import { cytoscape } from './imports/import-cytoscape.js';
import { COLORS, OUTLINES } from '../style/views/variables.js';
import { spawnPane } from './panes/panes.js';
import { destroyPanes } from './panes/panes.js';
import { CONSTANTS } from '../utils/names.js';
import { openClassHierarchyPane } from './class-hierarchy-pane.js';
import { setPane } from '../utils/controls.js';

let activeDecisionTreeCy = null;

const DECISION_TREE_LAYOUT_MODE = {
  HORIZONTAL: 'horizontal',
  VERTICAL: 'vertical',
};

function getDecisionTreeLayoutOptions(mode = DECISION_TREE_LAYOUT_MODE.HORIZONTAL) {
  const options = {
    name: 'dagre',
    directed: true,
    rankDir: mode === DECISION_TREE_LAYOUT_MODE.VERTICAL ? 'TB' : 'LR',
    animate: true,
    animationDuration: 500,
  };

  if (mode === DECISION_TREE_LAYOUT_MODE.VERTICAL) {
    options.sort = sortVerticalDecisionTreeElements;
    options.transform = createVerticalDecisionTreeTransform();
  }

  return options;
}

function getDecisionTreeElementOrder(ele) {
  if (!ele?.isEdge?.()) {
    return 1;
  }

  if (ele.data('type') === 'remove') {
    return 0;
  }

  if (ele.data('type') === 'keep') {
    return 2;
  }

  return 1;
}

function sortVerticalDecisionTreeElements(a, b) {
  return getDecisionTreeElementOrder(a) - getDecisionTreeElementOrder(b);
}

function getVisibleDecisionTreeSubtree(cy, rootNode) {
  const subtreeIds = new Set();
  const stack = [rootNode];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node?.nonempty?.() && !subtreeIds.has(node.id())) {
      subtreeIds.add(node.id());
      cy.edges().forEach((edge) => {
        if (edge.source().id() === node.id() && edge.target().nonempty()) {
          stack.push(edge.target());
        }
      });
    }
  }

  return cy.nodes().filter(node => subtreeIds.has(node.id()));
}

function getLayoutPosition(node) {
  const dagrePosition = node.scratch('dagre');
  if (dagrePosition) {
    return dagrePosition;
  }

  return node.position();
}

function computeVerticalBranchOffsets(cy) {
  const offsets = new Map();
  if (!cy || cy.decisionTreeLayoutMode !== DECISION_TREE_LAYOUT_MODE.VERTICAL) {
    return offsets;
  }

  const orderedParents = cy.nodes().sort((a, b) => (
    getLayoutPosition(a).y - getLayoutPosition(b).y
  ));

  orderedParents.forEach((parent) => {
    const childEdges = parent.outgoers('edge');
    const keepEdge = childEdges.filter(edge => edge.data('type') === 'keep').first();
    const removeEdge = childEdges.filter(edge => edge.data('type') === 'remove').first();

    if (!keepEdge?.nonempty?.() || !removeEdge?.nonempty?.()) {
      return;
    }

    const keepChild = keepEdge.target();
    const removeChild = removeEdge.target();
    const keepX = getLayoutPosition(keepChild).x + (offsets.get(keepChild.id()) || 0);
    const removeX = getLayoutPosition(removeChild).x + (offsets.get(removeChild.id()) || 0);

    if (keepX >= removeX) {
      return;
    }

    const keepSubtree = getVisibleDecisionTreeSubtree(cy, keepChild);
    const removeSubtree = getVisibleDecisionTreeSubtree(cy, removeChild);
    const hasOverlap = keepSubtree.some(keepNode => (
      removeSubtree.some(removeNode => removeNode.id() === keepNode.id())
    ));

    if (hasOverlap) {
      return;
    }

    const dx = removeX - keepX;
    keepSubtree.forEach((node) => {
      offsets.set(node.id(), (offsets.get(node.id()) || 0) + dx);
    });
    removeSubtree.forEach((node) => {
      offsets.set(node.id(), (offsets.get(node.id()) || 0) - dx);
    });
  });

  return offsets;
}

function createVerticalDecisionTreeTransform() {
  let offsets = null;

  return (node, position) => {
    offsets ||= computeVerticalBranchOffsets(node.cy());
    return {
      x: position.x + (offsets.get(node.id()) || 0),
      y: position.y,
    };
  };
}

function runDecisionTreeLayout(cy, mode = cy?.decisionTreeLayoutMode) {
  if (!cy) {
    return;
  }

  cy.decisionTreeLayout?.stop?.();
  cy.decisionTreeLayoutMode = mode || DECISION_TREE_LAYOUT_MODE.HORIZONTAL;
  const layout = cy.layout(getDecisionTreeLayoutOptions(cy.decisionTreeLayoutMode));
  cy.decisionTreeLayout = layout;
  layout.pon('layoutstop').then(() => {
    if (cy.decisionTreeLayout === layout) {
      cy.decisionTreeLayout = null;
    }
  });
  layout.run();
}

function addDecisionTreeLayoutToggle(cy, container) {
  const paneElement = container?.parentElement;
  if (!cy || !paneElement) {
    return;
  }

  if (getComputedStyle(paneElement).position === 'static') {
    paneElement.style.position = 'relative';
  }

  let header = paneElement.querySelector('.decision-tree-pane-header');
  if (!header) {
    header = document.createElement('div');
    header.className = 'decision-tree-pane-header';
    paneElement.prepend(header);
  }

  header.innerHTML = `
    <div class="decision-tree-pane-header-inner">
      <span class="decision-tree-pane-title">Decision Tree</span>
      <button type="button" class="decision-tree-layout-toggle" data-layout-toggle title="Switch to vertical layout" aria-label="Switch to vertical layout">
        <i class="fa-solid fa-arrows-left-right"></i>
      </button>
    </div>
  `;

  const layoutToggle = header.querySelector('[data-layout-toggle]');

  const setLayoutToggleState = (mode) => {
    cy.decisionTreeLayoutMode = mode;
    if (!layoutToggle) {
      return;
    }

    const isHorizontal = mode === DECISION_TREE_LAYOUT_MODE.HORIZONTAL;
    layoutToggle.innerHTML = isHorizontal
      ? '<i class="fa-solid fa-arrows-left-right"></i>'
      : '<i class="fa-solid fa-arrows-up-down"></i>';
    layoutToggle.title = isHorizontal
      ? 'Switch to vertical layout'
      : 'Switch to horizontal layout';
    layoutToggle.setAttribute('aria-label', layoutToggle.title);
  };

  setLayoutToggleState(cy.decisionTreeLayoutMode || DECISION_TREE_LAYOUT_MODE.HORIZONTAL);

  if (layoutToggle) {
    layoutToggle.onclick = () => {
      const nextMode = cy.decisionTreeLayoutMode === DECISION_TREE_LAYOUT_MODE.HORIZONTAL
        ? DECISION_TREE_LAYOUT_MODE.VERTICAL
        : DECISION_TREE_LAYOUT_MODE.HORIZONTAL;
      setLayoutToggleState(nextMode);
      runDecisionTreeLayout(cy, nextMode);
    };
  }
}

function runAfterRender(callback) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      callback();
    });
  });
}

function dispatchPaneDataChanged(cy) {
  if (!cy || !cy.paneId) {
    return;
  }
  document.dispatchEvent(new CustomEvent('decision-tree-pane-data-changed', {
    detail: { paneId: cy.paneId },
  }));
}

function createNodeElement(node, treeData) {
  return {
    data: {
      id: node.id,
      label: node.label || node.axiom,
      nodeId: node.nodeId,
      axiom: node.label || node.axiom,
      repairSymbol: '',
      symbolColor: '#333',
      symbolBackground: 'transparent',
      symbolBorderColor: COLORS.NODE_COLOR,
      symbolBackgroundOpacity: 0,
    },
    classes: getNodeClasses(node.id, treeData),
  };
}

function createEdgeElement(edge) {
  const edgeLabel = edge.label || edge.type;
  let normalizedLabel = edgeLabel;
  if (edgeLabel === 'keep') {
    normalizedLabel = 'kept';
  } else if (edgeLabel === 'remove') {
    normalizedLabel = 'removed';
  }

  return {
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: normalizedLabel,
      type: edge.type,
    },
  };
}

function createTreeElements(treeData, classificationData = treeData) {
  const nodeElements = treeData.nodes.map(node => createNodeElement(node, classificationData));
  const edgeElements = treeData.edges.map(edge => createEdgeElement(edge));

  return [...nodeElements, ...edgeElements];
}

function createDecisionTreeStylesheet() {
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
      selector: 'node.s',
      style: {
        label: 'data(label)',
        color: COLORS.LIGHT_TEXT,
        shape: 'rectangle',
        width: 'label',
        height: 'label',
        padding: '8px',
        'font-size': 10,
        'font-family': 'monospace',
        'text-valign': 'center',
        'text-margin-y': '0.65px',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '200px',
        'background-color': COLORS.NODE_COLOR,
        'text-outline-color': COLORS.NODE_COLOR,
        'text-outline-width': '2px',
        'overlay-padding': '6px',
        'z-index': '10',
        'background-opacity': 1,
        'border-width': OUTLINES.width,
        'border-color': COLORS.NODE_COLOR,
        'text-outline-opacity': 0,
      },
    },
    {
      selector: 'node.s:selected',
      style: {
        'border-color': COLORS.SELECTED_BORDER,
        'border-width': OUTLINES.width_selected,
        'border-style': 'double',
        'border-position': 'center',
      },
    },
    {
      selector: 'node.starplot-hovered',
      style: {
        'border-color': '#facc15',
        'border-width': Math.max(OUTLINES.width_selected, 4),
        'border-style': 'double',
      },
    },
    {
      selector: 'node.s.has-children',
      style: {
        'background-opacity': 1,
      },
    },
    {
      selector: 'node.s.expanded',
      style: {
        'background-opacity': 0,
        color: COLORS.DARK_TEXT,
        'border-color': COLORS.NODE_COLOR,
      },
    },
    {
      selector: 'node.s.partially-expanded',
      style: {
        'background-opacity': 1,
        'background-color': '#c6c6c6',
        color: COLORS.DARK_TEXT,
        'text-outline-color': '#c6c6c6',
        'border-color': COLORS.NODE_COLOR,
      },
    },
    {
      selector: 'node.s.expanded:selected',
      style: {
        'border-color': COLORS.SELECTED_BORDER,
        'border-width': OUTLINES.width_selected,
        'border-style': 'double',
      },
    },
    {
      selector: 'node.s.partially-expanded:selected',
      style: {
        'border-color': COLORS.SELECTED_BORDER,
        'border-width': OUTLINES.width_selected,
        'border-style': 'double',
      },
    },
    {
      selector: 'node.s.expanded.starplot-hovered',
      style: {
        'border-color': '#facc15',
        'border-width': Math.max(OUTLINES.width_selected, 4),
        'border-style': 'double',
      },
    },
    {
      selector: 'node.s.partially-expanded.starplot-hovered',
      style: {
        'border-color': '#facc15',
        'border-width': Math.max(OUTLINES.width_selected, 4),
        'border-style': 'double',
      },
    },
    {
      selector: 'node.s.leaf',
      style: {
        label: 'data(repairSymbol)',
        shape: 'ellipse',
        width: 18,
        height: 18,
        'background-opacity': 'data(symbolBackgroundOpacity)',
        'background-color': 'data(symbolBackground)',
        'border-color': 'data(symbolBorderColor)',
        'border-width': OUTLINES.width,
        'font-size': 12,
        'font-weight': 'bold',
        'text-valign': 'center',
        'text-halign': 'center',
        color: 'data(symbolColor)',
        padding: 0,
      },
    },
    {
      selector: 'node.s.leaf:selected',
      style: {
        'border-color': 'data(symbolColor)',
        'border-width': 3,
        'border-style': 'double',
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
        'font-size': 10,
        label: 'data(label)',
        color: '#333',
        'text-outline-color': 'white',
        'text-outline-opacity': 1,
        'text-outline-width': '2px',
      },
    },
    {
      selector: 'edge[type="keep"]',
      style: {
        'line-color': '#22c55e',
        'target-arrow-color': '#22c55e',
      },
    },
    {
      selector: 'edge[type="remove"]',
      style: {
        'line-color': '#ef4444',
        'target-arrow-color': '#ef4444',
      },
    },
  ];
}

export function createDecisionTree(container, treeData, fullTreeData) {
  if (!container) {
    console.error('Container not provided for decision tree');
    return null;
  }

  const classificationData = fullTreeData || treeData;
  const elements = createTreeElements(treeData, classificationData);

  const cy = cytoscape({
    container,
    elements,
    style: createDecisionTreeStylesheet(),
    layout: getDecisionTreeLayoutOptions(),
    zoom: 1,
    pan: { x: 0, y: 0 },
    minZoom: 0.1,
    maxZoom: 3,
    wheelSensitivity: 0.1,
  });

  cy.treeData = treeData;
  cy.expandedNodes = new Map();
  cy.decisionTreeLayoutMode = DECISION_TREE_LAYOUT_MODE.HORIZONTAL;
  cy.vars ||= {};
  cy.vars['pcp-auto-sync'] ||= { value: true };
  cy.vars['pcp-refine'] ||= { value: true };
  cy.vars['pcp-dfs'] ||= { value: false };
  cy.vars['pcp-bi'] ||= { value: 'o' };
  cy.vars['pcp-vs'] ||= { value: false };
  cy.vars['pcp-hs'] ||= { value: false };

  const dispatchNodeSelected = (nodeId) => {
    const selectedNodes = cy.$('node:selected');
    const selectedNodeIds = selectedNodes.map(n => n.data('nodeId'));
    document.dispatchEvent(new CustomEvent('decision-tree-node-selected', {
      detail: { nodeId, selectedNodeIds, paneId: cy.paneId },
    }));
  };

  const dispatchSelectionChange = () => {
    const selectedNodes = cy.$('node:selected');
    if (selectedNodes.length === 0) {
      document.dispatchEvent(new CustomEvent('decision-tree-node-selected', {
        detail: { nodeId: null, selectedNodeIds: [], paneId: cy.paneId },
      }));
      return;
    }
    const nodeId = selectedNodes[0].data('nodeId');
    const selectedNodeIds = selectedNodes.map(n => n.data('nodeId'));
    document.dispatchEvent(new CustomEvent('decision-tree-node-selected', {
      detail: { nodeId, selectedNodeIds, paneId: cy.paneId },
    }));
  };

  const dispatchNodeHovered = (nodeId = null) => {
    document.dispatchEvent(new CustomEvent('decision-tree-node-hovered', {
      detail: { nodeId, paneId: cy.paneId },
    }));
  };
  let preserveSelectionOnCoreTap = false;
  let allowCoreDeselect = false;
  let suppressSelectionChange = false;
  let coreTapSelectionIds = [];

  const restoreCoreTapSelection = () => {
    if (allowCoreDeselect || coreTapSelectionIds.length === 0) {
      preserveSelectionOnCoreTap = false;
      coreTapSelectionIds = [];
      return;
    }

    suppressSelectionChange = true;
    cy.batch(() => {
      coreTapSelectionIds.forEach((id) => {
        const node = cy.getElementById(id);
        if (node.nonempty()) {
          node.select();
        }
      });
    });
    suppressSelectionChange = false;
    preserveSelectionOnCoreTap = false;
    coreTapSelectionIds = [];
    dispatchSelectionChange();
  };

  cy.on('layoutstop', ()=> { // select first node asap, only once
    cy.$('node').select();
    cy.off('layoutstop');
  });

  cy.on('tap', 'node', (event) => {
    activeDecisionTreeCy = cy;
    const nodeId = event.target.data('nodeId');
    queueMicrotask(() => {
      dispatchNodeSelected(nodeId);
      dispatchSelectionChange();
    });
  });

  cy.on('select', 'node', () => {
    activeDecisionTreeCy = cy;
    if (suppressSelectionChange) {
      return;
    }
    dispatchSelectionChange();
  });

  cy.on('unselect', 'node', () => {
    activeDecisionTreeCy = cy;
    if (suppressSelectionChange) {
      return;
    }
    if (preserveSelectionOnCoreTap && !allowCoreDeselect) {
      return;
    }
    dispatchSelectionChange();
  });

  cy.on('mouseover', 'node', (event) => {
    activeDecisionTreeCy = cy;
    const node = event.target;
    if (!node || !node.selected()) {
      dispatchNodeHovered(null);
      return;
    }
    dispatchNodeHovered(node.data('nodeId'));
  });

  cy.on('mouseout', 'node', () => {
    activeDecisionTreeCy = cy;
    dispatchNodeHovered(null);
  });

  cy.on('dbltap', 'node', (event) => {
    activeDecisionTreeCy = cy;
    const node = event.target;
    const nodeId = node.data('nodeId');
    expandNode(cy, nodeId);
  });

  cy.on('tapstart', (event) => {
    if (event.target !== cy) {
      return;
    }

    activeDecisionTreeCy = cy;
    allowCoreDeselect = false;
    coreTapSelectionIds = cy.$('node:selected').map(node => node.id());
    preserveSelectionOnCoreTap = coreTapSelectionIds.length > 0;
  });

  cy.on('dbltap', (event) => {
    if (event.target !== cy) {
      return;
    }

    activeDecisionTreeCy = cy;
    allowCoreDeselect = true;
    preserveSelectionOnCoreTap = false;
    coreTapSelectionIds = [];
    suppressSelectionChange = true;
    cy.nodes().unselect();
    suppressSelectionChange = false;
    dispatchSelectionChange();
    allowCoreDeselect = false;
  });

  const keyboardHandler = (e) => {
    if (!cy.container() || document.activeElement.tagName === 'INPUT') {
      return;
    }

    if (activeDecisionTreeCy && activeDecisionTreeCy !== cy) {
      return;
    }

    const selectedNodes = cy.$('node:selected');
    if (selectedNodes.length === 0) {
      return;
    }

    if (e.key === 'k' || e.key === 'K') {
      if (e._dlRepairHandled) {
        return;
      }
      e.preventDefault();
      e._dlRepairHandled = true;
      expandNodeByType(cy, selectedNodes[0].data('nodeId'), 'keep');
      return;
    }

    if (e.key === 'r' || e.key === 'R') {
      if (e._dlRepairHandled) {
        return;
      }
      e.preventDefault();
      e._dlRepairHandled = true;
      expandNodeByType(cy, selectedNodes[0].data('nodeId'), 'remove');
      return;
    }

    if (e.key === 'Enter' || e.keyCode === 13) {
      if (e._dlRepairHandled) {
        return;
      }

      e.preventDefault();
      e._dlRepairHandled = true;

      if (e.ctrlKey && !e.metaKey) {
        expandNodeInNewPane(cy, selectedNodes[0].data('nodeId'));
      } else if (e.metaKey) {
        expandNode(cy, selectedNodes[0].data('nodeId'));
      }
    }

    if (e.key === 'ArrowLeft') {
      if (e._dlRepairHandled) {
        return;
      }
      e.preventDefault();
      e._dlRepairHandled = true;
      const currentNode = selectedNodes[0];
      const parentEdges = cy.treeData.edges.filter(edge => edge.target === currentNode.id());
      if (parentEdges.length > 0) {
        const parentNode = cy.getElementById(parentEdges[0].source);
        if (parentNode.length > 0) {
          currentNode.unselect();
          parentNode.select();
          dispatchNodeSelected(parentNode.data('nodeId'));
        }
      }
      return;
    }

    if (e.key === 'ArrowRight') {
      if (e._dlRepairHandled) {
        return;
      }
      e.preventDefault();
      e._dlRepairHandled = true;
      const currentNode = selectedNodes[0];
      const childEdges = cy.treeData.edges.filter(edge => edge.source === currentNode.id());
      if (childEdges.length > 0) {
        const visibleChildren = childEdges
          .map(edge => ({ edge, node: cy.getElementById(edge.target) }))
          .filter(item => item.node.length > 0);

        if (visibleChildren.length > 0) {
          const keepChild = visibleChildren.find(item => item.edge.type === 'keep');
          const targetChild = keepChild || visibleChildren[0];

          currentNode.unselect();
          targetChild.node.select();
          dispatchNodeSelected(targetChild.node.data('nodeId'));
        }
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      if (e._dlRepairHandled) {
        return;
      }
      e.preventDefault();
      e._dlRepairHandled = true;
      const currentNode = selectedNodes[0];
      const parentEdges = cy.treeData.edges.filter(edge => edge.target === currentNode.id());
      if (parentEdges.length > 0) {
        const parentId = parentEdges[0].source;
        const siblings = cy.treeData.edges.filter(
          edge => edge.source === parentId && edge.target !== currentNode.id(),
        );
        if (siblings.length > 0) {
          const nextSibling = cy.getElementById(siblings[0].target);
          if (nextSibling.length > 0) {
            currentNode.unselect();
            nextSibling.select();
            dispatchNodeSelected(nextSibling.data('nodeId'));
          }
        }
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      if (e._dlRepairHandled) {
        return;
      }
      e.preventDefault();
      e._dlRepairHandled = true;
      const currentNode = selectedNodes[0];
      const parentEdges = cy.treeData.edges.filter(edge => edge.target === currentNode.id());
      if (parentEdges.length > 0) {
        const parentId = parentEdges[0].source;
        const siblings = cy.treeData.edges.filter(
          edge => edge.source === parentId && edge.target !== currentNode.id(),
        );
        if (siblings.length > 0) {
          const prevSibling = cy.getElementById(siblings[siblings.length - 1].target);
          if (prevSibling.length > 0) {
            currentNode.unselect();
            prevSibling.select();
            dispatchNodeSelected(prevSibling.data('nodeId'));
          }
        }
      }
      return;
    }
  };

  document.addEventListener('keydown', keyboardHandler);

  cy.keyboardHandler = keyboardHandler;

  if (cy.contextMenus) {
    cy.ctxmenu = cy.contextMenus({
      menuItems: [
        {
          id: 'expand-same',
          content: `${CONSTANTS.INTERACTIONS.expand1.name}`,
          tooltipText: `${CONSTANTS.INTERACTIONS.expand1.description}\\t(Cmd+Enter)`,
          selector: 'node.has-children',
          onClickFunction: (event) => {
            const node = event.target || event.cyTarget;
            const nodeId = node.data('nodeId');
            expandNode(cy, nodeId);
          },
          hasTrailingDivider: false,
        },
        {
          id: 'expand-new',
          content: `${CONSTANTS.INTERACTIONS.expand1.name} on New Pane`,
          tooltipText: `${CONSTANTS.INTERACTIONS.expand1.description} on new pane\\t(Ctrl+Enter)`,
          selector: 'node:selected',
          onClickFunction: (event) => {
            const node = event.target || event.cyTarget;
            const nodeId = node.data('nodeId');
            expandNodeInNewPane(cy, nodeId);
          },
          hasTrailingDivider: true,
        },
        {
          id: 'collapse-node',
          content: 'Collapse',
          tooltipText: 'Collapse subtree',
          selector: 'node.expanded, node.partially-expanded',
          onClickFunction: (event) => {
            const node = event.target || event.cyTarget;
            const nodeId = node.data('nodeId');
            collapseNode(cy, nodeId);
          },
          hasTrailingDivider: true,
        },
        {
          id: 'move-path-to-summary',
          content: 'Move this path to Summary View',
          tooltipText: 'Update summary-view node states from root to this node path',
          selector: 'node:selected',
          onClickFunction: (event) => {
            const node = event.target || event.cyTarget;
            const nodeId = node.data('nodeId');
            document.dispatchEvent(new CustomEvent('decision-tree-move-path-to-summary', {
              detail: {
                paneId: cy.paneId,
                nodeId,
              },
            }));
          },
          hasTrailingDivider: true,
        },
        {
          id: 'show-class-hierarchy',
          content: 'Show class hierarchy if removed',
          tooltipText: 'Open class hierarchy comparison graph for this node',
          selector: 'node',
          onClickFunction: async (event) => {
            const node = event.target || event.cyTarget;
            const nodeId = node.data('nodeId');
            await openClassHierarchyPane(cy, nodeId);
          },
          hasTrailingDivider: true,
        },
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
          id: 'close-pane',
          content: 'Close pane',
          tooltipText: 'Close this decision tree pane',
          coreAsWell: true,
          onClickFunction: () => {
            if (!cy?.paneId) {
              return;
            }

            destroyPanes(cy.paneId, { manualRemoval: true }).catch(error => {
              console.error(`Failed to close pane ${cy.paneId}:`, error);
            });
          },
          hasTrailingDivider: false,
        },
      ],
    });
  }

  cy.on('tap', 'edge', (event) => {
    setPane(cy.paneId);
    const edge = event.target;
    const targetNodeId = edge.target().data('nodeId');
    const edgeType = edge.data('type');

    document.dispatchEvent(new CustomEvent('decision-tree-edge-clicked', {
      detail: {
        target: targetNodeId,
        type: edgeType,
      },
    }));
  });

  cy.on('tap', () => {
    setPane(cy.paneId);
    if (preserveSelectionOnCoreTap) {
      queueMicrotask(restoreCoreTapSelection);
    }
  });

  if (cy.paneId) {
    setPane(cy.paneId);
  }

  addDecisionTreeLayoutToggle(cy, container);
  cy.fit();

  return cy;
}

export function updateDecisionTree(cy, treeData) {
  if (!cy) return;

  cy.elements().remove();

  const elements = createTreeElements(treeData);

  cy.add(elements);
  runDecisionTreeLayout(cy);
}

export function navigateToNode(cy, nodeId) {
  const node = cy.getElementById(`node-${nodeId}`);
  if (node.nonempty()) {
    cy.animate({
      center: { ebb: node },
      zoom: 2,
    }, {
      duration: 500,
    });
    node.select();
  }
}

export function highlightPath(cy, nodeId) {
  cy.elements().removeClass('on-path');
  cy.edges().style('opacity', 0.2);

  const node = cy.getElementById(`node-${nodeId}`);
  if (node.nonempty()) {
    const path = [];
    let current = node;

    while (current.nonempty()) {
      path.unshift(current);
      const incomers = current.incomers('edge');
      if (incomers.length > 0) {
        current = incomers[0].source();
      } else {
        break;
      }
    }

    path.forEach(element => {
      element.addClass('on-path');
    });

    path.slice(0, -1).forEach((currentNode, index) => {
      const edges = currentNode.edgesTo(path[index + 1]);
      edges.forEach(edge => {
        edge.style('opacity', 1);
        edge.style('width', 3);
      });
    });
  }
}

async function updateLeafNodeSymbols(cy, nodeId) {
  if (!cy || !cy.treeData) return;

  try {
    const dlRepairApi = (await import('../utils/mock-dl-repair-api.js')).default;
    const nodeIdStr = `node-${nodeId}`;

    const probabilities = await dlRepairApi.getImpactProbabilities(nodeId);
    if (!probabilities) return;

    const hasKeepRepair = probabilities.yes && probabilities.yes !== 'No Repair!';
    const hasRemoveRepair = probabilities.no && probabilities.no !== 'No Repair!';

    const childEdges = cy.treeData.edges.filter(edge => edge.source === nodeIdStr);
    childEdges.forEach(edge => {
      const childNode = cy.getElementById(edge.target);
      if (childNode.length > 0) {
        let symbol = '';
        let color = '#333';
        let background = 'transparent';
        let borderColor = COLORS.NODE_COLOR;
        let backgroundOpacity = 0;

        if (edge.type === 'keep') {
          if (hasKeepRepair) {
            symbol = '✓';
            color = '#2b8a3e';
            background = '#f5fff5';
            borderColor = '#d9e8d9';
            backgroundOpacity = 1;
          } else {
            symbol = '✗';
            color = '#c92a2a';
            background = '#fff5f5';
            borderColor = '#f0d6d6';
            backgroundOpacity = 1;
          }
        } else if (edge.type === 'remove') {
          if (hasRemoveRepair) {
            symbol = '✓';
            color = '#2b8a3e';
            background = '#f5fff5';
            borderColor = '#d9e8d9';
            backgroundOpacity = 1;
          } else {
            symbol = '✗';
            color = '#c92a2a';
            background = '#fff5f5';
            borderColor = '#f0d6d6';
            backgroundOpacity = 1;
          }
        }

        childNode.data('repairSymbol', symbol);
        childNode.data('symbolColor', color);
        childNode.data('symbolBackground', background);
        childNode.data('symbolBorderColor', borderColor);
        childNode.data('symbolBackgroundOpacity', backgroundOpacity);
      }
    });
  } catch (error) {
    console.error('Error updating leaf node symbols:', error);
  }
}

function getExpandedTypes(cy, nodeId) {
  let types = cy.expandedNodes.get(nodeId);
  if (!types) {
    types = new Set();
    cy.expandedNodes.set(nodeId, types);
  }
  return types;
}

function syncNodeExpansionClass(cy, nodeId) {
  if (!cy || !cy.treeData) {
    return;
  }

  const nodeIdStr = `node-${nodeId}`;
  const node = cy.getElementById(nodeIdStr);
  if (node.length === 0) {
    return;
  }

  const hasChildren = cy.treeData.edges.some(edge => edge.source === nodeIdStr);
  const expandedTypes = cy.expandedNodes.get(nodeId);
  const hasKeep = expandedTypes?.has('keep') || expandedTypes?.has('all');
  const hasRemove = expandedTypes?.has('remove') || expandedTypes?.has('all');
  const isFullyExpanded = !!(hasKeep && hasRemove);
  const isPartiallyExpanded = !!(!isFullyExpanded && (hasKeep || hasRemove));

  node.removeClass('leaf has-children expanded partially-expanded');

  if (!hasChildren) {
    node.addClass('leaf');
    return;
  }

  if (isFullyExpanded) {
    node.addClass('expanded');
    return;
  }

  if (isPartiallyExpanded) {
    node.addClass('partially-expanded');
    return;
  }

  node.addClass('has-children');
}

export function expandNode(cy, nodeId) {
  if (!cy || !cy.treeData) return;

  const nodeIdStr = `node-${nodeId}`;

  if (cy.getElementById(nodeIdStr).length === 0) {
    console.error(`Node ${nodeIdStr} does not exist in cy instance!`);
    return;
  }

  const expandedTypes = getExpandedTypes(cy, nodeId);
  if (expandedTypes.has('all')) {
    return;
  }

  const childEdges = cy.treeData.edges.filter(edge => edge.source === nodeIdStr);

  if (childEdges.length === 0) {
    return;
  }

  const targetNodeIds = childEdges.map(edge => edge.target);

  const childNodes = cy.treeData.nodes.filter(node => targetNodeIds.includes(node.id));

  const newElements = [];
  childNodes.forEach(node => {
    if (cy.getElementById(node.id).length === 0) {
      newElements.push(createNodeElement(node, cy.treeData));
    }
  });

  childEdges.forEach(edge => {
    if (cy.getElementById(edge.id).length === 0) {
      newElements.push(createEdgeElement(edge));
    }
  });

  if (newElements.length > 0) {
    cy.add(newElements);

    expandedTypes.add('keep');
    expandedTypes.add('remove');
    expandedTypes.add('all');
    syncNodeExpansionClass(cy, nodeId);

    runDecisionTreeLayout(cy);

    dispatchPaneDataChanged(cy);
    updateLeafNodeSymbols(cy, nodeId);
  }
}

export function expandNodeByType(cy, nodeId, edgeType) {
  if (!cy || !cy.treeData) return;

  const nodeIdStr = `node-${nodeId}`;

  if (cy.getElementById(nodeIdStr).length === 0) {
    console.error(`Node ${nodeIdStr} does not exist in cy instance!`);
    return;
  }

  const expandedTypes = getExpandedTypes(cy, nodeId);
  if (expandedTypes.has('all') || expandedTypes.has(edgeType)) {
    return;
  }

  const childEdges = cy.treeData.edges.filter(
    edge => edge.source === nodeIdStr && edge.type === edgeType,
  );

  if (childEdges.length === 0) {
    return;
  }

  const targetNodeIds = childEdges.map(edge => edge.target);
  const childNodes = cy.treeData.nodes.filter(node => targetNodeIds.includes(node.id));

  const newElements = [];
  childNodes.forEach(node => {
    if (cy.getElementById(node.id).length === 0) {
      newElements.push(createNodeElement(node, cy.treeData));
    }
  });

  childEdges.forEach(edge => {
    if (cy.getElementById(edge.id).length === 0) {
      newElements.push(createEdgeElement(edge));
    }
  });

  if (newElements.length > 0) {
    cy.add(newElements);

    expandedTypes.add(edgeType);
    syncNodeExpansionClass(cy, nodeId);

    runDecisionTreeLayout(cy);

    dispatchPaneDataChanged(cy);
    updateLeafNodeSymbols(cy, nodeId);
  }
}

function collapseNode(cy, nodeId) {
  if (!cy || !cy.treeData) return;

  const nodeIdStr = `node-${nodeId}`;
  const currentNode = cy.getElementById(nodeIdStr);
  if (currentNode.length === 0) {
    return;
  }

  const expandedTypes = cy.expandedNodes.get(nodeId);
  if (!expandedTypes || expandedTypes.size === 0) {
    return;
  }

  const toRemoveNodes = new Set();
  const toRemoveEdges = new Set();
  const stack = [nodeIdStr];

  while (stack.length > 0) {
    const currentIdStr = stack.pop();
    const edges = cy.treeData.edges.filter(edge => edge.source === currentIdStr);
    edges.forEach(edge => {
      toRemoveEdges.add(edge.id);
      toRemoveNodes.add(edge.target);
      stack.push(edge.target);
    });
  }

  const existingNodeIds = Array.from(toRemoveNodes)
    .filter(id => cy.getElementById(id).length > 0);
  const existingEdgeIds = Array.from(toRemoveEdges)
    .filter(id => cy.getElementById(id).length > 0);

  if (existingNodeIds.length === 0 && existingEdgeIds.length === 0) {
    return;
  }

  if (existingEdgeIds.length > 0) {
    cy.remove(cy.$(existingEdgeIds.map(id => `#${id}`).join(', ')));
  }

  if (existingNodeIds.length > 0) {
    cy.remove(cy.$(existingNodeIds.map(id => `#${id}`).join(', ')));
  }

  existingNodeIds.forEach((id) => {
    const childId = Number(id.replace('node-', ''));
    if (!Number.isNaN(childId)) {
      cy.expandedNodes.delete(childId);
    }
  });

  cy.expandedNodes.delete(nodeId);
  currentNode.removeClass('expanded partially-expanded leaf has-children');
  syncNodeExpansionClass(cy, nodeId);

  runDecisionTreeLayout(cy);

  dispatchPaneDataChanged(cy);
}

function extractSubtree(treeData, nodeId) {
  const nodeIdStr = `node-${nodeId}`;
  const visited = new Set();
  const subtreeNodes = [];
  const subtreeEdges = [];

  function traverse(currentIdStr) {
    if (visited.has(currentIdStr)) return;
    visited.add(currentIdStr);

    const node = treeData.nodes.find(n => n.id === currentIdStr);
    if (node) {
      subtreeNodes.push(node);
    }

    const edges = treeData.edges.filter(e => e.source === currentIdStr);
    edges.forEach(edge => {
      subtreeEdges.push(edge);
      traverse(edge.target);
    });
  }

  traverse(nodeIdStr);

  return {
    nodes: subtreeNodes,
    edges: subtreeEdges,
  };
}

export function expandNodeInNewPane(cy, nodeId) {
  if (!cy || !cy.treeData) return;

  const subtree = extractSubtree(cy.treeData, nodeId);

  if (subtree.nodes.length === 0) {
    console.log(`Node ${nodeId} has no subtree`);
    return;
  }

  const paneId = cy.container().closest('.pane')?.id || 'pane-0';

  const newPane = spawnPane({
    spawner: paneId,
    id: `dl-repair-${Date.now()}`,
    newPanePosition: 'right',
  }, [nodeId], [nodeId]);

  if (!newPane) {
    console.error('Failed to create new pane');
    return;
  }

  const newContainer = document.getElementById(newPane.container);
  if (!newContainer) {
    console.error('Failed to find pane container element');
    return;
  }

  const newCy = createInitialTree(newContainer, subtree);

  if (newCy) {
    newCy.paneId = newPane.id;
    newPane.cy = newCy;
    setPane(newPane.id);
    document.dispatchEvent(new CustomEvent('decision-tree-pane-ready', {
      detail: { paneId: newPane.id },
    }));
    dispatchPaneDataChanged(newCy);

    runAfterRender(() => {
      const rootNode = subtree.nodes[0];
      if (rootNode) {
        expandNode(newCy, rootNode.nodeId);
      }
    });
  }
}

export function createInitialTree(container, treeData) {
  if (!container || !treeData) {
    console.error('Container or tree data not provided');
    return null;
  }

  let rootNode = null;

  const targetIds = new Set(treeData.edges.map(e => e.target));

  rootNode = treeData.nodes.find(node => !targetIds.has(node.id));

  if (!rootNode && treeData.nodes.length > 0) {
    console.warn('No node without incoming edges found, using first node');
    rootNode = treeData.nodes[0];
  }

  if (!rootNode) {
    console.error('Root node not found');
    return null;
  }

  const initialData = {
    nodes: [
      {
        id: rootNode.id,
        label: rootNode.label,
        nodeId: rootNode.nodeId,
      },
    ],
    edges: [],
  };

  const cy = createDecisionTree(container, initialData, treeData);

  if (!cy) {
    console.error('Failed to create cy instance');
    return null;
  }

  cy.treeData = treeData;
  cy.expandedNodes = new Map();

  return cy;
}

function getNodeClasses(nodeId, treeData) {
  const hasChildren = treeData.edges.some(edge => edge.source === nodeId);
  if (!hasChildren) {
    return 's leaf';
  }
  return 's has-children';
}

export default {
  createDecisionTree,
  updateDecisionTree,
  navigateToNode,
  highlightPath,
};
