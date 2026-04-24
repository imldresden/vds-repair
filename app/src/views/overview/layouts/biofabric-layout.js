import { h, t } from '../../../utils/utils.js';
import d3 from '../../imports/import-d3.js';
const NODE_SPACING = 80;
const EDGE_SPACING = 60;
const START_OFFSET = 100;
const NODE_SIZE = 8;
const NODE_SIZE_FOR_SELECTION = 12;

const COLOR_EDGE_DEFAULT = '#666';
const COLOR_EDGE_DUPLICATE = '#8e44ad';
const COLOR_EDGE_MERGE = '#e67e22';
const COLOR_EDGE_CONNECTOR = '#999';
const COLOR_NODE_FILL = '#95a5a6';
const COLOR_NODE_STROKE_DEFAULT = '#333';
const COLOR_HIGHLIGHT_SELECTED = '#0066ff';

const STROKE_WIDTH_EDGE_DEFAULT = 2;
const STROKE_WIDTH_EDGE_MERGE = 2.5;
const STROKE_WIDTH_NODE_HOVER = 3;
const STROKE_WIDTH_HIGHLIGHTED = 4;

const OPACITY_EDGE_CONNECTOR_DEFAULT = 0.2;
const OPACITY_EDGE_CONNECTOR_HIGHLIGHTED = 0.5;
const OPACITY_NODE_DEFAULT = 0.8;
const OPACITY_FULL = 1;

const DASH_ARRAY_DUPLICATE_EDGE = '3,3';
const DASH_ARRAY_MERGE_EDGE = '2,3';

function edgeStrokeProps(edgeData) {
  if (edgeData.isDuplicateEdge) {
    return {
      color: COLOR_EDGE_DUPLICATE,
      width: STROKE_WIDTH_EDGE_DEFAULT,
      dash: DASH_ARRAY_DUPLICATE_EDGE,
    };
  }
  if (edgeData.isMergeEdge) {
    return {
      color: COLOR_EDGE_MERGE,
      width: STROKE_WIDTH_EDGE_MERGE,
      dash: DASH_ARRAY_MERGE_EDGE,
    };
  }
  return { color: COLOR_EDGE_DEFAULT, width: STROKE_WIDTH_EDGE_DEFAULT, dash: null };
}

function applyDefaultEdgeStyle(svgLines) {
  const props = edgeStrokeProps(svgLines.edgeData);
  svgLines.mainLine
    .attr('stroke', props.color)
    .attr('stroke-width', props.width)
    .attr('opacity', OPACITY_FULL)
    .classed('edge-svg-selected', false)
    .classed('edge-svg-highlighted', false);
  if (props.dash) svgLines.mainLine.attr('stroke-dasharray', props.dash);
  svgLines.sourceConnector
    .attr('opacity', OPACITY_EDGE_CONNECTOR_DEFAULT)
    .classed('edge-svg-selected', false)
    .classed('edge-svg-highlighted', false);
  svgLines.targetConnector
    .attr('opacity', OPACITY_EDGE_CONNECTOR_DEFAULT)
    .classed('edge-svg-selected', false)
    .classed('edge-svg-highlighted', false);
}

function applySelectedEdgeStyle(svgLines) {
  svgLines.mainLine
    .attr('stroke', COLOR_HIGHLIGHT_SELECTED)
    .attr('stroke-width', STROKE_WIDTH_HIGHLIGHTED)
    .attr('opacity', OPACITY_FULL)
    .classed('edge-svg-selected', true);
  const props = edgeStrokeProps(svgLines.edgeData);
  if (svgLines.edgeData.isMergeEdge || svgLines.edgeData.isDuplicateEdge) {
    svgLines.mainLine.attr('stroke-dasharray', props.dash);
  }
  svgLines.sourceConnector
    .attr('opacity', OPACITY_EDGE_CONNECTOR_HIGHLIGHTED)
    .classed('edge-svg-selected', true);
  svgLines.targetConnector
    .attr('opacity', OPACITY_EDGE_CONNECTOR_HIGHLIGHTED)
    .classed('edge-svg-selected', true);
}

function applyHighlightedEdgeStyle(svgLines) {
  svgLines.mainLine
    .attr('stroke-width', STROKE_WIDTH_HIGHLIGHTED)
    .attr('opacity', OPACITY_FULL)
    .classed('edge-svg-highlighted', true);
  svgLines.sourceConnector
    .attr('opacity', OPACITY_EDGE_CONNECTOR_HIGHLIGHTED)
    .classed('edge-svg-highlighted', true);
  svgLines.targetConnector
    .attr('opacity', OPACITY_EDGE_CONNECTOR_HIGHLIGHTED)
    .classed('edge-svg-highlighted', true);
}

function isEdgeForNode(edge, nodeId) {
  return edge.sourceId === nodeId || edge.targetId === nodeId;
}

function getTopmostEdge(edges) {
  return edges.reduce((min, e) => (e.edgeRowY < min.edgeRowY ? e : min));
}

function getBottommostEdge(edges) {
  return edges.reduce((max, e) => (e.edgeRowY > max.edgeRowY ? e : max));
}

export function applyBioFabricLayout(
  graphDataStore,
  socket,
) {
  const nodes = graphDataStore.getAllNodes();
  const edges = graphDataStore.getAllEdges();

  if (nodes.length === 0) {
    return;
  }

  const cyContainer = document.getElementById('cy-overview');
  if (cyContainer) {
    cyContainer.style.display = 'none';
  }

  const layoutContainer = document.getElementById('biofabric-layout-container');
  const leftPanel = document.getElementById('biofabric-graph-panel');
  const svgContainer = document.getElementById('d3-biofabric-container');
  const rightPanel = document.getElementById('biofabric-edge-boxes-panel');

  if (!layoutContainer || !leftPanel || !svgContainer || !rightPanel) {
    console.error('Biofabric layout containers not found');
    return;
  }

  let horizontalScrollWrapper = document.getElementById('biofabric-horizontal-scroll-wrapper');
  if (!horizontalScrollWrapper) {
    horizontalScrollWrapper = h('div', {
      id: 'biofabric-horizontal-scroll-wrapper',
      class: 'biofabric-horizontal-scroll-wrapper',
    }, []);
    if (svgContainer && svgContainer.parentElement === leftPanel) {
      leftPanel.removeChild(svgContainer);
    }
    leftPanel.appendChild(horizontalScrollWrapper);
  }

  let fixedNodesContainer = document.getElementById('biofabric-fixed-nodes-container');
  if (!fixedNodesContainer) {
    fixedNodesContainer = h('div', {
      id: 'biofabric-fixed-nodes-container',
      class: 'biofabric-fixed-nodes-container',
    }, []);
    layoutContainer.insertBefore(fixedNodesContainer, leftPanel);
  } else if (fixedNodesContainer.parentElement !== layoutContainer) {
    if (fixedNodesContainer.parentElement) {
      fixedNodesContainer.parentElement.removeChild(fixedNodesContainer);
    }
    layoutContainer.insertBefore(fixedNodesContainer, leftPanel);
  }

  if (svgContainer && svgContainer.parentElement !== horizontalScrollWrapper) {
    if (svgContainer.parentElement) {
      svgContainer.parentElement.removeChild(svgContainer);
    }
    horizontalScrollWrapper.appendChild(svgContainer);
  }

  fixedNodesContainer.innerHTML = '';
  fixedNodesContainer.style.display = 'block';
  svgContainer.innerHTML = '';
  svgContainer.style.display = 'block';

  const markersContainer = document.getElementById('biofabric-graph-markers');
  if (markersContainer) {
    markersContainer.innerHTML = '';
  }

  const originalNodes = nodes.filter(n => !n.isBioFabricIntermediate);

  const sortedNodes = originalNodes.sort((a, b) => {
    const levelA = a.level || 0;
    const levelB = b.level || 0;
    if (levelA !== levelB) {
      return levelA - levelB;
    }
    const itemA = a.item || 0;
    const itemB = b.item || 0;
    return itemA - itemB;
  });

  const sortedEdges = edges.filter(e => !e.isBioFabricEdge);

  let contentWidth;
  let contentHeight;
  let totalWidth;
  let totalHeight;
  let edgeData;
  let edgeNodeData;

  const numNodes = sortedNodes.length;
  const numEdgeRows = sortedEdges.length;

  contentWidth = START_OFFSET + numNodes * NODE_SPACING + START_OFFSET;
  contentHeight = START_OFFSET + (numEdgeRows + 1) * EDGE_SPACING + 200;
  totalWidth = contentWidth;
  totalHeight = Math.max(contentHeight, window.innerHeight + 500);

  edgeData = sortedEdges
    .map((edge, originalIndex) => {
      const sourceNode = graphDataStore.getNode(edge.source);
      const targetNode = graphDataStore.getNode(edge.target);
      const sourceIndex = sortedNodes.findIndex(n => n.id === edge.source);
      const targetIndex = sortedNodes.findIndex(n => n.id === edge.target);

      if (sourceIndex === -1 || targetIndex === -1 || !sourceNode || !targetNode) {
        return null;
      }

      const edgeRowY = START_OFFSET + (originalIndex + 1) * EDGE_SPACING;
      const sourceColX = START_OFFSET + sourceIndex * NODE_SPACING;
      const targetColX = START_OFFSET + targetIndex * NODE_SPACING;

      const isDuplicateEdge = targetNode.id.includes('DUPLICATE');

      return {
        id: edge.id,
        sourceId: sourceNode.id,
        targetId: targetNode.id,
        edgeRowY: edgeRowY,
        sourceColX: sourceColX,
        targetColX: targetColX,
        sourceIndex: sourceIndex,
        targetIndex: targetIndex,
        edgeIndex: originalIndex,
        isMergeEdge: edge.classes === 'merge-edge' || edge.classes?.includes('merge-edge'),
        isDuplicateEdge: isDuplicateEdge,
      };
    })
    .filter(e => e !== null)
    .map((edge, filteredIndex) => {
      edge.edgeRowY = START_OFFSET + (filteredIndex + 1) * EDGE_SPACING;
      return edge;
    });

  edgeNodeData = [];
  edgeData.forEach(edge => {
    edgeNodeData.push({
      x: edge.sourceColX,
      y: edge.edgeRowY,
      edgeId: edge.id,
      isSource: true,
    });
    edgeNodeData.push({
      x: edge.targetColX,
      y: edge.edgeRowY,
      edgeId: edge.id,
      isSource: false,
    });
  });

  const fixedSvgSelection = d3.select(fixedNodesContainer);
  fixedSvgSelection.selectAll('svg').remove();

  const fixedSvg = fixedSvgSelection
    .append('svg')
    .attr('width', totalWidth)
    .attr('height', START_OFFSET + 20) // Height for the fixed nodes row
    .attr('viewBox', `0 0 ${totalWidth} ${START_OFFSET + 20}`)
    .style('position', 'sticky')
    .style('top', '0')
    .style('z-index', '100')
    .style('pointer-events', 'all')
    .style('background-color', 'white')
    .style('width', `${totalWidth}px`)
    .style('min-width', `${totalWidth}px`);

  const fixedG = fixedSvg.append('g');

  const svgSelection = d3.select(svgContainer);
  svgSelection.selectAll('svg').remove();

  const svg = svgSelection
    .append('svg')
    .attr('width', totalWidth)
    .attr('height', totalHeight)
    .attr('viewBox', `0 0 ${totalWidth} ${totalHeight}`)
    .style('position', 'relative')
    .style('pointer-events', 'all')
    .style('width', `${totalWidth}px`)
    .style('min-width', `${totalWidth}px`);

  const g = svg.append('g');

  const edgeSvgLines = new Map();
  const nodeSvgElements = new Map();
  const highlightedEdgesForNodes = new Set();
  const highlightedNodesForEdges = new Set();
  const selectedEdgesForHighlighting = new Set();
  const mergeConnectingLines = new Map();

  edgeData.forEach(edge => {
    const isMergeEdge = edge.isMergeEdge;
    const isDuplicateEdge = edge.isDuplicateEdge;
    const {
      color: mainStrokeColor,
      width: mainStrokeWidth,
      dash: mainStrokeDashArray,
    } = edgeStrokeProps({ isDuplicateEdge, isMergeEdge });
    const sourceConnector = g.append('line')
      .attr('x1', edge.sourceColX)
      .attr('y1', START_OFFSET)
      .attr('x2', edge.sourceColX)
      .attr('y2', edge.edgeRowY)
      .attr('stroke', COLOR_EDGE_CONNECTOR)
      .attr('stroke-width', STROKE_WIDTH_EDGE_DEFAULT)
      .attr('opacity', OPACITY_EDGE_CONNECTOR_DEFAULT)
      .attr('class', 'edge-connector')
      .attr('data-edge-id', edge.id);

    const mainLine = g.append('line')
      .attr('x1', edge.sourceColX)
      .attr('y1', edge.edgeRowY)
      .attr('x2', edge.targetColX)
      .attr('y2', edge.edgeRowY)
      .attr('stroke', mainStrokeColor)
      .attr('stroke-width', mainStrokeWidth)
      .attr('class', 'edge-main-line')
      .attr('data-edge-id', edge.id);

    if (mainStrokeDashArray) mainLine.attr('stroke-dasharray', mainStrokeDashArray);
    const targetConnector = g.append('line')
      .attr('x1', edge.targetColX)
      .attr('y1', edge.edgeRowY)
      .attr('x2', edge.targetColX)
      .attr('y2', START_OFFSET)
      .attr('stroke', COLOR_EDGE_CONNECTOR)
      .attr('stroke-width', STROKE_WIDTH_EDGE_DEFAULT)
      .attr('opacity', OPACITY_EDGE_CONNECTOR_DEFAULT)
      .attr('class', 'edge-connector')
      .attr('data-edge-id', edge.id);

    edgeSvgLines.set(edge.id, {
      mainLine,
      sourceConnector,
      targetConnector,
      edgeData: edge,
    });
  });

  const mergeEdgesByTargetForConnection = {};
  edgeData.forEach(edge => {
    if (edge.isMergeEdge) {
      const targetId = edge.targetId;
      mergeEdgesByTargetForConnection[targetId] ||= [];
      mergeEdgesByTargetForConnection[targetId].push(edge);
    }
  });

  Object.keys(mergeEdgesByTargetForConnection).forEach(targetId => {
    const allEdges = mergeEdgesByTargetForConnection[targetId];
    if (allEdges.length < 2) return;

    const sortedEdges = allEdges.sort((a, b) => a.edgeIndex - b.edgeIndex);

    const mergeActions = [];
    let currentAction = [];
    let currentSources = new Set();

    for (let i = 0; i < sortedEdges.length; i += 1) {
      const edge = sortedEdges[i];
      const sourceId = edge.sourceId;

      if (currentSources.has(sourceId) && currentAction.length > 0) {
        mergeActions.push(currentAction);
        currentAction = [edge];
        currentSources = new Set([sourceId]);
      } else {
        currentAction.push(edge);
        currentSources.add(sourceId);
      }
    }
    if (currentAction.length > 0) {
      mergeActions.push(currentAction);
    }

    if (!mergeConnectingLines.has(targetId)) {
      mergeConnectingLines.set(targetId, []);
    }

    mergeActions.forEach(action => {
      if (action.length < 2) return;

      const sortedAction = action.sort((a, b) => a.edgeIndex - b.edgeIndex);
      const numLines = Math.min(3, sortedAction.length - 1);

      for (let i = 0; i < numLines; i += 1) {
        const edge1 = sortedAction[i];
        const edge2 = sortedAction[i + 1];

        const x1 = edge1.sourceColX;
        const y1 = edge1.edgeRowY;
        const x2 = edge2.sourceColX;
        const y2 = edge2.edgeRowY;

        const connectingLine = g.append('line')
          .attr('x1', x1)
          .attr('y1', y1)
          .attr('x2', x2)
          .attr('y2', y2)
          .attr('stroke', COLOR_EDGE_MERGE)
          .attr('stroke-width', STROKE_WIDTH_EDGE_MERGE)
          .attr('stroke-dasharray', DASH_ARRAY_MERGE_EDGE)
          .attr('class', 'merge-connecting-line')
          .attr('data-target-id', targetId);

        mergeConnectingLines.get(targetId).push(connectingLine);
      }
    });
  });

  sortedNodes.forEach((node, nodeIndex) => {
    const colX = START_OFFSET + nodeIndex * NODE_SPACING;
    const nodeY = START_OFFSET;
    graphDataStore.updateNode(node.id, { position: { x: colX, y: nodeY } });
  });

  const nodeLabelData = [];
  const edgeLabelData = [];

  sortedNodes.forEach((node, nodeIndex) => {
    const colX = START_OFFSET + nodeIndex * NODE_SPACING;
    const label = node.label || node.id;
    nodeLabelData.push({
      x: colX,
      y: START_OFFSET,
      label: label,
      nodeId: node.id,
    });
  });

  edgeData.forEach(edge => {
    const edgeObj = sortedEdges.find(e => e.id === edge.id);
    const label = edgeObj ? (edgeObj.label || edge.id) : edge.id;
    const midX = (edge.sourceColX + edge.targetColX) / 2;
    edgeLabelData.push({
      x: midX,
      y: edge.edgeRowY,
      label: label,
      edgeId: edge.id,
      isMergeEdge: edge.isMergeEdge,
      targetId: edge.targetId,
    });
  });

  const edgeNodeSelection = g.selectAll('g.edge-node')
    .data(edgeNodeData)
    .enter()
    .append('g')
    .attr('class', 'edge-node')
    .attr('transform', d => `translate(${d.x},${d.y})`);

  edgeNodeSelection.append('rect')
    .attr('width', NODE_SIZE)
    .attr('height', NODE_SIZE)
    .attr('x', -NODE_SIZE / 2)
    .attr('y', -NODE_SIZE / 2)
    .attr('fill', COLOR_NODE_FILL)
    .attr('stroke', COLOR_NODE_STROKE_DEFAULT)
    .attr('stroke-width', STROKE_WIDTH_EDGE_DEFAULT)
    .attr('rx', 2);

  const rowMarkers = new Map();
  const columnMarkers = new Map();

  if (markersContainer) {
    edgeData.forEach((edge, index) => {
      const rowY = edge.edgeRowY;

      const leftChevron = h('i', {
        class: 'fa-solid fa-circle-chevron-right row-marker row-marker-left',
        style: `
          position: absolute;
          left: 0;
          top: ${rowY}px;
          transform: translateY(-50%);
          color: #666;
          font-size: 24px;
          pointer-events: auto;
          cursor: pointer;
          z-index: 10;
          display: none;
        `,
        'data-edge-id': edge.id,
        'data-row-index': index,
      }, []);

      const rightChevron = h('i', {
        class: 'fa-solid fa-circle-chevron-left row-marker row-marker-right',
        style: `
          position: absolute;
          right: 0;
          top: ${rowY}px;
          transform: translateY(-50%);
          color: #666;
          font-size: 24px;
          pointer-events: auto;
          cursor: pointer;
          z-index: 10;
          display: none;
        `,
        'data-edge-id': edge.id,
        'data-row-index': index,
      }, []);

      leftChevron.addEventListener('click', () => {
        if (leftPanel) {
          const edgeLeft = Math.min(edge.sourceColX, edge.targetColX);
          const edgeRight = Math.max(edge.sourceColX, edge.targetColX);
          const edgeWidth = edgeRight - edgeLeft;
          const panelWidth = leftPanel.getBoundingClientRect().width;
          let targetScroll;
          if (edgeWidth < panelWidth) {
            targetScroll = edgeLeft - (panelWidth - edgeWidth) / 2;
          } else {
            targetScroll = edgeLeft - 50; // Small padding
          }

          leftPanel.scrollTo({
            left: Math.max(0, targetScroll),
            behavior: 'smooth',
          });
        }
      });

      rightChevron.addEventListener('click', () => {
        if (leftPanel) {
          const edgeLeft = Math.min(edge.sourceColX, edge.targetColX);
          const edgeRight = Math.max(edge.sourceColX, edge.targetColX);
          const edgeWidth = edgeRight - edgeLeft;
          const panelWidth = leftPanel.getBoundingClientRect().width;
          let targetScroll;
          if (edgeWidth < panelWidth) {
            targetScroll = edgeLeft - (panelWidth - edgeWidth) / 2;
          } else {
            targetScroll = edgeLeft - 50; // Small padding
          }

          leftPanel.scrollTo({
            left: Math.max(0, targetScroll),
            behavior: 'smooth',
          });
        }
      });

      markersContainer.appendChild(leftChevron);
      markersContainer.appendChild(rightChevron);

      rowMarkers.set(edge.id, {
        leftChevron,
        rightChevron,
        edge,
      });
    });
  }
  const checkEdgeVisibility = (edge) => {
    if (!leftPanel) return { isVisible: true, side: null };

    const panelRect = leftPanel.getBoundingClientRect();
    const scrollLeft = leftPanel.scrollLeft;
    const viewportLeft = scrollLeft;
    const viewportRight = scrollLeft + panelRect.width;

    const edgeLeft = Math.min(edge.sourceColX, edge.targetColX);
    const edgeRight = Math.max(edge.sourceColX, edge.targetColX);

    const isAnyPartVisible = !(edgeRight < viewportLeft || edgeLeft > viewportRight);

    if (isAnyPartVisible) {
      return { isVisible: true, side: null };
    }
    if (edgeRight < viewportLeft) {
      return { isVisible: false, side: 'left' };
    } else {
      return { isVisible: false, side: 'right' };
    }
  };
  const updateArrowVisibility = () => {
    rowMarkers.forEach((markers) => {
      const { leftChevron, rightChevron, edge } = markers;
      const { isVisible, side } = checkEdgeVisibility(edge);

      if (isVisible) {
        leftChevron.style.display = 'none';
        rightChevron.style.display = 'none';
      } else if (side === 'left') {
        leftChevron.style.display = 'block';
        rightChevron.style.display = 'none';
      } else if (side === 'right') {
        leftChevron.style.display = 'none';
        rightChevron.style.display = 'block';
      }
    });

    if (!layoutContainer) {
      return;
    }

    const scrollTop = layoutContainer.scrollTop;
    const viewportHeight = layoutContainer.getBoundingClientRect().height;
    const viewportTop = scrollTop;
    const viewportBottom = scrollTop + viewportHeight;

    columnMarkers.forEach((markers, nodeId) => {
      const { topChevron, bottomChevron } = markers;

      const nodeEdges = edgeData.filter(edge => isEdgeForNode(edge, nodeId));

      if (nodeEdges.length === 0) {
        topChevron.style.display = 'none';
        bottomChevron.style.display = 'none';
        return;
      }

      const hasEdgesAbove = nodeEdges.some(edge => edge.edgeRowY < viewportTop);

      const hasEdgesBelow = nodeEdges.some(edge => edge.edgeRowY > viewportBottom);

      topChevron.style.display = hasEdgesAbove ? 'block' : 'none';

      bottomChevron.style.display = hasEdgesBelow ? 'block' : 'none';
    });
  };

  fixedG.selectAll('g.biofabric-node').remove();

  const fixedNodeSelection = fixedG.selectAll('g.biofabric-node')
    .data(nodeLabelData)
    .enter()
    .append('g')
    .attr('class', 'biofabric-node')
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .attr('data-node-id', d => d.nodeId)
    .style('cursor', 'pointer')
    .style('pointer-events', 'all');

  fixedNodeSelection.each(function setNodeSvgElement(d) {
    nodeSvgElements.set(d.nodeId, d3.select(this));
  });

  fixedNodeSelection.append('rect')
    .attr('width', NODE_SIZE_FOR_SELECTION)
    .attr('height', NODE_SIZE_FOR_SELECTION)
    .attr('x', -NODE_SIZE_FOR_SELECTION / 2)
    .attr('y', -NODE_SIZE_FOR_SELECTION / 2)
    .attr('fill', COLOR_NODE_FILL)
    .attr('stroke', COLOR_NODE_STROKE_DEFAULT)
    .attr('stroke-width', STROKE_WIDTH_EDGE_DEFAULT)
    .attr('rx', 2)
    .attr('opacity', OPACITY_NODE_DEFAULT);

  g.selectAll('g.biofabric-node').remove();

  const nodeSelection = g.selectAll('g.biofabric-node')
    .data(nodeLabelData)
    .enter()
    .append('g')
    .attr('class', 'biofabric-node')
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .attr('data-node-id', d => d.nodeId)
    .style('cursor', 'pointer')
    .style('pointer-events', 'none') // Disable pointer events on main SVG nodes
    .style('opacity', 0); // Make invisible but keep for alignment

  nodeSelection.append('rect')
    .attr('width', NODE_SIZE_FOR_SELECTION)
    .attr('height', NODE_SIZE_FOR_SELECTION)
    .attr('x', -NODE_SIZE_FOR_SELECTION / 2)
    .attr('y', -NODE_SIZE_FOR_SELECTION / 2)
    .attr('fill', COLOR_NODE_FILL)
    .attr('stroke', COLOR_NODE_STROKE_DEFAULT)
    .attr('stroke-width', STROKE_WIDTH_EDGE_DEFAULT)
    .attr('rx', 2)
    .attr('opacity', 0);

  const highlightedNodes = new Set();

  let deselectAllEdgeBoxes = () => {};

  fixedNodeSelection.on('click', (event, d) => {
    const nativeEvent = event.sourceEvent || event;
    const isShiftPressed = nativeEvent.shiftKey || false;

    event.stopPropagation();
    event.preventDefault();

    const nodeData = graphDataStore.getNode(d.nodeId);
    if (!nodeData) {
      return;
    }

    deselectAllEdgeBoxes();

    selectedEdgesForHighlighting.forEach(edgeId => {
      const svgLines = edgeSvgLines.get(edgeId);
      if (svgLines) applyDefaultEdgeStyle(svgLines);
      highlightNodesForEdge(edgeId, false);
    });
    selectedEdgesForHighlighting.clear();

    if (isShiftPressed) {
      graphDataStore.selectNode(d.nodeId, true);
    } else {
      const currentSelection = graphDataStore.getSelectedNodeIds();
      if (currentSelection.length === 1 && currentSelection[0] === d.nodeId) {
        graphDataStore.unselectNode(d.nodeId);
      } else {
        graphDataStore.selectNode(d.nodeId, false);
      }
    }

    const selectedNodeIDs = graphDataStore.getSelectedNodeIds();

    if (socket) {
      socket.emit('overview nodes selected', selectedNodeIDs);
      socket.emit('overview node clicked', d.nodeId);
    }

    selectedNodeIDs.forEach(nodeId => {
      highlightedNodes.add(nodeId);
      highlightEdgesForNode(nodeId, true);
    });

    graphDataStore.getAllNodes().forEach(node => {
      if (!graphDataStore.isNodeSelected(node.id) && highlightedNodes.has(node.id)) {
        highlightedNodes.delete(node.id);
        highlightEdgesForNode(node.id, false);
      }
    });

    updateNodeAppearance();
  });

  const handleMouseOver = function handleMouseOver() {
    const rect = d3.select(this).select('rect');
    rect.attr('stroke', COLOR_HIGHLIGHT_SELECTED)
      .attr('stroke-width', STROKE_WIDTH_NODE_HOVER)
      .attr('opacity', OPACITY_FULL);
  };
  fixedNodeSelection.on('mouseover', handleMouseOver);

  const handleMouseOut = function handleMouseOut(event, d) {
    const isSelected = graphDataStore.isNodeSelected(d.nodeId);
    const isHighlighted = highlightedNodes.has(d.nodeId);
    const rect = d3.select(this).select('rect');

    if (isSelected || isHighlighted) {
      rect.attr('stroke', COLOR_HIGHLIGHT_SELECTED)
        .attr('stroke-width', STROKE_WIDTH_NODE_HOVER)
        .attr('opacity', OPACITY_FULL);
    } else {
      rect.attr('stroke', COLOR_NODE_STROKE_DEFAULT)
        .attr('stroke-width', STROKE_WIDTH_EDGE_DEFAULT)
        .attr('opacity', OPACITY_NODE_DEFAULT);
    }
  };
  fixedNodeSelection.on('mouseout', handleMouseOut);

  const updateNodeAppearance = () => {
    const updateEachNode = function updateEachNode(d) {
      const isSelected = graphDataStore.isNodeSelected(d.nodeId);
      const isHighlighted = highlightedNodes.has(d.nodeId);
      const rect = d3.select(this).select('rect');

      if (isSelected || isHighlighted) {
        rect.attr('stroke', COLOR_HIGHLIGHT_SELECTED)
          .attr('stroke-width', STROKE_WIDTH_NODE_HOVER)
          .attr('opacity', OPACITY_FULL);
      } else {
        rect.attr('stroke', COLOR_NODE_STROKE_DEFAULT)
          .attr('stroke-width', STROKE_WIDTH_EDGE_DEFAULT)
          .attr('opacity', OPACITY_NODE_DEFAULT);
      }
    };
    fixedNodeSelection.each(updateEachNode);
  };

  const highlightEdgesForNode = (nodeId, highlight = true) => {
    const connectedEdges = graphDataStore.getEdgesForNode(nodeId);

    connectedEdges.forEach(edge => {
      const edgeId = edge.id;
      const svgLines = edgeSvgLines.get(edgeId);
      if (!svgLines) return;
      const notSelected = !selectedEdgesForHighlighting.has(edgeId);
      if (highlight && notSelected) {
        applyHighlightedEdgeStyle(svgLines);
        highlightedEdgesForNodes.add(edgeId);
      } else if (!highlight && notSelected) {
        applyDefaultEdgeStyle(svgLines);
        highlightedEdgesForNodes.delete(edgeId);
      }
    });
  };

  const highlightNodesForEdge = (edgeId, highlight = true) => {
    const edge = graphDataStore.getEdge(edgeId);
    if (!edge || !edge.source || !edge.target) {
      return;
    }

    const sourceId = edge.source;
    const targetId = edge.target;

    [sourceId, targetId].forEach(nodeId => {
      const svgNode = nodeSvgElements.get(nodeId);
      if (svgNode) {
        const rect = svgNode.select('rect');
        if (highlight) {
          if (!graphDataStore.isNodeSelected(nodeId)) {
            rect.attr('stroke', COLOR_HIGHLIGHT_SELECTED)
              .attr('stroke-width', STROKE_WIDTH_HIGHLIGHTED)
              .attr('opacity', OPACITY_FULL)
              .classed('node-svg-highlighted', true);
            highlightedNodesForEdges.add(nodeId);
          }
        } else {
          const isSelected = graphDataStore.isNodeSelected(nodeId);
          const isHighlighted = highlightedNodes.has(nodeId);

          if (!isSelected && !isHighlighted) {
            rect.attr('stroke', COLOR_NODE_STROKE_DEFAULT)
              .attr('stroke-width', STROKE_WIDTH_EDGE_DEFAULT)
              .attr('opacity', OPACITY_NODE_DEFAULT);
            rect.classed('node-svg-highlighted', false);
            highlightedNodesForEdges.delete(nodeId);
          } else if (isSelected || isHighlighted) {
            rect.attr('stroke', COLOR_HIGHLIGHT_SELECTED)
              .attr('stroke-width', STROKE_WIDTH_NODE_HOVER)
              .attr('opacity', OPACITY_FULL);
            rect.classed('node-svg-highlighted', false);
            highlightedNodesForEdges.delete(nodeId);
          }
        }
      }
    });
  };

  const highlightMergeEdges = (edgeIds, highlight = true) => {
    const targetIds = new Set();

    edgeIds.forEach(edgeId => {
      const svgLines = edgeSvgLines.get(edgeId);
      if (svgLines) {
        if (highlight) {
          applySelectedEdgeStyle(svgLines);
          selectedEdgesForHighlighting.add(edgeId);
          if (svgLines.edgeData.isMergeEdge) {
            targetIds.add(svgLines.edgeData.targetId);
          }
        } else {
          applyDefaultEdgeStyle(svgLines);
          selectedEdgesForHighlighting.delete(edgeId);
          if (svgLines.edgeData.isMergeEdge) {
            targetIds.add(svgLines.edgeData.targetId);
          }
        }
      }
    });

    targetIds.forEach(targetId => {
      const connectingLines = mergeConnectingLines.get(targetId);
      if (connectingLines) {
        connectingLines.forEach(connectingLine => {
          if (highlight) {
            connectingLine
              .attr('stroke', COLOR_HIGHLIGHT_SELECTED)
              .attr('stroke-width', STROKE_WIDTH_HIGHLIGHTED)
              .attr('opacity', OPACITY_FULL)
              .classed('merge-connecting-line-selected', true);
          } else {
            connectingLine
              .attr('stroke', COLOR_EDGE_MERGE)
              .attr('stroke-width', STROKE_WIDTH_EDGE_MERGE)
              .attr('opacity', OPACITY_FULL)
              .attr('stroke-dasharray', DASH_ARRAY_MERGE_EDGE)
              .classed('merge-connecting-line-selected', false);
          }
        });
      }
    });
  };

  const clearCorrespondenceHighlights = () => {
    highlightedEdgesForNodes.forEach(edgeId => {
      const svgLines = edgeSvgLines.get(edgeId);
      if (svgLines && !selectedEdgesForHighlighting.has(edgeId)) {
        const edgeData = svgLines.edgeData;
        const isMergeEdge = edgeData.isMergeEdge;
        const isDuplicateEdge = edgeData.isDuplicateEdge;

        let mainStrokeColor = COLOR_EDGE_DEFAULT;
        let mainStrokeWidth = STROKE_WIDTH_EDGE_DEFAULT;
        let mainStrokeDashArray = null;

        if (isDuplicateEdge) {
          mainStrokeColor = COLOR_EDGE_DUPLICATE;
          mainStrokeWidth = STROKE_WIDTH_EDGE_DEFAULT;
          mainStrokeDashArray = DASH_ARRAY_DUPLICATE_EDGE;
        } else if (isMergeEdge) {
          mainStrokeColor = COLOR_EDGE_MERGE;
          mainStrokeWidth = STROKE_WIDTH_EDGE_MERGE;
          mainStrokeDashArray = DASH_ARRAY_MERGE_EDGE;
        }

        svgLines.mainLine
          .attr('stroke', mainStrokeColor)
          .attr('stroke-width', mainStrokeWidth)
          .attr('opacity', OPACITY_FULL)
          .classed('edge-svg-highlighted', false);
        if (mainStrokeDashArray) {
          svgLines.mainLine.attr('stroke-dasharray', mainStrokeDashArray);
        }
        svgLines.sourceConnector
          .attr('opacity', OPACITY_EDGE_CONNECTOR_DEFAULT)
          .classed('edge-svg-highlighted', false);
        svgLines.targetConnector
          .attr('opacity', OPACITY_EDGE_CONNECTOR_DEFAULT)
          .classed('edge-svg-highlighted', false);
      }
    });
    highlightedEdgesForNodes.clear();

    highlightedNodesForEdges.forEach(nodeId => {
      const svgNode = nodeSvgElements.get(nodeId);
      if (svgNode) {
        const isSelected = graphDataStore.isNodeSelected(nodeId);
        const isHighlighted = highlightedNodes.has(nodeId);

        if (!isSelected && !isHighlighted) {
          const rect = svgNode.select('rect');
          rect.attr('stroke', COLOR_NODE_STROKE_DEFAULT)
            .attr('stroke-width', STROKE_WIDTH_EDGE_DEFAULT)
            .attr('opacity', OPACITY_NODE_DEFAULT);
          rect.classed('node-svg-highlighted', false);
        }
      }
    });
    highlightedNodesForEdges.clear();

    const targetIdsToClear = new Set();
    const edgesToClear = Array.from(selectedEdgesForHighlighting);
    edgesToClear.forEach(edgeId => {
      const svgLines = edgeSvgLines.get(edgeId);
      if (svgLines) {
        applyDefaultEdgeStyle(svgLines);
        if (svgLines.edgeData.isMergeEdge) targetIdsToClear.add(svgLines.edgeData.targetId);
      }
      highlightNodesForEdge(edgeId, false);
    });
    selectedEdgesForHighlighting.clear();

    targetIdsToClear.forEach(targetId => {
      const connectingLines = mergeConnectingLines.get(targetId);
      if (connectingLines) {
        connectingLines.forEach(connectingLine => {
          connectingLine
            .attr('stroke', COLOR_EDGE_MERGE)
            .attr('stroke-width', STROKE_WIDTH_EDGE_MERGE)
            .attr('opacity', OPACITY_FULL)
            .attr('stroke-dasharray', DASH_ARRAY_MERGE_EDGE)
            .classed('merge-connecting-line-selected', false);
        });
      }
    });
  };

  svg.on('click', function svgRootClick(event) {
    const target = event.target;
    const svgNode = svg.node();

    if (target === svgNode && target.tagName === 'svg') {
      deselectAllEdgeBoxes();
      graphDataStore.clearSelection();
      clearCorrespondenceHighlights();
      highlightedNodes.clear();
      updateNodeAppearance();
      if (socket) {
        socket.emit('overview nodes selected', []);
      }
    }
  });

  fixedSvg.on('click', function fixedSvgRootClick(event) {
    const target = event.target;
    const svgNode = fixedSvg.node();

    if (target === svgNode && target.tagName === 'svg') {
      deselectAllEdgeBoxes();
      graphDataStore.clearSelection();
      clearCorrespondenceHighlights();
      highlightedNodes.clear();
      updateNodeAppearance();
      if (socket) {
        socket.emit('overview nodes selected', []);
      }
    }
  });

  const handleSelectionChange = (event, data) => {
    const { nodeId } = data;
    if (event === 'nodeSelected') {
      highlightedNodes.add(nodeId);
      highlightEdgesForNode(nodeId, true);
      updateNodeAppearance();
    } else if (event === 'nodeUnselected') {
      highlightedNodes.delete(nodeId);
      highlightEdgesForNode(nodeId, false);
      updateNodeAppearance();
    }
  };

  graphDataStore.addSelectionListener(handleSelectionChange);

  updateNodeAppearance();

  const emitCurrentSelection = () => {
    const selectedNodeIDs = graphDataStore.getSelectedNodeIds();
    if (socket && selectedNodeIDs.length > 0) {
      socket.emit('overview nodes selected', selectedNodeIDs);
    }
  };

  emitCurrentSelection();

  const biofabricEdgeBoxesContainer = document.getElementById('biofabric-edge-boxes-container');
  if (!biofabricEdgeBoxesContainer) {
    console.error('biofabric-edge-boxes-container not found');
    return;
  }

  biofabricEdgeBoxesContainer.innerHTML = '';
  biofabricEdgeBoxesContainer.style.display = 'block';

  deselectAllEdgeBoxes = () => {
    const allEdgeBoxes = biofabricEdgeBoxesContainer.querySelectorAll('.edge-box');
    allEdgeBoxes.forEach(edgeBox => {
      edgeBox.classList.remove('edge-box-selected');
      edgeBox.classList.remove('edge-box-highlighted');
    });
  };

  const mergeEdgeLabels = edgeLabelData.filter(e => e.isMergeEdge);
  const regularEdgeLabels = edgeLabelData.filter(e => !e.isMergeEdge);

  const mergeEdgesByTarget = {};
  mergeEdgeLabels.forEach(edgeLabel => {
    const targetId = edgeLabel.targetId;
    mergeEdgesByTarget[targetId] ||= [];
    mergeEdgesByTarget[targetId].push(edgeLabel);
  });

  const edgeBoxGroups = {};
  regularEdgeLabels.forEach((edgeLabel) => {
    const rowKey = Math.round(edgeLabel.y / 10) * 10;
    edgeBoxGroups[rowKey] ||= [];
    edgeBoxGroups[rowKey].push({ isMergeGroup: false, edgeLabel });
  });
  Object.keys(mergeEdgesByTarget).forEach(targetId => {
    const mergeGroup = mergeEdgesByTarget[targetId];
    if (mergeGroup.length > 0) {
      const rowKey = Math.round(mergeGroup[0].y / 10) * 10;
      edgeBoxGroups[rowKey] ||= [];
      edgeBoxGroups[rowKey].push({ isMergeGroup: true, edgeLabels: mergeGroup });
    }
  });

  Object.keys(edgeBoxGroups).forEach((groupKey) => {
    const itemsInGroup = edgeBoxGroups[groupKey];

    itemsInGroup.forEach((item) => {
      if (item.isMergeGroup) {
        const mergeEdgeGroup = item.edgeLabels;
        const edgeIds = mergeEdgeGroup.map(e => e.edgeId);
        const edgeIdsStr = edgeIds.join(',');

        const firstEdgeObj = sortedEdges.find(e => e.id === mergeEdgeGroup[0].edgeId);
        const edgeLabelText = firstEdgeObj ? (firstEdgeObj.label || 'merged') : 'merged';

        const firstEdgeId = edgeIds[0];
        const currentNote = graphDataStore.getEdgeNote(firstEdgeId);

        const mergeEdgeDataItems = mergeEdgeGroup
          .map(edgeLabel => edgeData.find(e => e.id === edgeLabel.edgeId))
          .filter(item => item !== undefined);

        let boxY;
        if (mergeEdgeDataItems.length > 0) {
          const edgeRowYs = mergeEdgeDataItems.map(e => e.edgeRowY);
          const minY = Math.min(...edgeRowYs);
          const maxY = Math.max(...edgeRowYs);
          boxY = (minY + maxY) / 2 - 16; // Center vertically, adjust for box height
        } else {
          boxY = mergeEdgeGroup[0].y - 20;
        }

        const boxClass = 'edge-box';
        const box = h('div', {
          class: boxClass,
          'data-edge-id': edgeIdsStr,
          'data-is-merge': 'true',
          style: `position: absolute; top: ${boxY}px;`,
        }, []);

        const labelPart = h('div', { class: 'edge-box-label', title: edgeLabelText }, [t(edgeLabelText)]);
        const noteInput = h('input', {
          type: 'text',
          class: 'edge-box-note-input',
          value: currentNote,
        }, []);

        noteInput.addEventListener('input', (e) => {
          graphDataStore.setEdgeNotes(edgeIds, e.target.value);
        });

        const notePart = h('div', { class: 'edge-box-note' }, [noteInput]);
        box.appendChild(labelPart);
        box.appendChild(notePart);

        box.addEventListener('mouseenter', () => {
          const selectedEdgeId = graphDataStore.getSelectedEdgeId();
          if (!edgeIds.includes(selectedEdgeId)) {
            box.classList.add('edge-box-highlighted');
          }
        });

        box.addEventListener('mouseleave', () => {
          const selectedEdgeId = graphDataStore.getSelectedEdgeId();
          if (!edgeIds.includes(selectedEdgeId)) {
            box.classList.remove('edge-box-highlighted');
          }
        });

        box.addEventListener('click', (e) => {
          e.stopPropagation();
          const isCurrentlySelected = box.classList.contains('edge-box-selected');

          if (isCurrentlySelected) {
            // If already selected, unselect it
            deselectAllEdgeBoxes();
            clearCorrespondenceHighlights();
            graphDataStore.clearSelection();
            graphDataStore.clearSelectedEdge();
            highlightedNodes.clear();
            updateNodeAppearance();
          } else {
            // Select this box and deselect others
            deselectAllEdgeBoxes();
            clearCorrespondenceHighlights();
            graphDataStore.clearSelection();
            graphDataStore.clearSelectedEdge();
            highlightMergeEdges(edgeIds, true);
            edgeIds.forEach(edgeId => {
              highlightNodesForEdge(edgeId, true);
            });
            box.classList.add('edge-box-selected');
            graphDataStore.setSelectedEdgeId(firstEdgeId);
            highlightedNodes.clear();
            updateNodeAppearance();
          }
        });

        biofabricEdgeBoxesContainer.appendChild(box);
      } else {
        const edgeLabel = item.edgeLabel;
        const edgeObj = sortedEdges.find(e => e.id === edgeLabel.edgeId);
        const edgeLabelText = edgeObj ? (edgeObj.label || edgeLabel.edgeId) : edgeLabel.edgeId;
        const currentNote = graphDataStore.getEdgeNote(edgeLabel.edgeId);

        const edgeDataItem = edgeData.find(e => e.id === edgeLabel.edgeId);
        const boxY = edgeDataItem ? edgeDataItem.edgeRowY - 20 : edgeLabel.y - 20;

        const boxClass = 'edge-box';
        const box = h('div', {
          class: boxClass,
          'data-edge-id': edgeLabel.edgeId,
          style: `position: absolute; top: ${boxY}px;`,
        }, []);

        const labelPart = h('div', { class: 'edge-box-label', title: edgeLabelText }, [t(edgeLabelText)]);

        const noteInput = h('input', {
          type: 'text',
          class: 'edge-box-note-input',
          value: currentNote,
        }, []);

        noteInput.addEventListener('input', (e) => {
          graphDataStore.setEdgeNote(edgeLabel.edgeId, e.target.value);
        });

        const notePart = h('div', { class: 'edge-box-note' }, [noteInput]);

        box.appendChild(labelPart);
        box.appendChild(notePart);

        box.addEventListener('mouseenter', () => {
          const selectedEdgeId = graphDataStore.getSelectedEdgeId();
          if (selectedEdgeId !== edgeLabel.edgeId) {
            box.classList.add('edge-box-highlighted');
          }
        });

        box.addEventListener('mouseleave', () => {
          const selectedEdgeId = graphDataStore.getSelectedEdgeId();
          if (selectedEdgeId !== edgeLabel.edgeId) {
            box.classList.remove('edge-box-highlighted');
          }
        });

        box.addEventListener('click', (e) => {
          e.stopPropagation();
          const isCurrentlySelected = box.classList.contains('edge-box-selected');

          if (isCurrentlySelected) {
            // If already selected, unselect it
            deselectAllEdgeBoxes();
            clearCorrespondenceHighlights();
            graphDataStore.clearSelection();
            graphDataStore.clearSelectedEdge();
            highlightedNodes.clear();
            updateNodeAppearance();
          } else {
            // Select this box and deselect others
            deselectAllEdgeBoxes();
            clearCorrespondenceHighlights();
            graphDataStore.clearSelection();
            graphDataStore.setSelectedEdgeId(edgeLabel.edgeId);
            highlightNodesForEdge(edgeLabel.edgeId, true);
            const svgLines = edgeSvgLines.get(edgeLabel.edgeId);
            if (svgLines) {
              svgLines.mainLine
                .attr('stroke', COLOR_HIGHLIGHT_SELECTED)
                .attr('stroke-width', STROKE_WIDTH_HIGHLIGHTED)
                .attr('opacity', OPACITY_FULL)
                .classed('edge-svg-selected', true);
              const edgeData = svgLines.edgeData;
              const isDuplicateEdge = edgeData.isDuplicateEdge;
              if (edgeData.isMergeEdge || isDuplicateEdge) {
                const mainStrokeDashArray = isDuplicateEdge
                  ? DASH_ARRAY_DUPLICATE_EDGE
                  : DASH_ARRAY_MERGE_EDGE;
                svgLines.mainLine.attr('stroke-dasharray', mainStrokeDashArray);
              }
              svgLines.sourceConnector
                .attr('opacity', OPACITY_EDGE_CONNECTOR_HIGHLIGHTED)
                .classed('edge-svg-selected', true);
              svgLines.targetConnector
                .attr('opacity', OPACITY_EDGE_CONNECTOR_HIGHLIGHTED)
                .classed('edge-svg-selected', true);
              selectedEdgesForHighlighting.add(edgeLabel.edgeId);
            }
            box.classList.add('edge-box-selected');
            highlightedNodes.clear();
            updateNodeAppearance();
          }
        });

        biofabricEdgeBoxesContainer.appendChild(box);
      }
    });
  });

  biofabricEdgeBoxesContainer.addEventListener('click', (event) => {
    if (event.target === biofabricEdgeBoxesContainer) {
      deselectAllEdgeBoxes();
      clearCorrespondenceHighlights();
      graphDataStore.clearSelection();
      graphDataStore.clearSelectedEdge();
      highlightedNodes.clear();
      updateNodeAppearance();
    }
  });

  sortedNodes.forEach((node, nodeIndex) => {
    const colX = START_OFFSET + nodeIndex * NODE_SPACING;

    const topChevron = h('i', {
      class: 'fa-solid fa-circle-chevron-down column-marker column-marker-top',
      style: `
        position: absolute;
        left: ${colX}px;
        top: 128px;
        transform: translateX(-50%);
        color: #666;
        font-size: 24px;
        pointer-events: auto;
        cursor: pointer;
        z-index: 10;
        display: none;
      `,
      'data-node-id': node.id,
      'data-node-index': nodeIndex,
    }, []);

    const bottomChevron = h('i', {
      class: 'fa-solid fa-circle-chevron-up column-marker column-marker-bottom',
      style: `
        position: absolute;
        left: ${colX}px;
        top: ${window.innerHeight - 28}px;
        transform: translateX(-50%);
        color: #666;
        font-size: 24px;
        pointer-events: auto;
        cursor: pointer;
        z-index: 10;
        display: none;
      `,
      'data-node-id': node.id,
      'data-node-index': nodeIndex,
    }, []);

    topChevron.addEventListener('click', () => {
      if (layoutContainer) {
        const nodeEdges = edgeData.filter(edge => isEdgeForNode(edge, node.id));

        if (nodeEdges.length > 0) {
          const topmostEdge = getTopmostEdge(nodeEdges);

          const scrollPadding = 200; // Padding to show content above the edge
          const targetScroll = Math.max(0, topmostEdge.edgeRowY - scrollPadding);

          layoutContainer.scrollTo({
            top: targetScroll,
            behavior: 'smooth',
          });
        }
      }
    });

    bottomChevron.addEventListener('click', () => {
      if (layoutContainer) {
        const nodeEdges = edgeData.filter(edge => isEdgeForNode(edge, node.id));

        if (nodeEdges.length > 0) {
          const bottommostEdge = getBottommostEdge(nodeEdges);

          const viewportHeight = layoutContainer.getBoundingClientRect().height;
          const scrollPadding = 200; // Padding to show content below the edge
          const targetScroll = Math.max(
            0,
            bottommostEdge.edgeRowY - viewportHeight + scrollPadding,
          );

          layoutContainer.scrollTo({
            top: targetScroll,
            behavior: 'smooth',
          });
        }
      }
    });

    fixedNodesContainer.appendChild(topChevron);
    fixedNodesContainer.appendChild(bottomChevron);

    columnMarkers.set(node.id, {
      topChevron,
      bottomChevron,
      nodeIndex,
      colX,
    });
  });

  svgContainer.style.height = `${totalHeight}px`;
  svgContainer.style.width = `${totalWidth}px`;
  svgContainer.style.minWidth = `${totalWidth}px`;

  biofabricEdgeBoxesContainer.style.height = `${totalHeight}px`;

  if (horizontalScrollWrapper) {
    horizontalScrollWrapper.style.width = `${totalWidth}px`;
    horizontalScrollWrapper.style.minWidth = `${totalWidth}px`;
    horizontalScrollWrapper.style.height = `${totalHeight}px`;
    horizontalScrollWrapper.style.minHeight = `${totalHeight}px`;
  }

  if (fixedNodesContainer) {
    fixedNodesContainer.style.width = `${totalWidth}px`;
    fixedNodesContainer.style.minWidth = `${totalWidth}px`;
  }

  if (leftPanel && fixedNodesContainer) {
    const syncScroll = () => {
      const scrollLeft = leftPanel.scrollLeft;
      fixedNodesContainer.style.transform = `translateX(-${scrollLeft}px)`;
      updateArrowVisibility();
    };

    // Remove existing listeners to avoid duplicates
    leftPanel.removeEventListener('scroll', syncScroll);
    leftPanel.addEventListener('scroll', syncScroll, { passive: true });

    // Initial sync and arrow visibility update
    syncScroll();
  }

  if (layoutContainer) {
    const handleVerticalScroll = () => {
      updateArrowVisibility();
    };

    layoutContainer.removeEventListener('scroll', handleVerticalScroll);
    layoutContainer.addEventListener('scroll', handleVerticalScroll, { passive: true });
  }

  const compactEdgeBoxesContainer = document.getElementById('edge-boxes-container');
  if (compactEdgeBoxesContainer) {
    compactEdgeBoxesContainer.style.display = 'none';
  }

  if (sortedNodes.length > 0) {
    const rightmostNodeIndex = sortedNodes.length - 1;
    const rightmostX = START_OFFSET + rightmostNodeIndex * NODE_SPACING;

    const scrollPadding = 10;
    const scrollTarget = rightmostX + scrollPadding;

    requestAnimationFrame(() => {
      if (leftPanel) {
        leftPanel.scrollTo({
          left: scrollTarget,
          behavior: 'smooth',
        });
      }
    });
  }

  const handleResize = () => {
    updateArrowVisibility();
  };

  window.addEventListener('resize', handleResize);

  requestAnimationFrame(() => {
    setTimeout(() => {
      updateArrowVisibility();
    }, 100);
  });
}
