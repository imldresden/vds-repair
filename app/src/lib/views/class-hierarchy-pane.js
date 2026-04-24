import { cytoscape } from './imports/import-cytoscape.js';
import { spawnPane, destroyPanes, getPanes } from './panes/panes.js';
import { COLORS, OUTLINES } from '../style/views/variables.js';
import { hideAllTippies, makeTippy, setPane } from '../utils/controls.js';

import dlRepairApi from '../utils/mock-dl-repair-api.js';

const NODE_STATE = {
  UNCHANGED: 'unchanged',
  ADDED: 'added',
  REMOVED: 'removed',
};

const EDGE_STATE = {
  UNCHANGED: 'unchanged',
  ADDED: 'added',
  REMOVED: 'removed',
};
const CLASS_HIERARCHY_HEADER_HEIGHT = 32;
const DL_REPAIR_CLASS_HIERARCHY_PANE_ID = 'class-hierarchy-pane-0';

function setDLRepairClassHierarchyVisibility(isVisible) {
  const layout = document.getElementById('dl-repair-layout');
  if (!layout) {
    return;
  }

  layout.setAttribute('data-class-hierarchy-visible', isVisible ? 'true' : 'false');
  if (!isVisible && layout.getAttribute('data-fullscreen-target') === 'class-hierarchy') {
    layout.removeAttribute('data-fullscreen-target');
  }
  window.dispatchEvent(new CustomEvent('dl-repair-class-hierarchy-visibility-change', {
    detail: { visible: isVisible },
  }));
}

function normalizeEdgeList(rawEdges) {
  if (!Array.isArray(rawEdges)) {
    return [];
  }

  return rawEdges
    .filter(edge => Array.isArray(edge) && edge.length >= 2)
    .map(([source, target]) => [String(source), String(target)]);
}

function createEdgeKey(source, target) {
  return `${source}->${target}`;
}

function createEdgeKeySet(edges) {
  return new Set(
    edges.map(([source, target]) => createEdgeKey(source, target)),
  );
}

function isLabelReferenced(edges, label) {
  return edges.some(
    ([source, target]) => source === label || target === label,
  );
}

function isOntologyBoundaryLabel(label) {
  const normalized = String(label || '').trim().toLowerCase();
  return normalized === '⊤'
    || normalized === '⊥'
    || normalized === 'owl:thing'
    || normalized === 'owl:nothing'
    || normalized === 'thing'
    || normalized === 'nothing';
}

function isOntologyBottomLabel(label) {
  const normalized = String(label || '').trim().toLowerCase();
  return normalized === '⊥'
    || normalized === 'owl:nothing'
    || normalized === 'nothing';
}

function buildComparisonElements(initialHierarchy, modifiedHierarchy, hierarchyDifference) {
  const initialEdges = normalizeEdgeList(initialHierarchy);
  const modifiedEdges = normalizeEdgeList(modifiedHierarchy);
  const removedEdges = normalizeEdgeList(hierarchyDifference?.removedEdges);
  const addedEdges = normalizeEdgeList(hierarchyDifference?.addedEdges);

  const initialEdgeKeys = createEdgeKeySet(initialEdges);
  const modifiedEdgeKeys = createEdgeKeySet(modifiedEdges);
  const removedEdgeKeys = createEdgeKeySet(removedEdges);
  const addedEdgeKeys = createEdgeKeySet(addedEdges);
  const diffConnectedLabels = new Set();

  [...removedEdges, ...addedEdges].forEach(([source, target]) => {
    diffConnectedLabels.add(source);
    diffConnectedLabels.add(target);
  });

  const allEdgeKeys = new Set([...initialEdgeKeys, ...modifiedEdgeKeys]);

  const nodeLabels = new Set();
  [...initialEdges, ...modifiedEdges].forEach(([source, target]) => {
    nodeLabels.add(source);
    nodeLabels.add(target);
  });

  const labelToNodeId = new Map();
  const nodes = [];
  const edges = [];

  let nodeCounter = 0;
  nodeLabels.forEach((label) => {
    labelToNodeId.set(label, `class-node-${nodeCounter}`);
    nodeCounter += 1;
  });

  nodeLabels.forEach((label) => {
    const isInInitial = isLabelReferenced(initialEdges, label);
    const isInModified = isLabelReferenced(modifiedEdges, label);

    let state = NODE_STATE.UNCHANGED;
    if (!isInInitial && isInModified) {
      state = NODE_STATE.ADDED;
    } else if (isInInitial && !isInModified) {
      state = NODE_STATE.REMOVED;
    }

    nodes.push({
      data: {
        id: labelToNodeId.get(label),
        label,
        state,
        emphasis: diffConnectedLabels.has(label) || state !== NODE_STATE.UNCHANGED ? 'focus' : 'muted',
        ontologyBoundary: isOntologyBoundaryLabel(label) ? 'true' : 'false',
      },
      classes: 'class-hierarchy-node',
    });
  });

  allEdgeKeys.forEach((edgeKey) => {
    const [sourceLabel, targetLabel] = edgeKey.split('->');
    const sourceId = labelToNodeId.get(targetLabel);
    const targetId = labelToNodeId.get(sourceLabel);

    if (!sourceId || !targetId) {
      return;
    }

    let state = EDGE_STATE.UNCHANGED;
    if (removedEdgeKeys.has(edgeKey)) {
      state = EDGE_STATE.REMOVED;
    } else if (addedEdgeKeys.has(edgeKey)) {
      state = EDGE_STATE.ADDED;
    } else if (!initialEdgeKeys.has(edgeKey) && modifiedEdgeKeys.has(edgeKey)) {
      state = EDGE_STATE.ADDED;
    } else if (initialEdgeKeys.has(edgeKey) && !modifiedEdgeKeys.has(edgeKey)) {
      state = EDGE_STATE.REMOVED;
    }

    edges.push({
      data: {
        id: `edge-${edgeKey}`,
        source: sourceId,
        target: targetId,
        state,
      },
    });
  });

  return {
    nodes,
    edges,
  };
}

function createComparisonStylesheet() {
  return [
    {
      selector: 'core',
      style: {
        'selection-box-color': COLORS.SELECTED_NODE_COLOR,
        'selection-box-border-color': '#8BB0D0',
        'selection-box-opacity': '0.5',
        'active-bg-opacity': 0,
      },
    },
    {
      selector: 'node, edge',
      style: {
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'node.class-hierarchy-node',
      style: {
        label: 'data(label)',
        shape: 'rectangle',
        width: 160,
        height: 42,
        'font-size': 12,
        'font-family': 'monospace',
        'text-wrap': 'wrap',
        'text-max-width': '145px',
        'text-valign': 'center',
        'text-margin-y': '0.65px',
        'text-halign': 'center',
        color: COLORS.LIGHT_TEXT,
        'background-color': COLORS.NODE_COLOR,
        'text-outline-color': COLORS.NODE_COLOR,
        'text-outline-width': '2px',
        'text-outline-opacity': 0,
        'overlay-padding': '6px',
        'z-index': '10',
        'background-opacity': 1,
        'border-width': OUTLINES.width,
        'border-color': COLORS.NODE_COLOR,
        opacity: 0.92,
      },
    },
    {
      selector: 'node[ontologyBoundary = "true"]',
      style: {
        'background-color': '#edf4ff',
        'border-color': '#2b6cb0',
        color: '#2b6cb0',
        'text-outline-color': '#2b6cb0',
        'text-outline-width': '0.6px',
        'font-size': 16,
        'font-weight': '900',
        opacity: 1,
      },
    },
    {
      selector: 'node[state = "unchanged"][emphasis = "muted"]',
      style: {
        'background-color': '#f3f4f6',
        'border-color': '#d5dae0',
        color: '#a0a8b3',
        'text-outline-color': '#f3f4f6',
        'text-outline-width': '0px',
        opacity: 0.92,
      },
    },
    {
      selector: 'node[state = "unchanged"][emphasis = "muted"][ontologyBoundary = "true"]',
      style: {
        'background-color': '#edf4ff',
        'border-color': '#2b6cb0',
        color: '#2b6cb0',
        'text-outline-color': '#edf4ff',
        opacity: 1,
      },
    },
    {
      selector: 'node[state = "unchanged"][emphasis = "focus"]',
      style: {
        opacity: 1,
      },
    },
    {
      selector: 'node.class-hierarchy-node:selected',
      style: {
        'border-color': COLORS.SELECTED_BORDER,
        'border-width': OUTLINES.width_selected,
        'border-style': 'double',
        'border-position': 'center',
      },
    },
    {
      selector: 'node[state = "added"]',
      style: {
        'background-color': '#f5fff5',
        'border-color': '#2b8a3e',
        color: '#2b8a3e',
        'text-outline-color': '#f5fff5',
        'text-outline-width': '0px',
      },
    },
    {
      selector: 'node[state = "removed"]',
      style: {
        'background-color': '#fff5f5',
        'border-color': '#c92a2a',
        color: '#c92a2a',
        'text-outline-color': '#fff5f5',
        'text-outline-width': '0px',
      },
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier',
        width: 2.5,
        'target-arrow-shape': 'triangle',
        'target-arrow-size': 15,
        'line-style': 'solid',
        'line-color': COLORS.EDGE_COLOR,
        'target-arrow-color': COLORS.EDGE_COLOR,
        opacity: 0.18,
      },
    },
    {
      selector: 'edge[state = "unchanged"]',
      style: {
        width: 1.6,
        'target-arrow-size': 11,
        'line-color': '#c8ced6',
        'target-arrow-color': '#c8ced6',
        opacity: 0.92,
      },
    },
    {
      selector: 'edge[state = "removed"]',
      style: {
        'line-color': '#c92a2a',
        'target-arrow-color': '#c92a2a',
        'line-style': 'dashed',
        width: 3.2,
        opacity: 1,
      },
    },
    {
      selector: 'edge[state = "added"]',
      style: {
        'line-color': '#2b8a3e',
        'target-arrow-color': '#2b8a3e',
        'line-style': 'solid',
        width: 3.2,
        opacity: 1,
      },
    },
  ];
}

function hidePaneDetails(pane, container) {
  const detailsElement = document.getElementById(pane.details);
  if (detailsElement) {
    detailsElement.style.display = 'none';
  }

  const splitDragbarElement = container.nextElementSibling;
  if (splitDragbarElement?.classList.contains('split-dragbar')) {
    splitDragbarElement.style.display = 'none';
  }

  container.style.marginTop = `${CLASS_HIERARCHY_HEADER_HEIGHT}px`;
  container.style.height = `${Math.max(80, pane.height - CLASS_HIERARCHY_HEADER_HEIGHT)}px`;
}

function renderEmptyState(container, message) {
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="class-hierarchy-empty-state">
      <div class="class-hierarchy-empty-state-title">Class Hierarchy</div>
      <div class="class-hierarchy-empty-state-copy">${message}</div>
    </div>
  `;
}

function setPaneTitle(pane, titleText, onLayoutChange) {
  const paneElement = document.getElementById(pane.id);
  if (!paneElement) {
    return;
  }

  let header = paneElement.querySelector('.class-hierarchy-pane-header');
  if (!header) {
    header = document.createElement('div');
    header.className = 'class-hierarchy-pane-header';
    paneElement.prepend(header);
  }

  header.style.position = 'absolute';
  header.style.top = '0';
  header.style.left = '0';
  header.style.right = '0';
  header.style.height = `${CLASS_HIERARCHY_HEADER_HEIGHT}px`;
  header.style.padding = '6px 10px';
  header.style.zIndex = '5';
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.gap = '10px';
  header.style.background = '#f7f7f7';
  header.style.borderBottom = '1px solid #dcdcdc';
  header.style.color = '#555';
  header.style.fontSize = '12px';
  header.style.fontWeight = 'bold';
  header.style.boxSizing = 'border-box';

  header.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;flex-wrap:nowrap;">
      <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Class Hierarchy (${titleText})</span>
      <div style="display:flex;gap:6px;align-items:center;">
        <button type="button" data-layout-toggle style="font-size:12px;width:28px;height:24px;border:1px solid #9d9d9d;background:#efefef;color:#444;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Switch to vertical layout" aria-label="Switch to vertical layout">
          <i class="fa-solid fa-arrows-left-right"></i>
        </button>
      </div>
    </div>
  `;

  const layoutToggle = header.querySelector('[data-layout-toggle]');
  let currentMode = 'horizontal';

  const setLayoutToggleState = (mode) => {
    currentMode = mode;
    if (!layoutToggle) {
      return;
    }

    const isHorizontal = mode === 'horizontal';
    layoutToggle.innerHTML = isHorizontal
      ? '<i class="fa-solid fa-arrows-left-right"></i>'
      : '<i class="fa-solid fa-arrows-up-down"></i>';
    layoutToggle.title = isHorizontal
      ? 'Switch to vertical layout'
      : 'Switch to horizontal layout';
    layoutToggle.setAttribute('aria-label', layoutToggle.title);
  };

  setLayoutToggleState('horizontal');

  if (layoutToggle) {
    layoutToggle.onclick = () => {
      const nextMode = currentMode === 'horizontal' ? 'vertical' : 'horizontal';
      setLayoutToggleState(nextMode);
      onLayoutChange?.(nextMode);
    };
  }
}

function getNodeAxiomText(sourceCy, nodeId) {
  if (!sourceCy || nodeId === undefined || nodeId === null) {
    return null;
  }

  const sourceNode = sourceCy.nodes().filter(node => node.data('nodeId') === nodeId).first();
  if (!sourceNode || sourceNode.empty()) {
    return null;
  }

  return sourceNode.data('axiom') || sourceNode.data('label') || null;
}

export async function openClassHierarchyPane(sourceCy, nodeId) {
  const hierarchyPayload = await dlRepairApi.getClassHierarchyDifference(nodeId);
  const hasInitialHierarchy = Boolean(hierarchyPayload?.initialHierarchy);
  const hasModifiedHierarchy = Boolean(hierarchyPayload?.modifiedHierarchy);
  const hasHierarchyData = hasInitialHierarchy && hasModifiedHierarchy;
  const isFixedDlRepairLayout = document.body.classList.contains('dl-repair-layout-active');

  const sourcePaneId = sourceCy?.container()?.closest('.pane')?.id || 'pane-0';
  let newPane = isFixedDlRepairLayout ? getPanes()[DL_REPAIR_CLASS_HIERARCHY_PANE_ID] : null;

  if (isFixedDlRepairLayout) {
    setDLRepairClassHierarchyVisibility(true);
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

  if (!newPane) {
    newPane = spawnPane(
      {
        spawner: sourcePaneId,
        id: isFixedDlRepairLayout ? DL_REPAIR_CLASS_HIERARCHY_PANE_ID : `class-hierarchy-${nodeId}-${Date.now()}`,
        newPanePosition: 'right',
      },
      [`class-hierarchy-${nodeId}`],
      [nodeId],
    );
  }

  if (!newPane) {
    console.error('Failed to create class hierarchy pane');
    return null;
  }

  const container = document.getElementById(newPane.container);
  if (!container) {
    console.error('Failed to find class hierarchy pane container');
    return null;
  }

  if (newPane.cy?.destroy) {
    try {
      newPane.cy.destroy();
    } catch (error) {
      console.warn('Failed to destroy previous class hierarchy view:', error);
    }
    newPane.cy = undefined;
  }

  container.innerHTML = '';
  hidePaneDetails(newPane, container);

  const nodeTitle = getNodeAxiomText(sourceCy, nodeId) || `Node ${nodeId}`;

  if (!hasHierarchyData) {
    setPaneTitle(newPane, nodeTitle, null);
    renderEmptyState(container, 'No hierarchy difference is available for this node.');
    return newPane;
  }

  const elements = buildComparisonElements(
    hierarchyPayload.initialHierarchy,
    hierarchyPayload.modifiedHierarchy,
    hierarchyPayload.hierarchyDifference,
  );

  const cy = cytoscape({
    container,
    elements,
    style: createComparisonStylesheet(),
    layout: {
      name: 'dagre',
      rankDir: 'RL',
      nodeSep: 50,
      rankSep: 90,
      fit: true,
      padding: 20,
      animate: false,
    },
    minZoom: 0.2,
    maxZoom: 2.5,
    wheelSensitivity: 0.2,
  });

  const runLayout = (mode = 'vertical') => {
    const rankDir = mode === 'horizontal' ? 'RL' : 'BT';
    cy.layout({
      name: 'dagre',
      rankDir,
      nodeSep: 50,
      rankSep: 90,
      fit: true,
      padding: 20,
      animate: false,
    }).run();
  };

  const bottomTooltipId = `class-hierarchy-bottom-tooltip-${newPane.id}`;
  let bottomTooltipVisible = false;

  setPaneTitle(newPane, nodeTitle, runLayout);

  const initialPositions = new Map();
  cy.nodes().forEach((node) => {
    const { x, y } = node.position();
    initialPositions.set(node.id(), { x, y });
  });

  if (cy.contextMenus) {
    cy.ctxmenu = cy.contextMenus({
      menuItems: [
        {
          id: 'fit-view',
          content: 'Fit to view',
          tooltipText: 'Fit graph to viewport',
          coreAsWell: true,
          onClickFunction: () => {
            cy.fit(undefined, 30);
          },
          hasTrailingDivider: true,
        },
        {
          id: 'reset-graph-layout',
          content: 'Reset graph layout',
          tooltipText: 'Reset node positions to initial layout',
          coreAsWell: true,
          onClickFunction: () => {
            cy.batch(() => {
              cy.nodes().forEach((node) => {
                const initialPosition = initialPositions.get(node.id());
                if (initialPosition) {
                  node.position(initialPosition);
                }
              });
            });
            cy.fit(undefined, 30);
          },
          hasTrailingDivider: false,
        },
        {
          id: 'close-pane',
          content: 'Close pane',
          tooltipText: 'Close this class hierarchy pane',
          coreAsWell: true,
          onClickFunction: () => {
            if (isFixedDlRepairLayout) {
              cy.destroy();
              newPane.cy = undefined;
              container.innerHTML = '';
              setDLRepairClassHierarchyVisibility(false);
              return;
            }
            destroyPanes(newPane.id, { manualRemoval: true }).catch(error => {
              console.error(`Failed to close pane ${newPane.id}:`, error);
            });
          },
          hasTrailingDivider: false,
        },
      ],
    });
  }

  cy.on('tap', () => {
    setPane(newPane.id);
  });

  cy.on('tap', 'node', (event) => {
    const node = event.target;
    const isShiftClick = Boolean(event.originalEvent?.shiftKey);
    if (!isOntologyBottomLabel(node.data('label')) || !isShiftClick || bottomTooltipVisible) {
      return;
    }

    const tooltip = document.createElement('div');
    tooltip.textContent = 'Bottom is a subset of everything.';
    makeTippy(node, tooltip, bottomTooltipId);
    bottomTooltipVisible = true;
  });

  cy.on('tap', (event) => {
    const tappedBottomNode = event.target?.isNode?.()
      && isOntologyBottomLabel(event.target.data('label'));
    if (tappedBottomNode || !bottomTooltipVisible) {
      return;
    }

    hideAllTippies();
    bottomTooltipVisible = false;
  });

  cy.on('destroy', () => {
    if (bottomTooltipVisible) {
      hideAllTippies();
      bottomTooltipVisible = false;
    }
  });

  cy.fit(undefined, 30);
  newPane.cy = cy;
  setPane(newPane.id);
  requestAnimationFrame(() => {
    cy.resize();
    cy.fit(undefined, 30);
  });

  return cy;
}

export {
  DL_REPAIR_CLASS_HIERARCHY_PANE_ID,
  renderEmptyState as renderClassHierarchyEmptyState,
  setDLRepairClassHierarchyVisibility,
};
