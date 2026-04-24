import { badges } from './badges.js';
import { COLORS, OUTLINES } from './variables.js';

const selections = {
  primary: {
    'border-color': COLORS.SELECTED_BORDER,
    'border-width': OUTLINES.width_selected,
    'border-style': 'double',
    'border-position': 'center',
    // opacity: 1,
  },
  secondary: {
    width: '10px',
    height: '10px',
    'border-color': COLORS.SECONDARY_SELECTION,
    'border-width': OUTLINES.width_selected,
    'border-style': 'solid',
    'border-position': 'center',
    // opacity: 1,
  },
};

const stylesheet = [
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
      label: 'data(id)',
      color: COLORS.LIGHT_TEXT,
      shape: 'rectangle',
      height: 20,
      width: 50,
      'font-size': 10,
      'font-family': 'monospace',
      'text-valign': 'center',
      'text-margin-y': '0.65px',
      'text-halign': 'center',
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
    selector: 'node.s.marked',
    style: {
      'background-image': '/src/lib/style/icons/badge-green.svg',
      'background-image-containment': 'over',
      'background-clip': 'none',
      'bounds-expansion': '11',
      'background-height': badges.height,
      'background-width': badges.width,
      'background-position-x': badges.x,
      'background-position-y': badges.y,
    },
  },
  {
    selector: 'node.s.marked:selected',
    style: {
      'bounds-expansion': '12',
      'background-position-y': badges.y_s,
    },
  },
  {
    selector: 'node.t',
    style: {
      height: '5px',
      width: '5px',
      shape: 'ellipse',
      'background-color': COLORS.SECONDARY_NODE_COLOR,
    },
  },
  {
    selector: 'node.s[[outdegree > 0]]', // expanded node
    style: {
      color: COLORS.DARK_TEXT,
      'background-opacity': 0,
      'border-color': COLORS.NODE_COLOR,
    },
  },
  {
    selector: 'node.s:selected',
    style: selections.primary,
  },
  {
    selector: 'node.t:selected',
    style: selections.secondary,
  },
  {
    selector: 'node.recurring',
    style: {
      'background-opacity': 1,
      'background-color': COLORS.RECURRING,
      'border-color': COLORS.RECURRING,
    },
  },
  {
    selector: 'node.recurring-hover',
    style: {
      'background-opacity': 1,
      'background-color': COLORS.RECURRING,
      'border-color': COLORS.RECURRING,
    },
  },
  {
    selector: 'node.shared',
    style: {
      // Single border for unselected shared nodes
      'border-width': OUTLINES.width,
      'border-style': 'solid',
      'border-color': COLORS.SHARED_BORDER,
    },
  },
  {
    selector: 'node.shared:selected',
    style: {
      // Double border for selected shared nodes
      'border-width': OUTLINES.width_selected,
      'border-style': 'double',
      'border-color': COLORS.SHARED_BORDER,
    },
  },
  {
    selector: 'node.unique',
    style: {
      // Single border for unselected unique nodes
      'border-width': OUTLINES.width,
      'border-style': 'solid',
      'border-color': COLORS.UNIQUE_BORDER,
    },
  },
  {
    selector: 'node.unique:selected',
    style: {
      // Double border for selected unique nodes
      'border-width': OUTLINES.width_selected,
      'border-style': 'double',
      'border-color': COLORS.UNIQUE_BORDER,
    },
  },
  // Unified comparison view styles
  {
    selector: 'node.graph-a-only',
    style: {
      'border-color': COLORS.GRAPH_A_ONLY,
      'background-color': COLORS.GRAPH_A_ONLY,
      'background-opacity': 0,
      'border-width': OUTLINES.width,
      'border-style': 'solid',
      color: '#000000',
    },
  },
  {
    selector: 'node.graph-a-only:selected',
    style: {
      'border-color': COLORS.GRAPH_A_ONLY,
      'border-width': OUTLINES.width_selected,
      'border-style': 'double',
      color: '#000000',
    },
  },
  {
    selector: 'node.graph-a-only.recurring, node.graph-a-only.recurring-hover',
    style: {
      'background-color': COLORS.GRAPH_A_ONLY,
      'background-opacity': 1,
      'border-color': COLORS.GRAPH_A_ONLY,
      color: '#000000',
    },
  },
  {
    selector: 'node.graph-b-only',
    style: {
      'border-color': COLORS.GRAPH_B_ONLY,
      'background-color': COLORS.GRAPH_B_ONLY,
      'background-opacity': 0,
      'border-width': OUTLINES.width,
      'border-style': 'solid',
      color: '#000000',
    },
  },
  {
    selector: 'node.graph-b-only:selected',
    style: {
      'border-color': COLORS.GRAPH_B_ONLY,
      'border-width': OUTLINES.width_selected,
      'border-style': 'double',
      color: '#000000',
    },
  },
  {
    selector: 'node.graph-b-only.recurring, node.graph-b-only.recurring-hover',
    style: {
      'background-color': COLORS.GRAPH_B_ONLY,
      'background-opacity': 1,
      'border-color': COLORS.GRAPH_B_ONLY,
      color: '#000000',
    },
  },
  {
    selector: 'node.graph-shared',
    style: {
      'border-color': COLORS.GRAPH_SHARED,
      'background-color': COLORS.GRAPH_SHARED,
      'background-opacity': 0,
      'border-width': OUTLINES.width,
      'border-style': 'solid',
      color: '#000000',
    },
  },
  {
    selector: 'node.graph-shared:selected',
    style: {
      'border-color': COLORS.GRAPH_SHARED,
      'border-width': OUTLINES.width_selected,
      'border-style': 'double',
      color: '#000000',
    },
  },
  {
    selector: 'node.graph-shared.recurring, node.graph-shared.recurring-hover',
    style: {
      'background-color': COLORS.GRAPH_SHARED,
      'background-opacity': 1,
      'border-color': COLORS.GRAPH_SHARED,
      color: '#000000',
    },
  },
  {
    selector: 'edge.graph-a-edge',
    style: {
      'line-color': COLORS.GRAPH_A_ONLY,
      'target-arrow-color': COLORS.GRAPH_A_ONLY,
    },
  },
  {
    selector: 'edge.graph-b-edge',
    style: {
      'line-color': COLORS.GRAPH_B_ONLY,
      'target-arrow-color': COLORS.GRAPH_B_ONLY,
    },
  },
  {
    selector: 'edge.graph-shared-edge',
    style: {
      'line-color': COLORS.GRAPH_SHARED,
      'target-arrow-color': COLORS.GRAPH_SHARED,
    },
  },
  {
    selector: 'edge.graph-cross-edge',
    style: {
      'line-color': '#9e9e9e',
      'target-arrow-color': '#9e9e9e',
      'line-style': 'dashed',
    },
  },
  // Partially shared nodes/edges (appear in some but not all graphs)
  {
    selector: 'node.graph-partial-shared',
    style: {
      'border-color': '#ff9800',
      'background-color': '#ff9800',
      'background-opacity': 0,
      'border-width': OUTLINES.width,
      'border-style': 'solid',
      color: '#000000',
    },
  },
  {
    selector: 'node.graph-partial-shared:selected',
    style: {
      'border-color': '#ff9800',
      'border-width': OUTLINES.width_selected,
      'border-style': 'double',
      color: '#000000',
    },
  },
  {
    selector: 'node.graph-partial-shared.recurring, node.graph-partial-shared.recurring-hover',
    style: {
      'background-color': '#ff9800',
      'background-opacity': 1,
      'border-color': '#ff9800',
      color: '#000000',
    },
  },
  {
    selector: 'edge.graph-partial-shared-edge',
    style: {
      'line-color': '#ff9800',
      'target-arrow-color': '#ff9800',
      'line-style': 'dotted',
    },
  },
  // Diff view (added/removed)
  {
    selector: 'node.diff-added',
    style: {
      'border-color': '#1b5e20',
      'background-color': '#1b5e20',
      'background-opacity': 0,
      'border-width': OUTLINES.width,
      'border-style': 'solid',
      color: '#000',
    },
  },
  {
    selector: 'node.diff-added.recurring, node.diff-added.recurring-hover',
    style: {
      'background-color': '#1b5e20',
      'background-opacity': 1,
      'border-color': '#1b5e20',
      color: '#000',
    },
  },
  {
    selector: 'node.diff-removed',
    style: {
      'border-color': '#b71c1c',
      'background-color': '#b71c1c',
      'background-opacity': 0,
      'border-width': OUTLINES.width,
      'border-style': 'solid',
      color: '#000',
    },
  },
  {
    selector: 'node.diff-removed.recurring, node.diff-removed.recurring-hover',
    style: {
      'background-color': '#b71c1c',
      'background-opacity': 1,
      'border-color': '#b71c1c',
      color: '#000',
    },
  },
  {
    selector: 'node.diff-context',
    style: {
      'border-color': '#9e9e9e',
      'background-color': '#9e9e9e',
      'background-opacity': 0,
      'border-width': OUTLINES.width,
      'border-style': 'dashed',
      color: '#000',
    },
  },
  {
    selector: 'node.diff-context.recurring, node.diff-context.recurring-hover',
    style: {
      'background-color': '#9e9e9e',
      'background-opacity': 1,
      'border-color': '#9e9e9e',
      color: '#000',
    },
  },
  {
    selector: 'edge.diff-added',
    style: {
      'line-color': '#1b5e20',
      'target-arrow-color': '#1b5e20',
      'line-style': 'solid',
      width: 2,
    },
  },
  {
    selector: 'edge.diff-removed',
    style: {
      'line-color': '#b71c1c',
      'target-arrow-color': '#b71c1c',
      'line-style': 'solid',
      width: 2,
    },
  },
  {
    selector: 'edge.diff-context',
    style: {
      'line-color': '#9e9e9e',
      'target-arrow-color': '#9e9e9e',
      'line-style': 'dashed',
      width: 1.5,
      opacity: 0.6,
    },
  },
  {
    selector: 'edge',
    style: {
      label: 'data(label)',
      color: COLORS.NODE_COLOR,
      width: 1.5,
      'font-size': 8,
      'curve-style': 'bezier', // taxi
      'target-arrow-shape': 'triangle',
      'line-color': COLORS.EDGE_COLOR,
      'target-arrow-color': COLORS.EDGE_COLOR,
      'line-style': 'dashed',
      'line-dash-pattern': [6, 3],
      'line-dash-offset': 24,
      'text-outline-color': 'white',
      'text-outline-opacity': 1,
      'text-outline-width': '1px',
    },
  },
  {
    selector: 'edge.scheduler',
    style: {
      'line-color': COLORS.HL_EDGE_COLOR,
      'target-arrow-color': COLORS.HL_EDGE_COLOR,
      'line-style': 'solid',
    },
  },
  // Matrix hover styles - placed at end for highest priority
  {
    selector: 'node.matrix-hover',
    style: {
      'border-width': 3,
      'border-color': COLORS.HL_EDGE_COLOR,
      'z-index': 9999,
    },
  },
  {
    selector: 'edge.matrix-hover',
    style: {
      display: 'element',
      'line-color': COLORS.HL_EDGE_COLOR,
      'target-arrow-color': COLORS.HL_EDGE_COLOR,
      'source-arrow-color': COLORS.HL_EDGE_COLOR,
      width: 4,
      'z-index': 9999,
      opacity: 1,
    },
  },
];

const overviewStylesheet = [
  {
    selector: 'core',
    style: {
      'selection-box-color': COLORS.SELECTED_NODE_COLOR,
      'selection-box-border-color': '#8BB0D0',
      'selection-box-opacity': '0.5',
    },
  },
  {
    selector: 'node.active-pane',
    style: {
      'border-color': '#439843',
      'border-width': '1px',
      'border-style': 'solid',
    },
  },
  {
    selector: 'node:selected',
    style: selections.primary,
  },
  {
    selector: 'edge',
    style: {
      label: 'data(label)',
      color: COLORS.NODE_COLOR,
      width: 1.5,
      'font-size': 8,
      'curve-style': 'bezier',
      'target-arrow-shape': 'triangle',
      'line-color': COLORS.EDGE_COLOR,
      'target-arrow-color': COLORS.EDGE_COLOR,
      'line-style': 'dashed',
      'line-dash-pattern': [6, 3],
      'line-dash-offset': 24,
    },
  },
  // Interactive legend filter styles
  {
    selector: 'node.legend-dimmed',
    style: {
      opacity: 0.2,
    },
  },
  {
    selector: 'edge.legend-dimmed',
    style: {
      opacity: 0.1,
    },
  },
  {
    selector: 'node.legend-hidden',
    style: {
      display: 'none',
    },
  },
  {
    selector: 'edge.legend-hidden',
    style: {
      display: 'none',
    },
  },
  // Matrix hover styles - placed at end for highest priority
  {
    selector: 'node.matrix-hover',
    style: {
      'border-width': 3,
      'border-color': COLORS.HL_EDGE_COLOR,
      'z-index': 9999,
    },
  },
  {
    selector: 'edge.matrix-hover',
    style: {
      display: 'element',
      'line-color': COLORS.HL_EDGE_COLOR,
      'target-arrow-color': COLORS.HL_EDGE_COLOR,
      'source-arrow-color': COLORS.HL_EDGE_COLOR,
      width: 4,
      'z-index': 9999,
      opacity: 1,
    },
  },
];

export {
  stylesheet, selections, overviewStylesheet,
};
