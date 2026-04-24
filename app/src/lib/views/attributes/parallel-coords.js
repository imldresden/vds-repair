// Adapted from: https://gist.github.com/syntagmatic/2409451 and https://gist.github.com/mbostock/1341021
// d3v7 brushing example https://observablehq.com/@d3/brushable-parallel-coordinates

import { setPane, updateSidebarLegends } from '../../utils/controls.js';
import events from '../../utils/events.js';
import { fixed } from '../../utils/utils.js';
import { generateComparisonColor, getColorForNode } from '../../utils/colors.js';
import makeCtxMenu from './ctx-menu.js';
import {
  frequencies, histogram, violin, brushedHistogram,
} from './axis.js';
import d3 from '../imports/import-d3.js';
import { _ } from 'lodash';

function parallelCoords(pane, data, metadata) {
  let counts = {};
  const selections = new Map(); // stores dimension -> brush selection
  const highlighted = new Set(); // stores hover highlighting, always a subset of selections
  const compared = new Map(); // stores ID -> index for comparison highlighting
  let selected = {}; // stores data selection
  let extents = {}; // for preserving brushes on nominals and booleans
  let dimensions;
  let pcpHtml;
  const bounds = { min: 0, max: 1 };
  const scale = 2; // canvas resolution scale
  const stack = 5; // amount of line segments that can be stacked until full opacity
  let drawBrushedFn; // reference to drawBrushed function for public API

  // Initialize from cy.vars if available, otherwise default to false
  let coloredComparisonEnabled = pane.cy?.vars?.['pcp-colored-comparison']?.value ?? false;

  // Overlay state for multi-pane comparison
  let overlayState = {
    enabled: false,
    panes: [],  // array of {pane, data, metadata, visible, opacity}
    legend: null,  // DOM element
    showRibbons: false,  // show difference ribbons between matched nodes
    ribbonOpacity: 0.25,  // opacity of the ribbon fill
  };

  const publicFunctions = {
    destroy: () => {
      Object.values(pcpHtml).forEach((l) => {
        const layer = document.getElementById(l);
        if (layer) {
          layer.remove();
        }
      });
      d3.selectAll('#' + pcpHtml.div).remove();
      selections.clear();
      highlighted.clear();
      compared.clear();
      selected = {};
      extents = {};
      dimensions = undefined;
      pcpHtml = undefined;
    },
    getSelection: () => {
      return Object.values(selected).map((d) => {
        const returnable = {};
        Object.keys(metadata.pld).forEach((c) => {
          returnable[c] = d[c];
        });
        returnable.id = d.id;
        if (d.linkedId) {
          returnable.linkedId = d.linkedId;
        }
        return returnable;
      });
    },
    getOrder: () => {
      return dimensions;
    },
    redraw: () => {
      draw(pane, data);
    },
    setComparison: (nodeIds) => {
      compared.clear();
      nodeIds.forEach((id, idx) => compared.set(id, idx));
      if (drawBrushedFn) {
        drawBrushedFn();
      }
    },
    clearComparison: () => {
      compared.clear();
      if (drawBrushedFn) {
        drawBrushedFn();
      }
    },
    toggleColoredComparison: (enabled) => {
      coloredComparisonEnabled = enabled;
      if (drawBrushedFn) {
        drawBrushedFn();
      }
    },
    highlightNode: (nodeIds) => {
      if (!drawBrushedFn) return;
      highlighted.clear();
      // Accept single nodeId or array of nodeIds
      const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
      ids.forEach(id => {
        if (id) highlighted.add(id);
      });
      if (highlighted.size > 0) drawBrushedFn();
    },
    clearHighlight: () => {
      highlighted.clear();
      if (drawBrushedFn) {
        drawBrushedFn();
      }
    },
    enableOverlay: (overlayPanes) => {
      overlayState.enabled = true;
      overlayState.panes = overlayPanes.map(op => ({
        ...op,
        visible: true,
        opacity: 0.7,
      }));
      createOverlayLegend();
      if (drawBrushedFn) {
        drawBrushedFn();
      }
    },
    disableOverlay: () => {
      overlayState.enabled = false;
      overlayState.panes = [];
      if (overlayState.legend) {
        overlayState.legend.remove();
        overlayState.legend = null;
      }
      if (drawBrushedFn) {
        drawBrushedFn();
      }
      // Update sidebar to remove overlay legend
      updateSidebarLegends(pane);
    },
    toggleRibbons: (show) => {
      overlayState.showRibbons = show;
      if (drawBrushedFn) {
        drawBrushedFn();
      }
    },
    setRibbonOpacity: (opacity) => {
      overlayState.ribbonOpacity = Math.max(0.05, Math.min(1, opacity));
      if (drawBrushedFn) {
        drawBrushedFn();
      }
    },
    getOverlayState: () => {
      return {
        enabled: overlayState.enabled,
        panes: overlayState.panes.map(p => ({
          pane: p.pane,
          data: p.data,
          metadata: p.metadata,
          visible: p.visible,
          opacity: p.opacity,
        })),
        showRibbons: overlayState.showRibbons,
        ribbonOpacity: overlayState.ribbonOpacity,
      };
    },
  };

  function updateCountStrings() {
    const pcp_selection = publicFunctions.getSelection();
    const count = document.getElementById('count');
    const json = document.getElementById('json');

    if (count && json) {
      count.textContent = 'Selected elements: ' + pcp_selection.length;
      json.textContent = JSON.stringify(pcp_selection, undefined, 2);
    }
  }

  function createOverlayLegend() {
    // Legend is now handled by the sidebar through updateSidebarLegends
    // This function is kept for backward compatibility but delegates to sidebar
    updateSidebarLegends(pane);
  }

  function draw(pane, data) {
    function drawForeground(d, count = false, isThick = false) {
      const color = coloredComparisonEnabled
        ? getColorForNode(d.id)
        : getComputedStyle(div).getPropertyValue(d._color);
      foreground.strokeStyle = color;
      if (isThick) {
        foreground.lineWidth = 1 * scale;
        foreground.globalAlpha = 0.9;
      }
      path(d, foreground, count);
      if (isThick) {
        foreground.lineWidth = 1 * scale;
        foreground.globalAlpha = 1;
      }
    }

    function drawHighlight(d, count = false) {
      const color = coloredComparisonEnabled
        ? getColorForNode(d.id)
        : getComputedStyle(div).getPropertyValue('--pcp-hover-stroke');
      highlight.strokeStyle = color;
      highlight.lineWidth = 3 * scale; // Thicker line for visibility
      path(d, highlight, count);
    }

    function drawComparisonForeground(d, index, count = false) {
      const color = coloredComparisonEnabled
        ? generateComparisonColor(index)
        : getComputedStyle(div).getPropertyValue(d._color);
      foreground.strokeStyle = color;
      foreground.lineWidth = 1 * scale; // thicker lines for compared nodes
      foreground.globalAlpha = 0.9;
      path(d, foreground, count);
      // Reset line width and alpha
      foreground.lineWidth = 1 * scale;
      foreground.globalAlpha = 1;
    }

    function drawBoundIndicator(dim, selection, ctx) {
      const color = ctx.strokeStyle;
      const alpha = ctx.globalAlpha;
      const width = ctx.lineWidth;
      ctx.strokeStyle = getComputedStyle(div).getPropertyValue('--pcp-axes-lines');
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      let { x, y } = {};
      if (orient) {
        x = adjust(resp.scale(dim) + margin.left);
        y = adjust(resp.axes[dim](selection[1]) + margin.top);
      } else {
        x = adjust(resp.axes[dim](selection[0]) + margin.left);
        y = adjust(resp.scale(dim) + margin.top);
      }

      if (pane.cy.vars['pcp-bi'].value === 'o') {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.stroke();
      }

      if (pane.cy.vars['pcp-bi'].value === '><') {
        const t = 7;
        const pl = 4;
        const pr = pl + 1;

        ctx.beginPath();

        if (orient) {
          ctx.moveTo(x - t - pl, y - t);
          ctx.lineTo(x - pl, y);
          ctx.lineTo(x - t - pl, y + t);

          ctx.moveTo(x + t + pr, y - t);
          ctx.lineTo(x + pr, y);
          ctx.lineTo(x + t + pr, y + t);
        } else {
          ctx.moveTo(x - t, y - t - pl);
          ctx.lineTo(x, y - pl);
          ctx.lineTo(x + t, y - t - pl);

          ctx.moveTo(x - t, y + t + pr);
          ctx.lineTo(x, y + pr);
          ctx.lineTo(x + t, y + t + pr);
        }

        ctx.stroke();
      }

      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
    }

    // applies effect over duration
    function animate(g) {
      return g.transition().duration(500);
    }

    function checkIfActive(point) {
      const refine = !pane.cy.vars['pcp-refine'].value;
      if (refine) {
        if (metadata.preselected !== 0 && !point._selected) {
          return false;
        }
      } else if (!selections.size && !point._selected) {
        return false;
      }

      return Array.from(selections).every(([key, [min, max]]) => {
        const val = metadata.pld[key].type === 'number'
          ? point[key]
          : resp.axes[key].mapping[point[key]];
        return val >= Math.min(min, max) && val <= Math.max(min, max);
      });
    }

    function getAxisId(d) {
      const safe = String(d).replace(/[^a-zA-Z0-9_-]/g, '_');
      return pane.id + '_axis_' + safe;
    }

    // returns the dimension in x/y or modified in dragging
    function position(d) {
      const v = dragging[d];
      return v === undefined ? resp.scale(d) : v;
    }

    function checkExceedsStack(line, ctx, ds) {
      const l0 = orient ? fixed(line.l0.y) : fixed(line.l0.x);
      const l1 = orient ? fixed(line.l1.y) : fixed(line.l1.x);
      ctx.stacks[ds.d0] ||= {};
      ctx.stacks[ds.d0][ds.d1] ||= {};
      ctx.stacks[ds.d0][ds.d1][l0] ||= {};
      ctx.stacks[ds.d0][ds.d1][l0][l1] ||= 0;
      ctx.stacks[ds.d0][ds.d1][l0][l1] += 1;
      return ctx.stacks[ds.d0][ds.d1][l0][l1] > ctx.stack;
    }

    function segment(line, ctx, ds) {
      if (!checkExceedsStack(line, ctx, ds)) {
        ctx.beginPath();
        ctx.moveTo(line.l0.x, line.l0.y);
        ctx.lineTo(line.l1.x, line.l1.y);
        
        if (ds.isOverlap && ds.isForeground) {
          const originalStrokeStyle = ctx.strokeStyle;
          ctx.strokeStyle = '#0066cc';
          ctx.stroke();
          ctx.strokeStyle = originalStrokeStyle;
        } else {
          ctx.stroke();
        }
        
        ctx.segments.drawn += 1;
      } else {
        ctx.segments.skipped += 1;
      }
    }

    function adjust(v) {
      return scale * v - 1;
    }

    // returns the path for a given data point
    // this maps the generated x/y function for each of the data points to every dimension
    function path(point, ctx, count = false, isForeground = true) {
      const lines = orient
        ? (d0, d1) => ({
          l0: {
            x: adjust(resp.scale(d0) + margin.left),
            y: adjust(resp.axes[d0](point[d0]) + margin.top),
          },
          l1: {
            x: adjust(resp.scale(d1) + margin.left),
            y: adjust(resp.axes[d1](point[d1]) + margin.top),
          },
        })
        : (d0, d1) => ({
          l0: {
            x: adjust(resp.axes[d0](point[d0]) + margin.left),
            y: adjust(resp.scale(d0) + margin.top),
          },
          l1: {
            x: adjust(resp.axes[d1](point[d1]) + margin.left),
            y: adjust(resp.scale(d1) + margin.top),
          },
        });

      dimensions.forEach((d1, i) => {
        if (i > 0) {
          const d0 = dimensions[i - 1];
          const isOverlap = point._overlapAxioms && point._overlapAxioms.has(d0) && point._overlapAxioms.has(d1);
          segment(lines(d0, d1), ctx, { d0, d1, isOverlap, isForeground });
        }
        if (count) {
          const val = fixed(resp.axes[d1](point[d1]));
          counts[d1] ||= {};
          counts[d1][val] ||= 0;
          counts[d1][val] += 1;
        }
      });
    }

    function brush_start(e) {
      e.sourceEvent.stopPropagation();
    }

    // handles a brush event, updates selections
    function brush({ selection }, key) {
      if (selection === null || selection[0] === selection[1]) {
        selections.delete(key);
      } else {
        selections.set(key, selection.map(resp.axes[key].invert));
      }

      drawBrushed();
      updateCountStrings();
      if (pane.cy.vars['pcp-auto-sync'].value) {
        dispatchEvent(
          events.LINKED_SELECTION(pane.id, publicFunctions.getSelection()),
        );
      }
    }

    function drawBrushed() {
      selected = {};

      // Ensure consistent line width at start (may have been modified by overlay drawing)
      foreground.lineWidth = 1 * scale;
      foreground.globalAlpha = 1;

      [ // clear all canvas
        foreground,
        background,
        highlight,
      ].forEach(ctx => {
        const right = scale * (width + margin.left + margin.right + 10);
        const bottom = scale * (height + margin.top + margin.bottom + 10);
        ctx.clearRect(0, 0, right, bottom);
        ctx.stacks = {};
        ctx.segments = { drawn: 0, skipped: 0 };
      });
      counts = {};

      // get lines within extents
      data.map((d) => {
        const isCompared = compared.has(d.id);
        const comparisonIndex = compared.get(d.id);
        const isHighlighted = highlighted.has(d.id);

        if (checkIfActive(d)) {
          if (isHighlighted) {
            // Draw highlighted node (from graph hover) on highlight layer
            drawHighlight(d, true);
          } else if (compared.size > 0 && isCompared) {
            // Draw comparison nodes with thick lines and comparison-specific colors
            drawComparisonForeground(d, comparisonIndex, true);
          } else if (compared.size > 0 && !isCompared) {
            // Dim non-compared nodes when in comparison mode
            foreground.globalAlpha = 0.2;
            drawForeground(d, true, false);
            foreground.globalAlpha = 1;
          } else {
            // No comparison active - draw normal lines (colored if enabled)
            drawForeground(d, true, false);
          }
          selected[d.id] = d;
        } else {
          path(d, background, true, false);
        }
      });

      drawBoundIndicators();

      if (pane.cy.vars['pcp-dfs'].value) {
        dimensions.forEach(d => {
          frequencies(d3.select(`#${getAxisId(d)} > .axis`), {
            counts, name: d, orient,
          });
        });
      }

      // Update brushed histograms if enabled
      if (pane.cy.vars['pcp-hs'].value) {
        const selectedData = Object.values(selected);
        dimensions.forEach(dim => {
          const axis_g = d3.select(`#${getAxisId(dim)} > .axis`);
          brushedHistogram(axis_g, {
            orient,
            resp,
            name: dim,
            allData: data.map(d => d[dim]),
            brushedData: selectedData.map(d => d[dim]),
            brushedColor: '#3b82f6',
          });
        });
      }

      // Draw overlay panes last so they appear on top of all other lines
      if (overlayState.enabled && overlayState.panes.length > 0) {
        // First, detect overlapping data points across all visible overlay panes AND base pane
        const overlapColor = '#000000'; // Black for overlapping lines
        const overlapMap = new Map(); // Maps dimension values to pane indices

        // Add base pane data to overlap detection (use index -1 for base pane)
        data.forEach(d => {
          const canDraw = dimensions.every(dim => {
            return metadata.pld[dim] !== undefined && d[dim] !== undefined;
          });

          if (canDraw) {
            const key = dimensions.map(dim => d[dim]).join(',');
            if (!overlapMap.has(key)) {
              overlapMap.set(key, []);
            }
            overlapMap.get(key).push(-1); // -1 represents base pane
          }
        });

        // Build overlap detection map for overlay panes
        overlayState.panes.forEach((overlayPane, idx) => {
          if (!overlayPane.visible) return;

          const overlayData = overlayPane.data;
          const overlayMetadata = overlayPane.metadata;

          if (overlayData && overlayMetadata) {
            overlayData.forEach(od => {
              const canDraw = dimensions.every(dim => {
                return overlayMetadata.pld[dim] !== undefined && od[dim] !== undefined;
              });

              if (canDraw) {
                // Create a key from all dimension values
                const key = dimensions.map(dim => od[dim]).join(',');
                if (!overlapMap.has(key)) {
                  overlapMap.set(key, []);
                }
                overlapMap.get(key).push(idx);
              }
            });
          }
        });

        // Identify which keys represent overlaps (appear in multiple panes)
        const overlappingKeys = new Set();
        overlapMap.forEach((paneIndices, key) => {
          if (paneIndices.length > 1) {
            overlappingKeys.add(key);
          }
        });

        // Draw overlay lines with color based on overlap status
        overlayState.panes.forEach((overlayPane, idx) => {
          if (!overlayPane.visible) return;

          const paneColor = generateComparisonColor(idx);
          const originalAlpha = foreground.globalAlpha;
          const originalWidth = foreground.lineWidth;

          foreground.lineWidth = 1 * scale;
          foreground.globalAlpha = 1.0;

          const overlayData = overlayPane.data;
          const overlayMetadata = overlayPane.metadata;

          if (overlayData && overlayMetadata) {
            overlayData.forEach(od => {
              const canDraw = dimensions.every(dim => {
                return overlayMetadata.pld[dim] !== undefined && od[dim] !== undefined;
              });

              if (canDraw) {
                // Check if this line overlaps with other panes
                const key = dimensions.map(dim => od[dim]).join(',');
                const isOverlapping = overlappingKeys.has(key);

                // Set color: black for overlapping, pane color for unique
                foreground.strokeStyle = isOverlapping ? overlapColor : paneColor;

                // Temporarily override metadata for path function
                const originalPld = metadata.pld;
                metadata.pld = { ...originalPld, ...overlayMetadata.pld };
                path(od, foreground, false);
                metadata.pld = originalPld;
              }
            });
          }

          // Reset
          foreground.lineWidth = originalWidth;
          foreground.globalAlpha = originalAlpha;
        });

        // Draw difference ribbons between matched nodes (if enabled)
        if (overlayState.showRibbons) {
          drawDifferenceRibbons(
            overlayState,
            data,
            metadata,
            dimensions,
            yscale,
            types,
            margin,
            foreground,
            scale,
            adjust,
            generateComparisonColor,
            orient,
          );
        }
      }
    }

    // Assign to outer scope for public API access
    drawBrushedFn = drawBrushed;

    // sorting function by value, used in scales for each numerical dimension
    function basic_sort(a, b) {
      return position(a) - position(b);
    }

    function drawBrushMinMax(data, name, pane, which) {
      brushes['brush-' + getAxisId(name)].call(d3.brush().clear);
      const extent = d3.extent(data, (p) => +p[name]);
      const selection = [extent[bounds[which]], extent[bounds[which]]];
      selection.bound = which;
      selections.set(name, selection);
      drawBrushed();
      updateCountStrings();
      dispatchEvent(
        events.LINKED_SELECTION(pane.id, publicFunctions.getSelection()),
      );
    }

    function getPCPID(str) {
      return str + where.id;
    }

    const paneDiv = document.getElementById(pane.id);
    const detailHost = document.getElementById(pane.details);
    if (!paneDiv) {
      // after a pane has been destroyed, clean pcp when invoked from an event listener
      publicFunctions.destroy();
      return;
    }

    const detailRect = detailHost?.getBoundingClientRect();
    const where = {
      id: pane.details,
      width: detailRect?.width || paneDiv.getBoundingClientRect().width,
      height: detailRect?.height || (pane.height * pane.split),
    };

    pcpHtml = {
      div: getPCPID('pcp'),
      fg: getPCPID('foreground'),
      bg: getPCPID('background'),
      hl: getPCPID('highlight'),
      interact: getPCPID('interaction'),
    };

    d3.selectAll('#' + pcpHtml.div).remove();

    const d3div = d3
      .select('#' + where.id)
      .append('div')
      .attr('id', pcpHtml.div);

    const cols = Object.keys(metadata.pld);

    if (cols.length === 0) {
      return;
    }

    // determines whether the plot appears vertically or horizontally
    const orient = metadata.forceCompactDirection
      ? 0
      : (metadata.forceHorizontal
        ? 1
        : (metadata.forceVertical ? 0 : (where.width < where.height ? 0 : 1))); // 0: ☰, 1 |||

    // set up some margins and dimensions for the svg
    const margin = {
      top: orient ? 30 : 50,
      bottom: orient ? 30 : 50,
      right: orient ? 50 : 30,
      left: orient ? 50 : 30,
    };
    const width = where.width - margin.left - margin.right;
    const height = where.height - margin.top - margin.bottom;
    const brush_width = 8;

    if (width < 5 || height < 5) {
      return; // do not draw
    }

    // variables to draw the plot vertically or horizontally
    const resp = {
      axes: {},
      scale: d3.scalePoint().range([0, orient ? width : height], 1),
      scale_orient: [d3.axisTop(), d3.axisLeft()],
      svg_dims: [width, height],
      w_h: ['width', 'height'],
      x_y: ['x', 'y'],
      // anchor: ["end", "middle"],
      anchor: ['start', 'start'],
      // title: ["rotate(-20)", "rotate(-20)"],
      title: ['translate(0, 15)', 'translate(0) rotate(90)'],
      trans: ['translate(0, ', 'translate('],
    };

    let dragging = {};

    // variables to handle data points
    const axis = resp.scale_orient[orient].ticks(
      Math.max(2, Math.trunc(resp.svg_dims[orient] / 100, 0)),
    );

    d3div.append('canvas').attr('id', pcpHtml.bg);
    d3div.append('canvas').attr('id', pcpHtml.fg);
    d3div.append('canvas').attr('id', pcpHtml.hl);

    const div = document.getElementById(pcpHtml.div);

    d3.select('#' + where.id)
      .selectAll('#' + pcpHtml.fg + ', #' + pcpHtml.bg + ', #' + pcpHtml.hl)
      .attr('width', scale * (width + margin.left + margin.right))
      .attr('height', scale * (height + margin.top + margin.bottom))
      .style('width', (width + margin.left + margin.right) + 'px')
      .style('height', (height + margin.top + margin.bottom) + 'px');

    const foreground = div.querySelector('#' + pcpHtml.fg).getContext('2d');
    const background = div.querySelector('#' + pcpHtml.bg).getContext('2d');
    const highlight = div.querySelector('#' + pcpHtml.hl).getContext('2d');

    background.strokeStyle = getComputedStyle(div).getPropertyValue('--pcp-bg-stroke');
    highlight.strokeStyle = getComputedStyle(div).getPropertyValue('--pcp-hover-stroke');

    // make the base svg for parallel coordinates
    const svg = d3div
      .append('svg')
      .attr('id', pcpHtml.interact)
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    document.getElementById(pcpHtml.interact).onmousedown = () => {
      setPane(pane.id);
    };

    // get list of dimensions and create a scale for each, considering the data types.
    dimensions = cols.filter((d) => {
      if (metadata.nominals.includes(d)) {
        const domain = data
          .map((p) => p[d])
          .filter(d => d); // filter undefined
        resp.axes[d] = d3
          .scalePoint()
          .domain(domain)
          .range([0, resp.svg_dims[orient]])
          .padding(1);
        const axis = resp.axes[d];

        axis.linear = d3
          .scaleLinear()
          .domain([resp.svg_dims[orient], 0])
          .range([resp.svg_dims[orient], 0]);

        axis.invert = (pos) => axis.linear(pos);
        axis.mapping = {};
        axis.domain().forEach((d) => (axis.mapping[d] = axis(d)));
        return axis;
      } else if (metadata.booleans.includes(d)) {
        resp.axes[d] = d3
          .scalePoint()
          .domain([true, false])
          .range([0, resp.svg_dims[orient]])
          .padding(1);
        const axis = resp.axes[d];

        axis.linear = d3
          .scaleLinear()
          .domain([resp.svg_dims[orient], 0])
          .range([resp.svg_dims[orient], 0]);

        axis.invert = (pos) => axis.linear(pos);
        axis.mapping = {};
        axis.domain().forEach((d) => (axis.mapping[d] = axis(d)));
        return axis;
      } else if (metadata.data_id != d) {
        // numbers
        const de = d3.extent(data, (p) => +p[d]);
        const extent = [
          metadata.pld[d].min !== 'Infinity'
            ? metadata.pld[d].min
            : de[0],
          metadata.pld[d].max !== 'Infinity'
            ? metadata.pld[d].max
            : de[1],
        ];

        if (extent[0] === extent[1]) {
          extent[1] = extent[0] + 1;
        }

        // start/end on 0 when possible
        if (extent[0] > 0) {
          extent[0] = 0;
        }

        if (extent[1] < 0) {
          extent[1] = 0;
        }

        return (resp.axes[d] = d3
          .scaleLinear()
          .domain([extent[1], extent[0]])
          .range([0, resp.svg_dims[orient]]));
      }
    });

    resp.scale.domain(dimensions);

    [ // setup the drawing layers
      foreground,
      background,
      highlight,
    ].forEach(ctx => {
      ctx.globalAlpha = 1 / stack;
      ctx.lineWidth = scale * 2;
      ctx.stacks = {};
      ctx.stack = stack;
    });
    highlight.stack = 1;
    highlight.globalAlpha = 1;

    // hover highlighting: cursor area visual indicator
    const cursor_rect = svg
      .append('rect')
      .attr('class', 'cursor-area')
      .attr('width', 0)
      .attr('height', 0);
    const count_tooltip = svg
      .append('text')
      .attr('class', 'selection-count-tooltip');

    // group element for each dimension (axis) and add drag motion
    const g = svg
      .selectAll('.dimension')
      .data(dimensions)
      .enter()
      .append('g')
      .attr('id', (d) => getAxisId(d))
      .attr('class', () => 'dimension')
      .on('contextmenu', (e, d) => {
        e.axisName = d; // attaches axis information to the event for context menu
      })
      .attr('transform', (d) => resp.trans[orient] + resp.scale(d) + ')')
      .call( // axes reordering
        d3
          .drag()
          .subject((d) => orient ? { x: resp.scale(d) } : { y: resp.scale(d) })
          .on('start', (_, d) => {
            dragging[d] = resp.scale(d);
          })
          .on('drag', (e, d) => {
            dragging[d] = orient
              ? (e.subject.x = Math.min(
                width + margin.right,
                Math.max(-margin.left, e.x),
              ))
              : (e.subject.y = Math.min(
                height + margin.bottom,
                Math.max(-margin.top, e.y),
              ));
            dimensions.sort(basic_sort);
            resp.scale.domain(dimensions);
            drawBrushed();
            g.attr('transform', (d) => resp.trans[orient] + position(d) + ')');

            // ensure that new order is preserved on redraw:
            const pld = {};
            dimensions.forEach(key => pld[key] = metadata.pld[key]);
            metadata.pld = pld;
          })
          .on('end', (_, d) => {
            delete dragging[d];
            animate(d3.selectAll(`#${pane.id}_axis_${d}`)).attr(
              'transform',
              resp.trans[orient] + resp.scale(d) + ')',
            );
            drawBrushed();
          }),
      );

    const countTooltipUpdate = _.throttle((tooltip, mouse, text) => {
      tooltip.attr('x', mouse[0] + 10);
      tooltip.attr('y', mouse[1] - 10);
      tooltip.text(text);
    }, 50);

    function drawBoundIndicators() {
      dimensions.forEach(d => {
        const s = selections.get(d);
        if (s?.bound) {
          drawBoundIndicator(d, s, foreground);
        }
      });
    }

    // cursor logic
    svg.on('mousemove', (e) => {
      const right = scale * (width + margin.left + margin.right + 10);
      const bottom = scale * (height + margin.top + margin.bottom + 10);

      [
        highlight,
        foreground,
        background,
      ].forEach(ctx => {
        ctx.clearRect(0, 0, right, bottom);
        ctx.stacks = {};
        ctx.segments = { drawn: 0, skipped: 0 };
      });

      const mouse = d3.pointer(e); // [x, y]
      const cursor_pad = 20;

      // compute closest dimension
      let dim = dimensions[0];

      dimensions.forEach(d => {
        if (
          Math.abs(position(dim) - mouse[1 - orient])
          > Math.abs(position(d) - mouse[1 - orient])
        ) {
          dim = d;
        }
      });

      // disallow highlighting if outside cursor area wrt axes locations
      const mouse_scale_pos = resp.axes[dim].invert(mouse[orient]);
      const pixelRange = resp.axes[dim].range();
      const range = [resp.axes[dim].invert(pixelRange[0]), resp.axes[dim].invert(pixelRange[1])];

      if (
        Math.abs(position(dim) - mouse[1 - orient]) > cursor_pad
        || mouse_scale_pos > Math.max(range[0], range[1])
        || mouse_scale_pos < Math.min(range[0], range[1])
      ) {
        cursor_rect.attr(resp.w_h[orient], 0);
        cursor_rect.attr(resp.w_h[1 - orient], 0);
        countTooltipUpdate(count_tooltip, mouse, '');
        data.map((point) => {
          const active = checkIfActive(point);
          if (active && point[dim] !== undefined) {
            drawForeground(point);
          } else {
            path(point, background);
          }
        });
        drawBoundIndicators();

        // Redraw overlays if enabled
        if (overlayState.enabled && overlayState.panes.length > 0) {
          // First, detect overlapping data points across all visible overlay panes AND base pane
          const overlapColor = '#000000'; // Black for overlapping lines
          const overlapMap = new Map(); // Maps dimension values to pane indices

          // Add base pane data to overlap detection (use index -1 for base pane)
          data.forEach(d => {
            const canDraw = dimensions.every(dim => {
              return metadata.pld[dim] !== undefined && d[dim] !== undefined;
            });

            if (canDraw) {
              const key = dimensions.map(dim => d[dim]).join(',');
              if (!overlapMap.has(key)) {
                overlapMap.set(key, []);
              }
              overlapMap.get(key).push(-1); // -1 represents base pane
            }
          });

          // Build overlap detection map for overlay panes
          overlayState.panes.forEach((overlayPane, idx) => {
            if (!overlayPane.visible) return;

            const overlayData = overlayPane.data;
            const overlayMetadata = overlayPane.metadata;

            if (overlayData && overlayMetadata) {
              overlayData.forEach(od => {
                const canDraw = dimensions.every(dim => {
                  return overlayMetadata.pld[dim] !== undefined && od[dim] !== undefined;
                });

                if (canDraw) {
                  // Create a key from all dimension values
                  const key = dimensions.map(dim => od[dim]).join(',');
                  if (!overlapMap.has(key)) {
                    overlapMap.set(key, []);
                  }
                  overlapMap.get(key).push(idx);
                }
              });
            }
          });

          // Identify which keys represent overlaps (appear in multiple panes)
          const overlappingKeys = new Set();
          overlapMap.forEach((paneIndices, key) => {
            if (paneIndices.length > 1) {
              overlappingKeys.add(key);
            }
          });

          // Draw overlay lines with color based on overlap status
          overlayState.panes.forEach((overlayPane, idx) => {
            if (!overlayPane.visible) return;

            const paneColor = generateComparisonColor(idx);
            const originalAlpha = foreground.globalAlpha;
            const originalWidth = foreground.lineWidth;

            foreground.lineWidth = 1 * scale;
            foreground.globalAlpha = 1.0;

            const overlayData = overlayPane.data;
            const overlayMetadata = overlayPane.metadata;

            if (overlayData && overlayMetadata) {
              overlayData.forEach(od => {
                const canDraw = dimensions.every(dim => {
                  return overlayMetadata.pld[dim] !== undefined && od[dim] !== undefined;
                });

                if (canDraw) {
                  // Check if this line overlaps with other panes
                  const key = dimensions.map(dim => od[dim]).join(',');
                  const isOverlapping = overlappingKeys.has(key);

                  // Set color: black for overlapping, pane color for unique
                  foreground.strokeStyle = isOverlapping ? overlapColor : paneColor;

                  const originalPld = metadata.pld;
                  metadata.pld = { ...originalPld, ...overlayMetadata.pld };
                  path(od, foreground, false);
                  metadata.pld = originalPld;
                }
              });
            }

            foreground.lineWidth = originalWidth;
            foreground.globalAlpha = originalAlpha;
          });

          // Draw difference ribbons between matched nodes (if enabled)
          if (overlayState.showRibbons) {
            drawDifferenceRibbons(
              overlayState,
              data,
              metadata,
              dimensions,
              yscale,
              types,
              margin,
              foreground,
              scale,
              adjust,
              generateComparisonColor,
              orient,
            );
          }
        }

        return;
      }

      // compute cursor area wrt the scale value
      const mouse_upper_limit = resp.axes[dim].invert(
        mouse[orient] + cursor_pad,
      );
      const mouse_lower_limit = resp.axes[dim].invert(
        mouse[orient] - cursor_pad,
      );

      // update visual indicator
      cursor_rect.attr(resp.w_h[1 - orient], cursor_pad);
      cursor_rect.attr(resp.w_h[orient], cursor_pad * 2);
      cursor_rect.attr(resp.x_y[1 - orient], position(dim) - cursor_pad / 2);
      cursor_rect.attr(resp.x_y[orient], mouse[orient] - cursor_pad);

      // compare against mouse value only on closest dimension and within brush selections
      data.map((point) => {
        const active = checkIfActive(point);
        if (point[dim] !== undefined) {
          const val = metadata.pld[dim].type === 'number'
            ? point[dim]
            : resp.axes[dim].mapping[point[dim]];
          if (active) {
            if (
              val >= Math.min(mouse_lower_limit, mouse_upper_limit)
              && val <= Math.max(mouse_lower_limit, mouse_upper_limit)
            ) {
              highlighted.add(point.id);
              drawHighlight(point);
            } else {
              highlighted.delete(point.id);
              drawForeground(point);
            }
          } else {
            highlighted.delete(point.id);
            path(point, background);
          }
        } else {
          highlighted.delete(point.id);
        }
      });

      drawBoundIndicators();

      // Redraw overlays if enabled
      if (overlayState.enabled && overlayState.panes.length > 0) {
        // First, detect overlapping data points across all visible overlay panes AND base pane
        const overlapColor = '#000000'; // Black for overlapping lines
        const overlapMap = new Map(); // Maps dimension values to pane indices

        // Add base pane data to overlap detection (use index -1 for base pane)
        data.forEach(d => {
          const canDraw = dimensions.every(dim => {
            return metadata.pld[dim] !== undefined && d[dim] !== undefined;
          });

          if (canDraw) {
            const key = dimensions.map(dim => d[dim]).join(',');
            if (!overlapMap.has(key)) {
              overlapMap.set(key, []);
            }
            overlapMap.get(key).push(-1); // -1 represents base pane
          }
        });

        // Build overlap detection map for overlay panes
        overlayState.panes.forEach((overlayPane, idx) => {
          if (!overlayPane.visible) return;

          const overlayData = overlayPane.data;
          const overlayMetadata = overlayPane.metadata;

          if (overlayData && overlayMetadata) {
            overlayData.forEach(od => {
              const canDraw = dimensions.every(dim => {
                return overlayMetadata.pld[dim] !== undefined && od[dim] !== undefined;
              });

              if (canDraw) {
                // Create a key from all dimension values
                const key = dimensions.map(dim => od[dim]).join(',');
                if (!overlapMap.has(key)) {
                  overlapMap.set(key, []);
                }
                overlapMap.get(key).push(idx);
              }
            });
          }
        });

        // Identify which keys represent overlaps (appear in multiple panes)
        const overlappingKeys = new Set();
        overlapMap.forEach((paneIndices, key) => {
          if (paneIndices.length > 1) {
            overlappingKeys.add(key);
          }
        });

        // Draw overlay lines with color based on overlap status
        overlayState.panes.forEach((overlayPane, idx) => {
          if (!overlayPane.visible) return;

          const paneColor = generateComparisonColor(idx);
          const originalAlpha = foreground.globalAlpha;
          const originalWidth = foreground.lineWidth;

          foreground.lineWidth = 1 * scale;
          foreground.globalAlpha = 1.0;

          const overlayData = overlayPane.data;
          const overlayMetadata = overlayPane.metadata;

          if (overlayData && overlayMetadata) {
            overlayData.forEach(od => {
              const canDraw = dimensions.every(dim => {
                return overlayMetadata.pld[dim] !== undefined && od[dim] !== undefined;
              });

              if (canDraw) {
                // Check if this line overlaps with other panes
                const key = dimensions.map(dim => od[dim]).join(',');
                const isOverlapping = overlappingKeys.has(key);

                // Set color: black for overlapping, pane color for unique
                foreground.strokeStyle = isOverlapping ? overlapColor : paneColor;

                const originalPld = metadata.pld;
                metadata.pld = { ...originalPld, ...overlayMetadata.pld };
                path(od, foreground, false);
                metadata.pld = originalPld;
              }
            });
          }

          foreground.lineWidth = originalWidth;
          foreground.globalAlpha = originalAlpha;
        });

        // Draw difference ribbons between matched nodes (if enabled)
        if (overlayState.showRibbons) {
          drawDifferenceRibbons(
            overlayState,
            data,
            metadata,
            dimensions,
            yscale,
            types,
            margin,
            foreground,
            scale,
            adjust,
            generateComparisonColor,
            orient,
          );
        }
      }

      // console.log(`Highlighting layer drew: ${
      //   highlight.segments.drawn
      // } and saved ${
      //   highlight.segments.skipped
      // } segments`);

      countTooltipUpdate(count_tooltip, mouse, highlighted.size);
    });

    // axes and title.
    g.append('g')
      .attr('class', 'axis')
      .each(dim => {
        const axis_g = d3
          .select(`#${getAxisId(dim)} > .axis`)
          .call(axis.scale(resp.axes[dim]));

        if (pane.cy.vars['pcp-vs'].value) {
          violin(axis_g, {
            orient, resp, name: dim, data: data.map((d) => d[dim]),
          });
        }
        if (pane.cy.vars['pcp-hs'].value) {
          // Use brushedHistogram for consistent visualization
          // Initially all data is "brushed" (selected)
          brushedHistogram(axis_g, {
            orient,
            resp,
            name: dim,
            allData: data.map(d => d[dim]),
            brushedData: data.map(d => d[dim]),
            brushedColor: '#3b82f6',
          });
        }
      })
      .append('text')
      .attr('text-anchor', resp.anchor[orient])
      .attr('transform', resp.title[orient])
      .attr(resp.x_y[orient], -12)
      .text(String);

    // add and store a brush for each axis.
    const brushes = {};
    g.append('g')
      .attr('class', 'brush')
      .attr('id', (d) => 'brush-' + getAxisId(d))
      .each((d) => {
        const b = d3.select(`#brush-${getAxisId(d)}`);
        brushes['brush-' + getAxisId(d)] = b;

        if (orient) {
          b.call(
            (resp.axes[d].brush = d3.brushY().extent(
              [[-brush_width, 0], [brush_width, height]],
            )),
          );
        } else {
          b.call(
            (resp.axes[d].brush = d3.brushX().extent(
              [[0, -brush_width], [width, brush_width]],
            )),
          );
        }

        // preserve selections on redraw
        if (selections.get(d)) {
          if (!extents[d]) {
            const x = resp.axes[d](selections.get(d)[0]);
            const y = resp.axes[d](selections.get(d)[1]);
            b.call(resp.axes[d].brush.move, [x, y]);
          } else {
            const trans = d3
              .scaleLinear()
              .domain(extents[d])
              .range(resp.axes[d].linear.domain());

            selections.set(d, [trans(selections.get(d)[0]), trans(selections.get(d)[1])]);

            const x = resp.axes[d].linear(selections.get(d)[0]);
            const y = resp.axes[d].linear(selections.get(d)[1]);
            b.call(resp.axes[d].brush.move, [x, y]);
          }
        }

        // saves the extents of nominals and booleans so that they can be computed on resize
        if (resp.axes[d].linear) {
          extents[d] = resp.axes[d].linear.domain();
        }

        resp.axes[d].brush
          .on('start', brush_start)
          .on('brush', brush)
          .on('end', brush); // updates brush if clicked elsewhere on axis
      });

    makeCtxMenu(pane.details, pane, publicFunctions, {
      extras: [
        {
          label: 'Select Minimum',
          callback: (e) => drawBrushMinMax(data, e.axisName, pane, 'min'),
        },
        {
          label: 'Select Maximum',
          callback: (e) => drawBrushMinMax(data, e.axisName, pane, 'max'),
        },
        {
          label: 'Compare Selected Nodes',
          callback: () => {
            const selection = publicFunctions.getSelection();
            if (selection.length < 2) {
              alert('Please select at least 2 nodes to compare.');
            } else {
              const nodeIds = selection.map(s => s.id);
              publicFunctions.setComparison(nodeIds);

              // Also trigger the comparison dialog if we have access to cy
              if (pane.cy && pane.cy.nodes) {
                const nodes = nodeIds.map(id => pane.cy.$('#' + id)).filter(n => n.length > 0);
                if (nodes.length > 0 && window.buildComparisonTooltip) {
                  window.buildComparisonTooltip(pane.cy, nodes);
                }
              }
            }
          },
        },
        {
          label: 'Clear Comparison',
          callback: () => {
            publicFunctions.clearComparison();
          },
        },
      ],
    });

    drawBrushed();
    updateCountStrings();

    // Recreate overlay legend if overlay is enabled
    if (overlayState.enabled && overlayState.panes.length > 0) {
      createOverlayLegend();
    }
  }

  draw(pane, data);

  return publicFunctions;
};

// ============================================================================
// Difference Ribbons for PCP Overlay Comparison
// ============================================================================

/**
 * Draw difference ribbons between matched nodes in base pane and overlay panes.
 *
 * Creates filled polygons connecting the polylines of matched nodes with same ID
 * to visually highlight attribute differences between graphs. The ribbon fills
 * the area between the base and overlay polylines, making it easy to see where
 * and how values differ.
 *
 * @param {Object} overlayState - The overlay state object
 * @param {boolean} overlayState.enabled - Whether overlays are enabled
 * @param {Array} overlayState.panes - Array of overlay pane configurations
 * @param {number} overlayState.ribbonOpacity - Opacity for ribbon fills
 * @param {Array<Object>} baseData - Data array from the base pane
 * @param {Object} baseMetadata - Metadata for the base pane
 * @param {Array<string>} dimensions - Array of dimension names
 * @param {Function} yscale - Y-scale function for axis positioning
 * @param {Object} types - Object mapping dimension names to axis type configs
 * @param {Object} margin - Margin object with top, left, right, bottom
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D rendering context
 * @param {number} scale - Device pixel ratio scale factor
 * @param {Function} adjust - Coordinate adjustment function
 * @param {Function} getColorFn - Function that takes an index and returns a color string
 * @param {boolean} orient - Orientation (true = vertical, false = horizontal)
 */
function drawDifferenceRibbons(
  overlayState,
  baseData,
  baseMetadata,
  dimensions,
  yscale,
  types,
  margin,
  ctx,
  scale,
  adjust,
  getColorFn,
  orient,
) {
  if (!overlayState.enabled || overlayState.panes.length === 0) return;

  // Build a map of base pane nodes by ID for quick lookup
  const baseById = new Map();
  baseData.forEach((d) => {
    if (d.id) baseById.set(d.id, d);
  });

  // Save original context state
  const originalAlpha = ctx.globalAlpha;
  const originalWidth = ctx.lineWidth;

  // Process each overlay pane
  overlayState.panes.forEach((overlayPane, paneIdx) => {
    if (!overlayPane.visible) return;

    const overlayData = overlayPane.data;
    const overlayMetadata = overlayPane.metadata;
    if (!overlayData || !overlayMetadata) return;

    const paneColor = getColorFn(paneIdx);

    // Draw ribbon for each matched node pair
    overlayData.forEach((overlayPoint) => {
      const basePoint = baseById.get(overlayPoint.id);
      if (!basePoint) return; // No matching node in base pane

      // Verify both points have all required dimensions
      const canDrawBase = dimensions.every(
        (dim) => baseMetadata.pld[dim] !== undefined && basePoint[dim] !== undefined,
      );
      const canDrawOverlay = dimensions.every(
        (dim) => overlayMetadata.pld[dim] !== undefined && overlayPoint[dim] !== undefined,
      );

      if (!canDrawBase || !canDrawOverlay) return;

      // Calculate polyline points for both base and overlay
      const basePoints = calculatePolylinePoints(
        dimensions,
        basePoint,
        types,
        yscale,
        margin,
        adjust,
        orient,
      );
      const overlayPoints = calculatePolylinePoints(
        dimensions,
        overlayPoint,
        types,
        yscale,
        margin,
        adjust,
        orient,
      );

      // Skip if values are identical (no visible difference)
      if (!hasSignificantDifference(basePoints, overlayPoints)) return;

      // Draw the filled ribbon polygon
      drawRibbonPolygon(
        ctx,
        basePoints,
        overlayPoints,
        paneColor,
        overlayState.ribbonOpacity,
        scale,
      );
    });
  });

  // Restore original context state
  ctx.globalAlpha = originalAlpha;
  ctx.lineWidth = originalWidth;
}

/**
 * Calculate polyline points for a data point across all dimensions.
 *
 * @param {Array<string>} dimensions - Dimension names
 * @param {Object} dataPoint - Data point with dimension values
 * @param {Object} types - Axis type configurations
 * @param {Function} yscale - Y-scale function
 * @param {Object} margin - Margin object
 * @param {Function} adjust - Coordinate adjustment function
 * @param {boolean} orient - Orientation flag
 * @returns {Array<Object>} Array of {x, y} point objects
 */
function calculatePolylinePoints(dimensions, dataPoint, types, yscale, margin, adjust, orient) {
  return dimensions.map((dim) => {
    const axisScale = types[dim].scale;

    if (orient) {
      // Vertical orientation
      return {
        x: adjust(yscale(dim) + margin.left),
        y: adjust(axisScale(dataPoint[dim]) + margin.top),
      };
    } else {
      // Horizontal orientation
      return {
        x: adjust(axisScale(dataPoint[dim]) + margin.left),
        y: adjust(yscale(dim) + margin.top),
      };
    }
  });
}

/**
 * Check if there's a significant visual difference between two polylines.
 *
 * @param {Array<Object>} points1 - First polyline points
 * @param {Array<Object>} points2 - Second polyline points
 * @param {number} [threshold=1] - Minimum distance to consider as difference
 * @returns {boolean} True if polylines differ significantly
 */
function hasSignificantDifference(points1, points2, threshold = 1) {
  for (let i = 0; i < points1.length; i += 1) {
    const dist = Math.abs(points1[i].x - points2[i].x) + Math.abs(points1[i].y - points2[i].y);
    if (dist > threshold) {
      return true;
    }
  }
  return false;
}

/**
 * Draw a ribbon polygon connecting two polylines.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array<Object>} basePoints - Base polyline points
 * @param {Array<Object>} overlayPoints - Overlay polyline points
 * @param {string} color - Fill and stroke color
 * @param {number} opacity - Base opacity for fill
 * @param {number} scale - Scale factor for stroke width
 */
function drawRibbonPolygon(ctx, basePoints, overlayPoints, color, opacity, scale) {
  ctx.beginPath();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;

  // Forward path along base polyline
  ctx.moveTo(basePoints[0].x, basePoints[0].y);
  for (let i = 1; i < basePoints.length; i += 1) {
    ctx.lineTo(basePoints[i].x, basePoints[i].y);
  }

  // Backward path along overlay polyline (to close the polygon)
  for (let i = overlayPoints.length - 1; i >= 0; i -= 1) {
    ctx.lineTo(overlayPoints[i].x, overlayPoints[i].y);
  }

  ctx.closePath();
  ctx.fill();

  // Draw a thin stroke around the ribbon for better visibility
  ctx.globalAlpha = opacity * 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 * scale;
  ctx.stroke();
}

export { parallelCoords };
