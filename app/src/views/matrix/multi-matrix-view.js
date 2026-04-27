import events from '../../utils/events.js';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;
const ZOOM_FACTOR_IN = 1.1;
const ZOOM_FACTOR_OUT = 0.9;

export function createMultiMatrix(targetPane, sourcePanes) {
  const container = document.getElementById(targetPane.container);
  if (!container) return;

  // Clean up previous multi-matrix instance if exists
  if (targetPane.cy?.multiMatrixView?.destroy) {
    targetPane.cy.multiMatrixView.destroy();
  }

  // Hide Cytoscape canvas
  const cyContainer = container.querySelector('.cy-container');
  if (cyContainer) {
    cyContainer.style.display = 'none';
  }

  // Create or get multi-matrix container
  const multiMatrixContainer = createMultiMatrixContainer(targetPane, container);

  // Clear existing content
  multiMatrixContainer.innerHTML = '';

  // Create canvas for the combined matrix
  const canvas = createMultiMatrixCanvas();
  multiMatrixContainer.appendChild(canvas);

  // Initialize view state
  const viewState = {
    zoomLevel: 1.0,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    hoveredRow: -1,
    hoveredCol: -1,
    layoutInfo: null, // Will be populated by render
  };

  // Render function
  const render = () => renderCombinedMatrix(canvas, sourcePanes, viewState);

  // Initial render
  render();

  // Set up event handlers
  const cleanupHandlers = setupMultiMatrixEventHandlers(canvas, container, viewState, render);

  // Store cleanup hook on cy for later re-creation
  if (targetPane.cy) {
    targetPane.cy.multiMatrixView = {
      destroy: cleanupHandlers,
      render,
    };
  }

  // Update legend in sidebar
  updateMultiMatrixLegend(targetPane, sourcePanes);
}

function createMultiMatrixContainer(targetPane, container) {
  let multiMatrixContainer = document.getElementById(`${targetPane.container}-multi-matrix`);

  if (!multiMatrixContainer) {
    multiMatrixContainer = document.createElement('div');
    multiMatrixContainer.id = `${targetPane.container}-multi-matrix`;
    Object.assign(multiMatrixContainer.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      background: 'white',
    });
    container.appendChild(multiMatrixContainer);
  }

  return multiMatrixContainer;
}

function createMultiMatrixCanvas() {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
  });
  return canvas;
}

function setupMultiMatrixEventHandlers(canvas, container, viewState, render) {
  // Zoom with mouse wheel
  const handleWheel = (e) => {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const oldZoom = viewState.zoomLevel;
    const zoomFactor = e.deltaY < 0 ? ZOOM_FACTOR_IN : ZOOM_FACTOR_OUT;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, viewState.zoomLevel * zoomFactor));

    // Adjust pan to zoom towards mouse position
    const zoomChange = newZoom / oldZoom;
    viewState.panX = mouseX - (mouseX - viewState.panX) * zoomChange;
    viewState.panY = mouseY - (mouseY - viewState.panY) * zoomChange;

    viewState.zoomLevel = newZoom;
    render();
  };

  canvas.addEventListener('wheel', handleWheel, { passive: false });

  // Pan with mouse drag
  const handleMouseDown = (e) => {
    if (e.button === 0) {
      viewState.isDragging = true;
      viewState.dragStartX = e.clientX - viewState.panX;
      viewState.dragStartY = e.clientY - viewState.panY;
      canvas.style.cursor = 'grabbing';
    }
  };

  const handleMouseMove = (e) => {
    if (viewState.isDragging) {
      viewState.panX = e.clientX - viewState.dragStartX;
      viewState.panY = e.clientY - viewState.dragStartY;
      render();
      return;
    }

    // Hover detection for row/column highlighting
    if (viewState.layoutInfo) {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const {
        labelSpace, cellSize, matrixSize, offsetY, numMatrices, n, zoomLevel, panX, panY, nodeIds,
      } = viewState.layoutInfo;

      // Transform mouse coordinates to account for pan and zoom
      const transformedX = (mouseX - panX) / zoomLevel;
      const transformedY = (mouseY - panY) / zoomLevel;

      let newRow = -1;
      let newCol = -1;

      // Check each matrix
      const matrixSpacing = 2;
      for (let matrixIdx = 0; matrixIdx < numMatrices; matrixIdx += 1) {
        const offsetX = labelSpace + matrixIdx * (matrixSize + matrixSpacing);

        const relX = transformedX - offsetX;
        const relY = transformedY - offsetY;

        if (relX >= 0 && relX < matrixSize && relY >= 0 && relY < matrixSize) {
          newCol = Math.floor(relX / cellSize);
          newRow = Math.floor(relY / cellSize);
          break;
        }
      }

      if (newRow !== viewState.hoveredRow || newCol !== viewState.hoveredCol) {
        viewState.hoveredRow = newRow;
        viewState.hoveredCol = newCol;
        render();

        // Emit matrix-hover event for cross-pane highlighting
        if (newRow >= 0 && newCol >= 0 && newRow < n && newCol < n && nodeIds) {
          const sourceNodeId = nodeIds[newRow];
          const targetNodeId = nodeIds[newCol];
          window.dispatchEvent(
            events.MATRIX_HOVER(
              null,
              [sourceNodeId, targetNodeId],
              { source: sourceNodeId, target: targetNodeId },
            ),
          );
        } else {
          // Clear hover in other panes
          window.dispatchEvent(events.MATRIX_HOVER(null, [], null));
        }
      }
    }
  };

  const stopDragging = () => {
    if (viewState.isDragging) {
      viewState.isDragging = false;
      canvas.style.cursor = 'default';
    }
  };

  const handleMouseLeave = () => {
    stopDragging();
    if (viewState.hoveredRow !== -1 || viewState.hoveredCol !== -1) {
      viewState.hoveredRow = -1;
      viewState.hoveredCol = -1;
      render();
      // Clear hover in other panes
      window.dispatchEvent(events.MATRIX_HOVER(null, [], null));
    }
  };

  canvas.addEventListener('mousedown', handleMouseDown, { passive: true });
  canvas.addEventListener('mousemove', handleMouseMove, { passive: true });
  canvas.addEventListener('mouseleave', handleMouseLeave, { passive: true });
  window.addEventListener('mouseup', stopDragging, { passive: true });

  // Throttled resize observer
  let resizeScheduled = false;
  const throttledResize = () => {
    if (resizeScheduled) return;
    resizeScheduled = true;
    requestAnimationFrame(() => {
      render();
      resizeScheduled = false;
    });
  };

  const resizeObserver = new ResizeObserver(() => throttledResize());
  resizeObserver.observe(container);

  const handleWindowResize = () => throttledResize();
  window.addEventListener('resize', handleWindowResize, { passive: true });

  // Return cleanup function
  return () => {
    resizeObserver.disconnect();
    window.removeEventListener('resize', handleWindowResize);
    window.removeEventListener('mouseup', stopDragging);
    canvas.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('mouseleave', handleMouseLeave);
  };
}

function renderCombinedMatrix(canvas, sourcePanes, viewState) {
  const {
    zoomLevel = 1.0, panX = 0, panY = 0, hoveredRow = -1, hoveredCol = -1,
  } = viewState;
  const ctx = canvas.getContext('2d');

  if (sourcePanes.length === 0) return;

  // Resize canvas to match display size
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  // Calculate number of matrices needed: ceil(numPanes / 2)
  const numMatrices = Math.ceil(sourcePanes.length / 2);

  // Collect all unique node IDs from all panes (union)
  // Filter out nodes starting with 't' (transitions)
  const nodeIds = [];
  const nodeSet = new Set();

  // First, add all nodes from first pane in their original order
  sourcePanes[0].cy.nodes().forEach(node => {
    const id = node.id();
    // Skip transition nodes (starting with 't')
    if (!id.startsWith('t') && !nodeSet.has(id)) {
      nodeIds.push(id);
      nodeSet.add(id);
    }
  });

  // Then add any additional nodes from other panes
  sourcePanes.slice(1).forEach(pane => {
    pane.cy.nodes().forEach(node => {
      const id = node.id();
      // Skip transition nodes (starting with 't')
      if (!id.startsWith('t') && !nodeSet.has(id)) {
        nodeIds.push(id);
        nodeSet.add(id);
      }
    });
  });

  const n = nodeIds.length;

  if (n === 0) {
    ctx.fillStyle = '#999';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No nodes', canvas.width / 2, canvas.height / 2);
    return;
  }

  // Build adjacency matrices for each pane (using the same node ordering)
  // For Petri nets: skip transition nodes and create direct state-to-state connections
  const paneMatrices = sourcePanes.map((pane) => {
    const counts = Array(n).fill(0).map(() => Array(n).fill(0));

    // For each state node, find all reachable states through transitions
    nodeIds.forEach((srcId, srcIdx) => {
      // Find all transitions reachable from this state
      const outEdges = pane.cy.edges(`[source="${srcId}"]`);

      outEdges.forEach(e1 => {
        const transitionId = e1.target().id();
        // Only follow through transition nodes
        if (transitionId.startsWith('t')) {
          // Find all states reachable from this transition
          const transOutEdges = pane.cy.edges(`[source="${transitionId}"]`);

          transOutEdges.forEach(e2 => {
            const tgtId = e2.target().id();
            const tgtIdx = nodeIds.indexOf(tgtId);

            if (tgtIdx !== -1) {
              // Found a state-transition-state path
              counts[srcIdx][tgtIdx] += 1;
            }
          });
        }
      });
    });

    return counts;
  });

  // Find max count across all panes for scaling
  let maxCount = 0;
  paneMatrices.forEach((counts) => {
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (counts[i][j] > maxCount) maxCount = counts[i][j];
      }
    }
  });

  // Calculate cell size and layout for multiple matrices with zoom
  const w = canvas.width;
  const h = canvas.height;

  // Clear canvas
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#f8f8f8';
  ctx.fillRect(0, 0, w, h);

  // Save context and apply zoom/pan transformation
  ctx.save();

  // Apply pan first, then zoom from origin
  ctx.translate(panX, panY);
  ctx.scale(zoomLevel, zoomLevel);

  // Available space for matrices (accounting for labels)
  const labelSpace = 100; // Space for row labels on left and column labels on bottom
  const availableWidth = w - labelSpace;
  const availableHeight = h - labelSpace;

  // Calculate base cell size to fit all matrices horizontally (no zoom here, applied via transform)
  const totalMatrixWidth = availableWidth / numMatrices;
  const baseCellSize = Math.max(
    1,
    Math.floor((Math.min(totalMatrixWidth, availableHeight) * 0.9) / n),
  );
  const cellSize = baseCellSize;
  const matrixSize = cellSize * n;

  // Vertical offset (center matrices vertically, no pan here)
  const offsetY = Math.floor((h - labelSpace - matrixSize) / 2);

  // Store layout info in viewState for hover detection
  viewState.layoutInfo = {
    labelSpace,
    cellSize,
    matrixSize,
    offsetY,
    numMatrices,
    n,
    zoomLevel,
    panX,
    panY,
    nodeIds,
  };

  // Only use blue and orange colors, alternating for each matrix
  const blueColor = { r: 43, g: 140, b: 255 };   // Blue
  const orangeColor = { r: 255, g: 127, b: 14 };   // Orange

  // Draw each matrix
  for (let matrixIdx = 0; matrixIdx < numMatrices; matrixIdx += 1) {
    const pane0Idx = matrixIdx * 2;       // Lower triangle pane
    const pane1Idx = matrixIdx * 2 + 1;   // Upper triangle pane

    // Horizontal offset for this matrix (no pan here, applied via transform)
    // Place matrices directly next to each other with small spacing
    const matrixSpacing = 2; // Small gap between matrices
    const offsetX = labelSpace + matrixIdx * (matrixSize + matrixSpacing);

    // Draw the matrix cells
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        const x = offsetX + c * cellSize;
        const y = offsetY + r * cellSize;

        let color;
        let count = 0;

        if (r === c) {
          // Diagonal - show self-loops from lower pane
          count = paneMatrices[pane0Idx] ? paneMatrices[pane0Idx][r][c] : 0;
          if (count > 0) {
            color = { r: 110, g: 110, b: 110 };
          } else {
            color = { r: 255, g: 255, b: 255 };  // Empty cell - white
          }
        } else if (r > c) {
          // Lower triangle - always blue
          if (paneMatrices[pane0Idx]) {
            count = Math.max(paneMatrices[pane0Idx][r][c], paneMatrices[pane0Idx][c][r]);
            if (count > 0) {
              color = blueColor;
            } else {
              color = { r: 255, g: 255, b: 255 };  // Empty cell - white
            }
          } else {
            color = { r: 255, g: 255, b: 255 };  // Empty cell - white
          }
        } else if (paneMatrices[pane1Idx]) {
          count = Math.max(paneMatrices[pane1Idx][r][c], paneMatrices[pane1Idx][c][r]);
          if (count > 0) {
            color = orangeColor;
          } else {
            color = { r: 255, g: 255, b: 255 };  // Empty cell - white
          }
        } else {
          color = { r: 255, g: 255, b: 255 };  // Empty cell - white
        }

        // Scale intensity based on count
        const intensity = maxCount > 0 ? count / maxCount : 0;
        const alpha = count > 0 ? 0.3 + intensity * 0.7 : 1.0;

        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
        ctx.fillRect(x, y, cellSize, cellSize);

        // Draw cell border
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, cellSize, cellSize);
      }
    }

    // Draw diagonal separator line (zigzag)
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const x1 = offsetX + i * cellSize;
      const y1 = offsetY + i * cellSize;
      const x2 = x1 + cellSize;
      const y2 = y1 + cellSize;

      if (i === 0) {
        ctx.moveTo(x1, y1);
      }
      ctx.lineTo(x2, y1);  // Horizontal
      ctx.lineTo(x2, y2);  // Vertical
    }
    ctx.stroke();

    // Draw vertical separator between matrices (except after last matrix)
    if (matrixIdx < numMatrices - 1) {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const separatorX = offsetX + matrixSize;
      ctx.moveTo(separatorX, offsetY);
      ctx.lineTo(separatorX, offsetY + matrixSize);
      ctx.stroke();
    }

    // Draw hover highlighting for row and column (gray background like other matrices)
    if (hoveredRow >= 0 && hoveredRow < n && hoveredCol >= 0 && hoveredCol < n) {
      ctx.fillStyle = 'rgba(100, 100, 100, 0.15)'; // Gray highlight

      // Highlight entire row
      ctx.fillRect(offsetX, offsetY + hoveredRow * cellSize, matrixSize, cellSize);

      // Highlight entire column
      ctx.fillRect(offsetX + hoveredCol * cellSize, offsetY, cellSize, matrixSize);

      // Draw border around hovered cell
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        offsetX + hoveredCol * cellSize,
        offsetY + hoveredRow * cellSize,
        cellSize,
        cellSize,
      );
    }

    // Draw selected/marked nodes with dashed red outline (like other matrix views)
    const selectedIds = new Set();
    sourcePanes.forEach(pane => {
      if (pane?.cy) {
        pane.cy.nodes(':selected').forEach(node => {
          if (node.data('type') === 's') {
            selectedIds.add(node.data('id'));
          }
        });
      }
    });

    if (selectedIds.size > 0) {
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      for (let i = 0; i < n; i += 1) {
        if (selectedIds.has(nodeIds[i])) {
          // Highlight row
          ctx.strokeRect(offsetX, offsetY + i * cellSize, matrixSize, cellSize);
          // Highlight column
          ctx.strokeRect(offsetX + i * cellSize, offsetY, cellSize, matrixSize);
        }
      }

      ctx.setLineDash([]);
    }
  }

  // Draw labels for all matrices
  ctx.save();
  const fontSize = Math.max(10, Math.min(14, Math.floor(cellSize * 0.7)));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = '#111';

  // Row labels (left side, right-aligned) - only for first matrix
  const matrixSpacing = 2;
  const firstOffsetX = labelSpace;
  ctx.textAlign = 'right';
  for (let r = 0; r < n; r += 1) {
    const label = nodeIds[r].length > 12 ? nodeIds[r].slice(0, 12) + '…' : nodeIds[r];
    const x = firstOffsetX - 6;
    const y = offsetY + r * cellSize + Math.min(cellSize - 4, cellSize * 0.8);
    ctx.fillText(label, x, y);
  }

  // Column labels (bottom, rotated -90°) - draw for each matrix
  const offsetDown = Math.max(20, fontSize + 16);
  for (let matrixIdx = 0; matrixIdx < numMatrices; matrixIdx += 1) {
    const columnOffsetX = labelSpace + matrixIdx * (matrixSize + matrixSpacing);
    for (let c = 0; c < n; c += 1) {
      const label = nodeIds[c].length > 12 ? nodeIds[c].slice(0, 12) + '…' : nodeIds[c];
      const x = columnOffsetX + c * cellSize + Math.min(cellSize - 2, Math.floor(cellSize * 0.6));
      const y = offsetY + matrixSize + offsetDown;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'left';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();

  // Restore clipping context
  ctx.restore();
}

function updateMultiMatrixLegend(targetPane, sourcePanes) {
  const infoBox = document.getElementById('info-box');
  if (!infoBox) return;

  // Remove existing legend
  const existing = document.getElementById(`legend-multi-matrix-${targetPane.id}`);
  if (existing) existing.remove();

  // Create legend container
  const legend = document.createElement('div');
  legend.id = `legend-multi-matrix-${targetPane.id}`;
  Object.assign(legend.style, {
    background: '#f9f9f9',
    border: '1px solid #ddd',
    borderRadius: '4px',
    padding: '10px',
    marginBottom: '15px',
    fontSize: '12px',
  });

  // Title
  const title = document.createElement('div');
  title.textContent = 'Multi-Matrix View';
  Object.assign(title.style, {
    fontWeight: 'bold',
    marginBottom: '8px',
    fontSize: '13px',
    borderBottom: '1px solid #ccc',
    paddingBottom: '5px',
  });
  legend.appendChild(title);

  // List of matrices and their panes
  const matricesSection = document.createElement('div');
  matricesSection.style.cssText = `
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid #ddd;
  `;

  const matricesTitle = document.createElement('div');
  matricesTitle.textContent = 'Panes in Matrices';
  matricesTitle.style.cssText = `
    font-weight: bold;
    margin-bottom: 5px;
    font-size: 11px;
  `;
  matricesSection.appendChild(matricesTitle);

  // Group panes by matrix
  const numMatrices = Math.ceil(sourcePanes.length / 2);
  for (let matrixIdx = 0; matrixIdx < numMatrices; matrixIdx += 1) {
    const pane0Idx = matrixIdx * 2;
    const pane1Idx = matrixIdx * 2 + 1;

    const matrixItem = document.createElement('div');
    matrixItem.style.cssText = `
      font-size: 10px;
      color: #333;
      margin: 5px 0;
      padding-left: 5px;
    `;

    let matrixText = `Matrix ${matrixIdx + 1}: `;
    if (sourcePanes[pane0Idx]) {
      matrixText += `${sourcePanes[pane0Idx].id} (lower)`;
    }
    if (sourcePanes[pane1Idx]) {
      matrixText += ` + ${sourcePanes[pane1Idx].id} (upper)`;
    }

    matrixItem.textContent = matrixText;
    matricesSection.appendChild(matrixItem);
  }

  legend.appendChild(matricesSection);

  // Color legend - show colors for each pane
  const colorTitle = document.createElement('div');
  colorTitle.textContent = 'Pane Colors';
  colorTitle.style.cssText = `
    font-weight: bold;
    margin-bottom: 5px;
    font-size: 11px;
  `;
  legend.appendChild(colorTitle);

  const paneColors = [
    '#2b8cff',  // Blue
    '#ff7f0e',  // Orange
    '#4caf50',  // Green
    '#9c27b0',  // Purple
    '#f44336',  // Red
    '#00bcd4',  // Cyan
  ];

  sourcePanes.forEach((pane, idx) => {
    const colorItem = document.createElement('div');
    colorItem.style.cssText = `
      display: flex;
      align-items: center;
      margin: 5px 0;
    `;

    const colorBox = document.createElement('div');
    colorBox.style.cssText = `
      width: 16px;
      height: 16px;
      background-color: ${paneColors[idx % paneColors.length]};
      margin-right: 8px;
      border-radius: 3px;
      flex-shrink: 0;
    `;

    const labelSpan = document.createElement('span');
    labelSpan.textContent = pane.id;
    labelSpan.style.fontSize = '11px';

    colorItem.appendChild(colorBox);
    colorItem.appendChild(labelSpan);
    legend.appendChild(colorItem);
  });

  // Add note about intensity
  const note = document.createElement('div');
  note.textContent = 'Color intensity indicates edge count';
  note.style.cssText = `
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #ddd;
    font-size: 10px;
    color: #666;
    font-style: italic;
  `;
  legend.appendChild(note);

  infoBox.appendChild(legend);
}
