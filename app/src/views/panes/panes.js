import shortid from 'shortid';
import Swal from 'sweetalert2/dist/sweetalert2.all.min.js';

import {
  setPane,
  PROJECT,
  updateGraphComparison,
  updateCurvedConnectors,
} from '../../utils/controls.js';
import { colorList } from '../../utils/utils.js';
import { CONSTANTS } from '../../utils/names.js';
import makeCtxMenu from './ctx-menu.js';
import { BACKEND } from '../../main/main.js';
import { socket } from '../imports/import-socket.js';

const MIN_FLEX_GROW = 0.005;
const MIN_SIZE = 10;
const panes = {}; // governs the pane-based exploration
const allPanesRegistry = {};
const tracker = {}; // keeps track of already seen nodes, marks, etc.

let height;
const maxheight = () => height - MIN_SIZE * 2;

socket.on('overview node clicked', (data) => {
  if (data) {
    highlightPaneById(data);
  }
});

socket.on('disconnect', () => {
  location.reload();
});

// ============================================================================
// Matrix Hover Cross-Pane Synchronization
// ============================================================================

/**
 * Resolve a state node element in Cytoscape by its ID.
 * Tries direct ID lookup first, then falls back to searching by data ID.
 * Only returns state nodes (type === 's').
 *
 * @param {Object} cy - Cytoscape instance
 * @param {string} nodeId - The node ID to resolve
 * @returns {Object|null} The Cytoscape node element, or null if not found
 */
function resolveStateNodeElement(cy, nodeId) {
  if (!cy || !nodeId) return null;

  // Try direct ID lookup first
  try {
    const direct = cy.getElementById(nodeId);
    if (direct && direct.nonempty && direct.isNode && direct.isNode() && direct.data('type') === 's') {
      return direct;
    }
  } catch {
    // Ignore errors and try fallback
  }

  // Fallback: search by data('id') property
  try {
    const fallback = cy.nodes().filter((n) => n.data('id') === nodeId && n.data('type') === 's');
    if (fallback && fallback.length > 0) {
      return fallback;
    }
  } catch {
    // Ignore errors
  }

  return null;
}

/**
 * Apply matrix hover highlighting to Cytoscape nodes and edges.
 * Called in response to the global 'matrix-hover' event to synchronize
 * hover state across all panes.
 *
 * @param {Object} cy - Cytoscape instance
 * @param {Array<string>} ids - Array of node IDs to highlight
 * @param {Object} [edge] - Optional edge info {fromId, toId} for edge highlighting
 */
function applyMatrixHoverToCy(cy, ids, edge = null) {
  if (!cy) return;

  // Initialize tracking set for previously highlighted nodes
  cy._matrixHoverGlobalIds ||= new Set();
  cy._matrixHoverEdges ||= [];

  // Clear previous hover highlights (nodes)
  if (cy._matrixHoverGlobalIds.size > 0) {
    Array.from(cy._matrixHoverGlobalIds).forEach((id) => {
      const el = resolveStateNodeElement(cy, id);
      try {
        el?.removeClass?.('matrix-hover');
      } catch {
        // Ignore errors
      }
    });
    cy._matrixHoverGlobalIds.clear();
  }

  // Clear previous hover highlights (edges)
  if (cy._matrixHoverEdges.length > 0) {
    cy._matrixHoverEdges.forEach((edgeEl) => {
      try {
        edgeEl?.removeClass?.('matrix-hover');
      } catch {
        // Ignore errors
      }
    });
    cy._matrixHoverEdges = [];
  }

  // Apply new highlights to nodes
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (uniqueIds.length === 0) return;

  uniqueIds.forEach((id) => {
    const el = resolveStateNodeElement(cy, id);
    try {
      el?.addClass?.('matrix-hover');
      cy._matrixHoverGlobalIds.add(id);
    } catch {
      // Ignore errors
    }
  });

  // Apply highlight to edge if edge info is provided
  if (edge && edge.fromId && edge.toId) {
    try {
      // The graph structure uses transition nodes (t-nodes) between state nodes.
      // So an edge from state A to state B is actually: A -> tX -> B
      // We need to find the transition node(s) that connect the two states.
      const allEdges = cy.edges();

      // Build a map of outgoing edges from each node
      const outgoingEdges = new Map(); // nodeId -> [{ edge, targetId }]

      allEdges.forEach((e) => {
        const sourceId = e.data('source');
        const targetId = e.data('target');

        if (!outgoingEdges.has(sourceId)) outgoingEdges.set(sourceId, []);
        outgoingEdges.get(sourceId).push({ edge: e, targetId });
      });

      // Find edges: fromId -> t* -> toId
      const fromOutgoing = outgoingEdges.get(edge.fromId) || [];

      fromOutgoing.forEach(({ edge: edgeToT, targetId: tNodeId }) => {
        if (tNodeId && tNodeId.toString().startsWith('t')) {
          const tOutgoing = outgoingEdges.get(tNodeId) || [];
          tOutgoing.forEach(({ edge: edgeFromT, targetId: finalTarget }) => {
            if (finalTarget === edge.toId) {
              edgeToT.addClass('matrix-hover');
              edgeFromT.addClass('matrix-hover');
              cy._matrixHoverEdges.push(edgeToT);
              cy._matrixHoverEdges.push(edgeFromT);
            }
          });
        }
      });

      // Also check reverse direction: toId -> t* -> fromId
      const toOutgoing = outgoingEdges.get(edge.toId) || [];

      toOutgoing.forEach(({ edge: edgeToT, targetId: tNodeId }) => {
        if (tNodeId && tNodeId.toString().startsWith('t')) {
          const tOutgoing = outgoingEdges.get(tNodeId) || [];
          tOutgoing.forEach(({ edge: edgeFromT, targetId: finalTarget }) => {
            if (finalTarget === edge.fromId) {
              edgeToT.addClass('matrix-hover');
              edgeFromT.addClass('matrix-hover');
              cy._matrixHoverEdges.push(edgeToT);
              cy._matrixHoverEdges.push(edgeFromT);
            }
          });
        }
      });
    } catch {
      // Ignore errors
    }
  }
}

// ============================================================================
// Pane Management Utilities
// ============================================================================

function uid() {
  return 'id' + shortid.generate();
}

function updateHeights() {
  Object.values(panes).forEach((p) => {
    p.height = height;
    document.getElementById(p.id).style.height = p.height + 'px';
  });
}

function redrawPanesNextFrame() {
  requestAnimationFrame(() => {
    Object.values(panes).forEach(p => p.cy?.pcp?.redraw());
  });
}

function spawnPane({ spawner, id, newPanePosition }, nodesIds, spawnerNodes) {
  const paneKeysBefore = Object.keys(panes);
  const index = paneKeysBefore.length % colorList.length;
  const backgroundColor = colorList[index];
  const pane = {
    id: id || uid(),
    container: uid(),
    dragbar: uid(),
    height,
    split: 0.3, // defines how much height the pcp has
    cy: undefined, // must be set later!,
    backgroundColor,
    nodesIds: new Set(nodesIds),
    spawner,
    spawnerNodes,
  };

  const newPane = {
    backgroundColor: pane.backgroundColor,
    id: pane.id,
    nodesIds: pane.nodesIds,
    spawner,
    spawnerNodes,
  };

  socket.emit('pane added', newPane);

  pane.details = pane.container + '-details';

  // pane div
  const div = document.createElement('div');
  div.className = 'cy-s flex-item pane';
  div.id = pane.id;
  div.style.flex = paneKeysBefore.length + 1;
  div.style.height = pane.height + 'px';

  // add the node-link diagram view
  const cyContainer = document.createElement('div');
  cyContainer.id = pane.container;
  cyContainer.className = 'cy';
  cyContainer.style.height = pane.height * (1 - pane.split) + 'px';

  const dragbar = document.createElement('div');
  dragbar.id = pane.dragbar;
  dragbar.className = 'dragbar';

  const buttons = createPaneControls(pane);

  // add the pane for the detail view (pcp)
  const details = document.createElement('div');
  details.className = 'detail-inspector';
  details.id = pane.details;
  details.style.height = pane.height * pane.split + 'px';

  const split_dragbar = document.createElement('div');
  split_dragbar.id = pane.dragbar + '-split';
  split_dragbar.className = 'split-dragbar';

  const sd_maximize = document.createElement('button');
  sd_maximize.title = 'Maximize PCP';
  sd_maximize.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
  sd_maximize.className = 'split-button split-max';
  sd_maximize.addEventListener('click', () => {
    if (cyContainer.clientHeight === MIN_SIZE) {
      resizeSplit(cyContainer, panes[div.id]._split);
      sd_maximize.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
      sd_maximize.title = 'Maximize PCP';
    } else {
      resizeSplit(cyContainer, MIN_SIZE);
      sd_maximize.innerHTML = '<i class="fa-solid fa-undo"></i>';
      sd_maximize.title = 'Undo maximize';
    }
  });

  const sd_minimize = document.createElement('button');
  sd_minimize.title = 'Minimize PCP';
  sd_minimize.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
  sd_minimize.className = 'split-button split-min';
  sd_minimize.addEventListener('click', () => {
    const max = Math.round(maxheight());
    if (cyContainer.clientHeight === max) {
      resizeSplit(cyContainer, panes[div.id]._split);
      sd_minimize.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
      sd_minimize.title = 'Minimize PCP';
    } else {
      resizeSplit(cyContainer, max);
      sd_minimize.innerHTML = '<i class="fa-solid fa-undo"></i>';
      sd_minimize.title = 'Undo minimize';
    }
  });

  split_dragbar.appendChild(sd_minimize);
  split_dragbar.appendChild(sd_maximize);

  div.appendChild(buttons);
  div.appendChild(cyContainer);
  div.appendChild(split_dragbar);
  div.appendChild(details);

  div.addEventListener('mousedown', () => {
    if (!panes[pane.id]?.cy) {
      return;
    }
    setPane(pane.id);
  });

  if (paneKeysBefore.length > 0) {
    if (
      document.getElementById(spawner)
      && newPanePosition?.value === 'insert'
    ) {
      document.getElementById(spawner).insertAdjacentElement('afterend', div);
      document
        .getElementById(spawner)
        .insertAdjacentElement('afterend', dragbar);
    } else {
      document.getElementById('container')?.appendChild(dragbar);
      document.getElementById('container')?.appendChild(div);
    }
  } else {
    document.getElementById('container')?.appendChild(div);
  }

  panes[div.id] = pane;
  allPanesRegistry[pane.id] = {
    ...pane,
    destroyed: false,
  };
  const paneKeysAfter = Object.keys(panes);
  if (spawner) {
    const spawners = Array.isArray(spawner) ? spawner : [spawner];
    spawners.forEach(spawnerId => {
      if (panes[spawnerId]) {
        panes[spawnerId].spawned ||= new Set();
        panes[spawnerId].spawned.add(div.id);
      }
    });
  }

  enableDragBars();

  // trigger graph comparison update if enabled
  const checkbox = document.getElementById('checkbox-graph-comparison');
  if (checkbox?.checked) {
    updateGraphComparison(true);
  }

  // trigger curved connectors update if enabled
  const curvedCheckbox = document.getElementById('checkbox-curved-connectors');
  if (curvedCheckbox?.checked) {
    updateCurvedConnectors(true);
  }

  return pane;
}

function createPaneControls(pane) {
  const buttons = document.createElement('div');
  buttons.className = 'pane-controls';
  buttons.id = `${pane.container}-controls`;
  buttons.style.width = 0;
  buttons.style.width = 0;
  buttons.style.backgroundColor = pane.backgroundColor + '50';

  const setting = document.getElementById('bestPathLength');
  const l = setting ? setting.value : CONSTANTS.INTERACTIONS.expandN.default;

  buttons.innerHTML = `<div class="ui blue bottom attached icon buttons">
        <button class="ui button" id="${pane.id}-expand1"
            title="${CONSTANTS.INTERACTIONS.expand1.name} \t (${CONSTANTS.INTERACTIONS.expand1.keyboard})">
            <i class="${CONSTANTS.INTERACTIONS.expand1.icon}" aria-hidden="true"></i>
        </button>
        <button class="ui button" id="${pane.id}-expandN"
            title="${CONSTANTS.INTERACTIONS.expandN.name(l)} \t (${CONSTANTS.INTERACTIONS.expandN.keyboard})">
            <i class="${CONSTANTS.INTERACTIONS.expandN.icon}" aria-hidden="true"></i>
        </button>
        <button class="ui button" id="${pane.id}-mark"
            title="${CONSTANTS.INTERACTIONS.mark.name} \t (${CONSTANTS.INTERACTIONS.mark.keyboard})">
            <i class="${CONSTANTS.INTERACTIONS.mark.icon}" aria-hidden="true"></i>
        </button>
    </div>`;

  return buttons;
}

function resizePane(div, flexGrow) {
  const _width = Math.max(MIN_FLEX_GROW, flexGrow);
  const _height = div.getBoundingClientRect().height;
  div.style.flexGrow = flexGrow;

  panes[div.id].width = _width;
  panes[div.id].height = _height;
}

function resizeSplit(div, pheight, save = true) {
  const _height = Math.min(maxheight(), Math.max(MIN_SIZE, pheight));
  const paneId = div.parentElement.id;

  if (save) {
    panes[paneId]._split = div.clientHeight;
  }

  div.style.height = _height + 'px';
  const details = document.getElementById(panes[paneId].details);
  if (details) {
    details.style.height = `${Math.max(MIN_SIZE, panes[paneId].height - _height)}px`;
  }

  panes[paneId].split = 1 - _height / panes[paneId].height;
  panes[paneId].cy?.pcp?.redraw();
}

function togglePane(div) {
  if (div) {
    const fg = Number(getComputedStyle(div).flexGrow);

    if (fg === MIN_FLEX_GROW) {
      if (panes[div.id]._flexGrowth < MIN_FLEX_GROW * 2) {
        resizePane(div, 1);
      } else {
        resizePane(div, panes[div.id]._flexGrowth);
      }
    } else {
      panes[div.id]._flexGrowth = fg;
      resizePane(div, MIN_FLEX_GROW);
      const keys = Object.keys(panes);
      resizePane(document.getElementById(panes[keys[keys.length - 1]].id), 1);
    }
  }
}

function expandPane(div) {
  if (div) {
    resizePane(div, 1);
  }
}

function collapsePane(div) {
  if (div) {
    if (panes[div.id]) {
      panes[div.id]._flexGrowth = Number(getComputedStyle(div).flexGrow);
    }
    resizePane(div, MIN_FLEX_GROW);
  }
}

function enableDragBars() {
  enablePaneDragBars();
  enableSplitDragBars();
}

// https://stackoverflow.com/questions/28767221/flexbox-resizing
function enablePaneDragBars() {
  const isDlRepairSummaryPane = (paneElement) => {
    return Boolean(
      paneElement
      && paneElement.id?.startsWith('axiom-pane-')
      && paneElement.classList?.contains('axiom-pane-fixed'),
    );
  };

  const fitSummaryPaneIfNeeded = (paneElement) => {
    if (!isDlRepairSummaryPane(paneElement)) {
      return;
    }

    const paneState = panes[paneElement.id];
    if (!paneState?.cy) {
      return;
    }

    if (paneState.cy.scratch('_summaryUserInteracting')) {
      return;
    }

    paneState.cy.resize();
    paneState.cy.fit(undefined, 20);
  };

  const dragbars = Array.from(document.getElementsByClassName('dragbar'));
  let dragging = false;

  dragbars.forEach(d => {
    d.onmousedown = null;
    d.ondblclick = null;
  });

  dragbars.forEach(d => {
    d.onmousedown = (e) => {
      const resizer = e.target;
      // e.button === 0 means left click
      if (e.button > 0 || !resizer.classList.contains('dragbar')) {
        return;
      }

      const parent = resizer.parentNode;
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.display !== 'flex') {
        return;
      }

      const [
        prev,
        next,
        sizeProp,
        posProp,
      ] = [
        resizer.previousElementSibling,
        resizer.nextElementSibling,
        'offsetWidth',
        'pageX',
      ];

      e.preventDefault();

      // Avoid cursor flickering (reset in onMouseUp)
      document.body.style.cursor = getComputedStyle(resizer).cursor;

      let prevSize = prev[sizeProp];
      let nextSize = next[sizeProp];
      const sumSize = prevSize + nextSize;
      const prevGrow = Number(getComputedStyle(prev).flexGrow);
      const nextGrow = Number(getComputedStyle(next).flexGrow);
      const sumGrow = prevGrow + nextGrow;
      let lastPos = e[posProp];
      let hasResized = false;
      dragging = true;

      document.onmousemove = (ex) => {
        let pos = ex[posProp];
        const d = pos - lastPos;
        prevSize += d;
        nextSize -= d;
        if (prevSize < 0) {
          nextSize += prevSize;
          pos -= prevSize;
          prevSize = 0;
        }
        if (nextSize < 0) {
          prevSize += nextSize;
          pos += nextSize;
          nextSize = 0;
        }

        const prevGrowNew = sumGrow * (prevSize / sumSize);
        const nextGrowNew = sumGrow * (nextSize / sumSize);

        prev.style.flexGrow = prevGrowNew;
        next.style.flexGrow = nextGrowNew;
        hasResized = true;

        lastPos = pos;
      };

      document.onmouseup = () => {
        document.onmousemove = null;
        document.onmouseup = null;
        document.body.style.removeProperty('cursor');

        if (hasResized) {
          fitSummaryPaneIfNeeded(prev);
          fitSummaryPaneIfNeeded(next);
        }

        dragging &&= false;
      };
    };

    d.ondblclick = (e) => {
      const elementId = e.target ? e.target.id : e.srcElement.id;
      const div = document.getElementById(elementId).previousElementSibling;
      togglePane(div);
    };
  });
}

function enableSplitDragBars() {
  const dragbars = Array.from(document.getElementsByClassName('split-dragbar'));

  dragbars.forEach(d => {
    d.onmousedown = null;
    d.ondblclick = null;
  });

  let dragging = false;
  dragbars.forEach(d => {
    d.onmousedown = (e) => {
      const elementId = e.target ? e.target.id : e.srcElement.id;
      const bar = document.getElementById(elementId);

      // e.button === 0 means left click
      if (e.button > 0 || !bar) {
        return;
      }

      const div = bar.previousElementSibling;
      dragging = panes[div.parentElement.id];
      document.onmousemove = (ex) => {
        resizeSplit(div, ex.y - div.getBoundingClientRect().top + 2, false);
      };

      document.onmouseup = () => {
        document.onmousemove = null;
        document.onmouseup = null;
        dragging &&= false;
      };
    };
    d.ondblclick = null;
    if (d && d.previousElementSibling && d.parentElement) {
      makeCtxMenu(d, d.previousElementSibling); // pane is: panes[d.parentElement.id]
    }
  });
}

function getPanes() {
  return panes;
}

function updatePanes(newPanesData) {
  Object.keys(newPanesData).forEach((k) => {
    panes[k] = newPanesData[k];
    if (allPanesRegistry[k]) {
      allPanesRegistry[k] = {
        ...allPanesRegistry[k],
        ...newPanesData[k],
        destroyed: false,
      };
    } else {
      allPanesRegistry[k] = {
        ...newPanesData[k],
        destroyed: false,
      };
    }
    if (panes[k]) {
      clearTimeout(panes[k]._storeTimeout);
      panes[k]._storeTimeout = setTimeout(() => {
        storePaneToServer(k, panes[k]).catch(error => {
          console.warn(`Failed to auto-store pane ${k}:`, error);
        });
      }, 1000);
    }
  });
}

async function storePaneToServer(paneId, paneData) {
  try {
    const paneInfo = {
      id: paneId,
      nodesIds: Array.from(paneData.nodesIds || []),
      spawner: paneData.spawner,
      spawnerNodes: paneData.spawnerNodes,
      backgroundColor: paneData.backgroundColor,
      cyData: paneData.cy ? paneData.cy.json() : null,
    };

    const content = JSON.stringify(paneInfo);
    const encodedPaneId = encodeURIComponent(paneId);

    const response = await fetch(`${BACKEND}/${PROJECT}/pane/store?pane_id=${encodedPaneId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: content,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Failed to store pane ${paneId} to server: ${response.status} - ${errorText}`);
      throw new Error(`Failed to store pane: ${response.status}`);
    }

    console.log(`Successfully stored pane ${paneId} to server`);
  } catch (error) {
    console.error(`Error storing pane ${paneId} to server:`, error);
    throw error;
  }
}

async function fetchPaneFromServer(paneId) {
  try {
    const response = await fetch(`${BACKEND}/${PROJECT}/pane?pane_id=${paneId}`);
    if (!response.ok) {
      if (response.status === 404 || response.status === 500) {
        return null;
      }
      return null;
    }
    const data = await response.json();
    if (data && typeof data === 'object') {
      const paneData = data[paneId];
      if (paneData) {
        if (typeof paneData === 'string') {
          try {
            return JSON.parse(paneData);
          } catch {
            try {
              const decoded = decodeURIComponent(escape(atob(paneData)));
              return JSON.parse(decoded);
            } catch (e2) {
              console.warn(`Failed to parse pane data for ${paneId}:`, e2);
              return null;
            }
          }
        }
        return paneData;
      }
    }
    return null;
  } catch (error) {
    console.warn(`Error fetching pane ${paneId} from server:`, error);
    return null;
  }
}

async function destroyPanes(firstId, {
  firstOnly = false, pre = false, manualRemoval = false,
} = {}) {
  const pane = document.getElementById(firstId);

  if (pane) {
    if (panes[firstId] && panes[firstId].spawned?.size > 0) {
      if (!firstOnly) {
        const spawnedArray = Array.from(panes[firstId].spawned);
        for (let i = 0; i < spawnedArray.length; i += 1) {
          await destroyPanes(spawnedArray[i], { manualRemoval });
        }
      }
    }

    if (panes[firstId]) {
      try {
        await storePaneToServer(firstId, panes[firstId]);
      } catch (error) {
        console.error(`Failed to store pane ${firstId} before destruction:`, error);
      }
    }

    const dragbar = pane.previousElementSibling;
    if (dragbar && dragbar.classList.contains('dragbar')) {
      dragbar.remove();
    }

    pane.remove();

    if (manualRemoval) {
      delete allPanesRegistry[firstId];
      socket.emit('pane removed', firstId);
    } else if (allPanesRegistry[firstId]) {
      allPanesRegistry[firstId].destroyed = true;
    }

    delete panes[firstId];

    const newKeys = Object.keys(panes);
    newKeys.forEach((k) => {
      panes[k].spawned?.delete(firstId);
    });

    if (!pre) {
      const lastPaneId = newKeys[newKeys.length - 1];

      highlightPaneById(lastPaneId);
    }

    socket.emit('pane removed', firstId);

    // trigger graph comparison update if enabled
    const checkbox = document.getElementById('checkbox-graph-comparison');
    if (checkbox?.checked) {
      updateGraphComparison(true);
    }

    // trigger curved connectors update if enabled
    const curvedCheckbox = document.getElementById('checkbox-curved-connectors');
    if (curvedCheckbox?.checked) {
      updateCurvedConnectors(true);
    }
  }
}

async function restorePaneFromServer(paneId) {
  if (!allPanesRegistry[paneId] || !allPanesRegistry[paneId].destroyed) {
    console.log(`Pane ${paneId} is not in destroyed state, skipping restore`);
    return false;
  }

  console.log(`Attempting to restore pane ${paneId} from server...`);
  let serverData = null;
  try {
    serverData = await fetchPaneFromServer(paneId);
  } catch (error) {
    console.warn(`Error fetching pane ${paneId} from server:`, error);
  }

  const { spawnGraph } = await import('../graph/node-link.js');
  const { params } = await import('../graph/layout-options/klay.js');

  const registryPane = allPanesRegistry[paneId];
  const nodesIds = serverData?.nodesIds || Array.from(registryPane.nodesIds || []);

  if (nodesIds.length === 0) {
    console.warn(`Cannot restore pane ${paneId}: no node IDs available`);
    return false;
  }

  const pane = spawnPane(
    {
      spawner: registryPane.spawner,
      id: paneId,
      newPanePosition: { value: 'end' },
    },
    nodesIds,
    registryPane.spawnerNodes,
  );

  if (serverData?.cyData && spawnGraph) {
    try {
      const data = {
        cyImport: serverData.cyData,
        nodes: serverData.cyData.elements?.nodes || [],
        edges: serverData.cyData.elements?.edges || [],
      };
      const layoutParams = params.default || params;
      spawnGraph(pane, data, layoutParams);
    } catch (error) {
      console.warn(`Error restoring graph for pane ${paneId}:`, error);
    }
  } else if (nodesIds.length > 0) {
    console.log(`Pane ${paneId} has no stored graph data, will need to expand nodes`);
  }

  if (allPanesRegistry[paneId]) {
    allPanesRegistry[paneId].destroyed = false;
  }

  console.log(`Successfully restored pane ${paneId}`);
  return true;
}

async function highlightPaneById(paneId) {
  if (!panes[paneId]) {
    const restored = await restorePaneFromServer(paneId);
    if (!restored) {
      console.warn(`Pane ${paneId} not found and could not be restored`);
      return;
    }
  }

  const paneDiv = document.getElementById(paneId);
  setPane(paneId);
  if (paneDiv) {
    if (panes) {
      Object.keys(panes).forEach((id) => {
        if (id !== paneId) {
          const otherPaneDiv = document.getElementById(id);
          collapsePane(otherPaneDiv);
        }
      });
    }

    expandPane(paneDiv);
  }
}

function updateDocDims() {
  const navHeight = parseInt(
    // turns NNpx into NN
    window.getComputedStyle(document.body).getPropertyValue('--nav-height'),
  );

  height = -navHeight
    + (window.innerHeight
      || document.documentElement.clientHeight
      || document.body.clientHeight);

  // width -= document.getElementById("config")?.clientWidth;
  updateHeights();
}

updateDocDims();

addEventListener('resize', () => {
  updateDocDims();
  Object.keys(panes).forEach((pane) => {
    panes[pane].height = height;
    const container = document.getElementById(panes[pane].id);
    container.style.height = height + 'px';
    document.getElementById(panes[pane].container).style.height = height * (1 - panes[pane].split) + 'px';
    document.getElementById(panes[pane].details).style.height = height * panes[pane].split + 'px';
  });
}, { passive: true });

addEventListener('global-action', (e) => {
  if (e.detail.action === 'propagate') {
    Object.keys(tracker).forEach((k) => {
      Object.values(getPanes()).forEach((pane) => {
        pane.cy.fns[k](pane.cy, Array.from(tracker[k]));
      });
    });
  } else {
    const action = e.detail.type + e.detail.action;
    tracker[e.detail.action] ||= new Set();

    if (e.detail.type === '') {
      e.detail.elements.forEach(
        tracker[e.detail.action].add,
        tracker[e.detail.action],
      );
    } else {
      // "undo-"
      e.detail.elements.forEach(
        tracker[e.detail.action].delete,
        tracker[e.detail.action],
      );
    }

    Object.values(getPanes()).forEach((pane) => {
      pane.cy.fns[action](pane.cy, e.detail.elements);
    });
  }
});

window.addEventListener('matrix-hover', (e) => {
  const ids = e?.detail?.ids || [];
  const edge = e?.detail?.edge || null;
  Object.values(getPanes()).forEach((pane) => {
    applyMatrixHoverToCy(pane?.cy, ids, edge);
    try {
      // Also highlight in PCP if available
      if (pane?.cy?.pcp) {
        if (ids.length > 0) {
          // Highlight all hovered node IDs in the PCP
          pane.cy.pcp.highlightNode(ids);
        } else {
          pane.cy.pcp.clearHighlight();
        }
      }
    } catch {
      console.log('tried to draw on unrendered pcp canvas...');
    }
  });
});

// Synchronize matrix selection across all panes
// window.addEventListener('matrix-selection', (e) => {
//   const sourcePaneId = e?.detail?.sourcePaneId;
//   const nodeId = e?.detail?.nodeId;
//   const isSelected = e?.detail?.isSelected;

//   if (!nodeId) return;

//   Object.values(getPanes()).forEach((pane) => {
//     // Skip the source pane (it already has the selection)
//     if (pane?.id === sourcePaneId) return;

//     const cy = pane?.cy;
//     if (!cy) return;

//     // Find the node in this pane
//     let el = cy.getElementById(nodeId);
//     if (!(el && el.nonempty && el.isNode && el.isNode() && el.data('type') === 's')) {
//       el = cy.nodes().filter((n) => n.data('id') === nodeId && n.data('type') === 's');
//     }

//     const empty = (
//       !el || (el.nonempty !== undefined && !el.nonempty)
//       || (el.length !== undefined && el.length === 0));
//     if (empty) return;

//     try {
//       // Make selectable temporarily if needed
//       if (typeof el.selectify === 'function') el.selectify();

//       if (isSelected) {
//         if (typeof el.select === 'function') el.select();
//       } else if (typeof el.unselect === 'function') {
//         el.unselect();
//       }
//     } catch {
//       // Ignore errors
//     }
//   });
// });

document.getElementById('export-strat')?.addEventListener('click', () => {
  if (!tracker['mark']) {
    Swal.fire({
      icon: 'error',
      title: 'Nothing to export',
      html: 'Nodes can be marked/unmarked using CTRL+M, the bookmark button atop the pane, or the context menu (right-click)',
      timer: 5000,
      timerProgressBar: true,
    });
    return;
  }

  const checker = {
    nodes: structuredClone(tracker['mark']),
    edges: new Set(),
    sources: new Set(),
    targets: new Set(),
  };

  const returnable = {
    nodes: new Map(),
    edges: new Map(),
  };

  let paneData;
  Object.values(getPanes()).forEach((pane) => {
    paneData = pane.cy.json();

    if (paneData.elements.edges) {
      paneData.elements.edges.forEach((edge) => {
        if (
          tracker['mark'].has(edge.data.source)
          || tracker['mark'].has(edge.data.target)
        ) {
          checker.edges.add(edge.data.id);

          if (edge.data.source.startsWith('t')) {
            checker.sources.add(edge.data.source);
          }

          if (edge.data.target.startsWith('t')) {
            checker.targets.add(edge.data.target);
          }
        }
      });

      paneData.elements.edges.forEach((edge) => {
        if (checker.edges.has(edge.data.id)) {
          if (edge.data.source.startsWith('t')) {
            if (checker.targets.has(edge.data.target)) {
              returnable.edges.set(edge.data.id, edge);
            } else {
              checker.sources.delete(edge.data.source);
            }
          }

          if (edge.data.target.startsWith('t')) {
            if (checker.sources.has(edge.data.target)) {
              returnable.edges.set(edge.data.id, edge);
            } else {
              checker.targets.delete(edge.data.source);
            }
          }
        }
      });
    }

    paneData.elements.nodes.forEach((node) => {
      if (
        checker.nodes.has(node.data.id)
        || (node.data.type === 't'
          && checker.sources.has(node.data.id)
          && checker.targets.has(node.data.id))
      ) {
        checker.nodes.add(node);
        returnable.nodes.set(node.data.id, node);
      }
    });
  });

  paneData.elements.nodes = Array.from(returnable.nodes.values());
  paneData.elements.edges = Array.from(returnable.edges.values());

  const dataStr = 'data:text/json;charset=utf-8,'
    + encodeURIComponent(JSON.stringify(paneData));
  const dl = document.getElementById('download');
  dl.setAttribute('href', dataStr);
  dl.setAttribute('download', 'strategy-export.json');
  dl.click();
});

document
  .getElementById('new-project')
  ?.addEventListener('click', async () => {
    let redirectName;

    await Swal.fire({
      title: 'Create new project',
      html: `
        <div style="text-align: left;">
          <div id="dl-repair-inputs" style="display: block;">
            <p style="margin-bottom: 10px;">Upload the required files for DL repair analysis.</p>
            
            <label style="float:left;margin-bottom:10px;margin-top:15px" for="ontology-file">Choose ontology file:</label>
            <div class="ui file input">
              <input id="ontology-file" type="file" accept=".owl, .rdf, .xml">
            </div>

            <div class="ui divider"></div>

            <label style="float:left;margin-bottom:10px;margin-top:15px" for="interested-axioms-file">Choose interested axioms file:</label>
            <div class="ui file input">
              <input id="interested-axioms-file" type="file" accept=".owl, .rdf, .xml">
            </div>

            <div class="ui divider"></div>

            <label style="float:left;margin-bottom:10px;margin-top:15px" for="defect-file">Choose defect file:</label>
            <div class="ui file input">
              <input id="defect-file" type="file" accept=".json, .txt, .xml">
            </div>
          </div>

          <div class="ui divider"></div>

          <label style="float:left;margin-bottom:10px;margin-top:15px;margin-right:50px">Project name (optional):</label>
          <div style="float:left;" class="ui input">
            <input id="project-name-unified" type="text" placeholder="Project name">
          </div>
        </div>
      `,
      focusConfirm: false,
      confirmButtonText: 'Create',
      confirmButtonColor: 'green',
      preConfirm: () => {
        Swal.showLoading();
        const selectedMode = document.querySelector('input[name="project-mode"]:checked').value;
        const nameInput = document.getElementById('project-name-unified');

        const ontologyInput = document.getElementById('ontology-file');
        const interestedAxiomsInput = document.getElementById('interested-axioms-file');
        const defectInput = document.getElementById('defect-file');

        if (!ontologyInput.value || !interestedAxiomsInput.value || !defectInput.value) {
          Swal.hideLoading();
          Swal.showValidationMessage('Please select all three required files');
          return;
        }

        const formData = new FormData();
        formData.append('ontology_file', ontologyInput.files[0], ontologyInput.value);
        formData.append('interested_axioms_file', interestedAxiomsInput.files[0], interestedAxiomsInput.value);
        formData.append('defect_file', defectInput.files[0], defectInput.value);

        const projectName = nameInput.value || shortid.generate();
        redirectName = projectName;

        return fetch(
          `${BACKEND}/${projectName}/create-dl-repair-project`,
          {
            method: 'POST',
            body: formData,
          },
        );
      },
    }).then((response) => {
      if (response.value) {
        if (response.value.status === 200) {
          Swal.fire({
            title: 'Success!',
            html: 'Redirecting to the created DL Repair project on a new tab.',
            timer: 2000,
            timerProgressBar: true,
          }).then(() => {
            window
              .open(
                window.location.href.split('?')[0] + '?id=' + redirectName,
                '_blank',
              )
              .focus();
          });
        } else {
          Swal.fire({
            icon: 'error',
            title: 'Error Creating Project',
            text: `Something went wrong! Received status ${response.status}. Please see the logs for more details`,
          });
        }
      }
    });
  });

export {
  enablePaneDragBars,
  spawnPane,
  getPanes,
  updatePanes,
  destroyPanes,
  togglePane,
  expandPane,
  collapsePane,
  resizeSplit,
  highlightPaneById,
  uid,
};
