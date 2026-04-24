/* eslint-disable */
import { spawnPane, getPanes } from '../views/panes/panes.js';
import { createInitialTree, expandNodeByType } from '../views/decision-tree.js';
import {
  createAxiomPane,
  getAxiomStatesForPane,
  AXIOM_STATES,
  setSummaryNodeState,
  setSummaryStateByDepth,
  resetSummaryStates,
} from '../views/axiom-pane.js';
import { parallelCoords } from '../views/attributes/parallel-coords.js';
import { DL_REPAIR_CLASS_HIERARCHY_PANE_ID, setDLRepairClassHierarchyVisibility } from '../views/class-hierarchy-pane.js';
import { PROJECT } from '../utils/controls.js';
import dlRepairApi from '../utils/mock-dl-repair-api.js';

const DL_REPAIR_SIDEBAR_WIDTH_KEY = 'dl-repair-sidebar-width';
const STAR_AXIS_DEFAULT_STROKE = '#b8b8b8';
const STAR_AXIS_DEFAULT_STROKE_WIDTH = '1';
const STAR_AXIS_HIGHLIGHT_STROKE = '#f08c00';
const STAR_AXIS_HIGHLIGHT_STROKE_WIDTH = '2.6';
const STAR_SELECTED_AXIOM_BORDER = '#4887b9';

let sidebarResizeInitialized = false;
let dlRepairLayoutInitialized = false;
let dlRepairFullscreenControlsInitialized = false;
let dlRepairClassHierarchyVisibilityInitialized = false;

const DL_REPAIR_LAYOUT = {
  leftWidth: 28,
  centerWidth: 47,
  rightWidth: 25,
  summaryHeightPct: 38,
};

function getDlRepairHostElements() {
  return {
    container: document.getElementById('container'),
    layout: document.getElementById('dl-repair-layout'),
    leftPaneHost: document.getElementById('dl-repair-summary-pane'),
    summaryHost: document.getElementById('dl-repair-left-pane'),
    starHost: document.getElementById('dl-repair-star-pane'),
    classHierarchyHost: document.getElementById('dl-repair-class-hierarchy-pane'),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function triggerDLRepairPaneResize() {
  Object.values(getPanes()).forEach((pane) => {
    if (!pane?.cy) {
      return;
    }
    pane.cy.resize();
    pane.cy.fit?.(undefined, 30);
    pane.cy.pcp?.redraw?.();
  });
}

function applyDLRepairLayoutSizing() {
  const {
    leftPaneHost,
    summaryHost,
    starHost,
    classHierarchyHost,
  } = getDlRepairHostElements();

  const panes = getPanes();
  const decisionPane = panes['pane-0'];
  const summaryPane = panes['axiom-pane-0'];
  const classHierarchyPane = panes[DL_REPAIR_CLASS_HIERARCHY_PANE_ID];

  const setPaneRegionSize = (pane, height, width, { containerHeight = height, detailsHeight = 0, hideDetails = false } = {}) => {
    if (!pane) {
      return;
    }

    const paneElement = document.getElementById(pane.id);
    const cyContainer = document.getElementById(pane.container);
    const details = document.getElementById(pane.details);

    pane.height = height;
    pane.width = width;
    if (paneElement) {
      paneElement.style.height = `${height}px`;
      paneElement.style.width = '100%';
      paneElement.style.flexGrow = '1';
    }
    if (cyContainer) {
      cyContainer.style.height = `${Math.max(0, containerHeight)}px`;
    }
    if (details) {
      details.style.height = `${Math.max(0, detailsHeight)}px`;
      details.style.display = hideDetails ? 'none' : '';
    }
    pane.split = height > 0 ? detailsHeight / height : 0;
  };

  if (decisionPane && leftPaneHost) {
    setPaneRegionSize(decisionPane, leftPaneHost.clientHeight, leftPaneHost.clientWidth, {
      containerHeight: leftPaneHost.clientHeight,
      detailsHeight: starHost?.clientHeight || 0,
      hideDetails: false,
    });
  }

  if (summaryPane && summaryHost) {
    setPaneRegionSize(summaryPane, summaryHost.clientHeight, summaryHost.clientWidth, {
      containerHeight: summaryHost.clientHeight,
      hideDetails: true,
    });
  }

  if (classHierarchyPane && classHierarchyHost) {
    setPaneRegionSize(classHierarchyPane, classHierarchyHost.clientHeight, classHierarchyHost.clientWidth, {
      containerHeight: Math.max(0, classHierarchyHost.clientHeight - 32),
      hideDetails: true,
    });
  }
}

function buildDLRepairLayoutShell() {
  const container = document.getElementById('container');
  if (!container) {
    return;
  }

  container.classList.add('dl-repair-layout-root');
  document.body.classList.add('dl-repair-layout-active');

  const activePaneLabel = document.getElementById('selected-pane')?.closest('.nav-text');
  if (activePaneLabel) {
    activePaneLabel.style.display = 'none';
  }

  const exportButton = document.getElementById('export-strat');
  if (exportButton) {
    exportButton.style.display = 'none';
  }

  if (document.getElementById('dl-repair-layout')) {
    return;
  }

  const layout = document.createElement('div');
  layout.id = 'dl-repair-layout';
  layout.className = 'dl-repair-layout';
  layout.setAttribute('data-class-hierarchy-visible', 'false');
  layout.innerHTML = `
    <section id="dl-repair-left-pane" class="dl-repair-panel dl-repair-panel-left" data-panel-key="decision">
      <button type="button" class="dl-repair-fullscreen-toggle" data-fullscreen-target="decision" title="Expand decision tree panel" aria-label="Expand decision tree panel">
        <i class="fa-solid fa-expand"></i>
      </button>
    </section>
    <div class="dl-repair-resizer dl-repair-resizer-vertical" data-resize="left-center"></div>
    <section class="dl-repair-panel dl-repair-panel-center">
      <div id="dl-repair-summary-pane" class="dl-repair-center-top" data-panel-key="summary">
        <button type="button" class="dl-repair-fullscreen-toggle" data-fullscreen-target="summary" title="Expand summary graph panel" aria-label="Expand summary graph panel">
          <i class="fa-solid fa-expand"></i>
        </button>
      </div>
      <div class="dl-repair-resizer dl-repair-resizer-horizontal" data-resize="summary-star"></div>
      <div id="dl-repair-star-pane" class="dl-repair-center-bottom" data-panel-key="star">
        <button type="button" class="dl-repair-fullscreen-toggle" data-fullscreen-target="star" title="Expand star plot panel" aria-label="Expand star plot panel">
          <i class="fa-solid fa-expand"></i>
        </button>
      </div>
    </section>
    <div class="dl-repair-resizer dl-repair-resizer-vertical" data-resize="center-right"></div>
    <section id="dl-repair-class-hierarchy-pane" class="dl-repair-panel dl-repair-panel-right" data-panel-key="class-hierarchy">
      <button type="button" class="dl-repair-fullscreen-toggle" data-fullscreen-target="class-hierarchy" title="Expand class hierarchy panel" aria-label="Expand class hierarchy panel">
        <i class="fa-solid fa-expand"></i>
      </button>
    </section>
  `;

  container.appendChild(layout);
}

function initializeDLRepairFullscreenControls() {
  if (dlRepairFullscreenControlsInitialized) {
    return;
  }

  const { layout } = getDlRepairHostElements();
  if (!layout) {
    return;
  }

  const labelByTarget = {
    decision: 'decision tree',
    summary: 'summary graph',
    star: 'star plot',
    'class-hierarchy': 'class hierarchy',
  };

  const updateButtons = () => {
    const activeTarget = layout.getAttribute('data-fullscreen-target') || '';
    layout.querySelectorAll('.dl-repair-fullscreen-toggle').forEach((button) => {
      const target = button.getAttribute('data-fullscreen-target');
      const isActive = target === activeTarget;
      const label = labelByTarget[target] || 'panel';
      const title = isActive ? `Exit ${label} fullscreen` : `Expand ${label} panel`;
      button.innerHTML = `<i class="fa-solid ${isActive ? 'fa-compress' : 'fa-expand'}"></i>`;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.classList.toggle('is-active', isActive);
    });
  };

  layout.addEventListener('click', (event) => {
    const button = event.target.closest('.dl-repair-fullscreen-toggle');
    if (!button) {
      return;
    }

    const target = button.getAttribute('data-fullscreen-target');
    const currentTarget = layout.getAttribute('data-fullscreen-target') || '';
    if (!target) {
      return;
    }

    if (currentTarget === target) {
      layout.removeAttribute('data-fullscreen-target');
    } else {
      layout.setAttribute('data-fullscreen-target', target);
    }

    updateButtons();
    applyDLRepairLayoutSizing();
    requestAnimationFrame(() => triggerDLRepairPaneResize());
  });

  updateButtons();
  dlRepairFullscreenControlsInitialized = true;
}

function initializeDLRepairClassHierarchyVisibilityHandling() {
  if (dlRepairClassHierarchyVisibilityInitialized) {
    return;
  }

  window.addEventListener('dl-repair-class-hierarchy-visibility-change', () => {
    applyDLRepairLayoutSizing();
    requestAnimationFrame(() => triggerDLRepairPaneResize());
  });

  dlRepairClassHierarchyVisibilityInitialized = true;
}

function mountDLRepairPanes({ decisionPaneId, summaryPaneId, classHierarchyPaneId }) {
  const {
    container,
    leftPaneHost,
    summaryHost,
    starHost,
    classHierarchyHost,
  } = getDlRepairHostElements();

  if (!container || !leftPaneHost || !summaryHost || !starHost || !classHierarchyHost) {
    return;
  }

  const decisionPaneElement = document.getElementById(decisionPaneId);
  const summaryPaneElement = document.getElementById(summaryPaneId);
  const classHierarchyPaneElement = document.getElementById(classHierarchyPaneId);
  const decisionDetails = getPanes()[decisionPaneId] ? document.getElementById(getPanes()[decisionPaneId].details) : null;

  if (decisionPaneElement) {
    decisionPaneElement.classList.add('dl-repair-pane', 'dl-repair-pane-decision');
    leftPaneHost.appendChild(decisionPaneElement);
  }
  if (summaryPaneElement) {
    summaryPaneElement.classList.add('dl-repair-pane', 'dl-repair-pane-summary');
    summaryHost.appendChild(summaryPaneElement);
  }
  if (decisionDetails) {
    decisionDetails.classList.add('dl-repair-detached-details');
    starHost.appendChild(decisionDetails);
  }
  if (classHierarchyPaneElement) {
    classHierarchyPaneElement.classList.add('dl-repair-pane', 'dl-repair-pane-class-hierarchy');
    classHierarchyHost.appendChild(classHierarchyPaneElement);
  }

  container.querySelectorAll(':scope > .dragbar').forEach((dragbar) => dragbar.remove());
}

function initializeDLRepairLayoutResizers() {
  if (dlRepairLayoutInitialized) {
    return;
  }

  const { layout } = getDlRepairHostElements();
  if (!layout) {
    return;
  }

  const getColumnWidths = () => {
    const total = DL_REPAIR_LAYOUT.leftWidth + DL_REPAIR_LAYOUT.centerWidth + DL_REPAIR_LAYOUT.rightWidth;
    return {
      left: (DL_REPAIR_LAYOUT.leftWidth / total) * 100,
      center: (DL_REPAIR_LAYOUT.centerWidth / total) * 100,
      right: (DL_REPAIR_LAYOUT.rightWidth / total) * 100,
    };
  };

  const applyLayoutStyles = () => {
    const { left, center, right } = getColumnWidths();
    const navHeight = Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--nav-height')) || 35;
    const viewportHeight = Math.max(0, window.innerHeight - navHeight);
    const layoutHeight = Math.min(layout.clientHeight || viewportHeight, viewportHeight);
    const centerPaddingY = 16;
    const centerGap = 4;
    const usableCenterHeight = Math.max(0, layoutHeight - centerPaddingY - centerGap);
    const minSummaryHeight = 160;
    const minStarHeight = 220;
    const preferredSummaryHeight = Math.round(usableCenterHeight * (DL_REPAIR_LAYOUT.summaryHeightPct / 100));
    const maxSummaryHeight = Math.max(minSummaryHeight, usableCenterHeight - minStarHeight);
    const summaryHeight = clamp(preferredSummaryHeight, minSummaryHeight, maxSummaryHeight);
    const starHeight = Math.max(minStarHeight, usableCenterHeight - summaryHeight);

    layout.style.setProperty('--dl-left-basis', `${left}%`);
    layout.style.setProperty('--dl-center-basis', `${center}%`);
    layout.style.setProperty('--dl-right-basis', `${right}%`);
    layout.style.setProperty('--dl-summary-height-px', `${summaryHeight}px`);
    layout.style.setProperty('--dl-star-height-px', `${starHeight}px`);
    applyDLRepairLayoutSizing();
  };

  const onMouseDown = (event) => {
    const resizer = event.target.closest('.dl-repair-resizer');
    if (!resizer) {
      return;
    }

    const mode = resizer.getAttribute('data-resize');
    const rect = layout.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { ...DL_REPAIR_LAYOUT };

    const onMove = (moveEvent) => {
      if (mode === 'left-center' || mode === 'center-right') {
        const delta = ((moveEvent.clientX - startX) / rect.width) * 100;
        if (mode === 'left-center') {
          const combined = start.leftWidth + start.centerWidth;
          DL_REPAIR_LAYOUT.leftWidth = clamp(start.leftWidth + delta, 18, combined - 24);
          DL_REPAIR_LAYOUT.centerWidth = combined - DL_REPAIR_LAYOUT.leftWidth;
          DL_REPAIR_LAYOUT.rightWidth = start.rightWidth;
        } else {
          const combined = start.centerWidth + start.rightWidth;
          DL_REPAIR_LAYOUT.centerWidth = clamp(start.centerWidth + delta, 24, combined - 18);
          DL_REPAIR_LAYOUT.rightWidth = combined - DL_REPAIR_LAYOUT.centerWidth;
          DL_REPAIR_LAYOUT.leftWidth = start.leftWidth;
        }
      } else if (mode === 'summary-star') {
        const centerHost = document.querySelector('.dl-repair-panel-center');
        const centerRect = centerHost?.getBoundingClientRect();
        if (!centerRect) {
          return;
        }
        const usableCenterHeight = Math.max(0, centerRect.height - 4);
        const minSummaryHeight = 160;
        const minStarHeight = 220;
        const startSummaryHeight = (start.summaryHeightPct / 100) * usableCenterHeight;
        const nextSummaryHeight = clamp(
          startSummaryHeight + (moveEvent.clientY - startY),
          minSummaryHeight,
          Math.max(minSummaryHeight, usableCenterHeight - minStarHeight),
        );
        DL_REPAIR_LAYOUT.summaryHeightPct = (nextSummaryHeight / usableCenterHeight) * 100;
      }

      applyLayoutStyles();
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      triggerDLRepairPaneResize();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    event.preventDefault();
  };

  layout.addEventListener('mousedown', onMouseDown);
  window.addEventListener('resize', () => {
    applyLayoutStyles();
    requestAnimationFrame(() => triggerDLRepairPaneResize());
  }, { passive: true });

  applyLayoutStyles();
  requestAnimationFrame(() => triggerDLRepairPaneResize());
  dlRepairLayoutInitialized = true;
}

function resetGlobalStarAxisHighlight() {
  document.querySelectorAll('.decision-tree-star-svg .decision-tree-star-axis-line').forEach((axisLine) => {
    const defaultStroke = axisLine.getAttribute('data-default-stroke') || STAR_AXIS_DEFAULT_STROKE;
    const defaultStrokeWidth = axisLine.getAttribute('data-default-stroke-width') || STAR_AXIS_DEFAULT_STROKE_WIDTH;
    axisLine.setAttribute('stroke', defaultStroke);
    axisLine.setAttribute('stroke-width', defaultStrokeWidth);
    axisLine.setAttribute('stroke-opacity', '1');
  });

  document.querySelectorAll('.decision-tree-star-svg .decision-tree-star-axis-label').forEach((axisLabel) => {
    axisLabel.setAttribute('font-weight', axisLabel.getAttribute('data-default-font-weight') || '500');
  });
}

function highlightGlobalStarAxis(axisName) {
  const axis = String(axisName || '');
  if (!axis) {
    resetGlobalStarAxisHighlight();
    return;
  }

  document.querySelectorAll('.decision-tree-star-svg .decision-tree-star-axis-line').forEach((axisLine) => {
    const lineAxis = axisLine.getAttribute('data-axis-name');
    if (lineAxis === axis) {
      axisLine.setAttribute('stroke', STAR_AXIS_HIGHLIGHT_STROKE);
      axisLine.setAttribute('stroke-width', STAR_AXIS_HIGHLIGHT_STROKE_WIDTH);
      axisLine.setAttribute('stroke-opacity', '1');
      axisLine.setAttribute('stroke-linecap', 'round');
      axisLine.parentNode?.appendChild(axisLine);
      return;
    }

    axisLine.setAttribute('stroke', axisLine.getAttribute('data-default-stroke') || STAR_AXIS_DEFAULT_STROKE);
    axisLine.setAttribute('stroke-width', axisLine.getAttribute('data-default-stroke-width') || STAR_AXIS_DEFAULT_STROKE_WIDTH);
    axisLine.setAttribute('stroke-opacity', '1');
  });

  document.querySelectorAll('.decision-tree-star-svg .decision-tree-star-axis-label').forEach((axisLabel) => {
    const labelAxis = axisLabel.getAttribute('data-axis-name');
    const defaultWeight = axisLabel.getAttribute('data-default-font-weight') || '500';
    axisLabel.setAttribute('font-weight', labelAxis === axis ? '700' : defaultWeight);
  });
}

if (typeof window !== 'undefined') {
  window.dlRepairHighlightStarAxis = highlightGlobalStarAxis;
  window.dlRepairClearStarAxisHighlight = resetGlobalStarAxisHighlight;
}

function setupDLRepairSidebarResize() {
  if (sidebarResizeInitialized) {
    return;
  }

  const body = document.body;
  const root = document.documentElement;
  const resizer = document.getElementById('config-resizer');
  if (!body || !root || !resizer) {
    return;
  }

  const savedWidth = Number(window.localStorage.getItem(DL_REPAIR_SIDEBAR_WIDTH_KEY));
  if (!Number.isNaN(savedWidth) && savedWidth > 0) {
    root.style.setProperty('--config-width', `${savedWidth}px`);
  }

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  const triggerPaneResize = () => {
    Object.values(getPanes()).forEach((pane) => {
      if (!pane?.cy) {
        return;
      }
      pane.cy.resize();
      pane.cy.fit(undefined, 30);
      pane.cy.pcp?.redraw();
    });
  };

  const onMouseMove = (event) => {
    if (!isResizing) {
      return;
    }

    const minWidth = 240;
    const maxWidth = Math.max(360, Math.floor(window.innerWidth * 0.7));
    const delta = startX - event.clientX;
    root.style.setProperty('--config-width', `${Math.max(minWidth, Math.min(maxWidth, startWidth + delta))}px`);
  };

  const onMouseUp = () => {
    if (!isResizing) {
      return;
    }
    isResizing = false;
    body.classList.remove('config-resizing');
    triggerPaneResize();

    const currentWidth = Number.parseFloat(window.getComputedStyle(root).getPropertyValue('--config-width'));
    if (!Number.isNaN(currentWidth)) {
      window.localStorage.setItem(DL_REPAIR_SIDEBAR_WIDTH_KEY, String(Math.round(currentWidth)));
    }

    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  resizer.addEventListener('mousedown', (event) => {
    if (body.classList.contains('config-closed')) {
      return;
    }

    isResizing = true;
    startX = event.clientX;
    startWidth = Number.parseFloat(window.getComputedStyle(root).getPropertyValue('--config-width')) || 350;
    body.classList.add('config-resizing');

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    event.preventDefault();
  });

  sidebarResizeInitialized = true;
}

function normalizeAxiomText(axiomText) {
  return typeof axiomText === 'string' ? axiomText.replace(/\s+/g, ' ').trim() : '';
}

function applyRepairAxiomsToSummary(summaryCy, paneId, repairAxioms) {
  if (!summaryCy) {
    return;
  }

  const removeSet = new Set((Array.isArray(repairAxioms) ? repairAxioms : []).map(normalizeAxiomText).filter(Boolean));
  summaryCy.nodes().forEach((node) => {
    const axiomText = normalizeAxiomText(node.data('fullLabel') || node.data('label'));
    setSummaryNodeState(summaryCy, paneId, node.id(), removeSet.has(axiomText) ? AXIOM_STATES.REMOVED : AXIOM_STATES.KEPT);
  });
}

function generateProbabilitiesBarChart(probabilities) {
  if (!probabilities || (!probabilities.yes && !probabilities.no)) {
    return '<p>No probabilities data available</p>';
  }

  const formatPercent = (value) => `${Number((value * 100).toFixed(2)).toString()}%`;
  const normalizeToUnit = (value) => {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return 0;
    }
    return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
  };
  const isNoRepairValue = (value) => typeof value === 'string' && value.trim().toLowerCase() === 'no repair!';

  const yesUnavailable = isNoRepairValue(probabilities.yes);
  const noUnavailable = isNoRepairValue(probabilities.no);
  const yesData = !yesUnavailable && probabilities.yes && typeof probabilities.yes === 'object' ? probabilities.yes : {};
  const noData = !noUnavailable && probabilities.no && typeof probabilities.no === 'object' ? probabilities.no : {};
  const allAxioms = new Set([...Object.keys(yesData), ...Object.keys(noData)]);

  const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeSingleQuotedJs = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const createMiniStarAxisIcon = (axiom, dimensions) => {
    const iconSize = 24;
    const center = iconSize / 2;
    const radius = 9.2;
    const axisCount = Math.max(1, dimensions.length);
    const getPoint = (angle, scale = 1) => ({ x: center + radius * scale * Math.cos(angle), y: center + radius * scale * Math.sin(angle) });

    const axisLines = dimensions.map((dimension, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / axisCount;
      const endpoint = getPoint(angle);
      const isTargetAxis = dimension === axiom;
      const defaultStroke = isTargetAxis ? STAR_AXIS_HIGHLIGHT_STROKE : STAR_AXIS_DEFAULT_STROKE;
      const defaultStrokeWidth = isTargetAxis ? '1.8' : STAR_AXIS_DEFAULT_STROKE_WIDTH;
      const defaultOpacity = isTargetAxis ? '1' : '0.45';
      return `<line class="decision-tree-star-axis-line" data-axis-name="${escapeHtml(dimension)}" data-default-stroke="${defaultStroke}" data-default-stroke-width="${defaultStrokeWidth}" x1="${center}" y1="${center}" x2="${endpoint.x}" y2="${endpoint.y}" stroke="${defaultStroke}" stroke-width="${defaultStrokeWidth}" stroke-opacity="${defaultOpacity}" />`;
    }).join('');

    const polygonPoints = dimensions.map((dimension, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / axisCount;
      const point = getPoint(angle);
      return `${point.x},${point.y}`;
    }).join(' ');

    const escapedAxiomForJs = escapeSingleQuotedJs(axiom);
    return `<span title="Highlight ${escapeHtml(axiom)} axis in star plots" style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;cursor:pointer;flex-shrink:0;" onmouseenter="window.dlRepairHighlightStarAxis && window.dlRepairHighlightStarAxis('${escapedAxiomForJs}')" onmouseleave="window.dlRepairClearStarAxisHighlight && window.dlRepairClearStarAxisHighlight()"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style="display:block;"><polygon points="${polygonPoints}" fill="#f4f4f4" fill-opacity="0.55" stroke="#d1d1d1" stroke-width="0.6"></polygon>${axisLines}</svg></span>`;
  };

  const renderAxiomLabelWithIcon = (axiom, dimensions, textColor = null) => {
    const colorStyle = textColor ? ` color: ${textColor}; font-weight: 600;` : '';
    const escapedAxiomForJs = escapeSingleQuotedJs(axiom);
    return `<div style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:4px;word-wrap:break-word;${colorStyle}">${createMiniStarAxisIcon(axiom, dimensions)}<span style="min-width:0;overflow-wrap:anywhere;cursor:pointer;" onmouseenter="this.style.fontWeight='700'; window.dlRepairHighlightStarAxis && window.dlRepairHighlightStarAxis('${escapedAxiomForJs}')" onmouseleave="this.style.fontWeight=''; window.dlRepairClearStarAxisHighlight && window.dlRepairClearStarAxisHighlight()">${axiom}</span></div>`;
  };

  const allAxiomDimensions = Array.from(allAxioms);
  let html = '<div style="font-family:monospace;font-size:13px;border-bottom:1px solid #d3d3d3;padding-bottom:10px;margin-bottom:14px;width:100%;box-sizing:border-box;">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;width:100%;box-sizing:border-box;" onclick="const content=document.getElementById(\'probabilities-content\'); const triangle=document.getElementById(\'probabilities-triangle\'); const isOpen=content.style.display!==\'none\'; content.style.display=isOpen ? \'none\' : \'block\'; triangle.style.transform=isOpen ? \'scaleX(1.35) rotate(180deg)\' : \'scaleX(1.35) rotate(0deg)\';">';
  html += '<h4 style="margin:0;font-size:17px;">Axiom Probabilities (keep/remove)</h4>';
  html += '<span id="probabilities-triangle" style="font-family:Arial,sans-serif;font-weight:700;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;text-align:center;transform:scaleX(1.35) rotate(0deg);transform-origin:center center;flex-shrink:0;">▴</span>';
  html += '</div>';
  html += '<div id="probabilities-content" style="display:block;padding-top:8px;width:100%;box-sizing:border-box;">';

  if (yesUnavailable || noUnavailable) {
    html += `<div style="background:#fff3cd;border:1px solid #ffe69c;color:#664d03;border-radius:4px;padding:8px 10px;margin-bottom:10px;font-size:12px;">${yesUnavailable && noUnavailable ? 'keep/remove has No Repair' : yesUnavailable ? 'keep has No Repair' : 'remove has No Repair'}</div>`;
  }

  if (allAxioms.size === 0) {
    html += '<div style="font-size:12px;color:#666;">No probability values available.</div>';
  }

  allAxioms.forEach((axiom) => {
    const hasYes = Object.prototype.hasOwnProperty.call(yesData, axiom);
    const hasNo = Object.prototype.hasOwnProperty.call(noData, axiom);
    const yesValue = hasYes ? normalizeToUnit(yesData[axiom]) : 0;
    const noValue = hasNo ? normalizeToUnit(noData[axiom]) : 0;
    const hasBoth = hasYes && hasNo;
    const bothOne = hasBoth && yesValue === 1 && noValue === 1;
    const bothZero = hasBoth && yesValue === 0 && noValue === 0;
    const sameValue = hasBoth && yesValue === noValue;
    const yesOneNoZero = hasBoth && yesValue === 1 && noValue === 0;
    const yesZeroNoOne = hasBoth && yesValue === 0 && noValue === 1;
    const shouldRenderSpecial = bothOne || bothZero || sameValue || yesOneNoZero || yesZeroNoOne;

    html += '<div style="margin-bottom:12px;">';
    if (shouldRenderSpecial) {
      let axiomColor = '#6c757d';
      if (bothOne) axiomColor = '#2b8a3e';
      else if (bothZero) axiomColor = '#c92a2a';
      else if (yesOneNoZero) axiomColor = '#1971c2';
      else if (yesZeroNoOne) axiomColor = '#e67700';

      html += renderAxiomLabelWithIcon(axiom, allAxiomDimensions, axiomColor);
      html += `<div style="font-size:11px;margin-top:2px;color:${axiomColor};font-weight:600;">keep: ${formatPercent(yesValue)} | remove: ${formatPercent(noValue)}</div>`;
    } else {
      html += renderAxiomLabelWithIcon(axiom, allAxiomDimensions);
      html += '<div style="display:flex;align-items:stretch;width:100%;height:20px;border-radius:3px;overflow:hidden;background-color:#f0f0f0;box-sizing:border-box;position:relative;">';
      html += `<div style="width:50%;background-color:#f0f0f0;position:relative;"><div style="position:absolute;right:0;top:0;width:${Math.max(0, Math.min(100, noValue * 100))}%;height:100%;background-color:#F6D69C;"></div></div>`;
      html += `<div style="width:50%;background-color:#f0f0f0;position:relative;"><div style="position:absolute;left:0;top:0;width:${Math.max(0, Math.min(100, yesValue * 100))}%;height:100%;background-color:#A6CAE1;"></div></div>`;
      html += '<div style="position:absolute;left:50%;top:0;transform:translateX(-50%);width:1px;height:100%;background-color:#000;z-index:3;"></div>';
      html += `<div style="position:absolute;right:calc(50% + 6px);top:50%;transform:translateY(-50%);font-size:10px;font-weight:600;color:#7a4a00;z-index:4;pointer-events:none;">remove: ${formatPercent(noValue)}</div>`;
      html += `<div style="position:absolute;left:calc(50% + 6px);top:50%;transform:translateY(-50%);font-size:10px;font-weight:600;color:#0b5a85;z-index:4;pointer-events:none;">keep: ${formatPercent(yesValue)}</div>`;
      html += '</div>';
    }
    html += '</div>';
  });

  html += '</div></div>';
  return html;
}

function generateHammingDistanceSection(distance) {
  if (!distance) {
    return '<p style="margin-top:14px;font-size:13px;">No hamming distance data available</p>';
  }

  const isNoRepairValue = (value) => typeof value === 'string' && value.trim().toLowerCase() === 'no repair!';
  const yesIsNoRepair = isNoRepairValue(distance.hamming_yes);
  const noIsNoRepair = isNoRepairValue(distance.hamming_no);
  const hammingYes = !yesIsNoRepair ? Number(distance.hamming_yes || 0) : 0;
  const hammingNo = !noIsNoRepair ? Number(distance.hamming_no || 0) : 0;
  const entailedYes = Array.isArray(distance.entailed_yes) ? distance.entailed_yes : [];
  const entailedBoth = Array.isArray(distance.entailed_both) ? distance.entailed_both : [];
  const entailedNo = Array.isArray(distance.entailed_no) ? distance.entailed_no : [];
  const formatUpTo4Decimals = (value) => Number(value.toFixed(4)).toString();
  const yesDisplay = yesIsNoRepair ? '(No Repair)' : `(<span style="color:#2b8a3e;font-weight:600;">${formatUpTo4Decimals(hammingYes)}</span>)`;
  const noDisplay = noIsNoRepair ? '(No Repair)' : `(<span style="color:#c92a2a;font-weight:600;">${formatUpTo4Decimals(hammingNo)}</span>)`;

  let compareSymbol = '-';
  if (!yesIsNoRepair && !noIsNoRepair) {
    compareSymbol = hammingYes > hammingNo ? '>' : hammingYes < hammingNo ? '<' : '=';
  }

  const renderAxiomList = (items) => {
    if (!items.length) {
      return '<div style="font-size:12px;margin-top:4px;color:#666;">No entailed axioms</div>';
    }
    return `<ul style="margin:6px 0 0 16px;padding:0;font-size:12px;">${items.map(item => `<li style="margin-bottom:4px;word-break:break-word;">${item}</li>`).join('')}</ul>`;
  };

  const bothHoverKeep = "const bothBox=document.getElementById('hamming-both-box'); const bothLabel=document.getElementById('hamming-both-label'); if (bothBox) { bothBox.style.borderColor='#d9e8d9'; bothBox.style.background='#f5fff5'; } if (bothLabel) { bothLabel.style.color='#2b8a3e'; }";
  const bothHoverRemove = "const bothBox=document.getElementById('hamming-both-box'); const bothLabel=document.getElementById('hamming-both-label'); if (bothBox) { bothBox.style.borderColor='#f0d6d6'; bothBox.style.background='#fff5f5'; } if (bothLabel) { bothLabel.style.color='#c92a2a'; }";
  const bothHoverReset = "const bothBox=document.getElementById('hamming-both-box'); const bothLabel=document.getElementById('hamming-both-label'); if (bothBox) { bothBox.style.borderColor='#d9d9d9'; bothBox.style.background='#fafafa'; } if (bothLabel) { bothLabel.style.color='#555'; }";
  const propagateTip = 'Ctrl+click to propagate this choice to Summary View';

  let html = '<div style="margin-top:18px;border-bottom:1px solid #d3d3d3;padding-bottom:10px;margin-bottom:10px;width:100%;box-sizing:border-box;">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;width:100%;box-sizing:border-box;" onclick="const content=document.getElementById(\'hamming-content\'); const triangle=document.getElementById(\'hamming-triangle\'); const isOpen=content.style.display!==\'none\'; content.style.display=isOpen ? \'none\' : \'block\'; triangle.style.transform=isOpen ? \'scaleX(1.35) rotate(180deg)\' : \'scaleX(1.35) rotate(0deg)\';">';
  html += '<h4 style="margin:0;font-size:17px;">Hamming Distance</h4>';
  html += '<span id="hamming-triangle" style="font-family:Arial,sans-serif;font-weight:700;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;text-align:center;transform:scaleX(1.35) rotate(0deg);transform-origin:center center;flex-shrink:0;">▴</span>';
  html += '</div>';
  html += '<div id="hamming-content" style="display:block;padding-top:8px;width:100%;box-sizing:border-box;">';
  html += '<div style="font-size:11px;color:#666;margin-bottom:8px;">Tip: Ctrl+click on a distance choice to propagate it.</div>';
  html += `<div style="font-size:13px;margin-bottom:10px;"><span data-hamming-choice="yes" data-hamming-hover-target="yes" title="${propagateTip}" style="color:#2b8a3e;font-weight:600;cursor:pointer;" onmouseover="${bothHoverKeep}" onmouseout="${bothHoverReset}">keep</span> <span data-hamming-choice="yes" data-hamming-hover-target="yes" title="${propagateTip}" style="cursor:pointer;" onmouseover="${bothHoverKeep}" onmouseout="${bothHoverReset}">${yesDisplay}</span> ${compareSymbol} <span data-hamming-choice="no" data-hamming-hover-target="yes" title="${propagateTip}" style="color:#c92a2a;font-weight:600;cursor:pointer;" onmouseover="${bothHoverRemove}" onmouseout="${bothHoverReset}">remove</span> <span data-hamming-choice="no" data-hamming-hover-target="yes" title="${propagateTip}" style="cursor:pointer;" onmouseover="${bothHoverRemove}" onmouseout="${bothHoverReset}">${noDisplay}</span></div>`;
  html += '<div style="display:flex;flex-direction:column;gap:10px;">';
  html += `<div data-hamming-choice="yes" style="border:1px solid #d9e8d9;border-radius:2px;padding:11px 13px;background:#f5fff5;cursor:pointer;" onmouseover="${bothHoverKeep}" onmouseout="${bothHoverReset}">`;
  html += '<div style="font-weight:600;font-size:14px;color:#2b8a3e;display:inline-block;">keep</div>';
  html += renderAxiomList(entailedYes);
  html += '</div>';
  html += '<div id="hamming-both-box" style="border:1px solid #d9d9d9;border-radius:2px;padding:11px 13px;background:#fafafa;">';
  html += '<div id="hamming-both-label" style="font-weight:600;font-size:14px;color:#555;">both</div>';
  html += renderAxiomList(entailedBoth);
  html += '</div>';
  html += `<div data-hamming-choice="no" style="border:1px solid #f0d6d6;border-radius:2px;padding:11px 13px;background:#fff5f5;cursor:pointer;" onmouseover="${bothHoverRemove}" onmouseout="${bothHoverReset}">`;
  html += '<div style="font-weight:600;font-size:14px;color:#c92a2a;display:inline-block;">remove</div>';
  html += renderAxiomList(entailedNo);
  html += '</div></div></div></div>';
  return html;
}

function generateNodeDetailsHTML(probabilities, distance) {
  return `<div style="width:100%;box-sizing:border-box;">${generateProbabilitiesBarChart(probabilities)}${generateHammingDistanceSection(distance)}</div>`;
}

function bindHammingRepairClickActions(container, nodeId, pane) {
  if (!container) {
    return;
  }

  container.querySelectorAll('[data-hamming-hover-target]').forEach((element) => {
    element.onmouseenter = (event) => {
      event.stopPropagation();
      const choice = element.getAttribute('data-hamming-choice');
      if (!choice) {
        return;
      }
      document.dispatchEvent(new CustomEvent('hamming-repair-hover', { detail: { choice, nodeId, paneId: pane?.id, distance: container.__hammingDistanceData } }));
    };

    element.onmouseleave = (event) => {
      event.stopPropagation();
      document.dispatchEvent(new CustomEvent('hamming-repair-hover-end', { detail: { paneId: pane?.id } }));
    };
  });

  container.querySelectorAll('[data-hamming-choice]').forEach((element) => {
    element.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const choice = element.getAttribute('data-hamming-choice');
      if (!choice) {
        return;
      }
      document.dispatchEvent(new CustomEvent('hamming-repair-choice', { detail: { choice, nodeId, paneId: pane?.id, propagate: !!(event.ctrlKey || event.metaKey), distance: container.__hammingDistanceData } }));
    };
  });
}

function displayNodeDetails(html, nodeId, pane, hammingDistance = null) {
  const detailsContainer = document.getElementById('dl-repair-details');
  if (detailsContainer) {
    detailsContainer.style.width = '100%';
    detailsContainer.style.boxSizing = 'border-box';
    detailsContainer.innerHTML = html;
    detailsContainer.__hammingDistanceData = hammingDistance;
    bindHammingRepairClickActions(detailsContainer, nodeId, pane);
    return;
  }

  const newContainer = document.createElement('div');
  newContainer.id = 'dl-repair-details';
  newContainer.className = 'dl-repair-details';
  newContainer.style.padding = '16px';
  newContainer.style.overflow = 'auto';
  newContainer.style.width = '100%';
  newContainer.style.boxSizing = 'border-box';
  newContainer.innerHTML = html;
  newContainer.__hammingDistanceData = hammingDistance;
  bindHammingRepairClickActions(newContainer, nodeId, pane);

  document.getElementById('config')?.appendChild(newContainer);
}

function showErrorMessage(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'ui negative message';
  errorDiv.innerHTML = `<div class="header">Error</div><p>${message}</p>`;
  document.getElementById('container')?.appendChild(errorDiv);
}

async function updateDecisionTreePCP(pane, selectedNodeIds) {
  if (!pane?.cy) {
    return;
  }

  const DECISION_TREE_PLOT_MODE = { PCP: 'pcp', STAR: 'star' };
  const STAR_PLOT_COLORS = { yesStroke: '#2b8a3e', yesFill: '#f5fff5', noStroke: '#c92a2a', noFill: '#fff5f5' };

  const buildSeriesValues = (dimensions, row) => dimensions.map((dimension) => {
    const value = Number(row?.[dimension]);
    return Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value));
  });

  const createStarPlotSvg = ({ dimensions, series, width, height, title, showAxisLabels = false, selectedAxiomTexts = null }) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.classList.add('decision-tree-star-svg');

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.max(40, Math.min(width, height) / 2 - 40);
    const axisCount = Math.max(1, dimensions.length);
    let activeHoverAxis = null;
    const matchedAxisEntries = [];

    const polarToCartesian = (angle, value) => ({ x: centerX + value * radius * Math.cos(angle), y: centerY + value * radius * Math.sin(angle) });
    const append = (name, attrs = {}, parent = svg) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', name);
      Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
      parent.appendChild(element);
      return element;
    };
    const normalizeAxisText = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    const compactAxisText = (value) => normalizeAxisText(value).replace(/\s+/g, '');
    const addDoubleBorderRect = (group, textElement, fallbackInfo = null) => {
      let box;
      try { box = textElement.getBBox(); } catch { box = null; }
      if (!box || !Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) {
        const textValue = String(textElement.textContent || fallbackInfo?.text || '');
        const fontSize = Number(textElement.getAttribute('font-size') || 10);
        const estimatedWidth = Math.max(10, textValue.length * fontSize * 0.62);
        const estimatedHeight = Math.max(10, fontSize * 1.25);
        const rawX = Number(textElement.getAttribute('x') || 0);
        const rawY = Number(textElement.getAttribute('y') || 0);
        const anchor = textElement.getAttribute('text-anchor') || fallbackInfo?.anchor || 'start';
        const baseline = textElement.getAttribute('dominant-baseline') || fallbackInfo?.baseline || 'auto';
        let estimatedX = rawX;
        if (anchor === 'end') estimatedX = rawX - estimatedWidth;
        else if (anchor === 'middle') estimatedX = rawX - (estimatedWidth / 2);
        const estimatedY = baseline === 'hanging' ? rawY : rawY - (estimatedHeight * 0.82);
        box = { x: estimatedX, y: estimatedY, width: estimatedWidth, height: estimatedHeight };
      }

      const outerRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      outerRect.setAttribute('x', String(box.x - 5));
      outerRect.setAttribute('y', String(box.y - 3));
      outerRect.setAttribute('width', String(box.width + 10));
      outerRect.setAttribute('height', String(box.height + 6));
      outerRect.setAttribute('fill', 'none');
      outerRect.setAttribute('stroke', STAR_SELECTED_AXIOM_BORDER);
      outerRect.setAttribute('stroke-width', '1.3');
      outerRect.setAttribute('pointer-events', 'none');

      const innerRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      innerRect.setAttribute('x', String(box.x - 5 + 2));
      innerRect.setAttribute('y', String(box.y - 3 + 2));
      innerRect.setAttribute('width', String(Math.max(1, box.width + 6)));
      innerRect.setAttribute('height', String(Math.max(1, box.height + 2)));
      innerRect.setAttribute('fill', 'none');
      innerRect.setAttribute('stroke', STAR_SELECTED_AXIOM_BORDER);
      innerRect.setAttribute('stroke-width', '1');
      innerRect.setAttribute('pointer-events', 'none');
      group.insertBefore(outerRect, textElement);
      group.insertBefore(innerRect, textElement);
    };

    [0.25, 0.5, 0.75, 1].forEach((step) => append('circle', { cx: centerX, cy: centerY, r: radius * step, fill: 'none', stroke: '#cfcfcf', 'stroke-width': 1 }));

    dimensions.forEach((dimension, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / axisCount;
      const endpoint = polarToCartesian(angle, 1);
      append('line', { x1: centerX, y1: centerY, x2: endpoint.x, y2: endpoint.y, class: 'decision-tree-star-axis-line', 'data-axis-name': dimension, 'data-default-stroke': STAR_AXIS_DEFAULT_STROKE, 'data-default-stroke-width': STAR_AXIS_DEFAULT_STROKE_WIDTH, stroke: STAR_AXIS_DEFAULT_STROKE, 'stroke-width': STAR_AXIS_DEFAULT_STROKE_WIDTH });

      if (showAxisLabels) {
        const labelPoint = polarToCartesian(angle, 1.09);
        const labelGroup = append('g', { class: 'decision-tree-star-axis-label-group', 'data-axis-name': dimension });
        const label = append('text', { x: labelPoint.x, y: labelPoint.y, class: 'decision-tree-star-axis-label', 'data-axis-name': dimension, 'text-anchor': endpoint.x >= centerX ? 'start' : 'end', 'dominant-baseline': endpoint.y >= centerY ? 'hanging' : 'auto', 'font-size': 10, 'font-weight': 500, 'data-default-font-weight': 500, fill: '#4b4b4b' }, labelGroup);
        label.textContent = dimension;

        const normalizedDimension = normalizeAxisText(dimension);
        const compactDimension = compactAxisText(dimension);
        if (selectedAxiomTexts?.has(normalizedDimension) || selectedAxiomTexts?.has(compactDimension)) {
          matchedAxisEntries.push({ labelGroup, label, fallbackInfo: { text: dimension, anchor: endpoint.x >= centerX ? 'start' : 'end', baseline: endpoint.y >= centerY ? 'hanging' : 'auto' } });
        }

        const onEnter = () => highlightGlobalStarAxis(dimension);
        const onLeave = () => resetGlobalStarAxisHighlight();
        label.addEventListener('mouseenter', onEnter);
        label.addEventListener('mouseleave', onLeave);
        labelGroup.addEventListener('mouseenter', onEnter);
        labelGroup.addEventListener('mouseleave', onLeave);
      }
    });

    const seriesElements = [];
    series.forEach((entry) => {
      if (!entry.values.length) {
        return;
      }
      const pointList = entry.values.map((value, index) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / axisCount;
        const position = polarToCartesian(angle, value);
        return `${position.x},${position.y}`;
      });
      const points = pointList.join(' ');
      const linePoints = [...pointList, pointList[0]].join(' ');
      const fillPolygon = append('polygon', { points, fill: entry.fill || 'none', 'fill-opacity': entry.fillOpacity ?? 0.12, stroke: 'none' });
      const strokePolyline = append('polyline', { points: linePoints, fill: 'none', stroke: entry.stroke, 'stroke-width': entry.strokeWidth ?? 2, 'stroke-dasharray': entry.dashArray || '0', 'stroke-linejoin': 'round' });
      const style = { fill: entry.fill || 'none', fillOpacity: entry.fillOpacity ?? 0.12, stroke: entry.stroke, strokeWidth: entry.strokeWidth ?? 2, dashArray: entry.dashArray || '0' };
      fillPolygon.__seriesStyle = style;
      strokePolyline.__seriesStyle = style;
      seriesElements.push({ fillPolygon, strokePolyline, style });
    });

    if (title) {
      const titleText = append('text', { x: 8, y: 14, 'text-anchor': 'start', 'font-size': 12, 'font-weight': 600, fill: '#2f2f2f' });
      titleText.textContent = title;
    }

    const toSvgPoint = (evt) => {
      if (typeof svg.createSVGPoint !== 'function') {
        return null;
      }
      const point = svg.createSVGPoint();
      point.x = evt.clientX;
      point.y = evt.clientY;
      const ctm = svg.getScreenCTM();
      return ctm ? point.matrixTransform(ctm.inverse()) : null;
    };
    const shortestAngleDiff = (a, b) => {
      let diff = a - b;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      return Math.abs(diff);
    };
    const outerPolygonPoints = dimensions.map((_, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / axisCount;
      return polarToCartesian(angle, 1);
    });
    const isInsideOuterPolygon = (x, y) => {
      if (outerPolygonPoints.length < 3) {
        return false;
      }
      let inside = false;
      for (let current = 0, previous = outerPolygonPoints.length - 1; current < outerPolygonPoints.length; previous = current, current += 1) {
        const xi = outerPolygonPoints[current].x;
        const yi = outerPolygonPoints[current].y;
        const xj = outerPolygonPoints[previous].x;
        const yj = outerPolygonPoints[previous].y;
        const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };
    const setHoveredAxis = (axisName) => {
      if (activeHoverAxis === axisName) {
        return;
      }
      activeHoverAxis = axisName;
      if (!axisName) {
        resetGlobalStarAxisHighlight();
        return;
      }
      highlightGlobalStarAxis(axisName);
    };
    const findClosestAxis = (svgX, svgY) => {
      if (!dimensions.length || !isInsideOuterPolygon(svgX, svgY)) {
        return null;
      }
      const dx = svgX - centerX;
      const dy = svgY - centerY;
      if (Math.hypot(dx, dy) < 6) {
        return null;
      }
      const mouseAngle = Math.atan2(dy, dx);
      let bestIndex = 0;
      let bestDiff = Number.POSITIVE_INFINITY;
      dimensions.forEach((_, index) => {
        const axisAngle = -Math.PI / 2 + (2 * Math.PI * index) / axisCount;
        const diff = shortestAngleDiff(mouseAngle, axisAngle);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIndex = index;
        }
      });
      return dimensions[bestIndex];
    };
    svg.addEventListener('mousemove', (event) => {
      const svgPoint = toSvgPoint(event);
      if (!svgPoint) return;
      setHoveredAxis(findClosestAxis(svgPoint.x, svgPoint.y));
    });
    svg.addEventListener('mouseleave', () => setHoveredAxis(null));
    svg.__seriesElements = seriesElements;

    const renderMatchedAxisBorders = () => {
      matchedAxisEntries.forEach(({ labelGroup, label, fallbackInfo }) => {
        if (!labelGroup || !label || labelGroup.querySelector('rect.decision-tree-selected-axis-border')) {
          return;
        }
        addDoubleBorderRect(labelGroup, label, fallbackInfo);
        labelGroup.querySelectorAll('rect').forEach((rect) => rect.classList.add('decision-tree-selected-axis-border'));
        labelGroup.parentNode?.appendChild(labelGroup);
      });
    };

    requestAnimationFrame(renderMatchedAxisBorders);
    queueMicrotask(renderMatchedAxisBorders);
    return svg;
  };

  const ensurePlotToggle = (mode, showAxisLabels) => {
    const detailElement = document.getElementById(pane.details);
    if (!detailElement) {
      return;
    }
    let toggle = detailElement.querySelector('.decision-tree-plot-toggle');
    if (!toggle) {
      toggle = document.createElement('div');
      toggle.className = 'decision-tree-plot-toggle';
      detailElement.appendChild(toggle);
    }
    toggle.innerHTML = `
      <div class="decision-tree-plot-toggle-row">
        <button class="decision-tree-plot-toggle-btn ${mode === DECISION_TREE_PLOT_MODE.PCP ? 'active' : ''}" data-mode="${DECISION_TREE_PLOT_MODE.PCP}">PCP</button>
        <button class="decision-tree-plot-toggle-btn ${mode === DECISION_TREE_PLOT_MODE.STAR ? 'active' : ''}" data-mode="${DECISION_TREE_PLOT_MODE.STAR}">Star Plot</button>
      </div>
      ${mode === DECISION_TREE_PLOT_MODE.STAR ? `<label class="decision-tree-star-label-switch"><input type="checkbox" class="decision-tree-star-label-switch-input" ${showAxisLabels ? 'checked' : ''}><span>Show axis labels</span></label>` : ''}
    `;
    toggle.querySelectorAll('.decision-tree-plot-toggle-btn').forEach((button) => {
      button.onclick = () => {
        const nextMode = button.getAttribute('data-mode');
        if (!nextMode || pane.cy.vars['pcp-visual-mode'].value === nextMode) {
          return;
        }
        pane.cy.vars['pcp-visual-mode'].value = nextMode;
        updateDecisionTreePCP(pane, pane.cy.$('node:selected').map(n => n.data('nodeId')));
      };
    });
    const labelSwitch = toggle.querySelector('.decision-tree-star-label-switch-input');
    if (labelSwitch) {
      labelSwitch.onchange = () => {
        pane.cy.vars['star-show-axis-labels'].value = labelSwitch.checked;
        if (pane.cy.vars['pcp-visual-mode'].value !== DECISION_TREE_PLOT_MODE.STAR) {
          return;
        }
        updateDecisionTreePCP(pane, pane.cy.$('node:selected').map(n => n.data('nodeId')));
      };
    }
  };

  const clearStarPlotView = () => {
    document.getElementById(pane.details)?.querySelectorAll('.decision-tree-star-root').forEach((element) => element.remove());
  };

  const renderStarPlotView = (dimensions, byNodeRows, selectedIds, showAxisLabels = false) => {
    const detailElement = document.getElementById(pane.details);
    if (!detailElement) {
      return;
    }

    clearStarPlotView();
    const root = document.createElement('div');
    root.className = 'decision-tree-star-root';
    detailElement.appendChild(root);

    const selectedKeys = (selectedIds || []).map(String).filter((id) => byNodeRows[id]);
    const nodeLabelById = {};
    const nodeAxiomById = {};
    const nodeFullLabelById = {};
    pane.cy.nodes().forEach((node) => {
      const nodeId = String(node.data('nodeId'));
      const label = node.data('label') || node.data('axiom');
      const axiom = node.data('axiom') || label;
      const fullLabel = node.data('fullLabel');
      if (label) nodeLabelById[nodeId] = String(label);
      if (axiom) nodeAxiomById[nodeId] = String(axiom);
      if (fullLabel) nodeFullLabelById[nodeId] = String(fullLabel);
    });

    const normalizeAxisText = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    const compactAxisText = (value) => normalizeAxisText(value).replace(/\s+/g, '');
    const selectedAxiomTexts = new Set();
    selectedKeys.forEach((id) => {
      [nodeAxiomById[id], nodeLabelById[id], nodeFullLabelById[id]].filter(Boolean).forEach((candidate) => {
        const normalized = normalizeAxisText(candidate);
        const compact = compactAxisText(candidate);
        if (normalized) selectedAxiomTexts.add(normalized);
        if (compact) selectedAxiomTexts.add(compact);
      });
    });

    if (selectedKeys.length === 0 || dimensions.length === 0) {
      const emptyWidth = Math.max(360, Math.min(1200, Math.max(360, detailElement.clientWidth - 40)));
      const emptySvg = createStarPlotSvg({ dimensions, series: [], width: emptyWidth, height: 340, title: 'Star Plot (no node selected)', showAxisLabels, selectedAxiomTexts });
      const emptyContainer = document.createElement('div');
      emptyContainer.className = 'decision-tree-star-combined';
      emptyContainer.appendChild(emptySvg);
      root.appendChild(emptyContainer);
      return;
    }

    const previousOrder = (pane.cy.starPlotOrder || []).map(String);
    const selectedSet = new Set(selectedKeys);
    const orderedKeys = previousOrder.filter((id) => selectedSet.has(id)).concat(selectedKeys.filter((id) => !previousOrder.includes(id)));
    pane.cy.starPlotOrder = orderedKeys;

    const getNodeLabel = (nodeId) => nodeLabelById[String(nodeId)] || `Node ${nodeId}`;
    const cardById = {};
    const combinedSection = document.createElement('div');
    combinedSection.className = 'decision-tree-star-combined';
    const combinedWidth = Math.max(360, Math.min(1200, Math.max(360, detailElement.clientWidth - 40)));

    const combinedSeries = [];
    const combinedSeriesIndicesByNode = new Map();
    orderedKeys.forEach((nodeId) => {
      const rows = byNodeRows[nodeId] || {};
      const yesValues = buildSeriesValues(dimensions, rows.yes || {});
      const noValues = buildSeriesValues(dimensions, rows.no || {});
      const nodeLabel = getNodeLabel(nodeId);
      const startIndex = combinedSeries.length;
      combinedSeries.push(
        { label: `${nodeLabel} — yes`, values: yesValues, stroke: STAR_PLOT_COLORS.yesStroke, fill: STAR_PLOT_COLORS.yesFill, fillOpacity: 0.6, strokeWidth: 2 },
        { label: `${nodeLabel} — no`, values: noValues, stroke: STAR_PLOT_COLORS.noStroke, fill: STAR_PLOT_COLORS.noFill, fillOpacity: 0.55, strokeWidth: 2 },
      );
      combinedSeriesIndicesByNode.set(String(nodeId), [startIndex, startIndex + 1]);
    });

    const setHoveredDecisionTreeNode = (nodeId = null) => {
      pane.cy.$('node.starplot-hovered').removeClass('starplot-hovered');
      if (nodeId !== null && nodeId !== undefined) {
        pane.cy.getElementById(`node-${nodeId}`).addClass('starplot-hovered');
      }
    };

    const combinedSvg = createStarPlotSvg({ dimensions, series: combinedSeries, width: combinedWidth, height: 340, title: 'Combined Star Plot (selected nodes)', showAxisLabels, selectedAxiomTexts });
    combinedSection.appendChild(combinedSvg);

    const setCombinedHoverState = (hoveredNodeId = null) => {
      const seriesEls = combinedSvg.__seriesElements || [];
      const hoveredIndices = hoveredNodeId ? combinedSeriesIndicesByNode.get(String(hoveredNodeId)) : null;
      const hoveredSet = hoveredIndices ? new Set(hoveredIndices) : null;
      seriesEls.forEach((seriesEl, polygonIndex) => {
        const { fillPolygon, strokePolyline, style: base } = seriesEl;
        if (!base) return;
        if (hoveredSet === null) {
          fillPolygon.setAttribute('fill', base.fill);
          fillPolygon.setAttribute('fill-opacity', String(base.fillOpacity));
          strokePolyline.setAttribute('stroke', base.stroke);
          strokePolyline.setAttribute('stroke-width', String(base.strokeWidth));
          strokePolyline.setAttribute('stroke-dasharray', String(base.dashArray));
          return;
        }
        if (hoveredSet.has(polygonIndex)) {
          fillPolygon.setAttribute('fill', base.fill);
          fillPolygon.setAttribute('fill-opacity', String(base.fillOpacity));
          strokePolyline.setAttribute('stroke', base.stroke);
          strokePolyline.setAttribute('stroke-width', String(Math.max(base.strokeWidth, 3)));
          strokePolyline.setAttribute('stroke-dasharray', String(base.dashArray));
          return;
        }
        fillPolygon.setAttribute('fill', '#f3f3f3');
        fillPolygon.setAttribute('fill-opacity', '0.16');
        strokePolyline.setAttribute('stroke', '#dddddd');
        strokePolyline.setAttribute('stroke-width', '1.5');
        strokePolyline.setAttribute('stroke-dasharray', '0');
      });
      if (hoveredSet === null) {
        seriesEls.forEach(({ fillPolygon }) => fillPolygon.parentNode?.appendChild(fillPolygon));
        seriesEls.forEach(({ strokePolyline }) => strokePolyline.parentNode?.appendChild(strokePolyline));
        return;
      }
      hoveredIndices.forEach((hoveredIndex) => {
        const hovered = seriesEls[hoveredIndex];
        if (hovered) {
          hovered.fillPolygon.parentNode?.appendChild(hovered.fillPolygon);
          hovered.strokePolyline.parentNode?.appendChild(hovered.strokePolyline);
        }
      });
    };
    root.appendChild(combinedSection);

    const gridTitle = document.createElement('div');
    gridTitle.className = 'decision-tree-star-grid-title';
    gridTitle.textContent = 'Per-node Star Plot Grid (drag to reorder)';
    root.appendChild(gridTitle);

    const grid = document.createElement('div');
    grid.className = 'decision-tree-star-grid';
    root.appendChild(grid);

    const setStarPlotHoverState = (hoveredNodeId = null) => {
      const normalizedId = hoveredNodeId === null || hoveredNodeId === undefined ? null : String(hoveredNodeId);
      const effectiveId = normalizedId && combinedSeriesIndicesByNode.has(normalizedId) ? normalizedId : null;
      setCombinedHoverState(effectiveId);
      setHoveredDecisionTreeNode(effectiveId);
      Object.entries(cardById).forEach(([nodeId, card]) => card.classList.toggle('starplot-hovered-cell', effectiveId === nodeId));
    };

    const applyGridOrder = () => {
      const scrollTop = root.scrollTop;
      const scrollLeft = root.scrollLeft;
      pane.cy.starPlotOrder.forEach((id) => {
        const card = cardById[String(id)];
        if (card) grid.appendChild(card);
      });
      root.scrollTop = scrollTop;
      root.scrollLeft = scrollLeft;
      requestAnimationFrame(() => {
        root.scrollTop = scrollTop;
        root.scrollLeft = scrollLeft;
      });
    };

    const reorder = (draggedId, targetId) => {
      if (!draggedId || !targetId || draggedId === targetId) {
        return;
      }
      const order = [...pane.cy.starPlotOrder.map(String)];
      const fromIndex = order.indexOf(draggedId);
      const toIndex = order.indexOf(targetId);
      if (fromIndex < 0 || toIndex < 0) {
        return;
      }
      const [item] = order.splice(fromIndex, 1);
      order.splice(toIndex, 0, item);
      pane.cy.starPlotOrder = order;
      applyGridOrder();
    };

    orderedKeys.forEach((nodeId) => {
      const rows = byNodeRows[nodeId] || {};
      const nodeLabel = getNodeLabel(nodeId);
      const card = document.createElement('div');
      card.className = 'decision-tree-star-card';
      card.draggable = true;
      card.setAttribute('data-node-id', nodeId);
      cardById[String(nodeId)] = card;

      const header = document.createElement('div');
      header.className = 'decision-tree-star-card-header';
      header.textContent = nodeLabel;
      card.appendChild(header);
      card.addEventListener('mouseenter', () => setStarPlotHoverState(nodeId));
      card.addEventListener('mouseleave', () => setStarPlotHoverState(null));

      const plotsWrap = document.createElement('div');
      plotsWrap.className = 'decision-tree-star-card-plots';

      const yesSvg = createStarPlotSvg({ dimensions, series: [{ label: 'yes', values: buildSeriesValues(dimensions, rows.yes || {}), stroke: STAR_PLOT_COLORS.yesStroke, fill: STAR_PLOT_COLORS.yesFill, fillOpacity: 0.75 }], width: 230, height: 190, title: undefined, showAxisLabels: false });
      yesSvg.classList.add('decision-tree-star-svg-small');
      const noSvg = createStarPlotSvg({ dimensions, series: [{ label: 'no', values: buildSeriesValues(dimensions, rows.no || {}), stroke: STAR_PLOT_COLORS.noStroke, fill: STAR_PLOT_COLORS.noFill, fillOpacity: 0.72 }], width: 230, height: 190, title: undefined, showAxisLabels: false });
      noSvg.classList.add('decision-tree-star-svg-small');
      plotsWrap.appendChild(yesSvg);
      plotsWrap.appendChild(noSvg);
      card.appendChild(plotsWrap);

      card.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/plain', nodeId);
        event.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', (event) => {
        event.preventDefault();
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', (event) => {
        event.preventDefault();
        card.classList.remove('drag-over');
        reorder(event.dataTransfer?.getData('text/plain'), nodeId);
      });

      grid.appendChild(card);
    });

    setStarPlotHoverState(null);
    return { setHoveredNode: (nodeId = null) => setStarPlotHoverState(nodeId) };
  };

  const normalizeToUnit = (value) => {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return null;
    }
    return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
  };

  const paneNodeIds = pane.cy.nodes().map((n) => n.data('nodeId'));
  if (!paneNodeIds || paneNodeIds.length === 0) {
    if (pane.cy.pcp) {
      pane.cy.pcp.destroy();
      pane.cy.pcp = undefined;
    }
    return;
  }

  const selectedSet = new Set(selectedNodeIds || []);
  pane.cy.vars['pcp-visual-mode'] ||= { value: DECISION_TREE_PLOT_MODE.STAR };
  pane.cy.vars['star-show-axis-labels'] ||= { value: true };

  const probabilities = await Promise.all(paneNodeIds.map((nodeId) => dlRepairApi.getImpactProbabilities(nodeId)));
  const rows = [];
  const stats = {};
  const byNodeRows = {};

  paneNodeIds.forEach((nodeId, index) => {
    const yesValues = probabilities[index]?.yes;
    const noValues = probabilities[index]?.no;
    const buildRow = (values, suffix, colorVar) => {
      if (!values || typeof values !== 'object') {
        return null;
      }
      const row = { id: `node-${nodeId}-${suffix}`, linkedId: `node-${nodeId}`, _color: colorVar, _selected: selectedSet.has(nodeId) };
      Object.entries(values).forEach(([key, value]) => {
        const normalizedValue = normalizeToUnit(value);
        if (normalizedValue === null) {
          return;
        }
        row[key] = normalizedValue;
        stats[key] ||= { min: 0, max: 1 };
      });
      return row;
    };

    const yesRow = buildRow(yesValues, 'yes', '--pcp-yes');
    const noRow = buildRow(noValues, 'no', '--pcp-no');
    byNodeRows[String(nodeId)] = { yes: yesRow, no: noRow };

    if (yesRow && noRow) {
      const overlapAxioms = new Set();
      Object.keys(yesRow).forEach((axiom) => {
        if (!axiom.startsWith('_') && axiom !== 'id' && axiom !== 'linkedId' && noRow[axiom] !== undefined && yesRow[axiom] === noRow[axiom]) {
          overlapAxioms.add(axiom);
        }
      });
      if (overlapAxioms.size > 0) {
        yesRow._overlapAxioms = overlapAxioms;
        noRow._overlapAxioms = overlapAxioms;
      }
      rows.push(yesRow, noRow);
    } else if (yesRow) {
      rows.push(yesRow);
    } else if (noRow) {
      rows.push(noRow);
    }
  });

  const pld = {};
  Object.keys(stats).forEach((key) => {
    pld[key] = { type: 'number', min: 0, max: 1, prop: 'impact1' };
  });

  const mode = pane.cy.vars['pcp-visual-mode'].value;
  const showAxisLabels = !!pane.cy.vars['star-show-axis-labels'].value;
  ensurePlotToggle(mode, showAxisLabels);

  if (pane.cy.pcp) {
    pane.cy.pcp.destroy();
    pane.cy.pcp = undefined;
  }

  if (mode === DECISION_TREE_PLOT_MODE.STAR) {
    let starPlotView = renderStarPlotView(Object.keys(pld), byNodeRows, selectedNodeIds || [], showAxisLabels);
    pane.cy.pcp = { destroy: () => clearStarPlotView(), redraw: () => { starPlotView = renderStarPlotView(Object.keys(pld), byNodeRows, selectedNodeIds || [], showAxisLabels); }, getSelection: () => [], getOrder: () => [], setHoveredNode: (nodeId = null) => starPlotView?.setHoveredNode?.(nodeId) };
    return;
  }

  clearStarPlotView();
  if (rows.length === 0) {
    return;
  }

  pane.cy.pcp = parallelCoords(pane, rows, { data_id: 'id', nominals: [], booleans: [], numbers: Object.keys(pld), pld, preselected: selectedSet.size, forceCompactDirection: true });
}

async function startDLRepairProject() {
  console.log('Starting DL Repair Project');

  const cyConfig = document.getElementById('cy-config');
  if (cyConfig?.parentElement?.parentElement) {
    cyConfig.parentElement.parentElement.style.display = 'none';
  }
  const pcpConfigSpan = document.getElementById('pcp-config-span');
  if (pcpConfigSpan?.parentElement) {
    pcpConfigSpan.parentElement.style.display = 'none';
  }
  const overviewConfigSpan = document.getElementById('overview-config-span');
  if (overviewConfigSpan?.parentElement) {
    overviewConfigSpan.parentElement.style.display = 'none';
  }

  setupDLRepairSidebarResize();
  buildDLRepairLayoutShell();

  try {
    const treeData = await dlRepairApi.initializeDecisionTree();
    if (document.getElementById('project-id')) {
      document.getElementById('project-id').innerHTML = PROJECT;
    }
    if (!treeData?.nodes?.length) {
      throw new Error('No decision tree data available');
    }

    const nodesIds = treeData.nodes.map((node) => node.id);
    const axiomPaneId = 'axiom-pane-0';
    const axiomPane = spawnPane({ id: axiomPaneId }, nodesIds);
    const axiomPaneDiv = document.getElementById(axiomPaneId);
    if (axiomPaneDiv) {
      axiomPaneDiv.classList.add('axiom-pane-fixed');
      axiomPaneDiv.style.flexGrow = '0.4';
      axiomPaneDiv.style.minWidth = '180px';
    }

    const axiomDetailsDiv = document.getElementById(axiomPane.details);
    if (axiomDetailsDiv) {
      axiomDetailsDiv.style.display = 'none';
    }
    const axiomControls = document.getElementById(`${axiomPane.container}-controls`);
    if (axiomControls) {
      const closeBtn = axiomControls.querySelector('.pane-close');
      if (closeBtn) {
        closeBtn.style.display = 'none';
      }
    }

    const firstPaneId = 'pane-0';
    const pane = spawnPane({ id: firstPaneId }, nodesIds);
    const decisionDetails = document.getElementById(pane.details);
    if (decisionDetails) {
      decisionDetails.style.display = '';
    }

    const classHierarchyPane = spawnPane({ id: DL_REPAIR_CLASS_HIERARCHY_PANE_ID }, nodesIds);
    const classHierarchyPaneDiv = document.getElementById(classHierarchyPane.id);
    if (classHierarchyPaneDiv) {
      classHierarchyPaneDiv.classList.add('axiom-pane-fixed', 'dl-repair-class-hierarchy-fixed');
    }
    const classHierarchyContainer = document.getElementById(classHierarchyPane.container);
    const classHierarchyDetails = document.getElementById(classHierarchyPane.details);
    if (classHierarchyDetails) {
      classHierarchyDetails.style.display = 'none';
    }
    const classHierarchySplitDragbar = classHierarchyContainer?.nextElementSibling;
    if (classHierarchySplitDragbar?.classList.contains('split-dragbar')) {
      classHierarchySplitDragbar.style.display = 'none';
    }
    const classHierarchyControls = document.getElementById(`${classHierarchyPane.container}-controls`);
    if (classHierarchyControls) {
      const closeBtn = classHierarchyControls.querySelector('.pane-close');
      if (closeBtn) {
        closeBtn.style.display = 'none';
      }
    }
    setDLRepairClassHierarchyVisibility(false);

    mountDLRepairPanes({
      decisionPaneId: firstPaneId,
      summaryPaneId: axiomPaneId,
      classHierarchyPaneId: DL_REPAIR_CLASS_HIERARCHY_PANE_ID,
    });
    initializeDLRepairClassHierarchyVisibilityHandling();
    initializeDLRepairFullscreenControls();
    initializeDLRepairLayoutResizers();
    applyDLRepairLayoutSizing();

    const axiomContainer = document.getElementById(axiomPane.container);
    if (!axiomContainer) {
      throw new Error('Failed to find axiom pane container');
    }
    const axiomSplitDragbar = axiomContainer.nextElementSibling;
    if (axiomSplitDragbar?.classList.contains('split-dragbar')) {
      axiomSplitDragbar.style.display = 'none';
    }

    const axiomCy = createAxiomPane(axiomContainer, treeData, axiomPaneId);
    if (!axiomCy) {
      throw new Error('Failed to create axiom pane visualization');
    }
    axiomCy.paneId = axiomPaneId;
    axiomPane.cy = axiomCy;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      axiomCy.resize();
      axiomCy.fit(undefined, 20);
    }));

    const container = document.getElementById(pane.container);
    if (!container) {
      throw new Error('Failed to find pane container');
    }
    const decisionSplitDragbar = container.nextElementSibling;
    if (decisionSplitDragbar?.classList.contains('split-dragbar')) {
      decisionSplitDragbar.style.display = 'none';
    }

    const cy = createInitialTree(container, treeData);
    if (!cy) {
      throw new Error('Failed to create decision tree visualization');
    }
    cy.paneId = firstPaneId;
    pane.cy = cy;

    const initialCanvas = document.querySelector(`#${pane.container} canvas`);
    if (initialCanvas) {
      initialCanvas.pane = pane.id;
    }

    await updateDecisionTreePCP(pane, []);

    document.addEventListener('decision-tree-node-selected', async (event) => {
      document.dispatchEvent(new CustomEvent('hamming-repair-preview-clear'));
      const nodeId = event.detail.nodeId;
      const selectedNodeIds = event.detail.selectedNodeIds || [];
      const panes = getPanes();
      const targetPane = panes[event.detail.paneId] || pane;
      if (nodeId === null || selectedNodeIds.length === 0) {
        displayNodeDetails('', nodeId, targetPane);
        await updateDecisionTreePCP(targetPane, []);
        return;
      }

      try {
        const probabilitiesPromise = dlRepairApi.getImpactProbabilities(nodeId);
        const hammingPromise = dlRepairApi.getHammingDistance(nodeId);
        const probabilities = await probabilitiesPromise;
        const hammingDistance = await hammingPromise;
        displayNodeDetails(generateNodeDetailsHTML(probabilities, hammingDistance), nodeId, targetPane, hammingDistance);

        if (targetPane?.cy?.treeData) {
          const hasKeepRepair = probabilities?.yes && probabilities.yes !== 'No Repair!';
          const hasRemoveRepair = probabilities?.no && probabilities.no !== 'No Repair!';
          const childEdges = targetPane.cy.treeData.edges.filter((edge) => edge.source === `node-${nodeId}`);
          childEdges.forEach((edge) => {
            const childNode = targetPane.cy.getElementById(edge.target);
            if (childNode.length > 0) {
              let symbol = '';
              let symbolColor = '#333';
              let symbolBackground = 'transparent';
              let symbolBorderColor = '#555';
              let symbolBackgroundOpacity = 0;
              const hasRepair = edge.type === 'keep' ? hasKeepRepair : hasRemoveRepair;
              symbol = hasRepair ? '✓' : '✗';
              symbolColor = hasRepair ? '#2b8a3e' : '#c92a2a';
              symbolBackground = hasRepair ? '#f5fff5' : '#fff5f5';
              symbolBorderColor = hasRepair ? '#d9e8d9' : '#f0d6d6';
              symbolBackgroundOpacity = 1;
              childNode.data('repairSymbol', symbol);
              childNode.data('symbolColor', symbolColor);
              childNode.data('symbolBackground', symbolBackground);
              childNode.data('symbolBorderColor', symbolBorderColor);
              childNode.data('symbolBackgroundOpacity', symbolBackgroundOpacity);
            }
          });
        }
      } catch (error) {
        console.error('Error fetching probabilities:', error);
        displayNodeDetails('', nodeId, targetPane);
      }

      await updateDecisionTreePCP(targetPane, selectedNodeIds);
    });

    document.addEventListener('decision-tree-pane-ready', (event) => {
      const paneId = event.detail.paneId;
      const targetPane = getPanes()[paneId];
      if (!targetPane) {
        return;
      }
      updateDecisionTreePCP(targetPane, []);
    });

    document.addEventListener('decision-tree-pane-data-changed', (event) => {
      const paneId = event.detail.paneId;
      const targetPane = getPanes()[paneId];
      if (!targetPane?.cy) {
        return;
      }
      const selectedNodeIds = targetPane.cy.$('node:selected').map((n) => n.data('nodeId'));
      updateDecisionTreePCP(targetPane, selectedNodeIds);
    });

    document.addEventListener('decision-tree-node-hovered', (event) => {
      const targetPane = getPanes()[event.detail.paneId] || pane;
      targetPane?.cy?.pcp?.setHoveredNode?.(event.detail.nodeId);
    });

    document.addEventListener('decision-tree-edge-clicked', (event) => {
      console.log(`Navigate via ${event.detail.type} to node ${event.detail.target}`);
    });

    document.addEventListener('axiom-state-changed', (event) => {
      console.log(`Axiom state changed: ${event.detail.nodeId} -> ${event.detail.state}`);
    });

    document.addEventListener('decision-tree-move-path-to-summary', (event) => {
      const { paneId, nodeId } = event.detail || {};
      if (nodeId === undefined || nodeId === null) {
        return;
      }

      const panes = getPanes();
      const sourcePane = panes[paneId] || pane;
      const summaryPane = panes[axiomPaneId];
      if (!sourcePane?.cy || !summaryPane?.cy || !sourcePane.cy.treeData) {
        return;
      }

      const tree = sourcePane.cy.treeData;
      const targetId = `node-${nodeId}`;
      const incomingByTarget = new Map();
      tree.edges.forEach((edge) => incomingByTarget.set(edge.target, edge));

      const nodeDepths = new Map();
      const targetIds = new Set(tree.edges.map((e) => e.target));
      const rootNodes = tree.nodes.filter((n) => !targetIds.has(n.id));
      const queue = [];
      rootNodes.forEach((rootNode) => {
        nodeDepths.set(rootNode.id, 0);
        queue.push(rootNode.id);
      });
      while (queue.length > 0) {
        const currentId = queue.shift();
        const depth = nodeDepths.get(currentId);
        tree.edges.filter((edge) => edge.source === currentId).forEach((edge) => {
          if (!nodeDepths.has(edge.target)) {
            nodeDepths.set(edge.target, depth + 1);
            queue.push(edge.target);
          }
        });
      }

      resetSummaryStates(summaryPane.cy, axiomPaneId);
      let cursor = targetId;
      while (incomingByTarget.has(cursor)) {
        const edge = incomingByTarget.get(cursor);
        const parentDepth = nodeDepths.get(edge.source);
        if (parentDepth !== undefined) {
          if (edge.type === 'keep') {
            setSummaryStateByDepth(summaryPane.cy, axiomPaneId, parentDepth, AXIOM_STATES.KEPT);
          } else if (edge.type === 'remove') {
            setSummaryStateByDepth(summaryPane.cy, axiomPaneId, parentDepth, AXIOM_STATES.REMOVED);
          }
        }
        cursor = edge.source;
      }
    });

    let summaryPreviewSnapshot = null;
    const clearSummaryPreview = () => {
      if (!summaryPreviewSnapshot) {
        return;
      }
      const summaryPane = getPanes()[axiomPaneId];
      if (!summaryPane?.cy) {
        summaryPreviewSnapshot = null;
        return;
      }
      summaryPane.cy.nodes().forEach((node) => {
        setSummaryNodeState(summaryPane.cy, axiomPaneId, node.id(), summaryPreviewSnapshot[node.id()] || AXIOM_STATES.UNDECIDED);
      });
      summaryPreviewSnapshot = null;
    };

    document.addEventListener('hamming-repair-hover', (event) => {
      const { choice, distance } = event.detail || {};
      if (!distance || (choice !== 'yes' && choice !== 'no')) {
        return;
      }
      const summaryPane = getPanes()[axiomPaneId];
      if (!summaryPane?.cy) {
        return;
      }
      if (!summaryPreviewSnapshot) {
        summaryPreviewSnapshot = { ...(getAxiomStatesForPane(axiomPaneId) || {}) };
      }
      applyRepairAxiomsToSummary(summaryPane.cy, axiomPaneId, choice === 'yes' ? distance.hamming_yes_repair : distance.hamming_no_repair);
    });
    document.addEventListener('hamming-repair-hover-end', clearSummaryPreview);
    document.addEventListener('hamming-repair-preview-clear', clearSummaryPreview);
    document.addEventListener('hamming-repair-choice', (event) => {
      const { choice, distance, propagate } = event.detail || {};
      if (!distance || (choice !== 'yes' && choice !== 'no') || !propagate) {
        return;
      }
      clearSummaryPreview();
      const summaryPane = getPanes()[axiomPaneId];
      if (!summaryPane?.cy) {
        return;
      }
      applyRepairAxiomsToSummary(summaryPane.cy, axiomPaneId, choice === 'yes' ? distance.hamming_yes_repair : distance.hamming_no_repair);
      document.dispatchEvent(new CustomEvent('summary-view-expand-decision-tree', { detail: { paneId: axiomPaneId } }));
    });

    document.addEventListener('summary-view-expand-decision-tree', () => {
      const panes = getPanes();
      const summaryPane = panes[axiomPaneId];
      const decisionPane = panes[firstPaneId];
      if (!summaryPane?.cy || !decisionPane?.cy || !decisionPane.cy.treeData) {
        return;
      }
      const summaryStates = getAxiomStatesForPane(axiomPaneId);
      const orderedDepthNodes = summaryPane.cy.nodes().sort((a, b) => a.data('depth') - b.data('depth')).toArray();
      const statesByDepth = orderedDepthNodes.map((node) => summaryStates[node.id()] || AXIOM_STATES.UNDECIDED);
      let lastDecidedDepth = -1;
      statesByDepth.forEach((state, depthIndex) => {
        if (state === AXIOM_STATES.KEPT || state === AXIOM_STATES.REMOVED) {
          lastDecidedDepth = depthIndex;
        }
      });
      if (lastDecidedDepth < 0) {
        return;
      }
      const decisions = statesByDepth.slice(0, lastDecidedDepth + 1).map((state) => (state === AXIOM_STATES.KEPT ? 'keep' : state === AXIOM_STATES.REMOVED ? 'remove' : null));
      const tree = decisionPane.cy.treeData;
      const targetIds = new Set(tree.edges.map((e) => e.target));
      const rootNode = tree.nodes.find((node) => !targetIds.has(node.id));
      if (!rootNode) {
        return;
      }
      let frontier = [`node-${rootNode.nodeId}`];
      const traversedNodeIds = new Set(frontier);
      decisions.forEach((edgeType) => {
        const nextFrontier = new Set();
        const allowedTypes = edgeType ? [edgeType] : ['keep', 'remove'];
        frontier.forEach((sourceNodeId) => {
          const sourceNodeNumericId = Number(sourceNodeId.replace('node-', ''));
          if (Number.isNaN(sourceNodeNumericId)) {
            return;
          }
          allowedTypes.forEach((type) => {
            expandNodeByType(decisionPane.cy, sourceNodeNumericId, type);
            const nextEdge = tree.edges.find((edge) => edge.source === sourceNodeId && edge.type === type);
            if (!nextEdge) {
              return;
            }
            traversedNodeIds.add(nextEdge.target);
            nextFrontier.add(nextEdge.target);
          });
        });
        if (nextFrontier.size > 0) {
          frontier = Array.from(nextFrontier);
        }
      });
      const highlightedElements = decisionPane.cy.$(Array.from(traversedNodeIds).map((nodeId) => `#${nodeId}`).join(', '));
      const frontierSelector = frontier.map((nodeId) => `#${nodeId}`).join(', ');
      if (frontierSelector) {
        decisionPane.cy.nodes().unselect();
        decisionPane.cy.$(frontierSelector).select();
      }
      if (highlightedElements.length > 0) {
        decisionPane.cy.animate({ fit: { eles: highlightedElements, padding: 70 }, duration: 450 });
      }
    });

    console.log('DL Repair Project initialized successfully');
  } catch (error) {
    console.error('Error initializing DL Repair project:', error);
    showErrorMessage(`Failed to initialize DL Repair project: ${error.message}`);
  }
}

export { startDLRepairProject };
