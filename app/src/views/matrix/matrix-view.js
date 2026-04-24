/**
 * Matrix View Module
 *
 * Provides an adjacency matrix visualization for state-to-state connections
 * in Cytoscape graphs. Transitions (t-nodes) are aggregated to show direct
 * state-to-state connectivity.
 *
 * Features:
 * - Canvas-based rendering for performance
 * - Multiple ordering strategies (ID, degree, BFS)
 * - Zoom and pan interactions
 * - Hover highlighting synchronized across panes
 * - Selection support via diagonal cell clicks
 * - Support for diff graphs and unified views with color coding
 *
 * @module matrix-view
 */

import events from '../../utils/events.js';
import { setPane } from '../../utils/controls.js';
import { getPanes, destroyPanes, togglePane } from '../panes/panes.js';
import Swal from 'sweetalert2';

// ============================================================================
// Module State
// ============================================================================

/** Map of pane ID to matrix view state */
const state = new Map();

// ============================================================================
// DOM Utilities
// ============================================================================

/**
 * Get the container element for a pane.
 * @param {Object} pane - The pane object
 * @returns {HTMLElement|null} The container element
 */
function getPaneContainer(pane) {
  return document.getElementById(pane.container);
}

/**
 * Create or retrieve the matrix overlay layer for a pane.
 * Sets up the canvas and event isolation.
 *
 * @param {Object} pane - The pane object
 * @returns {HTMLElement} The matrix layer element
 */
function ensureMatrixLayer(pane) {
  const container = getPaneContainer(pane);
  const layerId = `${pane.container}-matrix`;
  let layer = document.getElementById(layerId);

  if (layer) {
    return layer;
  }

  // Ensure container can host absolute positioning
  if (container && getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  // Create overlay layer
  layer = document.createElement('div');
  layer.id = layerId;
  Object.assign(layer.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    right: '0',
    bottom: '0',
    zIndex: '9999',
    background: '#fff',
    overflow: 'hidden',
    pointerEvents: 'auto',
  });
  layer.dataset.matrixOverlay = '1';

  // Prevent events from bubbling to Cytoscape container
  // Note: Do NOT block up/end events to allow drag-end handlers to work
  const stopBubble = (ev) => {
    try {
      ev.stopPropagation();
    } catch {
      // Ignore errors
    }
  };

  const eventsToBlock = [
    'pointerdown',
    'mousedown',
    'click',
    'dblclick',
    'contextmenu',
    'touchstart',
  ];
  eventsToBlock.forEach((eventType) => {
    layer.addEventListener(eventType, stopBubble);
  });

  // Create canvas element
  const canvas = document.createElement('canvas');
  canvas.id = `${pane.container}-matrix-canvas`;
  Object.assign(canvas.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    pointerEvents: 'auto',
    zIndex: '1',
  });

  const rect = container.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width || container.clientWidth || 1));
  canvas.height = Math.max(1, Math.floor(rect.height || container.clientHeight || 1));

  layer.appendChild(canvas);
  container.appendChild(layer);

  return layer;
}

/**
 * Hide Cytoscape elements when showing matrix view.
 * @param {Object} pane - The pane object
 */
function hideCytoscape(pane) {
  const container = getPaneContainer(pane);
  const matrixId = `${pane.container}-matrix`;

  Array.from(container.childNodes).forEach((node) => {
    if (node.id !== matrixId) {
      node.style.display = 'none';
    }
  });
}

/**
 * Show Cytoscape elements when hiding matrix view.
 * @param {Object} pane - The pane object
 */
function showCytoscape(pane) {
  const container = getPaneContainer(pane);
  const matrixId = `${pane.container}-matrix`;

  Array.from(container.childNodes).forEach((node) => {
    if (node.id !== matrixId) {
      node.style.display = '';
    }
  });
}

// ============================================================================
// Adjacency Matrix Computation
// ============================================================================

/**
 * Compute node degrees for filtering and ordering.
 * @param {Array} sNodes - State nodes array
 * @param {Array} edges - Edges array
 * @returns {Map<string, number>} Map of node ID to degree
 */
function computeDegrees(sNodes, edges) {
  const degrees = new Map();
  sNodes.forEach((n) => degrees.set(n.id, 0));

  for (const edge of edges) {
    if (degrees.has(edge.source)) {
      degrees.set(edge.source, degrees.get(edge.source) + 1);
    }
    if (degrees.has(edge.target)) {
      degrees.set(edge.target, degrees.get(edge.target) + 1);
    }
  }

  return degrees;
}

/**
 * Apply BFS ordering to nodes starting from the first node.
 * @param {Array} sNodes - State nodes array
 * @param {Array} edges - Edges array
 * @returns {Array} Ordered nodes array
 */
function applyBfsOrdering(sNodes, edges) {
  if (sNodes.length === 0) {
    return sNodes;
  }

  const visited = new Set();
  const ordered = [];
  const queue = [sNodes[0].id];
  visited.add(sNodes[0].id);

  while (queue.length > 0) {
    const currentId = queue.shift();
    const node = sNodes.find((n) => n.id === currentId);

    if (node) {
      ordered.push(node);
    }

    // Find neighbors
    for (const edge of edges) {
      if (edge.source === currentId && !visited.has(edge.target)) {
        const targetExists = sNodes.some((n) => n.id === edge.target);
        if (targetExists) {
          visited.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
  }

  // Add any unvisited nodes
  sNodes.forEach((n) => {
    if (!visited.has(n.id)) {
      ordered.push(n);
    }
  });

  return ordered;
}

/**
 * Build the adjacency matrix data from Cytoscape graph.
 * Aggregates transitions (t-nodes) to show state-to-state connectivity.
 *
 * @param {Object} pane - The pane object
 * @param {string} ordering - Ordering strategy: 'id' | 'degree' | 'bfs'
 * @param {Object} filters - Filter options
 * @param {number} [filters.minDegree] - Minimum degree filter
 * @param {boolean} [filters.showOnlySelected] - Show only selected nodes
 * @returns {Object} Adjacency data { nodes, counts, n, max, isUnifiedView, nodeMembership }
 */
function buildAdjacency(pane, ordering = 'id', filters = {}) {
  const cy = pane.cy;
  const elements = cy.json()?.elements || {};
  const nodes = (elements.nodes || []).map((n) => n.data).filter(Boolean);
  const edges = (elements.edges || []).map((e) => e.data).filter(Boolean);

  // Check if this is a unified/merged view
  const isUnifiedView = cy.unifiedViewData && cy.unifiedViewData.paneList;

  // Filter to state nodes only (type === 's')
  let sNodes = nodes.filter((n) => n.type === 's');
  const tNodeIds = new Set(nodes.filter((n) => n.type === 't').map((n) => n.id));

  // Apply "show only selected" filter
  if (filters.showOnlySelected) {
    const selectedIds = new Set();
    cy.nodes(':selected').forEach((node) => {
      if (node.data('type') === 's') {
        selectedIds.add(node.data('id'));
      }
    });
    if (selectedIds.size > 0) {
      sNodes = sNodes.filter((n) => selectedIds.has(n.id));
    }
  }

  // Apply minimum degree filter
  if (filters.minDegree && filters.minDegree > 0) {
    const degrees = computeDegrees(sNodes, edges);
    sNodes = sNodes.filter((n) => (degrees.get(n.id) || 0) >= filters.minDegree);
  }

  // Apply ordering strategy
  if (ordering === 'id') {
    sNodes.sort((a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0));
  } else if (ordering === 'degree') {
    const degrees = computeDegrees(sNodes, edges);
    sNodes.sort((a, b) => (degrees.get(b.id) || 0) - (degrees.get(a.id) || 0));
  } else if (ordering === 'bfs') {
    sNodes = applyBfsOrdering(sNodes, edges);
  }

  // Build index map for quick lookup
  const indexMap = new Map();
  sNodes.forEach((n, i) => indexMap.set(n.id, i));

  const n = sNodes.length;
  const counts = new Uint16Array(n * n);

  if (n === 0) {
    return {
      nodes: sNodes, counts, n, max: 0,
    };
  }

  // Collect state-to-transition and transition-to-state relationships
  const stateToTransitions = new Map(); // stateIdx -> Set(transitionId)
  const transitionToStates = new Map(); // transitionId -> Set(stateIdx)

  for (const edge of edges) {
    const sourceIdx = indexMap.get(edge.source);
    const targetIdx = indexMap.get(edge.target);

    // State -> Transition edge
    if (sourceIdx != null && tNodeIds.has(edge.target)) {
      const transitions = stateToTransitions.get(sourceIdx) || new Set();
      transitions.add(edge.target);
      stateToTransitions.set(sourceIdx, transitions);
      continue;
    }

    // Transition -> State edge
    if (tNodeIds.has(edge.source) && targetIdx != null) {
      const states = transitionToStates.get(edge.source) || new Set();
      states.add(targetIdx);
      transitionToStates.set(edge.source, states);
      continue;
    }

    // Direct state-to-state edge (if present)
    if (sourceIdx != null && targetIdx != null) {
      counts[sourceIdx * n + targetIdx] += 1;
    }
  }

  // Construct state-to-state connections via transition nodes
  for (const [stateIdx, transitionSet] of stateToTransitions.entries()) {
    for (const transitionId of transitionSet) {
      const successorStates = transitionToStates.get(transitionId);
      if (!successorStates) continue;

      for (const successorIdx of successorStates) {
        counts[stateIdx * n + successorIdx] += 1;
      }
    }
  }

  // Find maximum count for color scaling
  let max = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > max) max = counts[i];
  }

  // For unified view, collect node membership info
  const nodeMembership = isUnifiedView ? new Map() : null;
  if (isUnifiedView) {
    sNodes.forEach((node) => {
      nodeMembership.set(node.id, node.graphMembership || []);
    });
  }

  return {
    nodes: sNodes, counts, n, max, isUnifiedView, nodeMembership,
  };
}

// ============================================================================
// Rendering Utilities
// ============================================================================

/**
 * Convert RGB color to RGBA string with intensity-based alpha.
 * @param {Object} color - Color object with r, g, b properties
 * @param {number} ratio - Intensity ratio (0-1)
 * @returns {string} RGBA color string
 */
function toRGBA({ r, g, b }, ratio) {
  if (!ratio || ratio <= 0) return 'rgba(0,0,0,0)';
  const alpha = Math.max(0.35, Math.min(1, 0.25 + 0.75 * ratio));
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Create tooltip element for matrix hover.
 * @param {Object} pane - The pane object
 * @param {HTMLElement} layer - The matrix layer element
 * @returns {HTMLElement} The tooltip element
 */
function createTooltip(pane, layer) {
  const tooltipId = `${pane.container}-matrix-tooltip`;
  let tooltip = document.getElementById(tooltipId);

  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = tooltipId;
    Object.assign(tooltip.style, {
      position: 'absolute',
      display: 'none',
      background: 'rgba(0,0,0,0.85)',
      color: '#fff',
      padding: '6px 10px',
      borderRadius: '4px',
      fontSize: '12px',
      pointerEvents: 'none',
      zIndex: '1000',
      whiteSpace: 'nowrap',
    });
    layer.appendChild(tooltip);
  }

  return tooltip;
}

// ============================================================================
// Matrix Renderer
// ============================================================================

/**
 * Create a renderer for the matrix view.
 * Manages canvas rendering, interactions, and state.
 *
 * @param {Object} pane - The pane object
 * @returns {Object} Renderer API { draw, resize, destroy, setOrdering, getCurrentOrdering, resetZoom }
 */
function createRenderer(pane) {
  const layer = ensureMatrixLayer(pane);
  const canvas = layer.querySelector('canvas');
  const ctx = canvas.getContext('2d');

  // Cleanup callbacks for event listeners
  const cleanupCallbacks = [];

  // Create tooltip element
  const tooltip = createTooltip(pane, layer);

  // Renderer state
  let currentOrdering = 'id';
  let hoveredCell = null;
  let hoveredNodeElements = [];
  let minDegreeFilter = 0;
  let showOnlySelected = false;
  let zoomLevel = 1.0;
  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  // -------------------------------------------------------------------------
  // Hover Highlighting
  // -------------------------------------------------------------------------

  /**
   * Clear hover highlighting from Cytoscape nodes.
   */
  function clearMatrixHoverNodes() {
    if (!pane?.cy) return;

    hoveredNodeElements.forEach((el) => {
      try {
        el.removeClass('matrix-hover');
      } catch {
        // Ignore errors
      }
    });
    hoveredNodeElements = [];
  }

  /**
   * Apply hover highlighting to Cytoscape nodes.
   * @param {string} fromId - Source node ID
   * @param {string} toId - Target node ID
   */
  function applyMatrixHoverNodes(fromId, toId) {
    if (!pane?.cy) return;
    clearMatrixHoverNodes();

    const ids = [...new Set([fromId, toId].filter(Boolean))];

    ids.forEach((id) => {
      // Try direct lookup first
      let el = pane.cy.getElementById(id);

      if (el && el.nonempty && el.isNode && el.isNode() && el.data('type') === 's') {
        el.addClass('matrix-hover');
        hoveredNodeElements.push(el);
      } else {
        // Fallback: search by data ID
        const node = pane.cy.nodes().filter((n) => n.data('id') === id && n.data('type') === 's');
        if (node.length > 0) {
          node.addClass('matrix-hover');
          hoveredNodeElements.push(node);
        }
      }
    });
  }

  /**
   * Emit global matrix hover event for cross-pane synchronization.
   * @param {Array} ids - Array of hovered node IDs
   * @param {Object} [edge] - Optional edge info {fromId, toId}
   */
  function emitMatrixHover(ids, edge = null) {
    try {
      window.dispatchEvent(events.MATRIX_HOVER(pane?.id, ids || [], edge));
    } catch {
      // Ignore errors
    }
  }

  // -------------------------------------------------------------------------
  // Canvas Sizing
  // -------------------------------------------------------------------------

  /**
   * Resize canvas to match container dimensions.
   */
  function resize() {
    const container = getPaneContainer(pane);
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    draw();
  }

  // -------------------------------------------------------------------------
  // Main Drawing Function
  // -------------------------------------------------------------------------

  /**
   * Main draw function - renders the entire matrix.
   */
  function draw() {
    const filters = { minDegree: minDegreeFilter, showOnlySelected };
    const {
      nodes, counts, n, max, isUnifiedView, nodeMembership,
    } = buildAdjacency(pane, currentOrdering, filters);
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Handle empty state
    if (n === 0) {
      ctx.fillStyle = '#666';
      ctx.fillText('No states to render (type = s).', 10, 20);
      return;
    }

    // Store data for interactions
    const paneState = state.get(pane.id);
    paneState.matrixData = {
      nodes, counts, n, max, isUnifiedView, nodeMembership,
    };

    // Calculate cell dimensions with zoom
    const baseCell = Math.max(1, Math.floor((Math.min(w, h) * 0.9) / n));
    const cell = baseCell * zoomLevel;
    const totalSize = cell * n;

    // Calculate origin with centering and pan offset
    const originX = Math.floor((w - totalSize) / 2) + panX;
    const originY = Math.floor((h - totalSize) / 2) + panY;

    // Store layout for interactions
    paneState.layout = {
      w, h, cell, originX, originY,
    };

    // Render background
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, w, h);

    // Save context for clipping
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.save();
    ctx.translate(originX, originY);

    // Optional coarse grid
    if (cell >= 8 && n <= 500) {
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = 1;
      for (let i = 0; i <= n; i++) {
        const p = i * cell;
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(totalSize, p);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, totalSize);
        ctx.stroke();
      }
    }

    // Color scale: For diff graphs use diff colors, for unified views use graph membership colors, otherwise use single edge color
    const isDiffGraph = pane.cy.isDiffGraph;

    const palette = isDiffGraph ? {
      added: { r: 27, g: 94, b: 32 },            // green (diff-added)
      removed: { r: 183, g: 28, b: 28 },         // red (diff-removed)
      context: { r: 158, g: 158, b: 158 },       // gray (diff-context)
      self: { r: 110, g: 110, b: 110 },          // neutral gray
    } : isUnifiedView ? {
      graphAOnly: { r: 76, g: 175, b: 80 },      // green (graph-a-only)
      graphBOnly: { r: 244, g: 67, b: 54 },      // red (graph-b-only)
      shared: { r: 158, g: 158, b: 158 },        // gray (shared)
      partial: { r: 255, g: 152, b: 0 },         // orange (partial)
      self: { r: 110, g: 110, b: 110 },          // neutral gray
    } : {
      edge: { r: 43, g: 140, b: 255 },           // blue for all edges
      self: { r: 110, g: 110, b: 110 },          // neutral gray for diagonal
    };
    const toRGBA = ({ r, g, b }, ratio) => {
      if (!ratio || ratio <= 0) return 'rgba(0,0,0,0)';
      const a = Math.max(0.35, Math.min(1, 0.25 + 0.75 * ratio));
      return `rgba(${r},${g},${b},${a})`;
    };

    // Row-wise maxima for normalization: max outgoing per source state
    const rowMax = new Uint16Array(n);
    for (let rr = 0; rr < n; rr++) {
      let m = 0;
      const base = rr * n;
      for (let cc = 0; cc < n; cc++) {
        const v = counts[base + cc];
        if (v > m) m = v;
      }
      rowMax[rr] = m;
    }

    // Degree vectors for fallback normalization when rows are uniform (max==1)
    const outDeg = new Uint16Array(n);
    const inDeg = new Uint16Array(n);
    for (let rr = 0; rr < n; rr++) {
      const base = rr * n;
      for (let cc = 0; cc < n; cc++) {
        if (counts[base + cc] > 0) {
          outDeg[rr]++;
          inDeg[cc]++;
        }
      }
    }
    let maxOut = 0; let
      maxIn = 0;
    for (let i = 0; i < n; i++) { if (outDeg[i] > maxOut) maxOut = outDeg[i]; if (inDeg[i] > maxIn) maxIn = inDeg[i]; }

    // Draw cells: only lower half (r >= c)
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        // Only render lower half (including diagonal)
        if (r < c) continue;

        const f = counts[r * n + c]; // r -> c (forward)
        const b = counts[c * n + r]; // c -> r (backward)
        if (f === 0 && b === 0) continue;
        const x = c * cell;
        const y = r * cell;

        // Determine color based on diff graph, unified view, or normal view
        let cellColor;
        let ratio;

        if (isDiffGraph) {
          // Use diff classes for coloring based on NODE classes (not edge classes)
          // because diff graphs only have collapsed-context edges, not added/removed edges
          const srcNode = pane.cy.getElementById(nodes[r]?.id);
          const tgtNode = pane.cy.getElementById(nodes[c]?.id);

          let colorKey;
          if (r === c) {
            // Diagonal - check node class for self-loop color
            if (srcNode.hasClass('diff-added')) colorKey = 'added';
            else if (srcNode.hasClass('diff-removed')) colorKey = 'removed';
            else if (srcNode.hasClass('diff-context')) colorKey = 'context';
            else colorKey = 'self';  // fallback
          } else {
            // Off-diagonal - color based on whether either endpoint is added/removed
            // (since diff graphs don't have added/removed edge classes, only nodes)
            const srcIsAdded = srcNode.hasClass('diff-added');
            const tgtIsAdded = tgtNode.hasClass('diff-added');
            const srcIsRemoved = srcNode.hasClass('diff-removed');
            const tgtIsRemoved = tgtNode.hasClass('diff-removed');

            // Priority: if either node is added/removed, use that color
            if (srcIsAdded || tgtIsAdded) {
              colorKey = 'added';
            } else if (srcIsRemoved || tgtIsRemoved) {
              colorKey = 'removed';
            } else {
              colorKey = 'context';
            }
          }

          cellColor = palette[colorKey];
          // Normalize intensity
          if (rowMax[r] > 1) {
            ratio = Math.min(1, (f + b) / rowMax[r]);
          } else {
            const ro = maxOut ? (outDeg[r] / maxOut) : 0;
            const ri = maxIn ? (inDeg[r] / maxIn) : 0;
            ratio = Math.max(ro, ri, 0.5);
          }
        } else if (isUnifiedView && nodeMembership) {
          // Use graph membership for coloring
          const rowMembership = nodeMembership.get(nodes[r]?.id) || [];
          const colMembership = nodeMembership.get(nodes[c]?.id) || [];

          // Determine the color based on which graphs the nodes belong to
          let colorKey;
          if (r === c) {
            // Diagonal - color based on node membership
            if (rowMembership.length === 1) {
              if (rowMembership[0] === 0) colorKey = 'graphAOnly';
              else if (rowMembership[0] === 1) colorKey = 'graphBOnly';
              else colorKey = 'partial';
            } else if (rowMembership.length > 1) {
              colorKey = rowMembership.length === pane.cy.unifiedViewData.paneList.length ? 'shared' : 'partial';
            } else {
              colorKey = 'self';
            }
          } else {
            // Off-diagonal - color based on edge membership
            // If both nodes are in same single graph, use that graph's color
            const commonGraphs = rowMembership.filter(g => colMembership.includes(g));
            if (commonGraphs.length === 1) {
              if (commonGraphs[0] === 0) colorKey = 'graphAOnly';
              else if (commonGraphs[0] === 1) colorKey = 'graphBOnly';
              else colorKey = 'partial';
            } else if (commonGraphs.length > 1) {
              colorKey = 'shared';
            } else if (rowMembership.length === 1 && colMembership.length === 1) {
              // Cross-graph edge - use partial color
              colorKey = 'partial';
            } else {
              colorKey = 'partial';
            }
          }

          cellColor = palette[colorKey];
          // Normalize intensity
          if (rowMax[r] > 1) {
            ratio = Math.min(1, f / rowMax[r]);
          } else {
            const ro = maxOut ? (outDeg[r] / maxOut) : 0;
            const ri = maxIn ? (inDeg[r] / maxIn) : 0;
            ratio = Math.max(ro, ri);
          }
        } else {
          // Normal view: single color for all edges
          if (r === c) {
            // Diagonal: self-loop, normalized by its row
            if (rowMax[r] > 1) {
              ratio = Math.min(1, f / rowMax[r]);
            } else {
              // fallback: degree-based
              const ro = maxOut ? (outDeg[r] / maxOut) : 0;
              const ri = maxIn ? (inDeg[r] / maxIn) : 0;
              ratio = Math.max(ro, ri);
            }
            cellColor = palette.self;
          } else {
            // Off-diagonal: use combined count from both directions
            const totalCount = f + b;
            // Normalize by the maximum of the two source rows
            const maxSource = Math.max(rowMax[r], rowMax[c]);
            if (maxSource > 1) {
              ratio = Math.min(1, totalCount / maxSource);
            } else {
              // fallback: use combined degree
              const ro = maxOut ? (outDeg[r] / maxOut) : 0;
              const ri = maxIn ? (inDeg[c] / maxIn) : 0;
              ratio = Math.max(ro, ri, 0.5);
            }
            cellColor = palette.edge;
          }
        }

        if (cellColor && ratio !== undefined) {
          ctx.fillStyle = toRGBA(cellColor, ratio);
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }

    // Zigzag separator line along the diagonal (thicker dark line)
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    // Start at top-left (0, 0) and draw zigzag along cell edges of the diagonal
    for (let i = 0; i <= n; i++) {
      const pos = i * cell;
      if (i === 0) {
        ctx.moveTo(0, 0);
      } else {
        // Zigzag: horizontal then vertical
        ctx.lineTo(pos, (i - 1) * cell); // horizontal to the right
        ctx.lineTo(pos, pos); // vertical downward
      }
    }
    ctx.stroke();

    ctx.restore();

    // Highlight hovered cell (row/column)
    if (hoveredCell !== null) {
      const { row, col } = hoveredCell;
      ctx.save();
      ctx.translate(originX, originY);
      ctx.fillStyle = 'rgba(100, 100, 100, 0.1)';
      // Highlight row
      ctx.fillRect(0, row * cell, n * cell, cell);
      // Highlight column
      ctx.fillRect(col * cell, 0, cell, n * cell);

      // Draw border around hovered cell
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(col * cell, row * cell, cell, cell);

      ctx.restore();
    }

    // Highlight selected nodes in the matrix
    const selectedIds = new Set();
    const cy = pane.cy;
    cy.nodes(':selected').forEach(node => {
      if (node.data('type') === 's') {
        selectedIds.add(node.data('id'));
      }
    });

    if (selectedIds.size > 0) {
      ctx.save();
      ctx.translate(originX, originY);
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      for (let i = 0; i < n; i++) {
        if (selectedIds.has(nodes[i]?.id)) {
          // Highlight row
          ctx.strokeRect(0, i * cell, n * cell, cell);
          // Highlight column
          ctx.strokeRect(i * cell, 0, cell, n * cell);
        }
      }

      ctx.restore();
    }

    // Labels for rows/columns when cell size is sufficient
    if (cell >= 16 && n <= 200) {
      ctx.save();
      ctx.fillStyle = '#111';
      const fontSize = Math.max(10, Math.min(14, Math.floor(cell * 0.7)));
      ctx.font = `${fontSize}px sans-serif`;
      // Row labels (LEFT of matrix) - right-aligned
      for (let r = 0; r < n; r++) {
        const id = (nodes[r]?.id || '').toString();
        const text = id.length > 12 ? id.slice(0, 12) + '…' : id;
        ctx.textAlign = 'right';
        ctx.fillText(text, originX - 6, originY + r * cell + Math.min(cell - 4, cell * 0.8));
      }
      // Column labels (bottom, rotated) - shifted down with sufficient spacing
      ctx.save();
      ctx.translate(originX, originY + totalSize);
      for (let c = 0; c < n; c++) {
        const id = (nodes[c]?.id || '').toString();
        const text = id.length > 12 ? id.slice(0, 12) + '…' : id;
        ctx.save();
        // Larger spacing downward, depending on font size and cell size
        const offsetDown = Math.max(20, fontSize + 16);
        ctx.translate(c * cell + Math.min(cell - 2, Math.floor(cell * 0.6)), offsetDown);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'left';
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
      ctx.restore();
      ctx.restore();
    }

    // Restore clipping context
    ctx.restore();

    // Compute statistics
    let nonZeroCells = 0;
    let totalDegree = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const f = counts[r * n + c];
        const b = counts[c * n + r];
        if (f > 0 || b > 0) nonZeroCells++;
        if (f > 0) totalDegree++;
      }
    }
    const density = n > 0 ? (nonZeroCells / (n * n) * 100).toFixed(1) : 0;
    const avgDegree = n > 0 ? (totalDegree / n).toFixed(1) : 0;

    // Store statistics in pane for sidebar display
    state.get(pane.id).matrixStats = {
      nodes: n,
      density,
      avgDegree,
      nonZeroCells,
      totalCells: n * n,
    };

    // Update sidebar legend if this is active pane
    updateMatrixLegendInSidebar(pane);

    // Store filter state for sidebar display
    state.get(pane.id).matrixFilters = {
      minDegree: minDegreeFilter,
      showOnlySelected,
    };
  }

  // Observe resize with throttling using requestAnimationFrame to avoid excessive redraws
  let resizeScheduled = false;
  const throttledResize = () => {
    if (resizeScheduled) return;
    resizeScheduled = true;
    requestAnimationFrame(() => {
      resize();
      resizeScheduled = false;
    });
  };

  const ro = new ResizeObserver(() => throttledResize());
  ro.observe(getPaneContainer(pane));

  // Mouse interactions
  canvas.addEventListener('mousemove', (e) => {
    const st = state.get(pane.id);
    if (!st || !st.matrixData) return;
    const { nodes, counts, n } = st.matrixData;
    const { cell, originX, originY } = st.layout;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check if inside matrix bounds
    const relX = mx - originX;
    const relY = my - originY;
    if (relX >= 0 && relY >= 0 && relX < cell * n && relY < cell * n) {
      const col = Math.floor(relX / cell);
      const row = Math.floor(relY / cell);

      // Matrix only renders the lower triangle (row >= col)
      if (row < col) {
        tooltip.style.display = 'none';
        canvas.style.cursor = isDragging ? 'grabbing' : 'default';
        if (hoveredCell !== null) {
          hoveredCell = null;
          clearMatrixHoverNodes();
          emitMatrixHover([]);
          draw();
        }
        return;
      }

      const fwd = counts[row * n + col];
      const bwd = counts[col * n + row];

      // Always update hover state for valid cells (for row/col shading)
      if (!hoveredCell || hoveredCell.row !== row || hoveredCell.col !== col) {
        hoveredCell = { row, col };
        const fromId = nodes[row]?.id;
        const toId = nodes[col]?.id;
        applyMatrixHoverNodes(fromId, toId);
        emitMatrixHover(
          Array.from(new Set([fromId, toId].filter(Boolean))),
          { fromId, toId },
        );
        draw();
      }

      if (fwd > 0 || bwd > 0) {
        const fromNode = nodes[row]?.id || '?';
        const toNode = nodes[col]?.id || '?';
        let text;
        if (row === col) {
          text = `${fromNode} (self-loop: ${fwd})`;
        } else {
          const total = fwd + bwd;
          text = `${fromNode} ↔ ${toNode}: ${total} edge${total > 1 ? 's' : ''}`;
        }

        tooltip.textContent = text;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
        tooltip.style.top = (e.clientY - rect.top + 10) + 'px';
        canvas.style.cursor = 'pointer';
      } else {
        tooltip.style.display = 'none';
        canvas.style.cursor = isDragging ? 'grabbing' : 'default';
      }

      return;
    }

    tooltip.style.display = 'none';
    canvas.style.cursor = isDragging ? 'grabbing' : 'default';
    if (hoveredCell !== null) {
      hoveredCell = null;
      clearMatrixHoverNodes();
      emitMatrixHover([]);
      draw();
    }
  }, { passive: true });

  const onWindowMouseUp = () => {
    if (isDragging) {
      isDragging = false;
      canvas.style.cursor = 'default';
    }
  };
  // Capture-phase so it still fires even if bubbling is stopped on the overlay.
  window.addEventListener('mouseup', onWindowMouseUp, { passive: true, capture: true });
  cleanupCallbacks.push(() => window.removeEventListener('mouseup', onWindowMouseUp, { capture: true }));

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
    isDragging &&= false;
    canvas.style.cursor = 'default';
    if (hoveredCell !== null) {
      hoveredCell = null;
      clearMatrixHoverNodes();
      emitMatrixHover([]);
      draw();
    }
  }, { passive: true });

  canvas.addEventListener('click', (e) => {
    // Always activate this pane when clicking on the matrix
    setPane(pane.id);

    const st = state.get(pane.id);
    if (!st || !st.matrixData) return;
    const { nodes, counts, n } = st.matrixData;
    const { cell, originX, originY } = st.layout;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check if inside matrix bounds
    const relX = mx - originX;
    const relY = my - originY;
    if (relX >= 0 && relY >= 0 && relX < cell * n && relY < cell * n) {
      const col = Math.floor(relX / cell);
      const row = Math.floor(relY / cell);

      // Matrix only renders the lower triangle (row >= col)
      if (row < col) return;

      const cy = pane.cy;
      if (!cy) return;

      // Helper function to toggle node selection
      const toggleNodeSelection = (nodeId) => {
        if (!nodeId) return;

        let el = cy.getElementById(nodeId);
        if (!(el && el.nonempty && el.isNode && el.isNode() && el.data('type') === 's')) {
          el = cy.nodes().filter((n) => n.data('id') === nodeId && n.data('type') === 's');
        }
        const empty = (!el || (el.nonempty !== undefined && !el.nonempty) || (el.length !== undefined && el.length === 0));
        if (empty) return;

        try {
          if (typeof el.selectify === 'function') el.selectify();

          const first = (typeof el[0] !== 'undefined') ? el[0] : el;
          const wasSelected = !!(first?.selected && first.selected());

          if (wasSelected) {
            if (typeof el.unselect === 'function') el.unselect();
          } else if (typeof el.select === 'function') el.select();

          // Emit matrix-selection event for cross-pane synchronization
          const isNowSelected = !wasSelected;
          window.dispatchEvent(events.MATRIX_SELECTION(pane?.id, nodeId, isNowSelected));
        } catch (err) {
          void err;
        }
      };

      // Get the node IDs for row and column
      const rowNodeId = nodes[row]?.id;
      const colNodeId = nodes[col]?.id;

      if (row === col) {
        // Diagonal cell: toggle single node
        toggleNodeSelection(rowNodeId);
      } else {
        // Off-diagonal cell: toggle both nodes
        toggleNodeSelection(rowNodeId);
        if (colNodeId !== rowNodeId) {
          toggleNodeSelection(colNodeId);
        }
      }

      // Ensure canvas updates even if Cytoscape events are batched
      setTimeout(() => draw(), 0);
      return;
    }
  });
  // Zoom with mouse wheel
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const w = canvas.width;
    const h = canvas.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Store old zoom
    const oldZoom = zoomLevel;

    // Calculate new zoom level
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.5, Math.min(5, zoomLevel * zoomFactor));

    // Get matrix size info to calculate origin
    const st = state.get(pane.id);
    const n = st?.matrixData?.n || 1;
    const baseCell = Math.max(1, Math.floor((Math.min(w, h) * 0.9) / n));

    // Calculate current and new matrix sizes
    const oldTotalSize = baseCell * oldZoom * n;
    const newTotalSize = baseCell * newZoom * n;

    // Calculate current origin (center of canvas + pan offset)
    const oldOriginX = Math.floor((w - oldTotalSize) / 2) + panX;
    const oldOriginY = Math.floor((h - oldTotalSize) / 2) + panY;

    // Calculate where the mouse is relative to the matrix origin
    const mouseRelX = mouseX - oldOriginX;
    const mouseRelY = mouseY - oldOriginY;

    // Scale the relative position by the zoom change
    const zoomChange = newZoom / oldZoom;
    const newMouseRelX = mouseRelX * zoomChange;
    const newMouseRelY = mouseRelY * zoomChange;

    // Calculate new center offset
    const newCenterX = Math.floor((w - newTotalSize) / 2);
    const newCenterY = Math.floor((h - newTotalSize) / 2);

    // Adjust panX/panY so that the point under the mouse stays in place
    // newOriginX = newCenterX + panX, and we want mouseX - newOriginX = newMouseRelX
    // So: panX = mouseX - newMouseRelX - newCenterX
    panX = mouseX - newMouseRelX - newCenterX;
    panY = mouseY - newMouseRelY - newCenterY;

    zoomLevel = newZoom;
    draw();
  }, { passive: false });

  // Pan with mouse drag
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // Left mouse button
      isDragging = true;
      dragStartX = e.clientX - panX;
      dragStartY = e.clientY - panY;
      canvas.style.cursor = 'grabbing';
    }
  }, { passive: true });

  canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
      panX = e.clientX - dragStartX;
      panY = e.clientY - dragStartY;
      draw();
      return;
    }

    // Existing hover logic
    const st = state.get(pane.id);
    if (!st || !st.matrixData) return;
    const { nodes, counts, n } = st.matrixData;
    const { cell, originX, originY } = st.layout;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check if inside matrix bounds
    const relX = mx - originX;
    const relY = my - originY;
    if (relX >= 0 && relY >= 0 && relX < cell * n && relY < cell * n) {
      const col = Math.floor(relX / cell);
      const row = Math.floor(relY / cell);

      // Matrix only renders the lower triangle (row >= col)
      if (row < col) {
        tooltip.style.display = 'none';
        canvas.style.cursor = isDragging ? 'grabbing' : 'default';
        if (hoveredCell !== null) {
          hoveredCell = null;
          clearMatrixHoverNodes();
          draw();
        }
        return;
      }

      const fwd = counts[row * n + col];
      const bwd = counts[col * n + row];

      // Always update hover state for valid cells (for row/col shading)
      if (!hoveredCell || hoveredCell.row !== row || hoveredCell.col !== col) {
        hoveredCell = { row, col };
        applyMatrixHoverNodes(nodes[row]?.id, nodes[col]?.id);
        draw();
      }

      if (fwd > 0 || bwd > 0) {
        const fromNode = nodes[row]?.id || '?';
        const toNode = nodes[col]?.id || '?';
        let text;
        if (row === col) {
          text = `${fromNode} (self-loop: ${fwd})`;
        } else {
          const total = fwd + bwd;
          text = `${fromNode} ↔ ${toNode}: ${total} edge${total > 1 ? 's' : ''}`;
        }

        tooltip.textContent = text;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
        tooltip.style.top = (e.clientY - rect.top + 10) + 'px';
        canvas.style.cursor = 'pointer';
      } else {
        tooltip.style.display = 'none';
        canvas.style.cursor = isDragging ? 'grabbing' : 'default';
      }

      return;
    }

    tooltip.style.display = 'none';
    canvas.style.cursor = isDragging ? 'grabbing' : 'default';
    if (hoveredCell !== null) {
      hoveredCell = null;
      clearMatrixHoverNodes();
      draw();
    }
  }, { passive: true });

  // Context menu for matrix view
  let contextMenu = null;

  const hideContextMenu = () => {
    if (contextMenu) {
      contextMenu.remove();
      contextMenu = null;
    }
  };

  const showContextMenu = (e) => {
    e.preventDefault();
    hideContextMenu();

    const cy = pane.cy;
    if (!cy) return;

    // Create context menu
    contextMenu = document.createElement('div');
    contextMenu.className = 'dropdown-menu show';
    Object.assign(contextMenu.style, {
      position: 'fixed',
      left: `${e.clientX}px`,
      top: `${e.clientY}px`,
      zIndex: '10000',
      display: 'block',
    });

    const menuItems = [
      {
        label: 'Fit to view',
        action: () => {
          resetZoom();
          hideContextMenu();
        },
      },
      { divider: true },
      {
        label: 'Collapse/expand pane',
        action: () => {
          const paneDiv = document.getElementById(pane.id);
          if (paneDiv) togglePane(paneDiv);
          hideContextMenu();
        },
      },
      { divider: true },
      {
        label: 'Export Graph',
        action: () => {
          import('../graph/node-link.js').then(module => {
            if (module.exportCy) {
              module.exportCy(cy);
            }
          });
          hideContextMenu();
        },
      },
      { divider: true },
      {
        label: 'Duplicate pane',
        action: () => {
          // Import duplicatePane dynamically to avoid circular dependency
          import('../graph/node-link.js').then(module => {
            if (module.duplicatePane) {
              module.duplicatePane(cy);
            }
          });
          hideContextMenu();
        },
      },
      {
        label: 'Remove pane',
        action: () => {
          if (cy.paneId === 'pane-0') {
            Swal.fire({
              icon: 'error',
              title: 'Oops...',
              text: 'Cannot delete initial pane!',
            });
          } else {
            Swal.fire({
              title: 'Removing Pane(s)',
              text: 'This action cannot be reverted.',
              icon: 'warning',
              showCancelButton: true,
              showDenyButton: true,
              confirmButtonColor: '#d33',
              cancelButtonColor: '#555',
              confirmButtonText: 'Remove Current',
              denyButtonText: 'Remove All From Selected',
            }).then((result) => {
              if (result.isConfirmed) {
                destroyPanes(getPanes()[cy.paneId].id, { firstOnly: true });
              } else if (result.isDenied) {
                destroyPanes(getPanes()[cy.paneId].id);
              }
            });
          }
          hideContextMenu();
        },
      },
    ];

    menuItems.forEach((item) => {
      if (item.divider) {
        const divider = document.createElement('div');
        divider.className = 'dropdown-divider';
        contextMenu.appendChild(divider);
      } else {
        const menuItem = document.createElement('a');
        menuItem.className = 'dropdown-item';
        menuItem.href = '#';
        menuItem.textContent = item.label;
        menuItem.addEventListener('click', (ev) => {
          ev.preventDefault();
          item.action();
        });
        contextMenu.appendChild(menuItem);
      }
    });

    document.body.appendChild(contextMenu);

    // Close menu when clicking outside
    const closeOnClick = (ev) => {
      if (!contextMenu?.contains(ev.target)) {
        hideContextMenu();
        document.removeEventListener('click', closeOnClick);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnClick), 0);
  };

  canvas.addEventListener('contextmenu', showContextMenu);
  cleanupCallbacks.push(() => {
    hideContextMenu();
    canvas.removeEventListener('contextmenu', showContextMenu);
  });

  const resetZoom = () => {
    zoomLevel = 1.0;
    panX = 0;
    panY = 0;
    draw();
  };

  return {
    draw,
    resize,
    destroy: () => {
      clearMatrixHoverNodes();
      cleanupCallbacks.forEach((off) => {
        try { off(); } catch { /* ignore */ }
      });
      ro.disconnect();
    },
    setOrdering: (ord) => { currentOrdering = ord; draw(); },
    getCurrentOrdering: () => currentOrdering,
    resetZoom,
  };
}

function createMultiMatrixLegend(pane, infoBox) {
  const legend = document.createElement('div');
  legend.id = `legend-matrix-${pane.id}`;
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
  title.textContent = 'Multi-Matrix View Legend';
  title.style.cssText = `
    font-weight: bold;
    margin-bottom: 8px;
    font-size: 13px;
    border-bottom: 1px solid #ccc;
    padding-bottom: 5px;
  `;
  legend.appendChild(title);

  // Pane information
  const multiMatrixData = pane.cy.multiMatrixData;
  if (multiMatrixData && multiMatrixData.paneNames) {
    const panesSection = document.createElement('div');
    panesSection.style.cssText = `
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #ddd;
    `;

    const panesTitle = document.createElement('div');
    panesTitle.textContent = 'Compared Panes';
    panesTitle.style.cssText = `
      font-weight: bold;
      margin-bottom: 5px;
      font-size: 11px;
    `;
    panesSection.appendChild(panesTitle);

    multiMatrixData.paneNames.forEach((paneName, idx) => {
      const paneItem = document.createElement('div');
      paneItem.textContent = `${idx === 0 ? 'Lower Triangle' : 'Upper Triangle'}: ${paneName}`;
      paneItem.style.cssText = `
        font-size: 10px;
        color: #333;
        margin: 3px 0;
      `;
      panesSection.appendChild(paneItem);
    });

    legend.appendChild(panesSection);
  }

  infoBox.appendChild(legend);
}

export function updateMatrixLegendInSidebar(pane) {
  const infoBox = document.getElementById('info-box');
  if (!infoBox) return;

  // Check if this is a multi-matrix view
  const isMultiMatrix = pane.cy.multiMatrixData;

  // Only show matrix legend if pane is in matrix view OR is a multi-matrix view
  if (!isMatrixEnabled(pane) && !isMultiMatrix) return;

  // Remove existing matrix legend
  const existing = document.getElementById(`legend-matrix-${pane.id}`);
  if (existing) existing.remove();

  // For multi-matrix views, show simplified legend
  if (isMultiMatrix) {
    createMultiMatrixLegend(pane, infoBox);
    return;
  }

  const st = state.get(pane.id);
  if (!st || !st.matrixStats) return;

  const {
    nodes, density, avgDegree, nonZeroCells, totalCells,
  } = st.matrixStats;

  // Get current ordering from renderer
  const currentOrdering = st.renderer?.getCurrentOrdering ? st.renderer.getCurrentOrdering() : 'id';

  // Create legend container
  const legend = document.createElement('div');
  legend.id = `legend-matrix-${pane.id}`;
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
  title.textContent = 'Matrix View Legend';
  title.style.cssText = `
    font-weight: bold;
    margin-bottom: 8px;
    font-size: 13px;
    border-bottom: 1px solid #ccc;
    padding-bottom: 5px;
  `;
  legend.appendChild(title);

  // Ordering section
  const orderSection = document.createElement('div');
  orderSection.style.cssText = `
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid #ddd;
  `;

  const orderTitle = document.createElement('div');
  orderTitle.textContent = 'Matrix Order';
  orderTitle.style.cssText = `
    font-weight: bold;
    margin-bottom: 5px;
    font-size: 11px;
  `;
  orderSection.appendChild(orderTitle);

  const orderSelect = document.createElement('select');
  orderSelect.style.cssText = `
    width: 100%;
    padding: 6px;
    font-size: 11px;
    border: 1px solid #ccc;
    border-radius: 3px;
    background: white;
  `;

  const orderOptions = [
    { value: 'id', label: 'ID' },
    { value: 'degree', label: 'Degree' },
    { value: 'bfs', label: 'Breadth-First Search' },
  ];

  orderOptions.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (currentOrdering === opt.value) {
      option.selected = true;
    }
    orderSelect.appendChild(option);
  });

  orderSelect.addEventListener('change', () => {
    if (st.renderer && st.renderer.setOrdering) {
      st.renderer.setOrdering(orderSelect.value);
      st.currentOrdering = orderSelect.value;
    }
  });

  orderSection.appendChild(orderSelect);
  legend.appendChild(orderSection);

  // Statistics section (moved to top)
  const statsSection = document.createElement('div');
  statsSection.style.cssText = `
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid #ddd;
  `;

  const statsTitle = document.createElement('div');
  statsTitle.textContent = 'Statistics';
  statsTitle.style.cssText = `
    font-weight: bold;
    margin-bottom: 5px;
    font-size: 11px;
  `;
  statsSection.appendChild(statsTitle);

  const stats = [
    { label: 'Nodes', value: nodes },
    { label: 'Density', value: `${density}%` },
    { label: 'Avg Degree', value: avgDegree },
    { label: 'Non-zero cells', value: `${nonZeroCells} / ${totalCells}` },
  ];

  stats.forEach(({ label, value }) => {
    const statLine = document.createElement('div');
    statLine.textContent = `${label}: ${value}`;
    statLine.style.cssText = `
      font-size: 10px;
      color: #333;
      margin: 3px 0;
    `;
    statsSection.appendChild(statLine);
  });

  legend.appendChild(statsSection);

  // Check if this is a unified view or diff graph
  const isUnifiedView = pane.cy.unifiedViewData && pane.cy.unifiedViewData.paneList;
  const isDiffGraph = pane.cy.isDiffGraph;

  // Color legend items - different for diff graph, unified view, or normal view
  const colorItems = isDiffGraph ? [
    { color: 'rgba(27, 94, 32, 1)', label: 'Added (in Graph 2)' },
    { color: 'rgba(183, 28, 28, 1)', label: 'Removed (in Graph 1)' },
    { color: 'rgba(158, 158, 158, 1)', label: 'Context (unchanged)' },
    { color: 'rgba(110, 110, 110, 1)', label: 'Self-loop (diagonal)' },
  ] : isUnifiedView ? [
    { color: 'rgba(76, 175, 80, 1)', label: 'Added (only in Graph 2)' },
    { color: 'rgba(244, 67, 54, 1)', label: 'Removed (only in Graph 1)' },
    { color: 'rgba(158, 158, 158, 1)', label: 'Unchanged (in both)' },
    { color: 'rgba(110, 110, 110, 1)', label: 'Self-loop (diagonal)' },
  ] : [{ color: 'rgba(43, 140, 255, 1)', label: 'Edge' }, { color: 'rgba(110, 110, 110, 1)', label: 'Self-loop (diagonal)' }];

  colorItems.forEach(({ color, label }) => {
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
      background-color: ${color};
      margin-right: 8px;
      border-radius: 3px;
      flex-shrink: 0;
    `;

    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    labelSpan.style.fontSize = '11px';

    item.appendChild(colorBox);
    item.appendChild(labelSpan);
    legend.appendChild(item);
  });

  // Intensity note
  const intensityNote = document.createElement('div');
  intensityNote.textContent = 'Intensity: darker = higher relative count';
  intensityNote.style.cssText = `
    font-size: 10px;
    color: #666;
    margin-top: 8px;
  `;
  legend.appendChild(intensityNote);

  infoBox.appendChild(legend);
}

function removeMatrixLegendFromSidebar(pane) {
  const existing = document.getElementById(`legend-matrix-${pane.id}`);
  if (existing) existing.remove();
}

function enableMatrixView(pane) {
  if (isMatrixEnabled(pane)) return;
  // Ensure the matrix layer exists before hiding Cytoscape
  ensureMatrixLayer(pane);
  hideCytoscape(pane);

  // Make state nodes selectable so matrix clicks can (de)select them.
  // In node-link view selection may be constrained by mode (s/t); matrix always
  // operates on state nodes, so we temporarily allow selecting them here.
  try {
    const cy = pane.cy;
    cy?.nodes?.('node.s')?.selectable?.(true);
    cy?.nodes?.('node.s')?.selectify?.();
  } catch {
    // ignore
  }

  // Prevent underlying Cytoscape from receiving hover events while matrix is active
  try {
    pane.cy._matrixViewActive = true;
  } catch {
    // ignore
  }

  const renderer = createRenderer(pane);
  state.set(pane.id, { renderer, logOnce: true });
  // Draw after layout tick
  requestAnimationFrame(() => {
    renderer.draw();
    updateMatrixLegendInSidebar(pane);
  });

  // Automatic update on graph changes
  const cy = pane.cy;
  const draw = () => {
    renderer.draw();
    updateMatrixLegendInSidebar(pane);
  };
  cy.on('add', draw);
  cy.on('remove', draw);
  cy.on('data', draw);
  cy.on('select', draw);
  cy.on('unselect', draw);
  // Store listener reference to remove them on disable
  state.get(pane.id).off = () => {
    cy.off('add', draw);
    cy.off('remove', draw);
    cy.off('data', draw);
    cy.off('select', draw);
    cy.off('unselect', draw);
  };
}

function disableMatrixView(pane) {
  if (!isMatrixEnabled(pane)) return;
  const s = state.get(pane.id);
  s?.off?.();
  s?.renderer?.destroy?.();
  const layer = document.getElementById(`${pane.container}-matrix`);
  layer?.remove();
  removeMatrixLegendFromSidebar(pane);
  state.delete(pane.id);
  showCytoscape(pane);

  // Restore selectability based on current mode
  try {
    const cy = pane.cy;
    cy?.nodes?.()?.selectify?.();
    const mode = cy?.vars?.mode?.value;
    if (mode === 's') cy?.$?.('node.t')?.unselectify?.();
    else if (mode === 't') cy?.$?.('node.s')?.unselectify?.();
  } catch {
    // ignore
  }

  // Re-enable Cytoscape pointer events
  try {
    pane.cy._matrixViewActive = false;
  } catch {
    // ignore
  }
}

function isMatrixEnabled(pane) {
  return state.has(pane.id);
}

function rebuildMatrix(pane) {
  const s = state.get(pane.id);
  if (s) s.renderer.draw();
}

function setMatrixOrdering(pane, ordering) {
  const s = state.get(pane.id);
  if (s && s.renderer && s.renderer.setOrdering) {
    s.renderer.setOrdering(ordering);
  }
}

function resetMatrixZoom(pane) {
  const s = state.get(pane.id);
  if (s && s.renderer && s.renderer.resetZoom) {
    s.renderer.resetZoom();
  }
}

export {
  enableMatrixView,
  disableMatrixView,
  isMatrixEnabled,
  rebuildMatrix,
  setMatrixOrdering,
  resetMatrixZoom,
};
