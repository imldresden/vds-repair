import { _ } from 'lodash';
import tippy from 'tippy.js';

import { info, setInfo, BACKEND } from '../main/main.js';
import { getPanes } from '../views/panes/panes.js';
import { h, t } from './utils.js';
import { generateComparisonColor } from './colors.js';

// import { params as _elk } from '../views/graph/layout-options/elk.js';
import { params as _dagre } from '../views/graph/layout-options/dagre.js';
import { params as _klay } from '../views/graph/layout-options/klay.js';
import { params as _cola } from '../views/graph/layout-options/cola.js';
import { CONSTANTS } from './names.js';
import { handleEditorSelection } from '../views/editor.js';
import {
  markRecurringNodes,
  setMaxIteration,
  unmarkRecurringNodes,
} from '../views/graph/node-link.js';
import {
  enableMatrixView,
  disableMatrixView,
  isMatrixEnabled,
  updateMatrixLegendInSidebar,
} from '../views/matrix/matrix-view.js';
import { ndl_to_pcp } from '../views/format.js';
import { socket } from '../views/imports/import-socket.js';

const $ = document.querySelector.bind(document);
const $cy_config = $('#cy-config');
const $graph_config = $('#graph-config');
const $pcp_config = $('#pcp-config');
const $pane_config = $('#pane-config');
const $props_config = $('#props-config');
const $overview_config = $('#overview-config');

const url = new URL(window.location.href);
const params = new URLSearchParams(url.search);
const PROJECT = params.get('id') || 0;

let pane = null;
let tippies = {};
let opened = {};

const layoutTemplates = {
  cola: { value: 'cola', name: 'Cola', data: _cola },
  klay: { value: 'klay', name: 'Klay', data: _klay },
  dagre: { value: 'dagre', name: 'Dagre', data: _dagre },
  // elk: { value: 'elk', name: 'ELK', data: _elk },
};

const spinningIcon = 'loading spinner icon trigger-check-prop';
const triggerIcon = 'fa fa-rocket trigger-check-prop';

// updates all graphs active canvas space when a pane resize happens
$('#config-toggle')?.addEventListener('click', () => {
  $('body').classList.toggle('config-closed');
  $('#config-toggle').classList.toggle('icon-inactive');
  $('#config-toggle i').classList.toggle('fa-chevron-right');
  $('#config-toggle i').classList.toggle('fa-chevron-left');
  if (pane && pane.cy) {
    pane.cy.resize();
  }
});

// panes and settings rely heavily on this function to work
// this function is called by every interaction to ensure changes happen to the correct pane
// therefore, be careful when introducing expensive operations here.
async function setPane(paneId, { make = false, force = false } = {}) {
  const panes = getPanes();

  if (panes[paneId]) {
    if (pane && pane.id && panes[pane.id]) {
      if (force || pane.id !== paneId) {
        document.getElementById(pane.id).classList.remove('active-pane');
      } else {
        return; // nothing to change, avoid extra computations
      }
    }

    pane = panes[paneId];

    if (!pane.cy) {
      // since panes and graphs need to be spawned and then linked,
      // this error happens if the main view (node-link.js) didn't assign pane.cy
      console.error('Active pane has no engine assigned.');
    }

    if (make) {
      makeLayout(pane.cy.params);
      pane.cy._layout.pon('layoutstop', () => {
        const d = document.querySelector(`#${pane.id}  canvas`);
        d.pane = pane.id;
        info.observer.observe(d);
      });
      pane.cy._layout.run();
    }

    if (pane.cy?.vars?.ur?.fn) {
      document.onkeydown = (e) => pane.cy.vars['ur'].fn(pane.cy, e);
    } else {
      document.onkeydown = null;
    }
    document.getElementById('selected-pane').innerHTML = paneId;
    document.getElementById(pane.id).classList.add('active-pane');
    if (info.updating && pane.cy?.vars?.update?.fn) {
      await pane.cy.vars['update'].fn();
    }

    if (pane.cy?.vars?.panePosition) {
      createControllers(pane.cy.params);
    }

    // Update sidebar legends for active pane
    updateSidebarLegends(pane);

    socket.emit('active pane', paneId);
    handleEditorSelection(undefined, pane.cy);
    return pane.cy;
  } else {
    console.error('Attempted to activate a non-existing pane.');
  }
}

// creates and runs a similar
function makeLayout(opts, overwrite = false) {
  if (overwrite) {
    pane.cy.params = {};
  }

  Object.keys(opts).forEach(i => {
    pane.cy.params[i] = opts[i];
  });

  pane.cy._layout = pane.cy.layout(pane.cy.params);
}

function makeTippy(node, html, id) {
  if (tippies[id]) {
    tippies[id].hide();
    tippies[id].destroy();
    delete tippies[id];
    return;
  }

  const t = tippy(node.popperRef(), {
    title: id,
    html: html,
    trigger: 'manual',
    arrow: true,
    placement: 'bottom',
    hideOnClick: false,
    interactive: true,
  }).tooltips[0];

  tippies[id] = t;
  tippies[id].show();
}

function hideAllTippies() {
  Object.values(tippies).forEach((t) => {
    t.hide();
    t.destroy();
  });
  tippies = {};
}

// ============================================================================
// Sidebar Legend Management
// ============================================================================

/**
 * Update sidebar legends based on the currently active pane.
 * Clears existing legends and creates appropriate ones based on pane state
 * (matrix view, unified view, diff graph, PCP overlay, etc.).
 *
 * @param {Object} pane - The active pane object
 */
function updateSidebarLegends(pane) {
  const infoBox = document.getElementById('info-box');
  if (!infoBox) return;

  // Clear existing pane-specific legends
  infoBox.innerHTML = '';

  if (!pane || !pane.cy) return;

  // Check if pane is in matrix view OR is a multi-matrix view - if so, only show matrix legend
  if (isMatrixEnabled(pane) || pane.cy.multiMatrixData) {
    updateMatrixLegendInSidebar(pane);
    return;
  }

  // For node-link view, show other legends
  // Check for unified view legend data
  if (pane.cy.unifiedViewData) {
    createUnifiedViewLegendInSidebar(
      pane,
      pane.cy.unifiedViewData.paneList,
      pane.cy.unifiedViewData.graphColors,
    );
  }

  // Check for diff graph legend data
  if (pane.cy.isDiffGraph) {
    createDiffLegendInSidebar(pane);
  }

  // Check for PCP overlay legend data
  if (pane.cy.pcp && pane.cy.pcp.getOverlayState && pane.cy.pcp.getOverlayState().enabled) {
    createPcpOverlayLegendInSidebar(pane);
  }

  // Always show interactive node type legend for node-link view
  // KILLSWITCHED
  // createNodeTypeLegendInSidebar(pane);
}

/**
 * Create an interactive legend for node types in the sidebar.
 * Provides filtering and isolation capabilities:
 * - Single click: Highlight nodes of this type (dim others)
 * - Double-click: Isolate only this type (hide others completely)
 *
 * The legend dynamically updates node counts and supports:
 * - Standard state nodes
 * - Expanded nodes (with children)
 * - Marked nodes
 * - Diff graph types (added/removed/context)
 * - Unified view types (graph A only/graph B only/shared)
 *
 * @param {Object} pane - The pane object
 */
function createNodeTypeLegendInSidebar(pane) {
  const infoBox = document.getElementById('info-box');
  if (!infoBox || !pane || !pane.cy) return;

  const cy = pane.cy;

  // Define node types with their visual properties
  const nodeTypes = [
    {
      id: 'state',
      label: 'State Nodes',
      selector: 'node.s',
      color: '#555555',
      shape: 'rectangle',
      description: 'Regular state nodes',
    },
    {
      id: 'expanded',
      label: 'Expanded Nodes',
      selector: 'node.s[[outdegree > 0]]',
      color: '#555555',
      shape: 'rectangle',
      border: true,
      description: 'Nodes with visible children',
    },
    {
      id: 'marked',
      label: 'Marked Nodes',
      selector: 'node.s.marked',
      color: '#4caf50',
      shape: 'rectangle',
      description: 'User-marked nodes',
    },
  ];

  // Check if diff graph - add diff-specific types
  if (cy.isDiffGraph) {
    nodeTypes.push(
      {
        id: 'diff-added',
        label: 'Added (Graph B)',
        selector: 'node.diff-added',
        color: '#4caf50',
        shape: 'rectangle',
        description: 'Nodes only in Graph B',
      },
      {
        id: 'diff-removed',
        label: 'Removed (Graph A)',
        selector: 'node.diff-removed',
        color: '#f44336',
        shape: 'rectangle',
        description: 'Nodes only in Graph A',
      },
      {
        id: 'diff-context',
        label: 'Shared (Context)',
        selector: 'node.diff-context',
        color: '#9e9e9e',
        shape: 'rectangle',
        description: 'Nodes in both graphs',
      },
    );
  }

  // Check if unified view - add comparison types
  if (cy.unifiedViewData) {
    nodeTypes.push(
      {
        id: 'graph-a-only',
        label: 'Graph A Only',
        selector: 'node.graph-a-only',
        color: '#4caf50',
        shape: 'rectangle',
        description: 'Nodes unique to Graph A',
      },
      {
        id: 'graph-b-only',
        label: 'Graph B Only',
        selector: 'node.graph-b-only',
        color: '#f44336',
        shape: 'rectangle',
        description: 'Nodes unique to Graph B',
      },
      {
        id: 'graph-shared',
        label: 'Shared Nodes',
        selector: 'node.graph-shared',
        color: '#9e9e9e',
        shape: 'rectangle',
        description: 'Nodes in both graphs',
      },
    );
  }

  const legend = document.createElement('div');
  legend.id = `legend-node-types-${pane.id}`;
  legend.style.cssText = `
    background: #f9f9f9;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 10px;
    margin-bottom: 15px;
    font-size: 12px;
  `;

  const title = document.createElement('div');
  title.textContent = 'Node Types (click to filter)';
  title.style.cssText = `
    font-weight: bold;
    margin-bottom: 8px;
    font-size: 13px;
    border-bottom: 1px solid #ccc;
    padding-bottom: 5px;
  `;
  legend.appendChild(title);

  // Track active filter state
  let activeFilter = null;
  let isolatedType = null;

  // Store references to count badges for updating
  const countBadges = new Map();

  nodeTypes.forEach(nodeType => {
    const item = document.createElement('div');
    item.style.cssText = `
      display: flex;
      align-items: center;
      padding: 4px 6px;
      margin: 2px 0;
      cursor: pointer;
      border-radius: 3px;
      transition: background 0.15s;
    `;
    item.title = `Click: Highlight ${nodeType.label}\nDouble-click: Show only ${nodeType.label}`;

    // Color indicator
    const colorBox = document.createElement('span');
    const isOutline = nodeType.border || nodeType.id === 'expanded';
    colorBox.style.cssText = `
      display: inline-block;
      width: 14px;
      height: 10px;
      ${isOutline ? `border: 2px solid ${nodeType.color}; background: transparent;` : `background: ${nodeType.color};`}
      border-radius: ${nodeType.shape === 'rectangle' ? '2px' : '50%'};
      margin-right: 8px;
      flex-shrink: 0;
    `;

    const label = document.createElement('span');
    label.textContent = nodeType.label;
    label.style.cssText = 'flex: 1; font-size: 11px;';

    // Count badge
    const countBadge = document.createElement('span');
    const count = cy.$(nodeType.selector).length;
    countBadge.textContent = count;
    countBadge.style.cssText = `
      background: #e0e0e0;
      color: #555;
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 10px;
      min-width: 20px;
      text-align: center;
    `;
    countBadges.set(nodeType.id, { badge: countBadge, selector: nodeType.selector });

    item.appendChild(colorBox);
    item.appendChild(label);
    item.appendChild(countBadge);

    // Hover effect
    item.onmouseenter = () => {
      item.style.background = '#e8e8e8';
    };
    item.onmouseleave = () => {
      let nestedColor = (isolatedType === nodeType.id ? '#ffe0b2' : 'transparent');
      item.style.background = activeFilter === nodeType.id ? '#d0e8ff' : nestedColor;
    };

    // Helper function to reset all filters
    const resetFilters = () => {
      activeFilter = null;
      isolatedType = null;
      // Reset node/edge styles directly
      cy.batch(() => {
        cy.nodes().style({ opacity: 1, visibility: 'visible' });
        cy.edges().style({ opacity: 1, visibility: 'visible' });
      });
      legend.querySelectorAll('[data-node-type]').forEach(el => {
        el.style.background = 'transparent';
        el.style.opacity = '1';
      });
    };

    // Click: Highlight/filter this type
    item.onclick = (e) => {
      e.stopPropagation();

      // Update counts first
      countBadges.forEach((data) => {
        data.badge.textContent = cy.$(data.selector).length;
      });

      if (activeFilter === nodeType.id && !isolatedType) {
        // Deselect - show all
        resetFilters();
      } else {
        // Select this type
        activeFilter = nodeType.id;
        isolatedType = null;

        // Highlight matching nodes by dimming others
        const matchingNodes = cy.$(nodeType.selector);
        const nonMatchingNodes = cy.nodes().difference(matchingNodes);
        const matchingEdges = matchingNodes.connectedEdges();
        const nonMatchingEdges = cy.edges().difference(matchingEdges);

        cy.batch(() => {
          cy.nodes().style({ visibility: 'visible' });
          cy.edges().style({ visibility: 'visible' });
          matchingNodes.style({ opacity: 1 });
          matchingEdges.style({ opacity: 1 });
          nonMatchingNodes.style({ opacity: 0.15 });
          nonMatchingEdges.style({ opacity: 0.1 });
        });

        // Update item styling
        legend.querySelectorAll('[data-node-type]').forEach(el => {
          el.style.background = 'transparent';
          el.style.opacity = '1';
        });
        item.style.background = '#d0e8ff';
      }
    };

    // Double-click: Isolate only this type (hide others)
    item.ondblclick = (e) => {
      e.stopPropagation();

      if (isolatedType === nodeType.id) {
        // Restore all
        resetFilters();
      } else {
        // Isolate this type
        isolatedType = nodeType.id;
        activeFilter = nodeType.id;

        const matchingNodes = cy.$(nodeType.selector);
        const nonMatchingNodes = cy.nodes().difference(matchingNodes);
        const matchingEdges = matchingNodes.connectedEdges();
        const nonMatchingEdges = cy.edges().difference(matchingEdges);

        cy.batch(() => {
          matchingNodes.style({ opacity: 1, visibility: 'visible' });
          matchingEdges.style({ opacity: 1, visibility: 'visible' });
          nonMatchingNodes.style({ visibility: 'hidden' });
          nonMatchingEdges.style({ visibility: 'hidden' });
        });

        // Update item styling
        legend.querySelectorAll('[data-node-type]').forEach(el => {
          el.style.background = 'transparent';
          el.style.opacity = '0.5';
        });
        item.style.background = '#ffe0b2';
        item.style.opacity = '1';
      }
    };

    item.setAttribute('data-node-type', nodeType.id);
    legend.appendChild(item);
  });

  // Reset button
  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset Filter';
  resetBtn.style.cssText = `
    width: 100%;
    margin-top: 8px;
    padding: 4px 8px;
    background: #607d8b;
    color: white;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
  `;
  resetBtn.onmouseenter = () => resetBtn.style.background = '#455a64';
  resetBtn.onmouseleave = () => resetBtn.style.background = '#607d8b';
  resetBtn.onclick = () => {
    activeFilter = null;
    isolatedType = null;
    cy.batch(() => {
      cy.nodes().style({ opacity: 1, visibility: 'visible' });
      cy.edges().style({ opacity: 1, visibility: 'visible' });
    });
    legend.querySelectorAll('[data-node-type]').forEach(el => {
      el.style.background = 'transparent';
      el.style.opacity = '1';
    });
    // Update counts
    countBadges.forEach((data, id) => {
      data.badge.textContent = cy.$(data.selector).length;
    });
  };
  legend.appendChild(resetBtn);

  // Function to update all counts
  const updateAllCounts = () => {
    countBadges.forEach((data, id) => {
      data.badge.textContent = cy.$(data.selector).length;
    });
  };

  // Listen for class changes (e.g., marking nodes)
  const classChangeHandler = () => {
    // Debounce updates
    if (legend._updateTimeout) clearTimeout(legend._updateTimeout);
    legend._updateTimeout = setTimeout(updateAllCounts, 100);
  };

  // Register event listeners for node changes
  cy.on('add remove', 'node', classChangeHandler);

  // Listen for global mark/unmark events (both use action: 'mark')
  const globalActionHandler = (e) => {
    if (e.detail && e.detail.action === 'mark') {
      // Small delay to ensure class has been applied
      setTimeout(updateAllCounts, 50);
    }
  };
  document.addEventListener('global-action', globalActionHandler);

  // Store cleanup function on legend element for potential future cleanup
  legend._cleanup = () => {
    cy.off('add remove', 'node', classChangeHandler);
    document.removeEventListener('global-action', globalActionHandler);
  };

  infoBox.appendChild(legend);
}

/**
 * Create a legend for PCP (Parallel Coordinate Plot) overlays in the sidebar.
 * Shows which pane's data is overlaid on the current pane's PCP view,
 * with color coding and visibility toggles.
 *
 * @param {Object} pane - The pane object
 */
function createPcpOverlayLegendInSidebar(pane) {
  const infoBox = document.getElementById('info-box');
  if (!infoBox) return;

  const overlayState = pane.cy.pcp.getOverlayState();
  if (!overlayState
    || !overlayState.enabled
    || !overlayState.panes
    || overlayState.panes.length === 0
  ) return;

  const legend = document.createElement('div');
  legend.id = `legend-pcp-overlay-${pane.id}`;
  legend.style.cssText = `
    background: #f9f9f9;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 10px;
    margin-bottom: 15px;
    font-size: 12px;
  `;

  const title = document.createElement('div');
  title.textContent = 'PCP Overlays';
  title.style.cssText = `
    font-weight: bold;
    margin-bottom: 8px;
    font-size: 13px;
    border-bottom: 1px solid #ccc;
    padding-bottom: 5px;
  `;
  legend.appendChild(title);

  overlayState.panes.forEach((op, idx) => {
    const paneColor = generateComparisonColor(idx);
    const item = document.createElement('div');
    item.style.cssText = 'margin: 6px 0; padding-bottom: 6px; border-bottom: 1px solid #e0e0e0;';

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; margin-bottom: 3px;';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = op.visible;
    checkbox.style.cssText = 'margin-right: 6px; cursor: pointer;';
    checkbox.onchange = () => {
      op.visible = checkbox.checked;
      if (pane.cy.pcp && pane.cy.pcp.redraw) {
        pane.cy.pcp.redraw();
      }
    };

    const colorBox = document.createElement('span');
    colorBox.style.cssText = `
      display: inline-block;
      width: 12px;
      height: 12px;
      background: ${paneColor};
      border: 1px solid #333;
      margin-right: 6px;
      flex-shrink: 0;
    `;

    const label = document.createElement('span');
    const paneIdShort = op.pane.id.substring(0, 15);
    label.textContent = `${paneIdShort}${op.pane.id.length > 15 ? '...' : ''}`;
    label.style.cssText = 'font-size: 11px; flex: 1;';

    header.appendChild(checkbox);
    header.appendChild(colorBox);
    header.appendChild(label);
    item.appendChild(header);
    legend.appendChild(item);
  });

  // Add color explanation for overlapping lines
  const overlapNote = document.createElement('div');
  overlapNote.style.cssText = 'margin-top: 8px; padding-top: 8px; border-top: 1px solid #ccc;';

  const overlapItem = document.createElement('div');
  overlapItem.style.cssText = 'display: flex; align-items: center; margin: 4px 0;';
  const overlapBox = document.createElement('span');
  overlapBox.style.cssText = `
    display: inline-block;
    width: 12px;
    height: 12px;
    background: #000000;
    border: 1px solid #333;
    margin-right: 6px;
    flex-shrink: 0;
  `;
  const overlapLabel = document.createElement('span');
  overlapLabel.textContent = 'Overlapping lines';
  overlapLabel.style.cssText = 'font-size: 11px;';
  overlapItem.appendChild(overlapBox);
  overlapItem.appendChild(overlapLabel);
  overlapNote.appendChild(overlapItem);
  legend.appendChild(overlapNote);

  // Close button to disable overlay
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Disable Overlays';
  closeBtn.style.cssText = `
    width: 100%;
    margin-top: 8px;
    padding: 4px 8px;
    background: #f44336;
    color: white;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
  `;
  closeBtn.onmouseenter = () => closeBtn.style.background = '#d32f2f';
  closeBtn.onmouseleave = () => closeBtn.style.background = '#f44336';
  closeBtn.onclick = () => {
    if (pane.cy.pcp && pane.cy.pcp.disableOverlay) {
      pane.cy.pcp.disableOverlay();
      updateSidebarLegends(pane);
    }
  };
  legend.appendChild(closeBtn);

  infoBox.appendChild(legend);
}

// determines which layout values will be used (default cola-params.js)
function createControllers(params) {
  Array.from(document.getElementsByTagName('details'))
    .filter(d => d.id)
    .forEach(d => {
      opened[d.id] = d.open;
    });

  // pane-related
  $pane_config.innerHTML = '';
  makeAppendDropdown();
  makeSelectionModesDropdown();

  // props
  $props_config.innerHTML = '';
  makeDetailCheckboxes();
  makeSchedulerPropDropdown();
  $props_config.insertAdjacentHTML(
    'beforeend',
    `<div class="buttons param"> 
      <button class="ui button" id="clear">
        <span>Delete Properties</span>
      </button>
      <button class="ui button" id="status">
        <span>Print Status</span>
      </button>
    </div>`,
  );
  document.getElementById('clear').addEventListener('click', () => clear());
  document.getElementById('status').addEventListener('click', () => status());
  // graph view settings
  $graph_config.innerHTML = '';
  makeGraphComparisonSettings();
  makeViewModeToggle();

  // layout settings
  $cy_config.innerHTML = '';
  makeLayoutDropdown();

  if (params.controls) {
    params.controls.forEach((c) => {
      if (c.type === 'button') {
        makeParamButton(c);
      } else if (c.type === 'slider') {
        makeParamSlider(c);
      } else if (c.type === 'dropdown') {
        makeParamDropdown(c);
      } else if (c.type === 'toggle') {
        makeParamToggle(c);
      }
    });
  }

  makeImportExport();

  // recurring nodes setting
  makeRecurringNodeMarkSettings();

  // pcp config
  $pcp_config.innerHTML = '';
  makePCPSettings();

  // overview setting
  $overview_config.innerHTML = '';
  makeOverviewSettings();
}

function makeViewModeToggle() {
  const targetId = 'graph-comparison-config';
  const $target = document.getElementById(targetId) || $graph_config;

  // Duplikate vermeiden: entferne vorhandenen Block
  const existing = document.getElementById('matrix-view-controls');
  if (existing) existing.remove();

  const $wrap = h('div', {
    class: 'param',
    id: 'matrix-view-controls',
    style: 'margin-top:8px;',
  });
  const $label = h('p', { class: 'label label-default' }, [t('View Mode')]);

  const $btnWrap = h('div', { style: 'display:flex;align-items:center;gap:8px;' });

  // Check if this is a multi-matrix pane
  const isMultiMatrix = pane?.cy?.multiMatrixData;
  const initialText = isMultiMatrix ? 'Node-Link' : (isMatrixEnabled(pane) ? 'Node-Link' : 'Matrix');
  const $btn = h('button', { class: 'ui button' }, [h('span', {}, [t(initialText)])]);

  // Disable button for multi-matrix panes
  if (isMultiMatrix) {
    $btn.disabled = true;
    $btn.style.opacity = '0.5';
    $btn.style.cursor = 'not-allowed';
    $btn.title = 'View mode cannot be changed for Compare All views';
  }

  $btn.addEventListener('click', () => {
    if (!pane) return;
    // Compare-All (Multi-Matrix) panes keep their custom view; do not toggle to Node-Link/Matrix.
    if (pane.cy?.multiMatrixData) return;
    if (isMatrixEnabled(pane)) {
      disableMatrixView(pane);
    } else {
      enableMatrixView(pane);
    }
    // Button-Label aktualisieren
    $btn.innerText = isMatrixEnabled(pane) ? 'Node-Link' : 'Matrix';
  });

  $btnWrap.appendChild($btn);

  $wrap.appendChild($label);
  $wrap.appendChild($btnWrap);
  $target.appendChild($wrap);
}

function makeParamSlider(opts) {
  const value = opts.subParam
    ? pane.cy.params[opts.param][opts.subParam]
    : pane.cy.params[opts.param];
  const $input = h('input', {
    id: 'slider-' + opts.param,
    type: 'range',
    min: opts.min,
    max: opts.max,
    step: opts.step ? opts.step : 1,
    value: value,
    class: 'slider param-' + opts.param,
    oninput: 'this.nextElementSibling.value = this.value',
  });

  const $param = h('div', { class: 'param' });
  const $label = h(
    'p',
    { class: 'label label-default', for: 'slider-' + opts.param },
    [t(opts.label)],
  );
  const $output = h('output', { style: 'font-size: 10px' }, [t(value)]);

  $param.appendChild($label);
  $param.appendChild(h('div', { style: 'display:flex;' }, [$input, $output]));

  $cy_config.appendChild($param);

  const update = _.throttle(() => {
    if (opts.subParam) {
      pane.cy.params[opts.param] ||= {};
      pane.cy.params[opts.param][opts.subParam] = +$input.value;
    } else {
      pane.cy.params[opts.param] = +$input.value;
    }
    pane.cy._layout.stop();
    makeLayout(pane.cy.params);
    pane.cy._layout.run();
  }, 500);

  $input.addEventListener('input', update);
  // $input.addEventListener('change', update);
}

function makeParamButton(opts) {
  const $param = h('div', { class: '', style: 'display: flex' });

  const $button = h(
    'button',
    {
      class: 'ui button param param-' + opts.param,
    },
    [h('span', {}, [t(opts.label)])],
  );

  $button.addEventListener('click', () => {
    pane.cy._layout.stop();

    if (opts.fn) {
      opts.fn();
    }

    makeLayout(opts.layoutOpts);
    pane.cy._layout.run();
  });

  $param.appendChild($button);
  $cy_config.appendChild($param);
}

function makeParamToggle(opts) {
  const id = `checkbox-${opts.param}${opts.subParam ? opts.subParam : ''}`;

  const value = opts.subParam
    ? pane.cy.params[opts.param][opts.subParam]
    : pane.cy.params[opts.param];

  const $label = h('label', { class: 'label label-default', for: id }, [t(opts.label)]);
  const $param = h('div', {
    class: 'param ui small checkbox',
    style: 'display: flex',
  });
  const $toggle = h('input', {
    type: 'checkbox',
    name: id,
    id: id,
    class: 'param-' + opts.param,
    style: 'margin-right: 5px',
  });

  $toggle.checked = value;

  $param.appendChild($toggle);
  $param.appendChild($label);

  const update = (e) => {
    if (opts.subParam) {
      pane.cy.params[opts.param] ||= {};
      pane.cy.params[opts.param][opts.subParam] = e.target.checked;
    } else {
      pane.cy.params[opts.param] = e.target.checked;
    }

    pane.cy._layout.stop();
    makeLayout(pane.cy.params);
    pane.cy._layout.run();
  };

  $toggle.addEventListener('change', update);
  $cy_config.appendChild($param);
}

function makeParamDropdown(opts) {
  _makeDropdown(
    opts.options,
    opts.subParam
      ? pane.cy.params[opts.param][opts.subParam]
      : pane.cy.params[opts.param],
    (value) => {
      if (opts.subParam) {
        pane.cy.params[opts.param] ||= {};
        pane.cy.params[opts.param][opts.subParam] = value;
      } else {
        pane.cy.params[opts.param] = value;
      }

      pane.cy._layout.stop();
      makeLayout(pane.cy.params);
      pane.cy._layout.run();
    },
    'select-' + opts.param + (opts.subParam ? opts.subParam : ''),
    opts.label,
    $cy_config,
  );
}

function makeSelectionModesDropdown() {
  const modes = {
    s: { value: 's', name: 'States' },
    t: { value: 't', name: 'Actions' },
    's+t': { value: 's+t', name: 'States & Actions' },
  };

  _makeDropdown(
    Object.values(modes),
    pane.cy.vars['mode'].value,
    (value) => {
      pane.cy.vars['mode'].fn(pane.cy, value);
      createControllers(pane.cy.params);
    },
    'selection-mode',
    'Selection mode',
    $pane_config,
  );
}

function makeSchedulerPropDropdown() {
  const options = Object.keys(
    info.scheduler, // only scheduler from the 'details'
  ).map(k => {
    return { value: k, name: k };
  }).filter(m => info.scheduler[m.name] === 'ready');

  options.push({ value: '_none_', name: 'No scheduler' });

  _makeDropdown(
    Object.values(options),
    pane.cy.vars['scheduler'].value,
    (value) => {
      pane.cy.vars['scheduler'].fn(pane.cy, value);
    },
    'scheduler-prop',
    'Scheduler (DOI)',
    $props_config,
  );

  const $param = h('div', { class: 'param' });
  const $label = h('p', { class: 'label label-default param' }, [t('Simulation Steps')]);
  const $numberInput = h('input', {
    type: 'number',
    name: 'bestPathLength',
    id: 'bestPathLength',
    value: 5,
    min: 1,
  });
  const update = (e) => {
    const value = e.target.value;
    setMaxIteration(value);
    document.getElementById(`${pane.id}-expandN`).title = `${
      CONSTANTS.INTERACTIONS.expandN.name(value)
    } \t (${
      CONSTANTS.INTERACTIONS.expandN.keyboard
    })`;
    const ctxmenu = document.getElementById('expand-best-path');
    ctxmenu.title = `${
      CONSTANTS.INTERACTIONS.expandN.description(value)
    } \t (${
      CONSTANTS.INTERACTIONS.expandN.keyboard
    })`;
    ctxmenu.innerHTML = CONSTANTS.INTERACTIONS.expandN.name(value);
  };
  $numberInput.addEventListener('input', update);

  $param.appendChild($label);
  $param.appendChild($numberInput);
  $props_config.appendChild($param);
}

function updatePropsValues() {
  const original = pane.cy.vars['details'].value;
  const update = {};

  Object.keys(original).forEach((d) => {
    const cb = document.getElementById(`checkbox-${d}`);
    update[d] = {
      all: cb?.checked,
      props: {},
    };
    Object.keys(original[d].props).forEach((p) => {
      const cbp = document.getElementById(`checkbox-${d}-${p}`);
      update[d].props[p] = cbp?.checked;
    });
  });

  return update;
}

async function status() {
  const data = await socket.emitWithAck('MC_STATUS', PROJECT);
  console.log(data);
  return data;
}

async function triggerModelCheckProperty(e, propType, props) {
  e.target.className = spinningIcon;
  props.forEach((p) => {
    const button = document.getElementById(`trigger-button-${propType}-${p}`);
    if (button) button.className = spinningIcon;
  });

  fetch(
    `${BACKEND}/${PROJECT}/check?property=${props.join(
      '&property=',
    )}`,
    { method: 'GET' },
  );
}

socket.on('MC_STATUS', (status) => {
  setInfo(status.info);
  info.updating = true;
  setPane(pane.id, { force: true });
});

async function clear() {
  const request = await fetch(`${BACKEND}/${PROJECT}/clear`, {
    method: 'GET',
  });
  const response = await request.json();

  if (response.content.startsWith(CONSTANTS.MESSAGES.cleared_starts_with)) {
    const state = await status();
    setInfo(state.info);
    setPane(pane.id, { force: true });
  }

  console.log(response);
}

function makeDetailCheckboxes() {
  const $param = document.getElementById('props-checkboxes')
    || h('div', {
      class: 'param',
      id: 'props-checkboxes',
      style: 'display: block',
    });
  const $label = h(
    'span',
    { id: 'props-checkboxes-label', class: 'label label-default' },
    [t('Details to show')],
  );

  $param.innerHTML = '';
  $param.appendChild($label);

  const options = pane.cy.vars['details'].value;
  const mode = pane.cy.vars['mode'].value;

  Object.keys(options).forEach((k) => {
    const $toggle = h('input', {
      type: 'checkbox',
      class: 'checkbox-prop',
      id: `checkbox-${k}`,
      name: `checkbox-${k}`,
      style: 'margin-right: 5px',
      value: k,
    });
    $toggle.checked = options[k].all;

    $toggle.addEventListener('change', (e) => {
      Object.keys(options[k].props).forEach((p) => {
        document.getElementById(`checkbox-${k}-${p}`).checked = e.target.checked;
      });
      pane.cy.vars['details'].fn(pane.cy, {
        update: updatePropsValues(),
      });
    });

    let $input_div = h('div', { class: 'ui small checkbox' }, [$toggle, h('label', { for: `checkbox-${k}` })]);

    if (k === CONSTANTS.results) {
      const keys = Object.keys(options[k].metadata);
      const statuses = {
        ready: new Set(),
        computing: new Set(),
        missing: new Set(),
      };

      keys.forEach((a) => statuses[options[k].metadata[a].status].add(a));

      const ready = statuses.ready.size === keys.length;
      const computing = statuses.computing.size > 0;

      if (!ready) {
        $input_div = h('i', {
          class: computing ? spinningIcon : triggerIcon,
          id: `trigger-button-${k}`,
        });
        $input_div.addEventListener('click', (e) => {
          triggerModelCheckProperty(e, k, Array.from(statuses.missing));
          e.preventDefault();
        });
      }
    }

    if (mode !== 's+t') {
      if (!info.types[k].includes(mode)) return;
    }

    const id = `details-${k}`;
    const $option_label = h('details', {
      id,
      class: 'ui accordion',
    }, [
      h('summary', { class: 'title', style: 'display:flex' }, [
        h('i', { class: 'dropdown icon left' }, []),
        $input_div,
        h('p', { class: 'prop-text-label-text' }, [t(k)]),
      ]),
      h('div', { class: 'content' }, [...makeDetailPropsCheckboxes(options[k], k)]),
    ]);

    if (opened[id]) {
      $option_label.open = true;
    }

    $param.appendChild($option_label);
  });

  $props_config.appendChild($param);
}

function makeDetailPropsCheckboxes(options, propType) {
  const props = options.props;
  const toggles = [];
  const $param = h('div', {
    class: 'prop-checkboxes',
    id: `props-checkboxes-${propType}`,
    style: 'display: block',
  });
  const meta = pane.cy.vars['details'].value[propType].metadata;

  Object.keys(props).forEach((propName) => {
    const checked = props[propName];

    const $toggle = h('input', {
      type: 'checkbox',
      class: 'checkbox-prop',
      id: `checkbox-${propType}-${propName}`,
      name: `checkbox-${propType}-${propName}`,
      style: 'margin-right: 5px',
      value: propName,
    });

    $toggle.checked = checked;

    $toggle.addEventListener('change', () => {
      pane.cy.vars['details'].fn(pane.cy, {
        update: updatePropsValues(),
      });
    });

    let $input_div = h('div', {}, [$toggle, h('label', { for: `checkbox-${propType}-${propName}` })]);

    if (
      propType === CONSTANTS.results
      && options.metadata[propName].status !== CONSTANTS.STATUS.ready
    ) {
      const computing = options.metadata[propName].status === CONSTANTS.STATUS.computing;
      $input_div = h('i', {
        class: computing ? spinningIcon : triggerIcon,
        id: `trigger-button-${propType}-${propName}`,
      });
      $input_div.addEventListener('click', (e) => triggerModelCheckProperty(e, propType, [propName]));
    }

    const html = meta[propName] && meta[propName].identifier
      ? [
        meta[propName].icon
          ? h('i', {
            class: meta[propName].identifier + ' prop-text-label-icon',
          })
          : h('span', { class: 'prop-text-label-icon' }, [t(meta[propName].identifier)]),
        t(propName),
      ]
      : [t(propName)];

    const $div = h(
      'div',
      {
        class: 'prop-text ui small checkbox',
        style: 'display:flex',
      },
      [$input_div, h('p', { class: 'prop-text-label-text' }, html)],
    );

    $param.appendChild($div);
    toggles.push($param);
  });

  return toggles;
}

function makeLayoutDropdown() {
  _makeDropdown(
    Object.values(layoutTemplates),
    pane.cy.params.name,
    (value) => {
      pane.cy._layout.stop();
      const params = structuredClone(layoutTemplates[value].data);
      makeLayout(params, true);
      createControllers(params);
      pane.cy._layout.run();
    },
    'select-layout',
    'Layout',
    $cy_config,
  );
}

function makeImportExport() {
  const $buttons = h('div', { class: 'buttons param' }, []);
  const $buttonImport = h('button', { class: 'ui button' }, [h('span', {}, [t('Import')])]);
  const $buttonExport = h('button', { class: 'ui button' }, [h('span', {}, [t('Export')])]);

  $buttons.appendChild($buttonImport);
  $buttons.appendChild($buttonExport);

  $buttonExport.addEventListener('click', async () => {
    if (pane.cy) {
      pane.cy.fns.export(pane.cy);
    } else {
      console.error('No active pane to export');
    }
  });

  $buttonImport.addEventListener('click', async () => {
    if (pane.cy) {
      pane.cy.fns.import(pane.cy);
    } else {
      console.error('No active pane to import');
    }
  });

  $props_config.appendChild($buttons);
}

function _makeDropdown(options, value, fn, id, name, where) {
  const $select = h('select', {
    id: id,
    class: 'dropdown',
  });

  options.forEach((option) => {
    const $option = h('option', { value: option.value }, [t(option.name)]);
    $select.appendChild($option);
  });

  const $param = h('div', { class: 'param' });
  const $label = h('span', { class: 'label label-default', for: id }, [t(name)]);

  $param.appendChild($label);
  $param.appendChild($select);
  where.appendChild($param);

  $select.value = value;
  const update = _.throttle(() => fn($select.value), 500);
  $select.addEventListener('change', update);
}

function makeBoundIndicatorDropdown() {
  const options = {
    append: { value: '><', name: '> <' },
    insert: { value: 'o', name: 'o' },
  };

  _makeDropdown(
    Object.values(options),
    pane.cy.vars['pcp-bi'].value,
    (value) => {
      pane.cy.vars['pcp-bi'].fn(pane.cy, value);
    },
    'pcp-bound-indicator',
    'Indicator of Min/Max Selections',
    $pcp_config,
  );
}

function makePCPSettings() {
  $pcp_config.innerHTML = '';

  $pcp_config.appendChild(
    makeToggle('pcp-auto-sync'),
  );
  $pcp_config.appendChild(
    makeToggle('pcp-refine'),
  );
  $pcp_config.appendChild(
    makeToggle('pcp-hs'),
  );
  $pcp_config.appendChild(
    makeToggle('pcp-dfs'),
  );
  $pcp_config.appendChild(
    makeToggle('pcp-vs'),
  );

  makeBoundIndicatorDropdown();

  const countPrinter = h('div', { class: 'content' });
  countPrinter.innerHTML = `<pre 
    id="count" 
    style="
      height: 20px; 
      font-size: 10px"
    >${
      pane.cy.pcp
        ? 'Selected elements: ' + pane.cy.pcp.getSelection().length
        : null
    }</pre>`;
  $pcp_config.appendChild(countPrinter);

  const jsonPrinter = h('div', { class: 'content' });
  jsonPrinter.innerHTML = `<pre 
    id="json">${
      pane.cy.pcp
        ? JSON.stringify(pane.cy.pcp.getSelection(), undefined, 2)
        : null
    }</pre>`;
  const $label = h(
    'details',
    { class: 'ui accordion' },
    [
      h(
        'summary',
        { class: 'title' },
        [h('i', { class: 'dropdown icon left' }, []), t('Selection Printout')],
      ),
      jsonPrinter,
    ],
  );
  $pcp_config.appendChild($label);

  const $buttons = h('div', { class: 'buttons param' }, []);
  const $buttonExport = h(
    'button',
    { class: 'ui button' },
    [h('span', {}, [t('Export Selection')])],
  );

  $buttons.appendChild($buttonExport);

  $pcp_config.appendChild($buttons);
  $buttonExport.addEventListener('click', () => {
    if (pane.cy.pcp) {
      pane.cy.fns.export(
        pane.cy,
        pane.cy.pcp.getSelection().map((d) => d.id),
      );
    } else {
      document.getElementById('json').textContent = 'No Inspection View';
    }
  });
}

function makeRecurringNodeMarkSettings() {
  const $buttons = h(
    'div',
    { class: 'buttons param', id: 'parent-button' },
    [],
  );
  const $buttonMark = h('button', { class: 'ui button', id: 'child-button' }, [h('span', {}, [t('Mark recurring')])]);

  const $buttonUnmark = h(
    'button',
    { class: 'ui button', id: 'child-button' },
    [h('span', {}, [t('Unmark recurring')])],
  );

  $buttonMark.addEventListener('click', async () => {
    markRecurringNodes();
  });

  $buttonUnmark.addEventListener('click', async () => {
    unmarkRecurringNodes();
  });

  $buttons.appendChild($buttonMark);
  $buttons.appendChild($buttonUnmark);
  $graph_config.appendChild($buttons);
}

function makeGraphComparisonSettings() {
  const id = 'checkbox-graph-comparison';
  // avoid creating duplicates when controllers are rebuilt multiple times
  const existing = Array.from(document.querySelectorAll(`#${id}`));
  if (existing.length > 1) {
    // remove any extra copies, keep the first
    existing.slice(1).forEach((el) => el.closest('.param')?.remove());
  }
  if (existing.length > 0) return; // already present

  const $target = document.getElementById('graph-comparison-config');

  // Checkbox 1: Enable shared / unique colors
  const $label = h('label', { class: 'label label-default', for: id }, [t('Cross-pane Shared / Unique Colors')]);
  const $param = h('div', { class: 'param ui small checkbox', style: 'display: flex' });
  const $toggle = h('input', {
    type: 'checkbox',
    name: id,
    id: id,
    style: 'margin-right: 5px',
  });

  $param.appendChild($toggle);
  $param.appendChild($label);
  $target.appendChild($param);

  $toggle.addEventListener('change', (e) => {
    updateGraphComparison(e.target.checked);
  });

  // Checkbox 2: Enable curved connectors
  const id2 = 'checkbox-curved-connectors';
  const $label2 = h('label', { class: 'label label-default', for: id2 }, [t('Cross-pane curved connectors')]);
  const $param2 = h('div', { class: 'param ui small checkbox', style: 'display: flex' });
  const $toggle2 = h('input', {
    type: 'checkbox',
    name: id2,
    id: id2,
    style: 'margin-right: 5px',
  });

  $param2.appendChild($toggle2);
  $param2.appendChild($label2);
  $target.appendChild($param2);

  $toggle2.addEventListener('change', (e) => {
    updateCurvedConnectors(e.target.checked);
  });

  // Button: Show diff graph (added/removed)
  const $buttonDiff = h('button', {
    class: 'ui button',
    style: 'margin-top: 5px',
    title: 'Create new pane with a traditional\nadded/removed diff encoding',
  }, [h('span', {}, [t('Create Diff View')])]);
  $buttonDiff.addEventListener('click', () => {
    showPaneDiffDialog();
  });
  $target.appendChild($buttonDiff);

  // Button: Merge into unified view
  const $buttonMerge = h('button', {
    class: 'ui button',
    style: 'margin-top: 10px',
    title: 'Create a merge view\nfrom the contents of panes',
  }, [h('span', {}, [t('Create Unified View')])]);
  $buttonMerge.addEventListener('click', () => {
    showPaneMergeDialog();
  });
  $target.appendChild($buttonMerge);

  // Button: Compare All (pairwise matrix comparisons)
  // KILLSWITCHED
  // const $buttonCompareAll = h('button', {
  //   class: 'ui button',
  //   style: 'margin-top: 5px;',
  //   id: 'compare-all-btn',
  // }, [h('span', {}, [t('Compare All (pairwise matrix merges)')])]);
  // $buttonCompareAll.addEventListener('click', () => {
  //   showCompareAllDialog();
  // });
  // $target.appendChild($buttonCompareAll);

  // Button: Scatter-Diff View
  // KILLSWITCHED
  // const $buttonScatter = h('button', {
  //   class: 'ui button',
  //   style: 'margin-top: 5px',
  // }, [h('span', {}, [t('Scatter-Diff View (Attribute Distributions)')])]);
  // $buttonScatter.addEventListener('click', () => {
  //   showScatterDiffDialog();
  // });
  // $target.appendChild($buttonScatter);

  // Button: PCP Overlay (in-pane)
  const $buttonPcpOverlay = h('button', {
    class: 'ui button',
    style: 'margin-top: 5px',
    title: 'Add an overlay with the contents of another pane\nto the active pane\'s PCP',
  }, [h('span', {}, [t('Create PCP Overlay')])]);
  $buttonPcpOverlay.addEventListener('click', () => {
    showPcpOverlayDialog();
  });
  $target.appendChild($buttonPcpOverlay);
}

function updateGraphComparison(enabled) {
  const panes = getPanes();
  if (!enabled) {
    Object.values(panes).forEach((p) => {
      if (p.cy) {
        p.cy.startBatch();
        p.cy.nodes().removeClass('shared unique');
        p.cy.endBatch();
      }
    });
    return;
  }

  // count in how many panes each node id appears (exclude transition nodes)
  const counts = {};
  Object.values(panes).forEach((p) => {
    let ids = [];
    if (p.nodesIds && p.nodesIds instanceof Set) {
      ids = Array.from(p.nodesIds).filter((id) => !id.startsWith('t'));
    } else if (p.cy) {
      ids = p.cy.nodes().filter((n) => !n.data().id.startsWith('t')).map((n) => n.data().id);
    }
    const uniques = new Set(ids);
    uniques.forEach((id) => {
      counts[id] = (counts[id] || 0) + 1;
    });
  });

  // apply classes per pane (only to state nodes, not transition nodes)
  Object.values(panes).forEach((p) => {
    if (p.cy) {
      p.cy.startBatch();
      p.cy.nodes().forEach((n) => {
        const id = n.data().id;
        n.removeClass('shared unique');
        // skip transition nodes
        if (!id.startsWith('t')) {
          if (counts[id] > 1) {
            n.addClass('shared');
          } else {
            n.addClass('unique');
          }
        }
      });
      p.cy.endBatch();
    }
  });
}

function updateCurvedConnectors(enabled) {
  // Remove existing connectors
  const existingSvg = document.getElementById('curved-connectors-svg');
  if (existingSvg) {
    existingSvg.remove();
  }

  // Remove existing listeners
  const panes = getPanes();
  Object.values(panes).forEach((p) => {
    if (p.cy && p.cy._curvedConnectorListeners) {
      p.cy.off('position zoom pan mouseover mouseout', p.cy._curvedConnectorListeners);
      p.cy.off('mouseover', 'node', p.cy._curvedConnectorMouseOver);
      p.cy.off('mouseout', 'node', p.cy._curvedConnectorMouseOut);
      delete p.cy._curvedConnectorListeners;
      delete p.cy._curvedConnectorMouseOver;
      delete p.cy._curvedConnectorMouseOut;
    }
  });

  if (!enabled) {
    return;
  }

  const container = document.getElementById('container');
  if (!container) return;

  // Create SVG overlay
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'curved-connectors-svg';
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '1';
  container.style.position = 'relative';
  container.appendChild(svg);

  // Function to redraw all connectors
  const redrawConnectors = _.debounce((hoveredNodeId = null) => {
    // Clear existing paths
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }

    // Find matching nodes across panes
    const nodePositions = {}; // { nodeId: [{ paneId, x, y, cy }] }

    Object.values(panes).forEach((p) => {
      if (p.cy) {
        p.cy.nodes().forEach((n) => {
          const id = n.data().id;
          // Skip transition nodes
          if (id.startsWith('t')) return;

          const renderedPos = n.renderedPosition();
          const containerBounds = document.getElementById(p.container)?.getBoundingClientRect();
          const containerParentBounds = container.getBoundingClientRect();

          if (!containerBounds) return;

          const nodeX = containerBounds.left - containerParentBounds.left + renderedPos.x;
          const nodeY = containerBounds.top - containerParentBounds.top + renderedPos.y;

          nodePositions[id] = nodePositions[id] || [];
          nodePositions[id].push({
            paneId: p.id,
            x: nodeX,
            y: nodeY,
            cy: p.cy,
            containerBounds: {
              left: containerBounds.left - containerParentBounds.left,
              right: containerBounds.left - containerParentBounds.left + containerBounds.width,
              top: containerBounds.top - containerParentBounds.top,
              bottom: containerBounds.top - containerParentBounds.top + containerBounds.height,
            },
          });
        });
      }
    });

    // Draw curves between matching nodes
    Object.keys(nodePositions).forEach((nodeId) => {
      const positions = nodePositions[nodeId];
      if (positions.length < 2) return; // Need at least 2 occurrences

      const isHovered = hoveredNodeId === nodeId;
      const shouldGrayOut = hoveredNodeId && !isHovered;

      // Draw curves from each position to the next
      for (let i = 0; i < positions.length - 1; i++) {
        const start = positions[i];
        const end = positions[i + 1];

        // Check if nodes are hidden
        const startHidden = start.x < start.containerBounds.left || start.x > start.containerBounds.right
          || start.y < start.containerBounds.top || start.y > start.containerBounds.bottom;
        const endHidden = end.x < end.containerBounds.left || end.x > end.containerBounds.right
          || end.y < end.containerBounds.top || end.y > end.containerBounds.bottom;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

        let d;

        // Only draw connectors when both nodes are visible
        if (startHidden || endHidden) {
          // Skip this connector - don't draw anything
          continue;
        }

        // Normal curve when both nodes are visible
        const midX = (start.x + end.x) / 2;
        const controlOffset = Math.abs(end.x - start.x) * 0.3;
        d = `M ${start.x} ${start.y} Q ${midX} ${start.y - controlOffset}, ${end.x} ${end.y}`;

        path.setAttribute('d', d);
        path.setAttribute('stroke', shouldGrayOut ? '#cccccc' : '#439843');
        path.setAttribute('stroke-width', isHovered ? '4' : '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('opacity', shouldGrayOut ? '0.3' : (isHovered ? '0.9' : '0.6'));
        path.setAttribute('stroke-dasharray', '5,5');
        path.setAttribute('data-node-id', nodeId);

        svg.appendChild(path);
      }
    });
  }, 16);

  // Initial draw
  redrawConnectors();

  const handleMouseOver = (event) => {
    const node = event.target;
    const nodeId = node.data().id;
    if (!nodeId.startsWith('t')) {
      redrawConnectors(nodeId);
    }
  };

  const handleMouseOut = () => {
    redrawConnectors(null);
  };

  // Add listeners to all panes for responsive updates
  Object.values(panes).forEach((p) => {
    if (p.cy) {
      // Store the listener references for cleanup
      p.cy._curvedConnectorListeners = redrawConnectors;
      p.cy._curvedConnectorMouseOver = handleMouseOver;
      p.cy._curvedConnectorMouseOut = handleMouseOut;

      // Listen to position changes (drag), zoom, and pan events
      p.cy.on('position zoom pan', () => redrawConnectors(null));

      // Listen to mouse events on nodes
      p.cy.on('mouseover', 'node', handleMouseOver);
      p.cy.on('mouseout', 'node', handleMouseOut);
    }
  });
}

function makeAppendDropdown() {
  const appendOptions = {
    append: { value: 'end', name: 'Append to the end' },
    insert: { value: 'insert', name: 'Insert after active pane' },
  };

  _makeDropdown(
    Object.values(appendOptions),
    pane.cy.vars['panePosition'].value,
    (value) => {
      pane.cy.vars['panePosition'].fn(pane.cy, value);
    },
    'select-pane-position',
    'New Pane Position',
    $pane_config,
  );
}

function makeToggle(param) {
  const value = pane.cy.vars[param].value;
  const id = `checkbox-${param}`;

  const $label = h('label', {
    class: 'label label-default',
    for: id,
  }, [t(CONSTANTS.CONTROLS[param])]);
  const $param = h('div', {
    class: 'param ui small checkbox',
    style: 'display: flex',
  });
  const $toggle = h('input', {
    type: 'checkbox',
    name: id,
    id: id,
    class: 'param-' + param,
    style: 'margin-right: 5px',
  });

  $toggle.checked = value;
  $param.appendChild($toggle);
  $param.appendChild($label);

  const update = (e) => {
    pane.cy.vars[param].fn(pane.cy, e.target.checked);
  };

  $toggle.addEventListener('change', update);
  return $param;
}

function makeOverviewSettings() {
  const $buttonOverview = h(
    'button',
    { class: 'ui button', id: 'child-button' },
    [h('span', {}, [t('Show Overview Window')])],
  );
  $buttonOverview.addEventListener('click', async () => {
    window.open('/overview/', 'New Window', 'width=800,height=600');
  });
  $overview_config.appendChild($buttonOverview);
}

function showPaneMergeDialog() {
  const panes = getPanes();
  const paneList = Object.values(panes).filter(p => p.cy);

  if (paneList.length < 2) {
    alert('Need at least 2 panes to create a unified comparison view');
    return;
  }

  // Create checkboxes for each pane
  const checkboxHtml = paneList.map((p, idx) => `
    <div style="margin: 10px 0;">
      <input type="checkbox" id="merge-pane-${idx}" value="${idx}" ${idx < 2 ? 'checked' : ''} style="margin-right: 5px;">
      <label for="merge-pane-${idx}">Pane ${idx + 1}: ${p.id}</label>
    </div>
  `).join('');

  import('sweetalert2').then(({ default: Swal }) => {
    Swal.fire({
      title: 'Select Panes to Merge',
      html: `
        <div style="text-align: left; max-height: 400px; overflow-y: auto;">
          <p style="margin-bottom: 15px;">Select at least 2 panes to merge into a unified view:</p>
          ${checkboxHtml}
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Merge Selected',
      cancelButtonText: 'Cancel',
      preConfirm: () => {
        const selected = [];
        paneList.forEach((p, idx) => {
          const checkbox = document.getElementById(`merge-pane-${idx}`);
          if (checkbox && checkbox.checked) {
            selected.push(idx);
          }
        });

        if (selected.length < 2) {
          Swal.showValidationMessage('Please select at least 2 panes');
          return false;
        }

        if (selected.length > 8) {
          Swal.showValidationMessage('Maximum 8 panes can be selected');
          return false;
        }

        return selected;
      },
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        const selectedPanes = result.value.map(idx => paneList[idx]);
        // Check if any of the selected panes is in matrix view
        const isMatrixMode = selectedPanes.some(p => isMatrixEnabled(p));
        createUnifiedComparisonView(selectedPanes, isMatrixMode);
      }
    });
  });
}

function showPaneDiffDialog() {
  const panes = getPanes();
  const paneList = Object.values(panes).filter(p => p.cy);
  if (paneList.length < 2) {
    alert('Need at least 2 panes to compute a diff graph');
    return;
  }

  const checkboxHtml = paneList.map((p, idx) => `
    <div style="margin: 10px 0;">
      <input type="checkbox" id="diff-pane-${idx}" value="${idx}" ${idx < 2 ? 'checked' : ''} style="margin-right: 5px;">
      <label for="diff-pane-${idx}">Pane ${idx + 1}: ${p.id}</label>
    </div>
  `).join('');

  import('sweetalert2').then(({ default: Swal }) => {
    Swal.fire({
      title: 'Select Panes for Diff',
      html: `
        <div style="text-align: left; max-height: 400px; overflow-y: auto;">
          <p style="margin-bottom: 8px;">Pick a BASE pane (first checked) and one or more panes to compare against.</p>
          <p style="margin-bottom: 15px; font-size: 12px; color: #666;">Result shows only added/removed nodes and edges.</p>
          ${checkboxHtml}
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Compute diff',
      cancelButtonText: 'Cancel',
      preConfirm: () => {
        const selected = [];
        paneList.forEach((p, idx) => {
          const cb = document.getElementById(`diff-pane-${idx}`);
          if (cb && cb.checked) selected.push(idx);
        });
        if (selected.length < 2) {
          Swal.showValidationMessage('Please select at least 2 panes');
          return false;
        }
        if (selected.length > 8) {
          Swal.showValidationMessage('Maximum 8 panes can be selected');
          return false;
        }
        return selected;
      },
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        const selectedPanes = result.value.map(idx => paneList[idx]);
        // Check if any of the selected panes is in matrix view
        const isMatrixMode = selectedPanes.some(p => isMatrixEnabled(p));
        // First pane in selection is baseline
        createDiffGraph(selectedPanes, isMatrixMode);
      }
    });
  });
}

function showCompareAllDialog() {
  const panes = getPanes();
  const paneList = Object.values(panes).filter(p => p.cy);

  if (paneList.length < 2) {
    alert('Need at least 2 panes to compare');
    return;
  }

  // Create checkboxes for each pane
  const checkboxHtml = paneList.map((p, idx) => `
    <div style="margin: 10px 0;">
      <input type="checkbox" id="compare-all-pane-${idx}" value="${idx}" checked style="margin-right: 5px;">
      <label for="compare-all-pane-${idx}">Pane ${idx + 1}: ${p.id}</label>
    </div>
  `).join('');

  import('sweetalert2').then(({ default: Swal }) => {
    Swal.fire({
      title: 'Compare All - Multi-Matrix View',
      html: `
        <div style="text-align: left; max-height: 400px; overflow-y: auto;">
          <p style="margin-bottom: 10px;">Select panes to display in a grid matrix view:</p>
          <p style="margin-bottom: 15px; font-size: 12px; color: #666;">
            Selected panes will be shown side-by-side in a single matrix.<br>
            Layout: 2 columns, multiple rows as needed.
          </p>
          ${checkboxHtml}
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Create Multi-Matrix',
      cancelButtonText: 'Cancel',
      preConfirm: () => {
        const selected = [];
        paneList.forEach((p, idx) => {
          const checkbox = document.getElementById(`compare-all-pane-${idx}`);
          if (checkbox && checkbox.checked) {
            selected.push(idx);
          }
        });

        if (selected.length < 2) {
          Swal.showValidationMessage('Please select at least 2 panes');
          return false;
        }

        return selected;
      },
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        const selectedIndices = result.value;
        const selectedPanes = selectedIndices.map(idx => paneList[idx]);

        // Create a multi-matrix comparison view
        createMultiMatrixView(selectedPanes);
      }
    });
  });
}

function createMultiMatrixView(selectedPanes) {
  function buildPcpOverlayDataFromPanes(panes, modeValue, detailsProp) {
    const selector = modeValue === 's+t' ? '' : '.' + modeValue;

    return panes
      .filter(p => p?.cy)
      .map((p) => {
        let selected = 0;

        const { pl, pld } = ndl_to_pcp(
          {
            nodes: p.cy.$(`node${selector}`).map((n) => {
              const d = n.data();
              d._selected = n.selected();
              if (d._selected) selected += 1;
              return d;
            }),
          },
          detailsProp,
        );

        const hidden = new Set(['color']);
        const props = Object.keys(pld).filter((k) => !hidden.has(k));
        if (props.length === 0) return null;

        return {
          pane: p,
          data: pl,
          metadata: {
            data_id: 'id',
            nominals: props.filter((k) => pld[k].type === 'nominal'),
            booleans: props.filter((k) => pld[k].type === 'boolean'),
            numbers: props.filter((k) => pld[k].type === 'number'),
            pld,
            preselected: selected,
          },
        };
      })
      .filter(Boolean);
  }

  // Import the necessary modules
  import('../views/panes/panes.js').then((panesModule) => {
    import('../views/graph/node-link.js').then((graphModule) => {
      import('../views/matrix/multi-matrix-view.js').then(({ createMultiMatrix }) => {
        // Create a new pane for the multi-matrix view
        const paneIds = selectedPanes.map(p => p.id).join('-');
        const newPane = panesModule.spawnPane({
          spawner: selectedPanes.map(p => p.id),
          id: `Multi-Matrix-${paneIds}`,
        });

        // Use the first pane's params as baseline
        const baseline = selectedPanes[0];
        const params = baseline.cy.params ? structuredClone(baseline.cy.params) : { name: 'grid' };

        // Use the baseline pane's vars as template (avoidInClone fields are excluded)
        let vars = {};
        if (baseline.cy?.vars) {
          const varsValues = {};
          Object.keys(baseline.cy.vars).forEach((k) => {
            if (baseline.cy.vars[k].avoidInClone) {
              return;
            }
            varsValues[k] = {
              value: baseline.cy.vars[k].value,
            };
          });
          vars = structuredClone(varsValues);
        }

        // Seed the pane with the baseline graph so PCP can render
        const baselineJson = baseline.cy?.json ? baseline.cy.json() : null;
        const seedData = {
          nodes: [],
          edges: [],
          info: { name: 'Multi-Matrix View' },
          cyImport: baselineJson
            ? {
              elements: baselineJson.elements,
              style: baselineJson.style,
            }
            : { elements: { nodes: [], edges: [] }, style: [] },
        };

        graphModule.spawnGraph(newPane, seedData, params, vars);

        // Wait for Cytoscape to be initialized, then create multi-matrix view
        setTimeout(() => {
          if (newPane.cy) {
            // Store reference to the source panes in the Cytoscape instance
            newPane.cy.multiMatrixData = {
              sourcePanes: selectedPanes,
              paneNames: selectedPanes.map(p => p.id),
            };

            // Create and render the multi-matrix view
            createMultiMatrix(newPane, selectedPanes);

            // Enable PCP overlays for the remaining panes so Compare-All includes PCP comparison
            const modeValue = baseline.cy?.vars?.mode?.value ?? 's';
            const detailsProp = baseline.cy?.vars?.details?.value ?? {};
            const overlaySourcePanes = selectedPanes.slice(1);
            if (newPane.cy?.pcp?.enableOverlay && overlaySourcePanes.length > 0) {
              const overlayData = buildPcpOverlayDataFromPanes(
                overlaySourcePanes,
                modeValue,
                detailsProp,
              );
              if (overlayData.length > 0) {
                newPane.cy.pcp.enableOverlay(overlayData);
              }
            }

            // Update the pane title (but keep the pane.id as the container ID for DOM access)
            const displayName = `Multi-Matrix (${selectedPanes.length} panes)`;
            const titleElem = document.querySelector(`#${newPane.container} .pane-title`);
            if (titleElem) {
              titleElem.textContent = displayName;
            }
          }
        }, 100);
      });
    });
  });
}

// ============================================================================
// Unified View Legend
// ============================================================================

/**
 * Initialize unified view legend data on a pane.
 * Stores the pane list and graph colors for sidebar legend rendering.
 *
 * @param {Object} pane - The pane object
 * @param {Array<Object>} paneList - List of source panes being compared
 * @param {Array<string>} graphColors - Array of color strings for each graph
 */
function createUnifiedViewLegend(pane, paneList, graphColors) {
  // Store data in pane.cy for sidebar legend
  pane.cy.unifiedViewData = { paneList, graphColors };

  // Update sidebar if this is the active pane
  const activePane = document.querySelector('.active-pane');
  if (activePane && activePane.id === pane.id) {
    updateSidebarLegends(pane);
  }
}

/**
 * Create a unified view legend in the sidebar.
 * Shows which graphs are being compared and their color coding.
 * For two-graph comparisons, also shows presence indicators
 * (shared, graph A only, graph B only).
 *
 * @param {Object} pane - The pane object
 * @param {Array<Object>} paneList - List of source panes being compared
 * @param {Array<string>} graphColors - Array of color strings for each graph
 */
function createUnifiedViewLegendInSidebar(pane, paneList, graphColors) {
  const infoBox = document.getElementById('info-box');
  if (!infoBox) return;

  // Create legend container
  const legend = document.createElement('div');
  legend.id = `legend-unified-${pane.id}`;
  legend.style.cssText = `
    background: #f9f9f9;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 10px;
    margin-bottom: 15px;
    font-size: 12px;
  `;

  // Add title
  const title = document.createElement('div');
  title.textContent = 'Unified View Legend';
  title.style.cssText = `
    font-weight: bold;
    margin-bottom: 8px;
    font-size: 13px;
    border-bottom: 1px solid #ccc;
    padding-bottom: 5px;
  `;
  legend.appendChild(title);

  // Add description for merged views
  if (paneList.length === 2) {
    const desc = document.createElement('div');
    desc.textContent = 'Node/Edge colors indicate presence:';
    desc.style.cssText = `
      font-size: 11px;
      color: #666;
      margin-bottom: 8px;
    `;
    legend.appendChild(desc);
  }

  // Add legend items for each pane
  paneList.forEach((p, idx) => {
    const color = graphColors[idx];
    const item = document.createElement('div');
    item.style.cssText = `
      display: flex;
      align-items: center;
      margin: 5px 0;
    `;

    const colorBox = document.createElement('div');
    colorBox.style.cssText = `
      width: 16px;
      height: 16px;
      border: 2px solid ${color.border};
      background-color: ${color.bg};
      margin-right: 8px;
      border-radius: 3px;
      flex-shrink: 0;
    `;

    const label = document.createElement('span');
    const graphLabel = paneList.length === 2
      ? `Only in Graph ${idx + 1}`
      : `Graph ${idx + 1}: ${p.id.substring(0, 20)}${p.id.length > 20 ? '...' : ''}`;
    label.textContent = graphLabel;
    label.style.cssText = `
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
    `;

    item.appendChild(colorBox);
    item.appendChild(label);
    legend.appendChild(item);
  });

  // Add shared nodes indicator if multiple graphs
  if (paneList.length > 1) {
    const sharedItem = document.createElement('div');
    sharedItem.style.cssText = `
      display: flex;
      align-items: center;
      margin: 5px 0;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid #ccc;
    `;

    const sharedBox = document.createElement('div');
    sharedBox.style.cssText = `
      width: 16px;
      height: 16px;
      border: 2px solid #9e9e9e;
      background-color: #f5f5f5;
      margin-right: 8px;
      border-radius: 3px;
      flex-shrink: 0;
    `;

    const sharedLabel = document.createElement('span');
    sharedLabel.textContent = paneList.length === 2 ? 'Present in both' : 'Shared (all graphs)';
    sharedLabel.style.fontSize = '11px';

    sharedItem.appendChild(sharedBox);
    sharedItem.appendChild(sharedLabel);
    legend.appendChild(sharedItem);

    // Add partially shared indicator if more than 2 graphs
    if (paneList.length > 2) {
      const partialItem = document.createElement('div');
      partialItem.style.cssText = `
        display: flex;
        align-items: center;
        margin: 5px 0;
      `;

      const partialBox = document.createElement('div');
      partialBox.style.cssText = `
        width: 16px;
        height: 16px;
        border: 2px solid #ff9800;
        background-color: #fff3e0;
        margin-right: 8px;
        border-radius: 3px;
        flex-shrink: 0;
      `;

      const partialLabel = document.createElement('span');
      partialLabel.textContent = 'Partial (some graphs)';
      partialLabel.style.fontSize = '11px';

      partialItem.appendChild(partialBox);
      partialItem.appendChild(partialLabel);
      legend.appendChild(partialItem);
    }
  }

  infoBox.appendChild(legend);
}

function createUnifiedComparisonView(selectedPanes = null, isMatrixMode = false) {
  const panes = getPanes();
  let paneList;

  if (selectedPanes) {
    paneList = selectedPanes;
  } else {
    paneList = Object.values(panes).filter(p => p.cy);
    if (paneList.length < 2) {
      alert('Need at least 2 panes to create a unified comparison view');
      return;
    }
    paneList = paneList.slice(0, 2);
  }

  // Collect nodes and edges from all selected panes
  const nodeMap = new Map();
  const edgeMap = new Map();

  paneList.forEach((p, idx) => {
    p.cy.nodes().forEach(n => {
      const id = n.data().id;
      if (!nodeMap.has(id)) {
        nodeMap.set(id, { data: { ...n.data() }, panes: new Set() });
      }
      nodeMap.get(id).panes.add(idx);
    });

    p.cy.edges().forEach(e => {
      const edgeId = `${e.data().source}-${e.data().target}`;
      if (!edgeMap.has(edgeId)) {
        edgeMap.set(edgeId, { data: { ...e.data() }, panes: new Set() });
      }
      edgeMap.get(edgeId).panes.add(idx);
    });
  });

  // Color assignment for multi-graph comparison
  const graphColors = [
    { border: '#4287f5', bg: '#e3f2fd' },  // Graph 0
    { border: '#f54242', bg: '#ffebee' },  // Graph 1
    { border: '#9c27b0', bg: '#f3e5f5' },  // Graph 2
    { border: '#ff9800', bg: '#fff3e0' },  // Graph 3
    { border: '#4caf50', bg: '#e8f5e9' },  // Graph 4
    { border: '#00bcd4', bg: '#e0f7fa' },  // Graph 5
    { border: '#ffeb3b', bg: '#fffde7' },  // Graph 6
    { border: '#795548', bg: '#efebe9' },  // Graph 7
  ];

  // Create elements with appropriate classes
  const elements = { nodes: [], edges: [] };

  nodeMap.forEach(({ data, panes: nodePanes }) => {
    let classes = [];

    if (nodePanes.size === paneList.length) {
      // Node appears in all graphs - use shared styling
      classes.push('graph-shared');
    } else if (nodePanes.size === 1) {
      // Node appears in only one graph
      const graphIdx = Array.from(nodePanes)[0];
      if (graphIdx === 0) {
        classes.push('graph-a-only');
      } else if (graphIdx === 1) {
        classes.push('graph-b-only');
      } else {
        // For graphs beyond A and B, we'll use inline styles
        classes.push(`graph-${graphIdx}-only`);
      }
    } else {
      // Node appears in multiple but not all graphs - mark as partially shared
      classes.push('graph-partial-shared');
    }

    // Preserve existing classes (like 's' or 't')
    const existingClasses = data.classes || '';
    if (existingClasses) {
      classes.push(existingClasses);
    }

    elements.nodes.push({
      data: {
        ...data,
        graphMembership: Array.from(nodePanes), // Store which graphs this node belongs to
      },
      classes: classes.join(' '),
    });
  });

  edgeMap.forEach(({ data, panes: edgePanes }) => {
    let classes = [];

    // Determine edge class based on source and target node membership
    const sourceNode = nodeMap.get(data.source);
    const targetNode = nodeMap.get(data.target);

    if (edgePanes.size === paneList.length) {
      classes.push('graph-shared-edge');
    } else if (edgePanes.size === 1) {
      const graphIdx = Array.from(edgePanes)[0];
      if (graphIdx === 0) {
        classes.push('graph-a-edge');
      } else if (graphIdx === 1) {
        classes.push('graph-b-edge');
      } else {
        classes.push(`graph-${graphIdx}-edge`);
      }
    } else {
      classes.push('graph-partial-shared-edge');
    }

    // Check if edge crosses between graphs (source in one, target in another)
    if (sourceNode && targetNode) {
      const sourceGraphs = sourceNode.panes;
      const targetGraphs = targetNode.panes;

      // Check if there's any graph where one endpoint is present but the other isn't
      let isCrossEdge = false;
      for (let i = 0; i < paneList.length; i++) {
        const sourceHasGraph = sourceGraphs.has(i);
        const targetHasGraph = targetGraphs.has(i);
        if (sourceHasGraph !== targetHasGraph) {
          isCrossEdge = true;
          break;
        }
      }

      if (isCrossEdge) {
        classes = ['graph-cross-edge'];
      }
    }

    elements.edges.push({
      data: {
        ...data,
        graphMembership: Array.from(edgePanes),
      },
      classes: classes.join(' '),
    });
  });

  // Prepare data for spawning
  const nodesIds = Array.from(nodeMap.keys()).filter(id => !id.startsWith('t'));

  // Import spawnPane and spawnGraph dynamically
  import('../views/panes/panes.js').then(panesModule => {
    import('../views/graph/node-link.js').then(graphModule => {
      const paneIds = paneList.map(p => p.id).join('-');
      const pane = panesModule.spawnPane(
        {
          spawner: paneList.map(p => p.id),
          id: `UNIFIED-${paneIds}`,
        },
        nodesIds,
        paneList.flatMap(p => p.spawnerNodes || []),
      );

      // Use the first pane's params and vars as template
      let vars = {};
      if (paneList[0].cy.vars) {
        const varsValues = {};
        Object.keys(paneList[0].cy.vars).forEach(k => {
          if (paneList[0].cy.vars[k].avoidInClone) {
            return;
          }
          varsValues[k] = {
            value: paneList[0].cy.vars[k].value,
          };
        });
        vars = structuredClone(varsValues);
      }

      const data = {
        nodes: elements.nodes.map(n => n.data),
        edges: elements.edges.map(e => e.data),
        info: info,
        cyImport: {
          elements: elements,
          style: paneList[0].cy.json().style,
        },
      };

      graphModule.spawnGraph(pane, data, structuredClone(paneList[0].cy.params), vars);

      // Create legend for the unified comparison view
      createUnifiedViewLegend(pane, paneList, graphColors);

      // Add custom styling for graphs beyond A and B after graph is created
      setTimeout(() => {
        const cy = pane.cy;
        if (cy && paneList.length > 2) {
          // Apply dynamic styles for additional graphs
          cy.nodes().forEach(node => {
            const membership = node.data('graphMembership');
            if (membership && membership.length === 1) {
              const graphIdx = membership[0];
              if (graphIdx >= 2 && graphIdx < graphColors.length) {
                const color = graphColors[graphIdx];
                node.style({
                  'border-color': color.border,
                  'background-color': color.bg,
                  color: '#000000',
                });
              }
            } else if (membership && membership.length > 1 && membership.length < paneList.length) {
              // Partially shared - use a mixed indicator
              node.style({
                'border-color': '#ff9800',
                'background-color': '#fff3e0',
                color: '#000000',
              });
            }
          });

          cy.edges().forEach(edge => {
            const membership = edge.data('graphMembership');
            if (membership && membership.length === 1) {
              const graphIdx = membership[0];
              if (graphIdx >= 2 && graphIdx < graphColors.length) {
                const color = graphColors[graphIdx];
                edge.style({
                  'line-color': color.border,
                  'target-arrow-color': color.border,
                });
              }
            } else if (membership && membership.length > 1 && membership.length < paneList.length) {
              edge.style({
                'line-color': '#ff9800',
                'target-arrow-color': '#ff9800',
                'line-style': 'dotted',
              });
            }
          });
        }
      }, 100);

      // Enable matrix view if source panes were in matrix mode
      if (isMatrixMode) {
        setTimeout(() => {
          enableMatrixView(pane);
        }, 200);
      }
    });
  });
}

// ============================================================================
// Diff Graph Legend
// ============================================================================

/**
 * Initialize diff graph legend data on a pane.
 * Sets the isDiffGraph flag and triggers sidebar legend update.
 *
 * @param {Object} pane - The pane object
 */
function createDiffLegend(pane) {
  // Store flag in pane.cy for sidebar legend
  pane.cy.isDiffGraph = true;

  // Update sidebar if this is the active pane
  const activePane = document.querySelector('.active-pane');
  if (activePane && activePane.id === pane.id) {
    updateSidebarLegends(pane);
  }
}

/**
 * Create a diff graph legend in the sidebar.
 * Shows summary statistics (added/removed/context counts) and provides
 * filtering controls for isolating specific diff categories.
 *
 * The legend includes:
 * - KPI badges showing counts of added/removed/context nodes
 * - Color-coded legend items with click-to-filter functionality
 * - Filter dropdown for isolating specific diff states
 *
 * @param {Object} pane - The pane object with diff graph data
 */
function createDiffLegendInSidebar(pane) {
  const infoBox = document.getElementById('info-box');
  if (!infoBox) return;

  const legend = document.createElement('div');
  legend.id = `legend-diff-${pane.id}`;
  legend.style.cssText = `
    background: #f9f9f9;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 10px;
    margin-bottom: 15px;
    font-size: 12px;
  `;

  const title = document.createElement('div');
  title.textContent = 'Diff Graph Summary';
  title.style.cssText = `
    font-weight: bold;
    margin-bottom: 8px;
    font-size: 13px;
    border-bottom: 1px solid #ccc;
    padding-bottom: 5px;
  `;
  legend.appendChild(title);

  // KPI Summary Section
  const diffSummary = pane.cy?.diffSummary;
  if (diffSummary) {
    const kpiSection = document.createElement('div');
    kpiSection.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 12px;
      padding: 8px;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
    `;

    // Helper to create KPI badge
    const createKpiBadge = (label, count, color, bgColor) => {
      const badge = document.createElement('div');
      badge.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px;
        border-radius: 3px;
        background: ${bgColor};
        border-left: 3px solid ${color};
        cursor: pointer;
        transition: transform 0.1s, box-shadow 0.1s;
      `;
      badge.title = `Click to filter: show only ${label.toLowerCase()}`;

      const countSpan = document.createElement('span');
      countSpan.textContent = count;
      countSpan.style.cssText = `font-weight: bold; font-size: 14px; color: ${color};`;

      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      labelSpan.style.cssText = 'font-size: 10px; color: #666;';

      badge.appendChild(countSpan);
      badge.appendChild(labelSpan);

      badge.addEventListener('mouseenter', () => {
        badge.style.transform = 'scale(1.02)';
        badge.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
      });
      badge.addEventListener('mouseleave', () => {
        badge.style.transform = 'scale(1)';
        badge.style.boxShadow = 'none';
      });

      return badge;
    };

    // Create KPI badges for nodes
    const addedNodesBadge = createKpiBadge('Added', diffSummary.addedNodes, '#1b5e20', '#e8f5e9');
    const removedNodesBadge = createKpiBadge('Removed', diffSummary.removedNodes, '#b71c1c', '#ffebee');
    const contextNodesBadge = createKpiBadge('Context', diffSummary.contextNodes, '#616161', '#fafafa');
    const totalNodesBadge = createKpiBadge('Total Nodes', diffSummary.totalNodes, '#1565c0', '#e3f2fd');

    kpiSection.appendChild(addedNodesBadge);
    kpiSection.appendChild(removedNodesBadge);
    kpiSection.appendChild(contextNodesBadge);
    kpiSection.appendChild(totalNodesBadge);

    legend.appendChild(kpiSection);

    // Filter buttons for interactive filtering
    const filterSection = document.createElement('div');
    filterSection.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 10px;
    `;

    const filterState = { added: true, removed: true, context: true };

    const createFilterBtn = (label, diffClass, color, stateKey) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `
        padding: 3px 8px;
        font-size: 10px;
        border: 1px solid ${color};
        background: ${color}20;
        color: ${color};
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.15s;
      `;

      const updateStyle = () => {
        if (filterState[stateKey]) {
          btn.style.background = `${color}20`;
          btn.style.color = color;
          btn.style.fontWeight = 'normal';
        } else {
          btn.style.background = '#f0f0f0';
          btn.style.color = '#999';
          btn.style.borderColor = '#ccc';
        }
      };

      btn.addEventListener('click', () => {
        filterState[stateKey] = !filterState[stateKey];
        updateStyle();
        applyDiffFilter(pane, filterState);
      });

      return btn;
    };

    const addedBtn = createFilterBtn('Added', 'diff-added', '#1b5e20', 'added');
    const removedBtn = createFilterBtn('Removed', 'diff-removed', '#b71c1c', 'removed');
    const contextBtn = createFilterBtn('Context', 'diff-context', '#616161', 'context');

    const filterLabel = document.createElement('span');
    filterLabel.textContent = 'Filter:';
    filterLabel.style.cssText = 'font-size: 10px; color: #666; margin-right: 4px; align-self: center;';

    filterSection.appendChild(filterLabel);
    filterSection.appendChild(addedBtn);
    filterSection.appendChild(removedBtn);
    filterSection.appendChild(contextBtn);

    legend.appendChild(filterSection);
  }

  // Legend items section
  const legendTitle = document.createElement('div');
  legendTitle.textContent = 'Legend';
  legendTitle.style.cssText = 'font-size: 11px; color: #666; margin-bottom: 6px;';
  legend.appendChild(legendTitle);

  // Added nodes/edges
  const addedItem = document.createElement('div');
  addedItem.style.cssText = 'display:flex;align-items:center;margin:5px 0;';
  const addedBox = document.createElement('div');
  addedBox.style.cssText = 'width:16px;height:16px;border:2px solid #1b5e20;background:#e8f5e9;margin-right:8px;flex-shrink:0;';
  const addedLabel = document.createElement('span');
  addedLabel.textContent = 'Added node / edge';
  addedLabel.style.fontSize = '11px';
  addedItem.appendChild(addedBox);
  addedItem.appendChild(addedLabel);
  legend.appendChild(addedItem);

  // Removed nodes/edges
  const removedItem = document.createElement('div');
  removedItem.style.cssText = 'display:flex;align-items:center;margin:5px 0;';
  const removedBox = document.createElement('div');
  removedBox.style.cssText = 'width:16px;height:16px;border:2px solid #b71c1c;background:#ffebee;margin-right:8px;flex-shrink:0;';
  const removedLabel = document.createElement('span');
  removedLabel.textContent = 'Removed node / edge';
  removedLabel.style.fontSize = '11px';
  removedItem.appendChild(removedBox);
  removedItem.appendChild(removedLabel);
  legend.appendChild(removedItem);

  // Context (unchanged)
  const contextItem = document.createElement('div');
  contextItem.style.cssText = 'display:flex;align-items:center;margin:5px 0;';
  const contextBox = document.createElement('div');
  contextBox.style.cssText = 'width:16px;height:16px;border:2px dashed #9e9e9e;background:#fafafa;margin-right:8px;flex-shrink:0;';
  const contextLabel = document.createElement('span');
  contextLabel.textContent = 'Context (unchanged)';
  contextLabel.style.fontSize = '11px';
  contextItem.appendChild(contextBox);
  contextItem.appendChild(contextLabel);
  legend.appendChild(contextItem);

  // Baseline note
  const note = document.createElement('div');
  note.textContent = diffSummary
    ? `Baseline: ${diffSummary.baselinePaneId}`
    : 'Baseline = first selected pane.';
  note.style.cssText = 'margin-top:8px;font-size:10px;color:#666;padding-top:8px;border-top:1px solid #ccc;';
  legend.appendChild(note);

  // Connectivity toggle
  const toggleWrap = document.createElement('div');
  toggleWrap.style.cssText = 'display:flex;align-items:center;margin-top:8px;gap:6px;';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.id = `toggle-ss-${pane.id}`;
  toggle.checked = true;
  const toggleLbl = document.createElement('label');
  toggleLbl.setAttribute('for', toggle.id);
  toggleLbl.textContent = 'Show connectivity';
  toggleLbl.style.cssText = 'cursor:pointer;font-size:11px;';
  toggleWrap.appendChild(toggle);
  toggleWrap.appendChild(toggleLbl);
  legend.appendChild(toggleWrap);

  toggle.addEventListener('change', (e) => {
    const show = e.target.checked;
    const cy = pane.cy;
    if (!cy) return;
    const sel = cy.edges('.diff-collapsed-context');
    if (show) {
      sel.style({
        display: 'element', 'line-color': '#9e9e9e', 'target-arrow-color': '#9e9e9e', 'line-style': 'dashed', opacity: 0.4, width: 1, 'target-arrow-shape': 'triangle',
      });
    } else {
      sel.style({ display: 'none' });
    }
  });

  infoBox.appendChild(legend);
}

/**
 * Apply diff type filter to show/hide nodes and edges in a diff graph.
 * Filters nodes by their diff class (added/removed/context) and
 * only shows edges where both endpoints are visible.
 *
 * @param {Object} pane - The pane object with diff graph
 * @param {Object} filterState - Filter state object
 * @param {boolean} filterState.added - Show added nodes/edges
 * @param {boolean} filterState.removed - Show removed nodes/edges
 * @param {boolean} filterState.context - Show context (unchanged) nodes/edges
 */
function applyDiffFilter(pane, filterState) {
  const cy = pane.cy;
  if (!cy) return;

  cy.startBatch();

  // Filter nodes by diff class
  cy.nodes('.diff-added').style('display', filterState.added ? 'element' : 'none');
  cy.nodes('.diff-removed').style('display', filterState.removed ? 'element' : 'none');
  cy.nodes('.diff-context').style('display', filterState.context ? 'element' : 'none');

  // Filter edges - only show if both endpoints are visible
  cy.edges().forEach((edge) => {
    const sourceNode = cy.getElementById(edge.data('source'));
    const targetNode = cy.getElementById(edge.data('target'));
    const sourceVisible = sourceNode.style('display') !== 'none';
    const targetVisible = targetNode.style('display') !== 'none';

    if (edge.hasClass('diff-added')) {
      edge.style('display', filterState.added && sourceVisible && targetVisible ? 'element' : 'none');
    } else if (edge.hasClass('diff-removed')) {
      edge.style('display', filterState.removed && sourceVisible && targetVisible ? 'element' : 'none');
    } else if (edge.hasClass('diff-context') || edge.hasClass('diff-collapsed-context')) {
      edge.style('display', filterState.context && sourceVisible && targetVisible ? 'element' : 'none');
    }
  });

  cy.endBatch();
}

/**
 * Create a diff graph comparing multiple panes.
 * Shows nodes/edges as added (only in compared panes), removed (only in baseline),
 * or context (in both).
 *
 * @param {Array<Object>} selectedPanes - Array of panes to compare (first is baseline)
 * @param {boolean} [isMatrixMode=false] - Whether to display as matrix view
 */
function createDiffGraph(selectedPanes, isMatrixMode = false) {
  if (!selectedPanes || selectedPanes.length < 2) return;
  const baseline = selectedPanes[0];
  const others = selectedPanes.slice(1);

  // Collect baseline nodes/edges
  const baseNodes = new Set();
  const baseEdges = new Set();
  baseline.cy.nodes().forEach(n => { if (!n.id().startsWith('t')) baseNodes.add(n.id()); });
  baseline.cy.edges().forEach(e => {
    const s = e.data('source');
    const t = e.data('target');
    if (s?.startsWith('t') || t?.startsWith('t')) return; // skip transition edges
    baseEdges.add(`${s}-${t}`);
  });

  // Collect all other nodes/edges
  const otherNodes = new Set();
  const otherEdges = new Set();
  others.forEach(p => {
    p.cy.nodes().forEach(n => { if (!n.id().startsWith('t')) otherNodes.add(n.id()); });
    p.cy.edges().forEach(e => {
      const s = e.data('source');
      const t = e.data('target');
      if (s?.startsWith('t') || t?.startsWith('t')) return; // skip transition edges
      otherEdges.add(`${s}-${t}`);
    });
  });

  // Compute added / removed
  const addedNodes = [...otherNodes].filter(n => !baseNodes.has(n));
  const removedNodes = [...baseNodes].filter(n => !otherNodes.has(n));
  const addedEdges = [...otherEdges].filter(e => !baseEdges.has(e));
  const removedEdges = [...baseEdges].filter(e => !otherEdges.has(e));
  const contextNodes = [...baseNodes].filter(n => otherNodes.has(n));
  const contextEdges = [...baseEdges].filter(e => otherEdges.has(e));

  // Build diff summary (KPI data)
  const diffSummary = {
    addedNodes: addedNodes.length,
    removedNodes: removedNodes.length,
    contextNodes: contextNodes.length,
    addedEdges: addedEdges.length,
    removedEdges: removedEdges.length,
    contextEdges: contextEdges.length,
    totalNodes: addedNodes.length + removedNodes.length + contextNodes.length,
    totalEdges: addedEdges.length + removedEdges.length + contextEdges.length,
    baselinePaneId: baseline.id,
    comparedPaneIds: others.map(p => p.id),
  };

  // Build element data maps
  const nodeDataMap = {};
  const collectData = (paneRef) => {
    paneRef.cy.nodes().forEach(n => {
      if (n.id().startsWith('t')) return;
      if (!nodeDataMap[n.id()]) nodeDataMap[n.id()] = { ...n.data() };
    });
  };
  collectData(baseline);
  others.forEach(p => collectData(p));

  const edgeDataMap = {};
  const collectEdgeData = (paneRef) => {
    paneRef.cy.edges().forEach(e => {
      const s = e.data('source');
      const t = e.data('target');
      if (s?.startsWith('t') || t?.startsWith('t')) return; // skip transition edges
      const key = `${s}-${t}`;
      edgeDataMap[key] ||= { ...e.data(), source: s, target: t };
    });
  };
  collectEdgeData(baseline);
  others.forEach(p => collectEdgeData(p));

  const elements = { nodes: [], edges: [] };
  addedNodes.forEach(id => elements.nodes.push({ data: { ...nodeDataMap[id], id }, classes: 'diff-added' }));
  removedNodes.forEach(id => elements.nodes.push({ data: { ...nodeDataMap[id], id }, classes: 'diff-removed' }));
  contextNodes.forEach(id => elements.nodes.push({ data: { ...nodeDataMap[id], id }, classes: 'diff-context' }));
  // Only include edges whose endpoints exist among included nodes
  const nodeSet = new Set(elements.nodes.map(n => n.data.id));
  const pushIfEndpointsPresent = (k, klass) => {
    const [s, t] = k.split('-');
    if (nodeSet.has(s) && nodeSet.has(t)) {
      const ed = edgeDataMap[k] || { source: s, target: t, id: k };
      elements.edges.push({ data: ed, classes: klass });
    }
  };
  addedEdges.forEach(k => pushIfEndpointsPresent(k, 'diff-added'));
  removedEdges.forEach(k => pushIfEndpointsPresent(k, 'diff-removed'));
  contextEdges.forEach(k => pushIfEndpointsPresent(k, 'diff-context'));

  // Synthesize collapsed state-to-state connectivity (via transition nodes), muted gray
  // We derive s->s pairs by bridging s->t and t->s edges found in any selected pane
  const collapsedPairs = new Set();
  const collectCollapsedFromPane = (paneRef) => {
    const preds = new Map(); // tId -> Set(sId) where s->t
    const succs = new Map(); // tId -> Set(sId) where t->s
    paneRef.cy.edges().forEach(e => {
      const s = e.data('source');
      const t = e.data('target');
      if (!s || !t) return;
      const sIsT = s.startsWith('t');
      const tIsT = t.startsWith('t');
      if (!sIsT && tIsT) {
        if (!preds.has(t)) preds.set(t, new Set());
        preds.get(t).add(s);
      } else if (sIsT && !tIsT) {
        if (!succs.has(s)) succs.set(s, new Set());
        succs.get(s).add(t);
      }
    });
    // Cross product over each transition node
    const tIds = new Set([...preds.keys(), ...succs.keys()]);
    tIds.forEach(tn => {
      const ins = preds.get(tn) || new Set();
      const outs = succs.get(tn) || new Set();
      ins.forEach(a => outs.forEach(b => {
        if (a !== b) collapsedPairs.add(`${a}-${b}`);
      }));
    });
  };
  collectCollapsedFromPane(baseline);
  others.forEach(p => collectCollapsedFromPane(p));

  // Avoid duplicates with already added edges; only add if both endpoints present
  const existingPairs = new Set(elements.edges.map(e => `${e.data.source}-${e.data.target}`));
  collapsedPairs.forEach(k => {
    if (existingPairs.has(k)) return;
    const [s, t] = k.split('-');
    if (!nodeSet.has(s) || !nodeSet.has(t)) return;
    elements.edges.push({ data: { id: `ss:${k}`, source: s, target: t }, classes: 'diff-collapsed-context' });
  });

  import('../views/panes/panes.js').then(panesModule => {
    import('../views/graph/node-link.js').then(graphModule => {
      const paneIds = selectedPanes.map(p => p.id).join('-');
      const diffNodeIds = elements.nodes.map(n => n.data.id);
      const newPane = panesModule.spawnPane({
        spawner: selectedPanes.map(p => p.id),
        id: `DIFF-${paneIds}`,
      }, diffNodeIds, baseline.spawnerNodes || []);

      let vars = {};
      if (baseline.cy.vars) {
        const vv = {};
        Object.keys(baseline.cy.vars).forEach(k => {
          if (!baseline.cy.vars[k].avoidInClone) vv[k] = { value: baseline.cy.vars[k].value };
        });
        vars = structuredClone(vv);
      }
      const data = {
        nodes: elements.nodes.map(n => n.data),
        edges: elements.edges.map(e => e.data),
        info: info,
        cyImport: { elements: elements, style: baseline.cy.json().style },
      };
      graphModule.spawnGraph(newPane, data, structuredClone(baseline.cy.params), vars);
      // Show collapsed connectivity edges by default and style them muted
      setTimeout(() => {
        // Store diff summary on cy for sidebar legend
        newPane.cy.diffSummary = diffSummary;
        // Create legend (also wires up toggle behavior)
        createDiffLegend(newPane);
        const cy = newPane.cy;
        if (cy) {
          const collapsed = cy.edges('.diff-collapsed-context');
          collapsed.style({
            'line-color': '#9e9e9e', 'target-arrow-color': '#9e9e9e', 'line-style': 'dashed', opacity: 0.4, width: 1, 'target-arrow-shape': 'triangle', display: 'element',
          });
        }
      }, 50);

      // Enable matrix view if source panes were in matrix mode
      if (isMatrixMode) {
        setTimeout(() => {
          enableMatrixView(newPane);
        }, 200);
      }
    });
  });
}

function showScatterDiffDialog() {
  const panes = getPanes();
  const paneList = Object.values(panes).filter(p => p.cy);
  if (paneList.length < 2) {
    alert('Need at least 2 panes to create a scatter-diff view');
    return;
  }

  const checkboxHtml = paneList.map((p, idx) => `
    <div style="margin: 10px 0;">
      <input type="checkbox" id="scatter-pane-${idx}" value="${idx}" ${idx < 2 ? 'checked' : ''} style="margin-right: 5px;">
      <label for="scatter-pane-${idx}">Pane ${idx + 1}: ${p.id}</label>
    </div>
  `).join('');

  import('sweetalert2').then(({ default: Swal }) => {
    Swal.fire({
      title: 'Select Panes for Scatter-Diff View',
      html: `
        <div style="text-align: left; max-height: 400px; overflow-y: auto;">
          <p style="margin-bottom: 15px;">Select at least 2 panes to compare attribute distributions:</p>
          ${checkboxHtml}
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Create Scatter-Diff',
      cancelButtonText: 'Cancel',
      preConfirm: () => {
        const selected = [];
        paneList.forEach((p, idx) => {
          const cb = document.getElementById(`scatter-pane-${idx}`);
          if (cb && cb.checked) selected.push(idx);
        });
        if (selected.length < 2) {
          Swal.showValidationMessage('Please select at least 2 panes');
          return false;
        }
        if (selected.length > 8) {
          Swal.showValidationMessage('Maximum 8 panes can be selected');
          return false;
        }
        return selected;
      },
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        const selectedPanes = result.value.map(idx => paneList[idx]);
        createScatterDiffView(selectedPanes);
      }
    });
  });
}

function createScatterDiffView(selectedPanes) {
  if (!selectedPanes || selectedPanes.length < 2) return;

  // Color palette for different panes
  const paneColors = [
    { color: '#3b82f6', name: 'Blue' },      // Graph 0
    { color: '#ef4444', name: 'Red' },       // Graph 1
    { color: '#10b981', name: 'Green' },     // Graph 2
    { color: '#f59e0b', name: 'Amber' },     // Graph 3
    { color: '#8b5cf6', name: 'Purple' },    // Graph 4
    { color: '#ec4899', name: 'Pink' },      // Graph 5
    { color: '#14b8a6', name: 'Teal' },      // Graph 6
    { color: '#f97316', name: 'Orange' },    // Graph 7
  ];

  // Collect all numeric attributes from all panes by examining node data
  const allAttributes = new Set();
  selectedPanes.forEach((pane, paneIdx) => {
    if (pane.cy) {
      // Get all non-transition nodes
      const nodes = pane.cy.nodes().filter(n => {
        const id = n.data('id') || n.data().id;
        return id && !id.toString().startsWith('t');
      });

      if (nodes.length > 0) {
        const sampleNode = nodes[0].data();

        // Check if attributes are in the details object
        if (sampleNode.details && typeof sampleNode.details === 'object') {
          // Check Variable Values
          if (sampleNode.details['Variable Values']) {
            Object.keys(sampleNode.details['Variable Values']).forEach(attr => {
              const value = sampleNode.details['Variable Values'][attr];
              if (typeof value === 'number' && !isNaN(value)) {
                allAttributes.add(attr);
              }
            });
          }

          // Check Reward Structures
          if (sampleNode.details['Reward Structures']) {
            Object.keys(sampleNode.details['Reward Structures']).forEach(attr => {
              const value = sampleNode.details['Reward Structures'][attr];
              if (typeof value === 'number' && !isNaN(value)) {
                allAttributes.add(attr);
              }
            });
          }

          // Check Model Checking Results
          if (sampleNode.details['Model Checking Results']) {
            Object.keys(sampleNode.details['Model Checking Results']).forEach(attr => {
              const value = sampleNode.details['Model Checking Results'][attr];
              if (typeof value === 'number' && !isNaN(value)) {
                allAttributes.add(attr);
              }
            });
          }
        }

        // Also check top-level attributes
        Object.keys(sampleNode).forEach(attr => {
          // Check if it's a numeric attribute by testing the value
          const value = sampleNode[attr];
          if (typeof value === 'number' && !isNaN(value) && attr !== 'id') {
            allAttributes.add(attr);
          }
        });
      }
    }
  });

  const attributeList = Array.from(allAttributes).sort();

  if (attributeList.length < 2) {
    console.error(`Only found ${attributeList.length} numeric attributes:`, attributeList);
    alert('Need at least 2 numeric attributes to create a scatter plot');
    return;
  }

  // Build attribute selection dialog with multi-select option
  const attributeCheckboxes = attributeList.map((attr, idx) => `<div style="margin: 5px 0;">
      <label style="display: flex; align-items: center; cursor: pointer;">
        <input type="checkbox" class="attr-checkbox" value="${attr}" ${idx < 2 ? 'checked' : ''} 
               style="margin-right: 8px; width: 16px; height: 16px; cursor: pointer;">
        <span>${attr}</span>
      </label>
    </div>`).join('');

  import('sweetalert2').then(({ default: Swal }) => {
    Swal.fire({
      title: 'Select Attributes for Scatter Plot',
      html: `
        <div style="text-align: left; padding: 10px;">
          <p style="margin-bottom: 10px; color: #666; font-size: 13px;">
            Select 2 attributes for a single scatter plot, or multiple attributes for a matrix view.
          </p>
          <div style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
            ${attributeCheckboxes}
          </div>
          <div style="margin-top: 10px; font-size: 12px; color: #888;">
            <span id="attr-count">2 attributes selected</span>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Create Plot',
      cancelButtonText: 'Cancel',
      didOpen: () => {
        const checkboxes = document.querySelectorAll('.attr-checkbox');
        const updateCount = () => {
          const selected = Array.from(checkboxes).filter(cb => cb.checked);
          document.getElementById('attr-count').textContent = `${selected.length} attribute${selected.length !== 1 ? 's' : ''} selected`;
        };
        checkboxes.forEach(cb => cb.addEventListener('change', updateCount));
      },
      preConfirm: () => {
        const checkboxes = document.querySelectorAll('.attr-checkbox');
        const selectedAttrs = Array.from(checkboxes)
          .filter(cb => cb.checked)
          .map(cb => cb.value);

        if (selectedAttrs.length < 2) {
          Swal.showValidationMessage('Please select at least 2 attributes');
          return false;
        }
        return { selectedAttrs };
      },
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        const { selectedAttrs } = result.value;
        if (selectedAttrs.length === 2) {
          // Single scatter plot
          renderScatterPlot(selectedPanes, selectedAttrs[0], selectedAttrs[1], paneColors);
        } else {
          // Matrix of scatter plots
          renderScatterMatrix(selectedPanes, selectedAttrs, paneColors);
        }
      }
    });
  });
}

function renderScatterPlot(selectedPanes, xAttr, yAttr, paneColors) {
  // Distinct color for overlapping points (shared coordinates across panes)
  const overlapColor = '#000000'; // black for high contrast
  // Helper function to get attribute value from node data
  const getAttributeValue = (nodeData, attr) => {
    // Check Variable Values
    if (nodeData.details && nodeData.details['Variable Values']
      && nodeData.details['Variable Values'][attr] !== undefined) {
      return nodeData.details['Variable Values'][attr];
    }
    // Check Reward Structures
    if (nodeData.details && nodeData.details['Reward Structures']
      && nodeData.details['Reward Structures'][attr] !== undefined) {
      return nodeData.details['Reward Structures'][attr];
    }
    // Check Model Checking Results
    if (nodeData.details && nodeData.details['Model Checking Results']
      && nodeData.details['Model Checking Results'][attr] !== undefined) {
      return nodeData.details['Model Checking Results'][attr];
    }
    // Check top-level
    return nodeData[attr];
  };

  // Collect data points from all panes
  const dataPoints = [];

  selectedPanes.forEach((pane, paneIdx) => {
    if (pane.cy) {
      let panePointCount = 0;
      pane.cy.nodes().forEach(node => {
        const nodeData = node.data();
        if (!nodeData.id.startsWith('t')) { // Skip transition nodes
          const xVal = getAttributeValue(nodeData, xAttr);
          const yVal = getAttributeValue(nodeData, yAttr);
          if (xVal !== undefined && yVal !== undefined && !isNaN(xVal) && !isNaN(yVal)) {
            dataPoints.push({
              x: Number(xVal),
              y: Number(yVal),
              id: nodeData.id,
              paneIdx: paneIdx,
              paneId: pane.id,
              nodeData: nodeData,
            });
            panePointCount++;
          }
        }
      });
    }
  });

  // Check for overlapping points
  const positionMap = new Map();
  dataPoints.forEach(pt => {
    const key = `${pt.x},${pt.y}`;
    if (!positionMap.has(key)) {
      positionMap.set(key, []);
    }
    positionMap.get(key).push(pt.paneIdx);
  });
  const overlaps = new Set(Array.from(positionMap.entries()).filter(([_, panes]) => panes.length > 1).map(([k]) => k));
  // Flag points as overlapping
  dataPoints.forEach(pt => {
    const key = `${pt.x},${pt.y}`;
    pt.isOverlap = overlaps.has(key);
  });

  if (dataPoints.length === 0) {
    alert('No valid data points found for the selected attributes');
    return;
  }

  // Create scatter plot HTML with D3.js
  import('sweetalert2').then(({ default: Swal }) => {
    const plotHtml = `
      <div id="scatter-plot-container" style="width: 100%; height: 600px;">
        <svg id="scatter-plot-svg" style="width: 100%; height: 100%;"></svg>
      </div>
    `;

    Swal.fire({
      title: `Scatter-Diff View: ${xAttr} vs ${yAttr}`,
      html: plotHtml,
      width: '80%',
      showCloseButton: true,
      showConfirmButton: false,
      didOpen: () => {
        // Use D3 to create the scatter plot
        import('d3').then(d3Module => {
          const d3 = d3Module;

          const container = document.getElementById('scatter-plot-container');
          const svg = d3.select('#scatter-plot-svg');
          const width = container.clientWidth;
          const height = container.clientHeight;
          const margin = {
            top: 40, right: 150, bottom: 60, left: 70,
          };
          const plotWidth = width - margin.left - margin.right;
          const plotHeight = height - margin.top - margin.bottom;

          svg.selectAll('*').remove();

          const g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

          // Create scales
          const xExtent = d3.extent(dataPoints, d => d.x);
          const yExtent = d3.extent(dataPoints, d => d.y);

          // Add 5% padding to extents
          const xPadding = (xExtent[1] - xExtent[0]) * 0.05;
          const yPadding = (yExtent[1] - yExtent[0]) * 0.05;

          const xScale = d3.scaleLinear()
            .domain([xExtent[0] - xPadding, xExtent[1] + xPadding])
            .range([0, plotWidth]);

          const yScale = d3.scaleLinear()
            .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
            .range([plotHeight, 0]);

          // Add axes
          const xAxis = d3.axisBottom(xScale).ticks(10);
          const yAxis = d3.axisLeft(yScale).ticks(10);

          g.append('g')
            .attr('transform', `translate(0,${plotHeight})`)
            .call(xAxis)
            .append('text')
            .attr('x', plotWidth / 2)
            .attr('y', 45)
            .attr('fill', 'black')
            .attr('font-size', '14px')
            .attr('font-weight', 'bold')
            .attr('text-anchor', 'middle')
            .text(xAttr);

          g.append('g')
            .call(yAxis)
            .append('text')
            .attr('transform', 'rotate(-90)')
            .attr('x', -plotHeight / 2)
            .attr('y', -50)
            .attr('fill', 'black')
            .attr('font-size', '14px')
            .attr('font-weight', 'bold')
            .attr('text-anchor', 'middle')
            .text(yAttr);

          // Add grid lines
          g.append('g')
            .attr('class', 'grid')
            .attr('opacity', 0.1)
            .call(d3.axisLeft(yScale).tickSize(-plotWidth).tickFormat(''));

          g.append('g')
            .attr('class', 'grid')
            .attr('opacity', 0.1)
            .attr('transform', `translate(0,${plotHeight})`)
            .call(d3.axisBottom(xScale).tickSize(-plotHeight).tickFormat(''));

          // Create tooltip
          const tooltip = d3.select('body').append('div')
            .attr('class', 'scatter-tooltip')
            .style('position', 'absolute')
            .style('visibility', 'hidden')
            .style('background-color', 'white')
            .style('border', '1px solid #ccc')
            .style('border-radius', '4px')
            .style('padding', '10px')
            .style('font-size', '12px')
            .style('box-shadow', '0 2px 4px rgba(0,0,0,0.2)')
            .style('pointer-events', 'none')
            .style('z-index', '10000');

          // Add points grouped by pane
          selectedPanes.forEach((pane, paneIdx) => {
            const paneData = dataPoints.filter(d => d.paneIdx === paneIdx);
            const baseColor = paneColors[paneIdx % paneColors.length].color;

            g.selectAll(`.point-pane-${paneIdx}`)
              .data(paneData)
              .enter()
              .append('circle')
              .attr('class', `point-pane-${paneIdx}`)
              .attr('cx', d => xScale(d.x))
              .attr('cy', d => yScale(d.y))
              .attr('r', 5)
              .attr('fill', d => d.isOverlap ? overlapColor : baseColor)
              .attr('fill-opacity', 1)
              .attr('stroke', '#333')
              .attr('stroke-width', 1)
              .style('opacity', 1)
              .style('pointer-events', 'all')
              .on('mouseover', function (event, d) {
                d3.select(this)
                  .attr('r', 8)
                  .attr('stroke-width', 2);

                tooltip
                  .style('visibility', 'visible')
                  .html(`
                    <strong>Node ID:</strong> ${d.id}<br>
                    <strong>Pane:</strong> ${d.paneId}<br>
                    <strong>${xAttr}:</strong> ${d.x.toFixed(3)}<br>
                    <strong>${yAttr}:</strong> ${d.y.toFixed(3)}${d.isOverlap ? '<br><em>Overlap position</em>' : ''}
                  `);
              })
              .on('mousemove', function (event) {
                tooltip
                  .style('top', (event.pageY - 10) + 'px')
                  .style('left', (event.pageX + 10) + 'px');
              })
              .on('mouseout', function () {
                d3.select(this)
                  .attr('r', 5)
                  .attr('stroke-width', 1);

                tooltip.style('visibility', 'hidden');
              });
          });

          // Track visibility state for each pane
          const paneVisibility = {};
          selectedPanes.forEach((_, idx) => { paneVisibility[idx] = true; });

          // Add legend with checkboxes
          const legend = svg.append('g')
            .attr('transform', `translate(${width - margin.right + 20}, ${margin.top})`);

          legend.append('text')
            .attr('x', 0)
            .attr('y', 0)
            .attr('font-size', '14px')
            .attr('font-weight', 'bold')
            .text('Panes');

          selectedPanes.forEach((pane, paneIdx) => {
            const color = paneColors[paneIdx % paneColors.length].color;
            const legendItem = legend.append('g')
              .attr('transform', `translate(0, ${25 + paneIdx * 30})`)
              .style('cursor', 'pointer');

            // Add checkbox-like square
            const checkbox = legendItem.append('rect')
              .attr('x', 0)
              .attr('y', -8)
              .attr('width', 16)
              .attr('height', 16)
              .attr('fill', 'white')
              .attr('stroke', color)
              .attr('stroke-width', 2)
              .attr('rx', 2);

            // Add checkmark
            const checkmark = legendItem.append('text')
              .attr('x', 8)
              .attr('y', 5)
              .attr('font-size', '14px')
              .attr('font-weight', 'bold')
              .attr('text-anchor', 'middle')
              .attr('fill', color)
              .text('✓');

            // Add color indicator circle
            legendItem.append('circle')
              .attr('cx', 26)
              .attr('cy', 0)
              .attr('r', 5)
              .attr('fill', color)
              .attr('stroke', '#333')
              .attr('stroke-width', 1);

            // Add label
            legendItem.append('text')
              .attr('x', 40)
              .attr('y', 5)
              .attr('font-size', '12px')
              .text(`Pane ${paneIdx}: ${pane.id}`);

            // Add click handler to toggle visibility
            legendItem.on('click', function () {
              paneVisibility[paneIdx] = !paneVisibility[paneIdx];
              const visible = paneVisibility[paneIdx];

              // Update checkbox appearance
              checkmark.style('opacity', visible ? 1 : 0);
              checkbox.attr('fill', visible ? 'white' : '#f0f0f0');

              // Recalculate overlaps based on visible panes only
              const visiblePaneIndices = Object.keys(paneVisibility).filter(idx => paneVisibility[idx]).map(Number);
              const newPositionMap = new Map();
              dataPoints.forEach(pt => {
                if (visiblePaneIndices.includes(pt.paneIdx)) {
                  const key = `${pt.x},${pt.y}`;
                  if (!newPositionMap.has(key)) {
                    newPositionMap.set(key, new Set());
                  }
                  newPositionMap.get(key).add(pt.paneIdx);
                }
              });
              const newOverlaps = new Set(
                Array.from(newPositionMap.entries())
                  .filter(([_, panes]) => panes.size > 1)
                  .map(([k]) => k),
              );

              // Update all panes: visibility for toggled pane, colors for all visible panes
              selectedPanes.forEach((_, idx) => {
                const baseColor = paneColors[idx % paneColors.length].color;
                const isVisible = paneVisibility[idx];
                g.selectAll(`.point-pane-${idx}`)
                  .interrupt()
                  .transition()
                  .duration(200)
                  .style('opacity', isVisible ? 1 : 0)
                  .style('pointer-events', isVisible ? 'all' : 'none')
                  .attr('fill', d => isVisible && newOverlaps.has(`${d.x},${d.y}`) ? overlapColor : baseColor)
                  .attr('stroke', d => isVisible && newOverlaps.has(`${d.x},${d.y}`) ? overlapColor : baseColor);
              });
            });
          });

          // Overlap legend entry (only if there are overlaps)
          if (overlaps.size > 0) {
            const overlapIndex = selectedPanes.length;
            const overlapLegend = legend.append('g')
              .attr('transform', `translate(0, ${25 + overlapIndex * 30})`);

            overlapLegend.append('circle')
              .attr('cx', 8)
              .attr('cy', 0)
              .attr('r', 6)
              .attr('fill', overlapColor)
              .attr('stroke', '#333')
              .attr('stroke-width', 1);

            overlapLegend.append('text')
              .attr('x', 22)
              .attr('y', 4)
              .attr('font-size', '12px')
              .attr('font-style', 'italic')
              .text('Overlap (shared position)');
          }

          // Cleanup tooltip on dialog close
          const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
              mutation.removedNodes.forEach((node) => {
                if (node.id === 'scatter-plot-container'
                  || (node.classList && node.classList.contains('swal2-container'))) {
                  tooltip.remove();
                  observer.disconnect();
                }
              });
            });
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
      },
    });
  });
}

function renderScatterMatrix(selectedPanes, attributes, paneColors) {
  const overlapColor = '#000000'; // consistent overlap color
  // Helper function to get attribute value from node data
  const getAttributeValue = (nodeData, attr) => {
    if (nodeData.details && nodeData.details['Variable Values']
      && nodeData.details['Variable Values'][attr] !== undefined) {
      return nodeData.details['Variable Values'][attr];
    }
    if (nodeData.details && nodeData.details['Reward Structures']
      && nodeData.details['Reward Structures'][attr] !== undefined) {
      return nodeData.details['Reward Structures'][attr];
    }
    if (nodeData.details && nodeData.details['Model Checking Results']
      && nodeData.details['Model Checking Results'][attr] !== undefined) {
      return nodeData.details['Model Checking Results'][attr];
    }
    return nodeData[attr];
  };

  // Collect data points with all selected attributes
  const dataPoints = [];
  selectedPanes.forEach((pane, paneIdx) => {
    if (pane.cy) {
      pane.cy.nodes().forEach(node => {
        const nodeData = node.data();
        if (!nodeData.id.startsWith('t')) {
          const point = {
            id: nodeData.id,
            paneIdx: paneIdx,
            paneId: pane.id,
            values: {},
          };

          let allValid = true;
          attributes.forEach(attr => {
            const val = getAttributeValue(nodeData, attr);
            if (val === undefined || isNaN(val)) {
              allValid = false;
            } else {
              point.values[attr] = Number(val);
            }
          });

          if (allValid) {
            dataPoints.push(point);
          }
        }
      });
    }
  });

  if (dataPoints.length === 0) {
    alert('No valid data points found for the selected attributes');
    return;
  }

  // Create scatter matrix HTML
  import('sweetalert2').then(({ default: Swal }) => {
    const plotHtml = `
      <div id="scatter-matrix-container" style="width: 100%; height: 700px; overflow: auto; display: flex; justify-content: center; align-items: center;">
        <svg id="scatter-matrix-svg"></svg>
      </div>
    `;

    Swal.fire({
      title: `Scatter Plot Matrix (${attributes.length} attributes)`,
      html: plotHtml,
      width: '90%',
      showCloseButton: true,
      showConfirmButton: false,
      didOpen: () => {
        import('d3').then(d3Module => {
          const d3 = d3Module;

          const container = document.getElementById('scatter-matrix-container');
          const svg = d3.select('#scatter-matrix-svg');
          const containerWidth = container.clientWidth;
          const containerHeight = container.clientHeight;

          const n = attributes.length;
          const padding = 20;
          const legendWidth = 150;
          const matrixWidth = containerWidth - legendWidth - padding;
          const cellSize = Math.min((matrixWidth - padding * 2) / n, (containerHeight - padding * 2) / n);
          const plotSize = cellSize - 10;

          const svgWidth = n * cellSize + padding * 2 + legendWidth;
          const svgHeight = n * cellSize + padding * 2;

          svg.attr('width', svgWidth)
            .attr('height', svgHeight);

          svg.selectAll('*').remove();

          // Create scales for each attribute
          const scales = {};
          attributes.forEach(attr => {
            const values = dataPoints.map(d => d.values[attr]);
            const extent = d3.extent(values);
            const padding = (extent[1] - extent[0]) * 0.05 || 1;
            scales[attr] = d3.scaleLinear()
              .domain([extent[0] - padding, extent[1] + padding])
              .range([plotSize, 0]);
          });

          // Create tooltip
          const tooltip = d3.select('body').append('div')
            .attr('class', 'scatter-matrix-tooltip')
            .style('position', 'absolute')
            .style('visibility', 'hidden')
            .style('background-color', 'white')
            .style('border', '1px solid #ccc')
            .style('border-radius', '4px')
            .style('padding', '8px')
            .style('font-size', '11px')
            .style('box-shadow', '0 2px 4px rgba(0,0,0,0.2)')
            .style('pointer-events', 'none')
            .style('z-index', '10000');

          // Track visibility state for each pane
          const paneVisibility = {};
          selectedPanes.forEach((_, idx) => { paneVisibility[idx] = true; });

          // Draw matrix cells
          attributes.forEach((yAttr, i) => {
            attributes.forEach((xAttr, j) => {
              const g = svg.append('g')
                .attr('transform', `translate(${padding + j * cellSize}, ${padding + i * cellSize})`);

              // Add cell border
              g.append('rect')
                .attr('width', cellSize)
                .attr('height', cellSize)
                .attr('fill', 'white')
                .attr('stroke', '#ddd')
                .attr('stroke-width', 1);

              if (i === j) {
                // Diagonal: show attribute name
                g.append('text')
                  .attr('x', cellSize / 2)
                  .attr('y', cellSize / 2)
                  .attr('text-anchor', 'middle')
                  .attr('dominant-baseline', 'middle')
                  .attr('font-size', '12px')
                  .attr('font-weight', 'bold')
                  .text(xAttr);
              } else {
                // Off-diagonal: scatter plot
                const plotG = g.append('g')
                  .attr('transform', 'translate(5, 5)');

                // Build overlap map for this cell across panes
                const cellPositionMap = new Map();
                selectedPanes.forEach((pane, paneIdx) => {
                  const paneData = dataPoints.filter(d => d.paneIdx === paneIdx);
                  paneData.forEach(d => {
                    const key = `${d.values[xAttr]},${d.values[yAttr]}`;
                    if (!cellPositionMap.has(key)) cellPositionMap.set(key, []);
                    cellPositionMap.get(key).push(paneIdx);
                  });
                });
                const cellOverlaps = new Set(Array.from(cellPositionMap.entries()).filter(([_, arr]) => arr.length > 1).map(([k]) => k));

                // Draw points for each pane with overlap detection
                selectedPanes.forEach((pane, paneIdx) => {
                  const paneData = dataPoints.filter(d => d.paneIdx === paneIdx);
                  const baseColor = paneColors[paneIdx % paneColors.length].color;

                  plotG.selectAll(`.point-${i}-${j}-pane-${paneIdx}`)
                    .data(paneData)
                    .enter()
                    .append('circle')
                    .attr('class', `point-${i}-${j}-pane-${paneIdx} matrix-point-pane-${paneIdx}`)
                    .attr('cx', d => cellSize - 10 - scales[xAttr](d.values[xAttr]))
                    .attr('cy', d => scales[yAttr](d.values[yAttr]))
                    .attr('r', 2.5)
                    .attr('fill', d => cellOverlaps.has(`${d.values[xAttr]},${d.values[yAttr]}`) ? overlapColor : baseColor)
                    .attr('fill-opacity', 1)
                    .attr('stroke', d => cellOverlaps.has(`${d.values[xAttr]},${d.values[yAttr]}`) ? overlapColor : baseColor)
                    .attr('stroke-width', 0.5)
                    .attr('opacity', 1)
                    .on('mouseover', function (event, d) {
                      d3.select(this)
                        .attr('r', 4)
                        .attr('opacity', 1);
                      const attrInfo = attributes.map(a => `<strong>${a}:</strong> ${d.values[a].toFixed(3)}`).join('<br>');
                      const overlapNote = cellOverlaps.has(`${d.values[xAttr]},${d.values[yAttr]}`) ? '<br><em>Overlap position</em>' : '';
                      tooltip
                        .style('visibility', 'visible')
                        .html(`
                          <strong>Node:</strong> ${d.id}<br>
                          <strong>Pane:</strong> ${d.paneId}${overlapNote}<br>
                          ${attrInfo}
                        `);
                    })
                    .on('mousemove', function (event) {
                      tooltip
                        .style('top', (event.pageY - 10) + 'px')
                        .style('left', (event.pageX + 10) + 'px');
                    })
                    .on('mouseout', function () {
                      d3.select(this)
                        .attr('r', 2.5)
                        .attr('opacity', 1);
                      tooltip.style('visibility', 'hidden');
                    });
                });
              }
            });
          });

          // Add legend
          const legend = svg.append('g')
            .attr('transform', `translate(${n * cellSize + padding + 20}, ${padding})`);

          legend.append('text')
            .attr('x', 0)
            .attr('y', 0)
            .attr('font-size', '14px')
            .attr('font-weight', 'bold')
            .text('Panes');

          selectedPanes.forEach((pane, paneIdx) => {
            const color = paneColors[paneIdx % paneColors.length].color;
            const legendItem = legend.append('g')
              .attr('transform', `translate(0, ${25 + paneIdx * 30})`)
              .style('cursor', 'pointer');

            const checkbox = legendItem.append('rect')
              .attr('x', 0)
              .attr('y', -8)
              .attr('width', 16)
              .attr('height', 16)
              .attr('fill', 'white')
              .attr('stroke', color)
              .attr('stroke-width', 2)
              .attr('rx', 2);

            const checkmark = legendItem.append('text')
              .attr('x', 8)
              .attr('y', 5)
              .attr('font-size', '14px')
              .attr('font-weight', 'bold')
              .attr('text-anchor', 'middle')
              .attr('fill', color)
              .text('✓');

            legendItem.append('circle')
              .attr('cx', 26)
              .attr('cy', 0)
              .attr('r', 5)
              .attr('fill', color)
              .attr('stroke', '#333')
              .attr('stroke-width', 1);

            legendItem.append('text')
              .attr('x', 40)
              .attr('y', 5)
              .attr('font-size', '11px')
              .text(`Pane ${paneIdx}: ${pane.id.substring(0, 15)}${pane.id.length > 15 ? '...' : ''}`);

            legendItem.on('click', function () {
              paneVisibility[paneIdx] = !paneVisibility[paneIdx];

              svg.selectAll(`.matrix-point-pane-${paneIdx}`)
                .transition()
                .duration(200)
                .attr('opacity', paneVisibility[paneIdx] ? 1 : 0)
                .style('pointer-events', paneVisibility[paneIdx] ? 'all' : 'none');

              checkmark.attr('opacity', paneVisibility[paneIdx] ? 1 : 0);
              checkbox.attr('fill', paneVisibility[paneIdx] ? 'white' : '#f0f0f0');

              // Recalculate overlaps based on visible panes and update colors for each cell
              const visiblePaneIndices = Object.keys(paneVisibility).filter(idx => paneVisibility[idx]).map(Number);

              // For each cell in the matrix, recalculate overlaps and update colors
              attributes.forEach((yAttr, i) => {
                attributes.forEach((xAttr, j) => {
                  if (i === j) return; // Skip diagonal cells

                  // Build new overlap map for this cell based on visible panes
                  const cellPositionMap = new Map();
                  dataPoints.forEach(d => {
                    if (visiblePaneIndices.includes(d.paneIdx)) {
                      const key = `${d.values[xAttr]},${d.values[yAttr]}`;
                      if (!cellPositionMap.has(key)) cellPositionMap.set(key, new Set());
                      cellPositionMap.get(key).add(d.paneIdx);
                    }
                  });
                  const newCellOverlaps = new Set(
                    Array.from(cellPositionMap.entries())
                      .filter(([_, panes]) => panes.size > 1)
                      .map(([k]) => k),
                  );

                  // Update colors of visible points in this cell
                  visiblePaneIndices.forEach(idx => {
                    const baseColor = paneColors[idx % paneColors.length].color;
                    svg.selectAll(`.point-${i}-${j}-pane-${idx}`)
                      .transition()
                      .duration(200)
                      .attr('fill', d => newCellOverlaps.has(`${d.values[xAttr]},${d.values[yAttr]}`) ? overlapColor : baseColor)
                      .attr('stroke', d => newCellOverlaps.has(`${d.values[xAttr]},${d.values[yAttr]}`) ? overlapColor : baseColor);
                  });
                });
              });
            });
          });

          // Overlap legend entry (static, appears if any cell has overlaps)
          const anyOverlaps = (() => {
            // Rough heuristic: if any identical value pair exists across panes for any attribute pair
            const seen = new Set();
            let overlapFound = false;
            dataPoints.forEach(d => {
              attributes.forEach(a1 => {
                attributes.forEach(a2 => {
                  if (a1 === a2) return;
                  const key = `${a1}:${d.values[a1]},${a2}:${d.values[a2]}`;
                  if (seen.has(key)) {
                    overlapFound = true;
                  } else {
                    seen.add(key);
                  }
                });
              });
            });
            return overlapFound;
          })();
          if (anyOverlaps) {
            const overlapIndex = selectedPanes.length;
            const overlapLegend = legend.append('g')
              .attr('transform', `translate(0, ${25 + overlapIndex * 30})`);
            overlapLegend.append('circle')
              .attr('cx', 8)
              .attr('cy', 0)
              .attr('r', 6)
              .attr('fill', overlapColor)
              .attr('stroke', '#333')
              .attr('stroke-width', 1);
            overlapLegend.append('text')
              .attr('x', 22)
              .attr('y', 4)
              .attr('font-size', '11px')
              .attr('font-style', 'italic')
              .text('Overlap (shared position)');
          }

          // Cleanup
          const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
              mutation.removedNodes.forEach((node) => {
                if (node.id === 'scatter-matrix-container'
                  || (node.classList && node.classList.contains('swal2-container'))) {
                  tooltip.remove();
                  observer.disconnect();
                }
              });
            });
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
      },
    });
  });
}

function showPcpOverlayDialog() {
  const panes = getPanes();
  const paneList = Object.values(panes).filter(p => p.cy && p.cy.pcp);

  if (paneList.length < 1) {
    alert('Need at least 1 pane with PCP enabled');
    return;
  }

  // Get active pane from the document
  const activePaneElement = document.querySelector('.active-pane');
  const activePaneId = activePaneElement ? activePaneElement.id : null;
  const activePane = activePaneId ? panes[activePaneId] : null;

  if (!activePane || !activePane.cy || !activePane.cy.pcp) {
    alert('Please select a pane with PCP enabled before creating an overlay');
    return;
  }

  // Filter out the active pane from the list
  const otherPanes = paneList.filter(p => p.id !== activePane.id);

  if (otherPanes.length === 0) {
    alert('Need at least 1 other pane with PCP to overlay');
    return;
  }

  const checkboxHtml = otherPanes.map((p, idx) => `
    <div style="margin: 10px 0;">
      <input type="checkbox" id="pcp-overlay-pane-${idx}" value="${idx}" checked style="margin-right: 5px;">
      <label for="pcp-overlay-pane-${idx}">Pane: ${p.id}</label>
    </div>
  `).join('');

  import('sweetalert2').then(({ default: Swal }) => {
    Swal.fire({
      title: `Overlay on Active Pane: ${activePane.id}`,
      html: `
        <div style="text-align: left; max-height: 400px; overflow-y: auto;">
          <p style="margin-bottom: 15px; color: #666; font-size: 13px;">
            Select panes to overlay on the current active pane's PCP.
          </p>
          ${checkboxHtml}
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Create Overlay',
      cancelButtonText: 'Cancel',
      preConfirm: () => {
        const selected = [];
        otherPanes.forEach((p, idx) => {
          const cb = document.getElementById(`pcp-overlay-pane-${idx}`);
          if (cb && cb.checked) selected.push(idx);
        });
        if (selected.length < 1) {
          Swal.showValidationMessage('Please select at least 1 pane to overlay');
          return false;
        }
        if (selected.length > 7) {
          Swal.showValidationMessage('Maximum 7 panes can be overlaid');
          return false;
        }
        return selected;
      },
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        const selectedPanes = result.value.map(idx => otherPanes[idx]);
        applyPcpOverlay(activePane, selectedPanes);
      }
    });
  });
}

function applyPcpOverlay(basePane, overlayPanes) {
  if (!basePane.cy || !basePane.cy.pcp) return;

  // Gather data and metadata from overlay panes
  const overlayData = overlayPanes.map(op => {
    if (!op.cy || !op.cy.pcp) return null;

    // Extract data from the pane's graph nodes
    const nodes = op.cy.nodes().filter(n => !n.data().id.startsWith('t'));
    const data = [];
    const pldKeys = new Set();

    nodes.forEach(n => {
      const nodeData = n.data();
      if (nodeData.details) {
        const point = { id: nodeData.id };

        // Collect attributes from various sources
        if (nodeData.details['Variable Values']) {
          Object.assign(point, nodeData.details['Variable Values']);
          Object.keys(nodeData.details['Variable Values']).forEach(k => pldKeys.add(k));
        }
        if (nodeData.details['Reward Structures']) {
          Object.assign(point, nodeData.details['Reward Structures']);
          Object.keys(nodeData.details['Reward Structures']).forEach(k => pldKeys.add(k));
        }
        if (nodeData.details['Model Checking Results']) {
          Object.assign(point, nodeData.details['Model Checking Results']);
          Object.keys(nodeData.details['Model Checking Results']).forEach(k => pldKeys.add(k));
        }

        data.push(point);
      }
    });

    // Build metadata structure
    const pld = {};
    pldKeys.forEach(key => {
      const values = data.map(d => d[key]).filter(v => v !== undefined && !isNaN(v));
      if (values.length > 0) {
        pld[key] = {
          type: 'number',
          min: Math.min(...values),
          max: Math.max(...values),
        };
      }
    });

    return {
      pane: op,
      data,
      metadata: { pld, data_id: 'id' },
    };
  }).filter(x => x !== null);

  // Apply overlay to base pane
  basePane.cy.pcp.enableOverlay(overlayData);
}

export {
  makeTippy,
  hideAllTippies,
  setPane,
  PROJECT,
  updateGraphComparison,
  updateCurvedConnectors,
  updateSidebarLegends,
};
