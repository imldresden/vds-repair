import { _ } from 'lodash';
import Swal from 'sweetalert2';

import { info, BACKEND } from '../../main/main.js';
import { stylesheet } from '../../style/views/cy-style.js';
import { COLORS } from '../../style/views/variables.js';
import {
  getPanes,
  spawnPane,
  togglePane,
  destroyPanes,
  updatePanes,
  expandPane,
  collapsePane,
  highlightPaneById,
} from '../panes/panes.js';
import { handleEditorSelection } from '../editor.js';
import { fixed } from '../../utils/utils.js';
import {
  makeTippy,
  hideAllTippies,
  setPane,
  PROJECT,
  updateGraphComparison,
  updateCurvedConnectors,
  updateSidebarLegends,
} from '../../utils/controls.js';
import { parallelCoords } from '../attributes/parallel-coords.js';
import { ndl_to_pcp } from '../format.js';
import { CONSTANTS } from '../../utils/names.js';
import events from '../../utils/events.js';
import { cytoscape } from '../imports/import-cytoscape.js';
import { socket } from '../imports/import-socket.js';

const THROTTLE_DEBOUNCE_DELAY = 100;
var iteration = 0;
var maxIteration = 5;

const setMaxIteration = (value) => {
  maxIteration = value;
};

let selectedPanesData = {
  selectedPanes: [],
  paneCy: null,
};

function getEdgeId(edge) {
  return edge.data.source + edge.data.label + edge.data.target;
}

// used to avoid duplication and wrong removal of nodes and edges
function setElementMapper(cy, elements) {
  cy.elementMapper = {
    nodes: new Map(),
    edges: new Map(),
  };
  elements.nodes.forEach((node) => {
    node.data.id;
    cy.elementMapper.nodes.set(node.data.id, node);
  });
  elements.edges.forEach((edge) => {
    cy.elementMapper.edges.set(getEdgeId(edge), edge);
  });
}

// applies data dependent styling to nodes
function setStyles(cy) {
  cy.startBatch();
  cy.$('node[type = "s"]').addClass('s');
  cy.$('node[type = "t"]').addClass('t');

  cy.edges()
    .removeClass('scheduler')
    .filter((n) => {
      const data = n.data();

      const source = data.source;
      if (source && source.startsWith('t')) {
        const node = cy.elementMapper.nodes.get(source);

        if (node && node.data.scheduler) {
          const nodeSchedulerValue =            node.data.scheduler[cy.vars['scheduler'].value];
          return nodeSchedulerValue > 0;
        }

        return false;
      }

      const target = data.target;
      if (target && target.startsWith('t')) {
        const node = cy.elementMapper.nodes.get(target);
        if (node && node.data.scheduler) {
          const nodeSchedulerValue =            node.data.scheduler[cy.vars['scheduler'].value];
          return nodeSchedulerValue > 0;
        }

        return false;
      }
    })
    .addClass('scheduler');

  cy.endBatch();
}

// queries and updates info on present graph
async function renewInfo(cy) {
  async function getSameGraph(nodes) {
    const ids = nodes.open.join('&id=');
    const idus = nodes.closed.join('&idu=');

    const call = `${BACKEND}/${PROJECT}/reset?${
      ids.length > 0 ? '&id=' + ids : ''
    }${idus.length > 0 ? '&idu=' + idus : ''}`;

    return await (await fetch(call)).json();
  }

  const graph = {
    open: cy.$('node.s[[outdegree > 0]]').map((n) => n.data().id),
    closed: cy.$('node.s[[outdegree = 0]]').map((n) => n.data().id),
  };
  const data = await getSameGraph(graph);
  const mapper = {};

  data.nodes.forEach((n) => {
    mapper[n.id] = n;
  });

  cy.nodes().forEach((n) => {
    const id = n.data().id;

    if (!mapper[id]) console.error('/reset returned unexisiting node');
    if (mapper[id].details) n.data('details', mapper[id].details);
    if (mapper[id].scheduler) n.data('scheduler', mapper[id].scheduler);

    cy.elementMapper.nodes.set(id, { data: n.data() });
  });
}

// requests outgoing edges from a selection of nodes and adds them to the graph
async function expandGraph(cy, nodes, onLayoutStopFn) {
  if (!nodes.length) return;

  const collapsed = nodes
    .filter((n) => n.outgoers().length === 0)
    .map((n) => n.data().id);

  if (collapsed.length === 0) {
    // everything already expanded
    const layout = cy.layout(cy.params);
    layout.pon('layoutstop').then(() => {
      getNexts(cy, cy.$('node.s:selected')).select();
    });

    layout.run();
    return;
  }

  const res = await fetch(
    `${BACKEND}/${PROJECT}/outgoing?id=${collapsed.join('&id=')}`,
  );
  const data = await res.json();

  function finalizeExpand(cy, data) {
    const new_nodes = data.nodes
      .map((d) => ({
        group: 'nodes',
        data: setNeedsHTML(d),
        // position: node.position()
        // WARNING: setting this prop makes nodes immutable, possible bug with cytoscape
      }))
      .filter((d) => {
        const accept = !cy.elementMapper.nodes.has(d.data.id);
        if (accept) {
          cy.elementMapper.nodes.set(d.data.id, d);
        }
        return accept;
      });
    const new_edges = data.edges
      .map((d) => ({
        group: 'edges',
        data: {
          id: d.id,
          label: d.label,
          source: d.source,
          target: d.target,
        },
      }))
      .filter((d) => {
        const accept = !cy.elementMapper.edges.has(getEdgeId(d));
        if (accept) {
          cy.elementMapper.edges.set(getEdgeId(d), d);
        }
        return accept;
      });
    const elements = {
      nodes: new_nodes,
      edges: new_edges,
    };

    cy.nodes().lock();
    cy.add(elements);
    if (new_nodes.length > 0) {
      cy.$('#' + new_nodes.map((n) => n.data.id).join(', #')).position(
        nodes[0].position(), // alternatively, cy.nodes().position(node.position())
      );
    }
    cy.nodes().unlock();

    const layout = cy.layout(cy.params);
    layout.pon('layoutstop').then(() => {
      // kills batch expansion if there is nothing to expand
      if (new_nodes.length !== 0 && onLayoutStopFn) {
        onLayoutStopFn();
      } else {
        getNexts(cy, cy.$('node.s:selected')).select();
      }
      spawnPCP(cy);
    });

    layout.run();
    bindListeners(cy);
    setStyles(cy);
    initHTML(cy);
    const nodesIds = data.nodes
      .map((node) => node.id)
      .filter((id) => !id.startsWith('t'));

    const panes = getPanes();
    panes[cy.paneId].nodesIds = new Set([...(panes[cy.paneId].nodesIds || []), ...nodesIds]);
    updatePanes(panes);

    // trigger graph comparison update if enabled
    const checkbox = document.getElementById('checkbox-graph-comparison');
    if (checkbox?.checked) {
      updateGraphComparison(true);
    }

    // trigger curved connectors update if enabled
    const curvedCheckbox = document.getElementById(
      'checkbox-curved-connectors',
    );
    if (curvedCheckbox?.checked) {
      updateCurvedConnectors(true);
    }
  }

  const limit = document.getElementById('nodesPerPane').value;
  const m = cy.vars['mode'].value;
  const incoming = new Set(
    data.nodes
      .filter((n) => m.includes(n.type) && !cy.elementMapper.nodes.get(n.id))
      .map((n) => n.id),
  );

  if (
    cy.$(`node${m === 's+t' ? '' : '.' + m}`).length + incoming.size
    > limit
  ) {
    Swal.fire({
      title: 'Too many nodes in this pane!',
      text: `The new total amount of nodes exceeds your set limit of ${limit}.`,
      icon: 'warning',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonColor: 'green',
      cancelButtonColor: '#555',
      confirmButtonText: 'Expand in New Pane',
      denyButtonText: 'Expand Here Anyway',
    }).then((result) => {
      if (result.isConfirmed) {
        return fetchAndSpawn(
          cy,
          nodes.map((n) => n.data()),
        );
      } else if (result.isDenied) {
        return finalizeExpand(cy, data);
      }
    });
  } else {
    finalizeExpand(cy, data);
  }
}

function setNeedsHTML(d) {
  // allows checking for 'node[needsHTML = "true"]' to not create empty divs per node
  const aps = d?.details?.[CONSTANTS.atomicPropositions];
  d.needsHTML =    ''
    + (aps
      && (aps[CONSTANTS.ap_init]
        || aps[CONSTANTS.ap_deadlock]
        || aps[CONSTANTS.ap_end]));
  return d;
}

const initHTML = _.debounce((cy) => {
  const html = document.getElementById(cy.container().id);

  Array.from(html.childNodes[0].childNodes).forEach((d, i) => {
    // the html layer lives here, remove it before creating a new one
    i > 2 && d.remove();
  });

  // window.selectAP = (ap) => {
  //   const events = {};
  //   events[CONSTANTS.ap_init] = () => document
  //     .dispatchEvent(
  //       new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, keyCode: 73 }),
  //     );
  //   events[CONSTANTS.ap_deadlock] = () => document
  //     .dispatchEvent(
  //       new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, keyCode: 68 }),
  //     );
  //   events[CONSTANTS.ap_end] = () => document
  //     .dispatchEvent(
  //       new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, keyCode: 69 }),
  //     );
  //   events[ap]();
  // };

  function apsfn(cy, data, padding) {
    const aps = data?.details?.[CONSTANTS.atomicPropositions] || {};

    let html = '';
    Object.keys(info.badges).forEach((ap) => {
      if (aps[CONSTANTS[ap]]) {
        html += info.badges[ap];
      }
    });

    return `<div style="position: relative; padding-top:${padding}px" id="${cy.paneId}-${data.id}">${html}</div>`;
  }

  cy.nodeHtmlLabel(
    [
      // this is extremely costly:
      // notable lag after ~100 nodes are on a pane, even if only a few nodes have html
      {
        query: 'node[needsHTML = "true"].s',
        tpl(data) {
          return apsfn(cy, data, 36.5);
        },
      },
      {
        query: 'node[needsHTML = "true"].s:selected',
        tpl(data) {
          return apsfn(cy, data, 45);
        },
      },
    ],
    { enablePointerEvents: false },
  );
}, 50);

// inits cy with graph data on a pane
function spawnGraph(pane, data, params, vars = {}) {
  const elements = {
    nodes: data.nodes.map((d) => ({ data: setNeedsHTML(d) })),
    edges: data.edges.map((d) => ({ data: d })),
  };

  const cytoscapeInit = {
    container: document.getElementById(pane.container),
    style: stylesheet,
    layout: params,
  };

  if (cytoscapeInit.container) {
    window.cy = cytoscape(cytoscapeInit);
    pane.cy = window.cy;
    const cy = pane.cy;

    if (data.cyImport) {
      cy.json(data.cyImport);
    } else {
      cy.add(elements);
    }
    const nodes = cy
      .elements()
      .nodes()
      .map((d) => ({ data: d.data() }));

    setElementMapper(cy, {
      nodes: nodes,
      edges: cy.edges().map((d) => ({ data: d.data() })),
    });

    cy.startBatch();
    // init props used from elsewhere
    cy.params = params;
    cy.paneId = pane.id;
    cy.stylesheet = stylesheet;
    setPublicVars(cy, vars);
    setStyles(cy);
    bindListeners(cy);
    setPane(pane.id, { make: true });
    initHTML(cy);
    cy.endBatch();

    initControls(cy);

    selectAll(cy);
    spawnPCP(cy, vars.order);
    dispatchEvent(events.GLOBAL_PROPAGATE);
    return cy;
  }
  return null;
}

function haveCommonNodes(array1, obj2) {
  var isInclude = null;
  if (array1 && obj2) {
    array1.forEach((i) => {
      Object.keys(obj2).forEach((key) => {
        const list = obj2[key].spawnerNodes;
        if (list?.includes(array1[i])) {
          isInclude = key;
        }
      });
    });
  }
  return isInclude;
}

async function checkSpawnNodes(cy, nodes) {
  const nodesId = nodes.map((n) => n.id);
  var allSpawnerNodes = {};
  const panes = getPanes();
  Object.keys(getPanes()).forEach((paneId) => {
    const spawnerNodes = getPanes()[paneId].spawnerNodes;
    allSpawnerNodes[paneId] = spawnerNodes;
  });

  if (allSpawnerNodes && Object.keys(allSpawnerNodes).length > 0) {
    const common = haveCommonNodes(nodesId, panes);
    if (common) {
      Swal.fire({
        title: 'Node(s) already explored',
        text: 'The nodes have been explored in another pane',
        icon: 'warning',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#555',
        confirmButtonText: 'Go to pane',
        denyButtonText: 'Expand anyway',
      }).then((result) => {
        if (result.isConfirmed) {
          return highlightPaneById(common);
        } else if (result.isDenied) {
          return fetchAndSpawn(cy, nodes);
        }
      });
    } else {
      fetchAndSpawn(cy, nodes);
    }
  } else {
    return fetchAndSpawn(cy, nodes);
  }
}

// creates new pane and then spawns graph
function spawnGraphOnNewPane(cy, nodes) {
  if (nodes.length === 0) {
    return; // console.error?
  }

  checkSpawnNodes(cy, nodes);
}

async function fetchAndSpawn(cy, nodes) {
  if (!nodes.length) return;

  const res = await fetch(
    `${BACKEND}/${PROJECT}/outgoing?id=${nodes.map((n) => n.id).join('&id=')}`,
  );
  const data = await res.json();

  const nodesIds = data.nodes
    .map((node) => node.id)
    .filter((id) => !id.startsWith('t'));
  const spawnerNodes = nodes.map((n) => n.id);

  const newPanePosition = cy.vars['panePosition'];
  const pane = spawnPane(
    {
      // pane that spawns the new one
      spawner: cy.container().parentElement.id,
      id: null,
      newPanePosition,
    },
    nodesIds,
    spawnerNodes,
  );

  let vars = {};
  if (cy.vars) {
    const varsValues = {};
    Object.keys(cy.vars).forEach((k) => {
      if (cy.vars[k].avoidInClone) {
        return;
      }
      varsValues[k] = {
        value: cy.vars[k].value,
      };
    });
    vars = structuredClone(varsValues);
  }
  vars.order = cy.pcp.getOrder();
  spawnGraph(pane, data, structuredClone(cy.params), vars);
}

function getNexts(cy, sources) {
  let ids;
  if (cy.vars['scheduler'].value === '_none_') {
    // open everything, as there is no decider / DOI / scheduler
    ids = sources.map((src) => getNextInPath(cy, src.data().id).next).flat();
  } else {
    // follow only the "best" path according to DOI/scheduler
    ids = sources.map((src) => getNextBestInPath(cy, src.data().id).bestNext);
  }

  const nexts = cy.nodes('#' + ids.join(', #'));
  return nexts;
}

async function expandBestPath(cy, allSources) {
  let sources = allSources.filter(
    (s) => !s.data()?.details?.[CONSTANTS.atomicPropositions]?.[CONSTANTS.ap_end]?.value,
  );

  while (
    iteration < maxIteration
    && sources.filter((n) => n.outgoers().length === 0).length === 0
  ) {
    sources = getNexts(cy, cy.$('node.s:selected'));
    sources.select();
    iteration += 1;
  }

  if (iteration >= maxIteration) {
    return;
  }

  await expandGraph(cy, sources, () => {
    const nexts = getNexts(cy, sources);
    iteration += 1;

    if (iteration < maxIteration && nexts) {
      expandBestPath(cy, nexts);
    }
    nexts.select();
  });
}

// for a state, returns best next state based on DOI/scheduler
function getNextBestInPath(cy, sourceNodeId) {
  if (cy.$(`#${sourceNodeId}`).outgoers().length === 0) {
    return { cy, bestNext: sourceNodeId };
  }

  let bestValue = 0;
  let bestNext = '';
  let tId = '';

  // chooses next best action
  cy.edges().forEach((n) => {
    const source = n.data().source;
    const target = n.data().target;

    if (target && target.startsWith('t')) {
      const node = cy.elementMapper.nodes.get(target);
      if (node && node.data.scheduler && source === sourceNodeId) {
        const nodeSchedulerValue =          node.data.scheduler[cy.vars['scheduler'].value];
        if (nodeSchedulerValue >= bestValue) {
          bestValue = nodeSchedulerValue;
          bestNext = target;
          tId = target;
        }
      }
    }
  });

  // chooses next best state, from the selected action
  cy.edges().forEach((n) => {
    const source = n.data().source;
    const target = n.data().target;

    if (source && source.startsWith('t') && source === tId) {
      const node = cy.elementMapper.nodes.get(source);
      if (node && node.data.scheduler) {
        const nodeSchedulerValue =          node.data.scheduler[cy.vars['scheduler'].value];
        if (nodeSchedulerValue >= bestValue) {
          bestValue = nodeSchedulerValue;
          bestNext = target;
          tId = source;
        }
      }
    }
  });

  return { cy, bestNext: cy.elementMapper.nodes.get(bestNext).data.id };
}

// for a state, returns all possible next states
function getNextInPath(cy, sourceNodeId) {
  if (cy.$(`#${sourceNodeId}`).outgoers().length === 0) {
    return { cy, next: sourceNodeId };
  }

  // gathers children actions
  const nextActions = cy
    .$(`#${sourceNodeId}`)
    .outgoers('node.t')
    .map((n) => n.data().id);

  // gathers states children to the actions
  const next = cy
    .$('#' + nextActions.join(', #'))
    .outgoers('node.s')
    .map((n) => n.data().id);

  return { cy, next };
}

// for a state, returns all states that led to it
function getPreviousInPath(cy, sourceNodeId) {
  if (cy.$(`#${sourceNodeId}`).incomers().length === 0) {
    return { cy, prev: sourceNodeId };
  }

  // gathers children actions
  const prevActions = cy
    .$(`#${sourceNodeId}`)
    .incomers('node.t')
    .map((n) => n.data().id);

  // gathers states children to the actions
  const prev = cy
    .$('#' + prevActions.join(', #'))
    .incomers('node.s')
    .map((n) => n.data().id);

  return { cy, prev };
}

function spawnPCP(cy, order = undefined) {
  const m = cy.vars.mode.value;
  const selector = m === 's+t' ? '' : '.' + m;
  let selected = 0;

  // Preserve overlay state from existing PCP if it exists
  let preservedOverlayState = null;
  if (cy.pcp && cy.pcp.getOverlayState) {
    preservedOverlayState = cy.pcp.getOverlayState();
  }

  const { pl, pld } = ndl_to_pcp(
    {
      nodes: cy.$(`node${selector}`).map((n) => {
        const d = n.data();
        d._selected = n.selected();
        if (d._selected) selected += 1;
        return d;
      }),
    },
    cy.vars.details.value,
  );

  const hidden = new Set(['color']);
  const props = Object.keys(pld).filter((k) => !hidden.has(k));
  const sorted_dim_metadata = {};

  const previous_pcp_order = cy.pcp ? cy.pcp.getOrder() : undefined;
  const pcp_order = order ? structuredClone(order) : previous_pcp_order;

  if (pcp_order) {
    pcp_order.forEach((key) => {
      if (pld[key]) {
        sorted_dim_metadata[key] = pld[key];
        delete pld[key];
      }
    });
  }

  Object.keys(pld).forEach((key) => (sorted_dim_metadata[key] = pld[key]));

  cy.pcp = parallelCoords(getPanes()[cy.paneId], pl, {
    data_id: 'id',
    nominals: props.filter((k) => sorted_dim_metadata[k].type === 'nominal'),
    booleans: props.filter((k) => sorted_dim_metadata[k].type === 'boolean'),
    numbers: props.filter((k) => sorted_dim_metadata[k].type === 'number'),
    pld: sorted_dim_metadata,
    preselected: selected,
  });

  // Restore overlay state if it was preserved
  if (preservedOverlayState && preservedOverlayState.enabled && preservedOverlayState.panes.length > 0) {
    cy.pcp.enableOverlay(preservedOverlayState.panes);
  }

  cy.paneFromPCP = (pane) => {
    spawnGraphOnNewPane(pane.cy, pane.cy.pcp.getSelection());
  };
}

/// /////////////////////////////////////////////////////////////////////////////////////
//  INTERACTIONS: Everything below here could be refactored to other files
/// /////////////////////////////////////////////////////////////////////////////////////

function unbindListeners(cy) {
  // clean listeners
  cy.off('tap cxttapstart grabon zoom pan');
  cy.off('select boxselect box tapselect tapunselect dbltap');
  cy.off('mouseover mousemove mouseout');
  cy.off('tap', 'edge');
  if (cy.ctxmenu) {
    cy.ctxmenu.destroy();
  }
}

let nodeDetailsWindowZ = 10000;
let nodeDetailsWindowCount = 0;

function openDraggableDetailsWindow({ titleHtml, contentEl, originalEvent }) {
  const winId = `node-details-window-${Date.now()}-${nodeDetailsWindowCount++}`;
  const $win = document.createElement('div');
  $win.id = winId;
  $win.style.cssText = `
    position: fixed;
    width: 760px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 40px);
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    overflow: hidden;
    z-index: ${++nodeDetailsWindowZ};
  `;

  const $header = document.createElement('div');
  $header.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    cursor: grab;
    user-select: none;
    border-bottom: 1px solid #e5e7eb;
    background: #f9fafb;
  `;

  const $title = document.createElement('div');
  $title.style.cssText = 'font-weight: 600; font-size: 13px; line-height: 1.2;';
  $title.innerHTML = titleHtml;

  const $close = document.createElement('button');
  $close.type = 'button';
  $close.setAttribute('aria-label', 'Close');
  $close.style.cssText = `
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    font-size: 18px;
    line-height: 28px;
    color: #6b7280;
  `;
  $close.textContent = '×';

  const $body = document.createElement('div');
  $body.style.cssText = 'padding: 12px; overflow: auto; max-height: calc(100vh - 120px);';
  $body.appendChild(contentEl);

  $header.appendChild($title);
  $header.appendChild($close);
  $win.appendChild($header);
  $win.appendChild($body);

  // Initial positioning
  const margin = 20;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const baseX = typeof originalEvent?.clientX === 'number' ? originalEvent.clientX : Math.floor(viewportW / 2);
  const baseY = typeof originalEvent?.clientY === 'number' ? originalEvent.clientY : Math.floor(viewportH / 2);
  const cascade = (nodeDetailsWindowCount % 10) * 18;

  // Place near cursor, clamped into viewport (use translate so we can measure after append)
  $win.style.left = Math.max(margin, Math.min(viewportW - margin - 760, baseX + 10 + cascade)) + 'px';
  $win.style.top = Math.max(margin, Math.min(viewportH - margin - 400, baseY + 10 + cascade)) + 'px';

  document.body.appendChild($win);

  const bringToFront = () => {
    $win.style.zIndex = String(++nodeDetailsWindowZ);
  };
  $win.addEventListener('mousedown', bringToFront, { passive: true });

  // Dragging
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const onMouseMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const nextLeft = Math.max(margin, Math.min(window.innerWidth - margin - $win.offsetWidth, startLeft + dx));
    const nextTop = Math.max(margin, Math.min(window.innerHeight - margin - $win.offsetHeight, startTop + dy));
    $win.style.left = nextLeft + 'px';
    $win.style.top = nextTop + 'px';
  };

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    $header.style.cursor = 'grab';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  $header.addEventListener('mousedown', (e) => {
    // Only left click
    if (e.button !== 0) return;
    bringToFront();
    dragging = true;
    $header.style.cursor = 'grabbing';
    startX = e.clientX;
    startY = e.clientY;
    startLeft = $win.offsetLeft;
    startTop = $win.offsetTop;
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mouseup', onMouseUp, { passive: true });
  }, { passive: true });

  const destroy = () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    $win.remove();
  };

  $close.addEventListener('click', destroy, { passive: true });
}

function buildDetailsTooltipFromNode(cy, n) {
  n.unselectify();
  cy.pendingSelectify = true;

  const g = n.data();
  const $blocks = [];
  const details = cy.vars['details'].value;
  Object.keys(details).forEach(d => {
    if (!g.details[d]) return;

    const show = details[d].all
      || Object.values(
        details[d].props,
      ).reduce((a, b) => a || b, false);

    if (show) {
      const block = document.createElement('div');
      block.innerHTML = `
        <p>${d} ======== </p>
        <pre>${
          Object.keys(details[d].props)
            .filter(p => details[d].props[p])
            .map(k => {
              if (details[d].metadata[k].type === 'number') {
                return `${k}: <span id="tt-${g.id}-${k}">${fixed(g.details[d][k])}</span>`;
              } else {
                return `${k}: <span id="tt-${g.id}-${k}">${g.details[d][k]}</span>`;
              }
            })
            .join('\n')
        }</pre>
      `;
      $blocks.push(block);
    }
  });

  if ($blocks.length > 0) {
    const tooltip = document.createElement('div');
    tooltip.style.textAlign = 'right';
    $blocks.forEach(block => tooltip.appendChild(block));
    makeTippy(n, tooltip, `tippy-${g.id}`);
  }
}

// function buildDetailsTooltipFromNode(cy, n, originalEvent = undefined) {
// KILLSWITCHED
//   n.unselectify();
//   cy.pendingSelectify = true;

//   const g = n.data();
//   const details = cy.vars.details.value;

//   // Category color themes
//   const categoryColors = {
//     'Variable Values': { bg: '#eff6ff', header: '#3b82f6', border: '#bfdbfe' },
//     'Reward Structures': { bg: '#f0fdf4', header: '#10b981', border: '#bbf7d0' },
//     'Model Checking Results': { bg: '#faf5ff', header: '#8b5cf6', border: '#e9d5ff' },
//   };

//   // Gather graph metrics
//   const incomingEdges = n.incomers('edge').length;
//   const outgoingEdges = n.outgoers('edge').length;
//   const degree = n.degree();
//   const isSelected = n.selected();

//   // Build overview section
//   const overviewHtml = `
//     <div style="background: #667eea; color: white; padding: 15px; border-radius: 6px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
//       <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; text-align: center;">
//         <div>
//           <div style="font-size: 11px; opacity: 0.9; margin-bottom: 4px;">Incoming</div>
//           <div style="font-size: 20px; font-weight: bold;">${incomingEdges}</div>
//         </div>
//         <div>
//           <div style="font-size: 11px; opacity: 0.9; margin-bottom: 4px;">Outgoing</div>
//           <div style="font-size: 20px; font-weight: bold;">${outgoingEdges}</div>
//         </div>
//         <div>
//           <div style="font-size: 11px; opacity: 0.9; margin-bottom: 4px;">Degree</div>
//           <div style="font-size: 20px; font-weight: bold;">${degree}</div>
//         </div>
//       </div>
//     </div>
//   `;

//   const $blocks = [];

//   Object.keys(details).forEach((d) => {
//     if (!g.details[d]) return;

//     const show =      details[d].all
//       || Object.values(details[d].props).reduce((a, b) => a || b, false);

//     if (show) {
//       const colorTheme = categoryColors[d] || { bg: '#f9fafb', header: '#6b7280', border: '#e5e7eb' };
//       const block = document.createElement('div');
//       block.style.marginBottom = '20px';

//       // Collect all values for this category to calculate min/max
//       const categoryValues = {};
//       const attributes = Object.keys(details[d].props).filter((p) => details[d].props[p]);

//       attributes.forEach((k) => {
//         const isNumber = details[d].metadata[k]?.type === 'number';
//         if (isNumber && details[d].metadata[k]) {
//           const min = details[d].metadata[k].min;
//           const max = details[d].metadata[k].max;
//           // Only add if min/max are valid numbers
//           if (typeof min === 'number' && typeof max === 'number' && !isNaN(min) && !isNaN(max)) {
//             categoryValues[k] = {
//               value: g.details[d][k],
//               min: min,
//               max: max,
//             };
//           }
//         }
//       });

//       // Build table HTML
//       let tableHtml = `
//         <div style="margin-bottom: 15px;">
//           <div style="background: ${colorTheme.header}; color: white; padding: 10px; border-radius: 6px 6px 0 0; font-weight: bold; font-size: 14px; text-align: center; display: flex; justify-content: space-between; align-items: center;">
//             <span>${d}</span>
//             <span style="font-size: 11px; opacity: 0.9; font-weight: normal;">${attributes.length} attribute${attributes.length !== 1 ? 's' : ''}</span>
//           </div>
//           <table style="width: 100%; border-collapse: collapse; border: 1px solid ${colorTheme.border}; border-top: none;">
//             <tbody>
//       `;

//       attributes.forEach((k, idx) => {
//         const isNumber = details[d].metadata[k]?.type === 'number';
//         const value = g.details[d][k];
//         const displayValue = isNumber ? fixed(value) : value;
//         const rowBg = idx % 2 === 0 ? '#ffffff' : colorTheme.bg;

//         let valueCell = `<td style="padding: 10px 12px; text-align: right; border-bottom: 1px solid ${colorTheme.border}; font-weight: 600; color: ${colorTheme.header}; font-family: 'Courier New', monospace;">
//           ${displayValue}
//         </td>`;

//         // Add range visualization for numeric values
//         if (isNumber && categoryValues[k]) {
//           const min = categoryValues[k].min;
//           const max = categoryValues[k].max;
//           const range = max - min;
//           const percentage = range > 0 ? ((value - min) / range) * 100 : 50;

//           // Ensure displayValue is valid for numeric display
//           const safeDisplayValue = typeof value === 'number' && !isNaN(value) ? fixed(value) : value;

//           // Add range indicator bar
//           valueCell = `
//             <td style="padding: 8px 12px; border-bottom: 1px solid ${colorTheme.border};">
//               <div style="display: flex; align-items: center; gap: 10px;">
//                 <div style="flex: 1; background: #e5e7eb; height: 8px; border-radius: 4px; position: relative; overflow: hidden;">
//                   <div style="position: absolute; left: 0; top: 0; height: 100%; width: ${percentage}%; background: linear-gradient(90deg, ${colorTheme.header}cc, ${colorTheme.header}); border-radius: 4px; transition: width 0.3s;"></div>
//                   <div style="position: absolute; left: ${percentage}%; top: 50%; transform: translate(-50%, -50%); width: 3px; height: 14px; background: ${colorTheme.header}; border-radius: 2px; box-shadow: 0 0 3px rgba(0,0,0,0.3);"></div>
//                 </div>
//                 <div style="font-weight: 600; color: ${colorTheme.header}; font-family: 'Courier New', monospace; min-width: 80px; text-align: right;">
//                   ${safeDisplayValue}
//                 </div>
//               </div>
//               <div style="display: flex; justify-content: space-between; margin-top: 2px; font-size: 10px; color: #9ca3af;">
//                 <span>min: ${typeof min === 'number' ? fixed(min) : min}</span>
//                 <span>max: ${typeof max === 'number' ? fixed(max) : max}</span>
//               </div>
//             </td>
//           `;
//         }

//         tableHtml += `
//           <tr style="background-color: ${rowBg};">
//             <td style="padding: 10px 12px; text-align: left; border-bottom: 1px solid ${colorTheme.border}; font-weight: 500; color: #374151; width: 40%;">
//               ${k}
//             </td>
//             ${valueCell}
//           </tr>
//         `;
//       });

//       tableHtml += `
//             </tbody>
//           </table>
//         </div>
//       `;

//       block.innerHTML = tableHtml;
//       $blocks.push(block);
//     }
//   });

//   if ($blocks.length > 0) {
//     const container = document.createElement('div');
//     container.style.textAlign = 'left';

//     // Add overview section
//     const overviewDiv = document.createElement('div');
//     overviewDiv.innerHTML = overviewHtml;
//     container.appendChild(overviewDiv);

//     // Add attribute blocks
//     $blocks.forEach((block) => container.appendChild(block));

//     const titleHtml = `
//       <div style="display: flex; align-items: center; gap: 10px;">
//         <span>Node Details: ${g.id}</span>
//         ${isSelected ? '<span style="background: #10b981; color: white; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: normal;">SELECTED</span>' : ''}
//       </div>
//     `;
//     openDraggableDetailsWindow({ titleHtml, contentEl: container, originalEvent });
//   }
// }

function buildComparisonTooltip(cy, nodes) {
  // Support both single comparison (2 nodes) and multi-node comparison
  const nodeArray = Array.isArray(nodes) ? nodes : [nodes];
  const nodeData = nodeArray.map((n) => n.data());
  const details = cy.vars.details.value;

  // Highlight in PCP
  const nodeIds = nodeData.map((g) => g.id);
  if (cy.pcp && cy.pcp.setComparison) {
    cy.pcp.setComparison(nodeIds);
  }

  // Color generator function (same as PCP)
  const baseColors = [
    '#3b82f6',
    '#ef4444',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#14b8a6',
    '#f97316',
  ];

  function generateComparisonColor(index) {
    if (index < baseColors.length) {
      return baseColors[index];
    }
    const hue = (index * 137.5) % 360;
    const saturation = 65 + (index % 3) * 10;
    const lightness = 45 + (index % 4) * 5;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  const $blocks = [];

  Object.keys(details).forEach((d) => {
    // Check if any node has data for this category
    const hasData = nodeData.some((g) => g.details[d]);
    if (!hasData) return;

    const show =      details[d].all
      || Object.values(details[d].props).reduce((a, b) => a || b, false);

    if (show) {
      const block = document.createElement('div');
      block.style.marginBottom = '25px';

      // Build category header
      let tableHtml = `<p style="font-weight: bold; font-size: 14px; margin-bottom: 10px; text-align: center;">${d}</p>`;

      // Start table
      tableHtml
        += '<table style="width: 100%; border-collapse: collapse; margin: 0 auto; max-width: 95%;">';

      // Table header with node IDs
      tableHtml += '<thead><tr>';
      tableHtml
        += '<th style="padding: 10px; text-align: left; border-bottom: 2px solid #e5e7eb; font-weight: bold; background-color: #f9fafb;">Attribute</th>';
      nodeData.forEach((g, idx) => {
        const color = generateComparisonColor(idx);
        tableHtml += `<th style="padding: 10px; text-align: center; border-bottom: 2px solid #e5e7eb; color: ${color}; font-weight: bold; background-color: #f9fafb;">Node ${g.id}</th>`;
      });
      tableHtml += '</tr></thead>';

      tableHtml += '<tbody>';

      Object.keys(details[d].props)
        .filter((p) => details[d].props[p])
        .forEach((k, rowIdx) => {
          const isNumber = details[d].metadata[k].type === 'number';

          // Collect all values for this attribute
          const values = nodeData.map((g) => {
            const val = g.details[d]?.[k];
            return val !== undefined ? (isNumber ? fixed(val) : val) : null;
          });

          // Check if all values are the same (or all null)
          const nonNullValues = values.filter((v) => v !== null);
          const allSame =            nonNullValues.length > 0
            && nonNullValues.every((v) => v === nonNullValues[0]);

          // Alternating row background
          const rowBg = rowIdx % 2 === 0 ? '#ffffff' : '#f9fafb';

          // Start row
          tableHtml += `<tr style="background-color: ${rowBg};">`;

          // Attribute name column
          tableHtml += `<td style="padding: 8px 10px; text-align: left; border-bottom: 1px solid #e5e7eb; font-weight: 500;">${k}</td>`;

          // Value columns
          values.forEach((val, idx) => {
            const color = generateComparisonColor(idx);
            const displayVal = val !== null ? val : 'N/A';
            const bgColor = allSame
              ? 'transparent'
              : val !== null
                ? '#fff3cd'
                : '#f3f4f6';
            const textColor = val === null ? '#9ca3af' : color;
            const fontStyle = val === null ? 'italic' : 'normal';
            const fontWeight = val === null ? 'normal' : '600';

            tableHtml += `<td style="padding: 8px 10px; text-align: center; border-bottom: 1px solid #e5e7eb; background-color: ${bgColor}; color: ${textColor}; font-style: ${fontStyle}; font-weight: ${fontWeight};">${displayVal}</td>`;
          });

          tableHtml += '</tr>';
        });

      tableHtml += '</tbody></table>';

      block.innerHTML = tableHtml;
      $blocks.push(block);
    }
  });

  if ($blocks.length > 0) {
    const tooltip = document.createElement('div');
    tooltip.style.textAlign = 'center';
    $blocks.forEach((block) => tooltip.appendChild(block));

    const nodeIds = nodeData.map((g) => g.id).join(', ');
    const titleText =      nodeData.length === 2
      ? `Comparing Nodes: ${nodeIds}`
      : `Comparing ${nodeData.length} Nodes: ${nodeIds}`;

    Swal.fire({
      title: titleText,
      html: tooltip,
      width: '900px',
      confirmButtonText: 'Close',
      confirmButtonColor: '#555',
    });
  } else {
    Swal.fire({
      title: 'No comparable attributes',
      text: 'These nodes have no visible attributes to compare.',
      icon: 'info',
    });
  }
}

// Expose globally for PCP context menu access
window.buildComparisonTooltip = buildComparisonTooltip;

function bindListeners(cy) {
  unbindListeners(cy);
  cy.edges().unselectify();

  cy.on('tap', (e) => {
    if (e.target === cy) {
      setPane(cy.paneId);
      hideAllTippies();

      // ensure that selections don't go away when clicking the background once
      cy.nodes().unselectify();
      cy.pendingSelectify = true;
    } else {
      selectifyByMode(cy);
    }
  });

  cy.on('cxttapstart', () => {
    setPane(cy.paneId);
  });

  ctxmenu(cy);

  cy.on('grabon', (e) => {
    setPane(cy.paneId);
    if (!e.originalEvent.shiftKey) {
      hideAllTippies();
    }
  });

  cy.on('tap', 'edge', () => {
    setPane(cy.paneId);
    hideAllTippies();
  });

  cy.on('zoom pan', () => {
    setPane(cy.paneId);
    hideAllTippies();
  });

  cy.on(
    'boxselect tapselect tapunselect',
    _.debounce(() => {
      if (cy.vars['pcp-auto-sync'].value) {
        spawnPCP(cy);
      }
    }, THROTTLE_DEBOUNCE_DELAY),
  );

  cy.on('box', (e) => {
    if (cy.keyboard?.shiftKey && e.target.selected()) {
      e.target.unselect();
      e.target.unselectify();
      cy.pendingSelectify = true;
    }
  });

  // re-enable selections after the previous check happened
  cy.on('dbltap mousemove', () => {
    cy.pendingSelectify &&= selectifyByMode(cy) && false;
  });

  cy.on('select unselect', (e) => {
    handleEditorSelection(e, cy);

    // Emit matrix-selection event for cross-pane synchronization
    const target = e.target;
    if (target && target.isNode && target.isNode() && target.data('type') === 's') {
      const nodeId = target.id();
      const isSelected = target.selected();
      window.dispatchEvent(events.MATRIX_SELECTION(cy.paneId, nodeId, isSelected));
    }
  });

  cy.on('tap', 'node', (e) => {
    const n = e.target;
    setPane(cy.paneId);

    if (!e.originalEvent.shiftKey) {
      hideAllTippies();
    }

    if (e.originalEvent.shiftKey) {
      buildDetailsTooltipFromNode(cy, n, e.originalEvent);
    }
  });

  cy.on('dbltap', 'node.s', (e) => {
    const n = e.target;
    hideAllTippies();

    if (
      (e.originalEvent.altKey || e.originalEvent.ctrlKey)
      && n.classes().filter((c) => c === 's').length > 0
    ) {
      spawnGraphOnNewPane(cy, [n.data()]);
    } else if (e.originalEvent.shiftKey) {
      expandBestPath(cy, [n]);
    } else {
      expandGraph(cy, [n]);
    }
  });

  cy.on('mouseover', 'node', (e) => {
    if (cy?._matrixViewActive) return;
    // If this pane is currently showing the matrix view, Cytoscape can still
    // receive pointer events via its container; ignore hover-sync in that case.
    try {
      const container = cy.container();
      const paneContainerId = container?.parentElement?.id || container?.id;
      if (paneContainerId && document.getElementById(`${paneContainerId}-matrix`)) return;
    } catch {
      // ignore
    }

    var node = e.target;
    const nodeId = node.id();
    markRecurringNodesById(nodeId);

    // Highlight corresponding line in PCP for ALL panes
    // const panes = getPanes();
    // Object.values(panes).forEach((pane) => {
    //   if (pane?.cy?.pcp?.highlightNode) {
    //     pane.cy.pcp.highlightNode(nodeId);
    //   }
    // });
    if (cy?.pcp?.highlightNode) {
      cy.pcp.highlightNode(nodeId);
    }
  });

  cy.on('mouseout', 'node', () => {
    if (cy?._matrixViewActive) return;
    try {
      const container = cy.container();
      const paneContainerId = container?.parentElement?.id || container?.id;
      if (paneContainerId && document.getElementById(`${paneContainerId}-matrix`)) return;
    } catch {
      // ignore
    }

    unmarkRecurringNodes();

    // // Clear PCP highlight for ALL panes
    // const panes = getPanes();
    // Object.values(panes).forEach((pane) => {
    //   if (pane?.cy?.pcp?.clearHighlight) {
    //     pane.cy.pcp.clearHighlight();
    //   }
    // });

    if (cy?.pcp?.clearHighlight) {
      cy.pcp.clearHighlight();
    }
  });
}

function selectifyByMode(cy) {
  cy.nodes().selectify();

  const mode = cy.vars.mode.value;
  if (mode === 's') {
    cy.$('node.t').unselectify();
  } else if (mode === 't') {
    cy.$('node.s').unselectify();
  }
}

// functions called from other to set variables (see setPublicVars below)
function setSelectMode(cy, mode) {
  cy.vars.mode.value = mode;
  cy.startBatch();
  cy.nodes().unselect();
  // adjust selection styles
  if (mode === 's') {
    // states
    cy.style()
      .selector('core')
      .css({ 'selection-box-color': COLORS.SELECTED_NODE_COLOR });
    cy.$('node.t').unselectify();
  } else if (mode === 't') {
    // actions / transitions
    cy.style()
      .selector('core')
      .css({ 'selection-box-color': COLORS.SECONDARY_SELECTION });
    cy.$('node.s').unselectify();
  } else {
    // both
    cy.style()
      .selector('core')
      .css({ 'selection-box-color': COLORS.DUAL_SELECTION });
  }

  cy.style().update();
  cy.endBatch();
}

function setUpdateState(cy) {
  const props = cy.vars.details.value[CONSTANTS.results].metadata;
  let decided = false;

  Object.keys(props).forEach((k) => {
    if (decided) return;

    if (info.details[CONSTANTS.results][k].status !== CONSTANTS.STATUS.ready) {
      cy.vars.update.value = CONSTANTS.STATUS.missing;
      decided = true;
    }
  });

  if (!decided) {
    cy.vars.update.value = CONSTANTS.STATUS.ready;
  }
}

function updateDetailsToShow(cy, { update } = {}) {
  const props = {};
  const details = structuredClone(info.details);

  let init = true;
  if (update) {
    init = false;
  }

  let mode = CONSTANTS.results;
  const ready =    details[CONSTANTS.results]
    && Object.values(details[CONSTANTS.results])
      .map((a) => a.status === CONSTANTS.STATUS.ready)
      .reduce((a, b) => a && b, true);

  if (!ready) {
    mode = CONSTANTS.variables;
  }

  Object.keys(details).forEach((d) => {
    if (d === CONSTANTS.metadata) {
      return;
    }

    let truthVal = false;
    if (d === mode) {
      truthVal = true;
    }

    props[d] = {
      all: init ? truthVal : update[d].all,
      props: {},
      metadata: {},
    };

    Object.keys(details[d]).forEach((p) => {
      const iv =        truthVal
        || (d === CONSTANTS.results
          && info.details[d][p].status === CONSTANTS.STATUS.ready);
      props[d].props[p] = init ? iv : update[d].props[p];
      props[d].metadata[p] = info.details[d] ? info.details[d][p] : undefined;
    });
  });

  cy.vars.details.value = props;
  spawnPCP(cy);
}

function updateScheduler(cy, prop) {
  cy.vars.scheduler.value = prop;
  setStyles(cy);
  cy.resize();
}

function updateNewPanePosition(cy, prop) {
  cy.vars.panePosition.value = prop;
}

function toggleFullSync(cy, prop) {
  cy.vars['pcp-auto-sync'].value = prop;

  // reset context menus...
  bindListeners(cy);
  spawnPCP(cy);
}

function togglePCPFlag(cy, prop, name) {
  cy.vars[name].value = prop;
  cy.pcp.redraw();
}

function updateBoundsIndicator(cy, prop) {
  cy.vars['pcp-bi'].value = prop;
  cy.pcp.redraw();
}

function selectBasedOnAP(cy, e, ap) {
  e && e.preventDefault();

  if (info.initial !== '#') {
    cy.nodes().deselect();
    const states = cy
      .nodes('.s')
      .filter((d) => d.data()?.details?.[CONSTANTS.atomicPropositions]?.[ap]);

    if (states.length > 0) {
      states.select();

      if (cy.vars['pcp-auto-sync'].value) {
        spawnPCP(cy);
      }
    }
  }
}

function mark(cy, selection) {
  if (selection.length > 0) {
    const nodes = cy.$('#' + selection.join(', #'));
    nodes.addClass('marked');
    // Update sidebar legend counts
    const pane = Object.values(getPanes()).find(p => p.cy === cy);
    if (pane) updateSidebarLegends(pane);
  }
}

function unmark(cy, selection) {
  if (selection.length > 0) {
    const nodes = cy.$('#' + selection.join(', #'));
    nodes.removeClass('marked');
    // Update sidebar legend counts
    const pane = Object.values(getPanes()).find(p => p.cy === cy);
    if (pane) updateSidebarLegends(pane);
  }
}

async function importCy(cy) {
  await Swal.fire({
    title: 'Import Model to Pane',
    html: `
        <p> Select .json file to import to the Graph View </p>
        <label style="float:left;margin-bottom:10px" for="prism-model">Choose a model file:</label>
        <div class="ui file input">
            <input id="import-graph" type="file" accept=".json" multiple>
        </div>
        `,
    focusConfirm: false,
    confirmButtonText: 'Import',
    confirmButtonColor: 'green',

    preConfirm: () => {
      const input = document.getElementById('import-graph');
      if (input.value) {
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
          // const backup = {
          //   nodes: Array.from(cy.elementMapper.nodes.values()),
          //   edges: Array.from(cy.elementMapper.edges.values()),
          //   info: info,
          // };

          const data = {
            nodes: [],
            edges: [],
            info: info,
            cyImport: JSON.parse(e.target.result),
          };

          let vars = {};
          if (cy.vars) {
            const varsValues = {};
            Object.keys(cy.vars).forEach((k) => {
              if (cy.vars[k].avoidInClone) {
                return;
              }
              varsValues[k] = {
                value: cy.vars[k].value,
              };
            });
            vars = structuredClone(varsValues);
          }
          cy = spawnGraph(
            getPanes()[cy.paneId],
            data,
            structuredClone(cy.params),
            vars,
          );
          setPane(cy.paneId, { make: true, force: true }); // reset sidebar to new content
          dispatchEvent(events.GLOBAL_PROPAGATE);
        };
        reader.readAsText(file);
      }
    },
  });
}

async function exportCyList(cyList) {
  if (cyList && cyList.length > 0) {
    var jsonDataList = [];
    cyList.forEach((cy) => {
      const paneData = cy.json();
      jsonDataList.push(paneData);
    });
    downloadJSONsAsZip(jsonDataList);
  }
}

async function downloadJSONsAsZip(jsonDataList) {
  const zip = new JSZip();
  await Swal.fire({
    title: 'Export Models in the Panes',
    text: 'Downloads Graph View contents as .zip',
    icon: 'warning',
    showCancelButton: true,
    showDenyButton: false,
    confirmButtonColor: 'green',
    cancelButtonColor: '#555',
    confirmButtonText: 'Download',
  }).then((result) => {
    if (result.isConfirmed) {
      try {
        // Fetch each JSON file and add it to the zip
        jsonDataList.forEach((jsonData, i) => {
          const blob = new Blob([JSON.stringify(jsonData)], {
            type: 'application/json',
          });
          zip.file(`graph${i + 1}.json`, blob);
        });
        zip.generateAsync({ type: 'blob' }).then((zipBlob) => {
          const downloadLink = document.createElement('a');
          downloadLink.href = URL.createObjectURL(zipBlob);
          downloadLink.download = 'graph_files.zip';
          downloadLink.click();
        });
      } catch (error) {
        console.error('Error:', error);
      }
    }
  });
}

async function exportCy(cy, selection) {
  await Swal.fire({
    title: 'Export Model in Pane',
    text: 'Downloads Graph View content as .json',
    icon: 'warning',
    showCancelButton: true,
    showDenyButton: false,
    confirmButtonColor: 'green',
    cancelButtonColor: '#555',
    confirmButtonText: 'Download',
  }).then((result) => {
    if (result.isConfirmed) {
      const paneData = cy.json();
      const m = cy.vars.mode.value;
      if (selection) {
        let setSelect = new Set(selection);
        paneData.elements.nodes = paneData.elements.nodes.filter(
          (node) => setSelect.has(node.data.id) || !m.includes(node.data.type),
        );

        setSelect = new Set(paneData.elements.nodes.map((d) => d.data.id));

        paneData.elements.edges &&= paneData.elements.edges.filter((edge) => {
          return (
            setSelect.has(edge.data.source) && setSelect.has(edge.data.target)
          );
        });
      }

      const dataStr =        'data:text/json;charset=utf-8,'
        + encodeURIComponent(JSON.stringify(paneData));
      const dl = document.getElementById('download');
      dl.setAttribute('href', dataStr);
      dl.setAttribute('download', `graph-${cy.paneId}.json`);
      dl.click();
    }
  });
}

function duplicatePane(cy, initSpawner) {
  const data = {
    nodes: Array.from(cy.elementMapper.nodes.values()),
    edges: Array.from(cy.elementMapper.edges.values()),
    info: info,
    cyImport: cy.json(),
  };

  const nodesIds = data.nodes
    .map((node) => node.data?.id)
    .filter((id) => !id.startsWith('t'));

  const sourcePaneId = cy.container().parentElement.id;

  const panes = getPanes();
  const paneData = panes[sourcePaneId];

  const spawnerNodes = paneData.spawnerNodes;
  const pane = spawnPane(
    {
      // spawner: cy.container().parentElement.id,
      spawner: initSpawner || paneData.spawner,
      // Must be CSS-selector safe because PCP builds selectors from pane.id
      id: 'DUPLICATE-' + cy.paneId + '-' + Math.random().toString(36).slice(2),
    },
    nodesIds,
    spawnerNodes,
  );

  let vars = {};
  if (cy.vars) {
    const varsValues = {};
    Object.keys(cy.vars).forEach((k) => {
      if (cy.vars[k].avoidInClone) {
        return;
      }
      varsValues[k] = {
        value: cy.vars[k].value,
      };
    });
    vars = structuredClone(varsValues);
  }

  spawnGraph(pane, data, structuredClone(cy.params), vars);
  return pane;
}

function duplicatePanes(selectedPanes) {
  const panes = getPanes();
  var duplicatedPanes = [];
  selectedPanes.forEach((pane) => {
    var initSpawnerId = '';
    const cy = pane.paneCy;
    const sourcePaneId = cy.container().parentElement.id;
    const paneData = panes[sourcePaneId];
    const spawner = paneData.spawner;
    if (duplicatedPanes.length > 0) {
      duplicatedPanes.forEach((duplPane) => {
        if (duplPane?.id?.includes(spawner)) {
          initSpawnerId = duplPane?.id;
        }
      });
    }

    const duplicatedPane = duplicatePane(cy, initSpawnerId);
    duplicatedPanes.push(duplicatedPane);
  });
}

function unmarkRecurringNodes() {
  const panes = getPanes();
  Object.keys(panes).forEach((paneId) => {
    const paneCy = panes[paneId].cy;
    // skip panes without an active cytoscape instance
    if (!paneCy || typeof paneCy.nodes !== 'function') return;
    try {
      const recurring = paneCy.nodes('.recurring');
      recurring.forEach((n) => {
        n.style({
          'background-color': '',
          'border-color': '',
          color: '',
          'background-opacity': '',
          'border-opacity': '',
        });
      });
      const recurringHover = paneCy.nodes('.recurring-hover');
      recurringHover.forEach((n) => {
        n.style({
          'background-color': '',
          'border-color': '',
          color: '',
          'background-opacity': '',
          'border-opacity': '',
        });
      });
      paneCy.nodes('.recurring').removeClass('recurring');
      paneCy.nodes('.recurring-hover').removeClass('recurring-hover');
    } catch (err) {
      // don't let one pane failure stop the whole cleanup
      console.warn(`unmarkRecurringNodes: failed for pane ${paneId}`, err);
    }
  });
}

function markRecurringNodes() {
  const panes = getPanes();
  const duplicates = {};
  Object.keys(panes).forEach((paneId) => {
    const nodesIds = panes[paneId].nodesIds;
    nodesIds.forEach((nodeId) => {
      if (duplicates[nodeId]) {
        duplicates[nodeId].add(paneId);
      } else {
        duplicates[nodeId] = new Set([paneId]);
      }
    });
  });

  const recurringNodes = {};
  Object.keys(duplicates).forEach((nodeId) => {
    const duplicatePanes = duplicates[nodeId];
    if (duplicatePanes.size > 1) {
      recurringNodes[nodeId] = duplicatePanes;

      duplicatePanes.forEach((paneId) => {
        const paneCy = panes[paneId].cy;
        const node = paneCy.$('#' + nodeId);
        // persistent recurring mark (used by the 'Mark recurring' control)
        node.addClass('recurring');
        // choose highlight color according to node's classification
        let bg = COLORS.RECURRING;
        let border = COLORS.RECURRING;
        if (node.hasClass('graph-shared')) {
          bg = COLORS.GRAPH_SHARED_BG;
          border = COLORS.GRAPH_SHARED;
        } else if (node.hasClass('graph-a-only')) {
          bg = COLORS.GRAPH_A_BG;
          border = COLORS.GRAPH_A_ONLY;
        } else if (node.hasClass('graph-b-only')) {
          bg = COLORS.GRAPH_B_BG;
          border = COLORS.GRAPH_B_ONLY;
        } else if (node.hasClass('graph-partial-shared')) {
          bg = '#fff3e0';
          border = '#ff9800';
        } else if (node.hasClass('diff-added')) {
          bg = '#e8f5e9';
          border = '#1b5e20';
        } else if (node.hasClass('diff-removed')) {
          bg = '#ffebee';
          border = '#b71c1c';
        } else if (node.hasClass('diff-context')) {
          bg = '#fafafa';
          border = '#9e9e9e';
        }
        // rely on stylesheet :hover and .recurring rules to apply fill/border
        // keep text color consistent
        node.style({ color: '#000' });
      });
    }
  });
}

function markRecurringNodesById(markId, showInOverview = false) {
  const panes = getPanes();
  const duplicates = {};
  Object.keys(panes).forEach((paneId) => {
    const nodesIds = panes[paneId].nodesIds;
    nodesIds.forEach((nodeId) => {
      if (markId === nodeId) {
        if (duplicates[nodeId]) {
          duplicates[nodeId].add(paneId);
        } else {
          duplicates[nodeId] = new Set([paneId]);
        }
      }
    });
  });

  var recurringNodes = {};
  Object.keys(duplicates).forEach((nodeId) => {
    const duplicatePanes = duplicates[nodeId];

    // Always mark the hovered node, even if it only appears in one pane
    duplicatePanes.forEach((paneId) => {
      const paneCy = panes[paneId].cy;
      const node = paneCy.$('#' + nodeId);
      // mark as a temporary hover recurrence so it can be removed reliably
      node.addClass('recurring-hover');
      // keep text color consistent
      node.style({ color: '#000' });
    });

    // Only track as "recurring" for overview if it appears in multiple panes
    if (duplicatePanes.size > 1) {
      recurringNodes[nodeId] = duplicatePanes;
    }
    if (showInOverview && duplicatePanes.size > 1) {
      socket.emit('duplicate pane ids', duplicatePanes);
    }
  });
}

function resetPaneNodeMarkings() {
  socket.emit('reset pane-node markings');
}

function mergePane(panesToMerge, cy, prevSpawners) {
  var data = {
    nodes: Array.from(cy.elementMapper.nodes.values()),
    edges: Array.from(cy.elementMapper.edges.values()),
    info: info,
    cyImport: cy.json(),
  };
  var spawnerIds = prevSpawners || panesToMerge.map((p) => p.paneId);
  var spawnerNodes = [];

  const allPanes = getPanes();

  if (panesToMerge.length > 0) {
    panesToMerge.forEach((paneData) => {
      data = {
        nodes: data.nodes.concat(paneData.nodes),
        edges: data.edges.concat(paneData.edges),
        info: info,
        cyImport: cy.json(),
      };
      spawnerNodes.push(allPanes[paneData.paneId]?.spawnerNodes);
    });

    const nodesIds = data.nodes
      .map((node) => node.data?.id)
      .filter((id) => !id.startsWith('t'));
    const pane = spawnPane(
      {
        spawner: spawnerIds,
        id: 'MERGED-' + spawnerIds.join('-'),
      },
      nodesIds,
      spawnerNodes,
    );

    let vars = {};
    if (cy.vars) {
      const varsValues = {};
      Object.keys(cy.vars).forEach((k) => {
        if (cy.vars[k].avoidInClone) {
          return;
        }
        varsValues[k] = {
          value: cy.vars[k].value,
        };
      });
      vars = structuredClone(varsValues);
    }

    const elements = {
      nodes: data.nodes.map((d) => {
        return {
          group: 'nodes',
          data: d.data,
        };
      }),
      edges: data.edges.map((edge) => {
        const d = edge.data;
        return {
          group: 'edges',
          data: {
            id: d.id,
            label: d.label,
            source: d.source,
            target: d.target,
          },
        };
      }),
    };
    data.cyImport.elements = elements;
    spawnGraph(pane, data, structuredClone(cy.params), vars);
  }
}

function forceCyUpdate(el) {
  el.data('update', 1);
  el.data('update', undefined);
}

function mergePanes(panesToMerge, paneCy) {
  if (panesToMerge && panesToMerge.length > 0) {
    Swal.fire({
      title: 'Merge Panes',
      text: 'Do you want to keep the merged panes? ',
      icon: 'warning',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#555',
      confirmButtonText: 'Keep merged panes',
      denyButtonText: 'Remove merged panes',
    }).then((result) => {
      if (result.isConfirmed) {
        mergePane(panesToMerge, paneCy);
      } else if (result.isDenied) {
        const paneIds = panesToMerge.map((p) => p.paneId);
        const panes = getPanes();
        const prevSpawners = [];
        paneIds.forEach((id) => {
          const paneData = panes[id];
          if (paneData?.spawner) {
            prevSpawners.push(paneData?.spawner);
          }

          destroyPanes(id);
        });
        mergePane(panesToMerge, paneCy, prevSpawners);
      }
    });
  }
}

function handleMergePane() {
  if (selectedPanesData && selectedPanesData.selectedPanes.length > 1) {
    mergePanes(selectedPanesData.selectedPanes, selectedPanesData.paneCy);
  }
}

function handleDeletePane() {
  if (selectedPanesData && selectedPanesData.selectedPanes.length > 0) {
    selectedPanesData.selectedPanes.forEach((pane) => {
      destroyPanes(pane.paneId, { firstOnly: true });
    });
  }
}

function handleDuplicatePane() {
  if (selectedPanesData && selectedPanesData.selectedPanes.length > 0) {
    // selectedPanesData.selectedPanes.forEach((pane) => {
    //   duplicatePane(pane.paneCy);
    // });

    duplicatePanes(selectedPanesData.selectedPanes);
  }
}

function handleExpandPane() {
  if (selectedPanesData && selectedPanesData.selectedPanes.length > 0) {
    selectedPanesData.selectedPanes.forEach((pane) => {
      const paneId = pane.paneId;

      const paneDiv = document.getElementById(paneId);
      expandPane(paneDiv);
    });
  }
}

function handleCollapsePane() {
  if (selectedPanesData && selectedPanesData.selectedPanes.length > 0) {
    selectedPanesData.selectedPanes.forEach((pane) => {
      const paneId = pane.paneId;

      const paneDiv = document.getElementById(paneId);
      collapsePane(paneDiv);
    });
  }
}

function handleExportPane() {
  if (selectedPanesData && selectedPanesData.selectedPanes.length > 0) {
    var cyList = [];
    selectedPanesData.selectedPanes.forEach((pane) => {
      cyList.push(pane.paneCy);
    });
    exportCyList(cyList);
  }
}

function handleMarkNodes(cy) {
  const targets = cy.$('node:selected');
  if (targets.length > 0) {
    if (!targets.classes().includes('marked')) {
      dispatchEvent(events.GLOBAL_MARK(targets.map((t) => t.data().id)));
    } else {
      dispatchEvent(events.GLOBAL_UNMARK(targets.map((t) => t.data().id)));
    }
  }
  document.activeElement.blur();
}

function initControls(cy) {
  document
    .getElementById(`${cy.paneId}-expand1`)
    .addEventListener('click', (e) => {
      const modifier = e.ctrlKey || e.altKey;
      if (modifier) {
        spawnGraphOnNewPane(
          cy,
          cy.$('node.s:selected').map((n) => n.data()),
        );
      } else {
        expandGraph(cy, cy.$('node.s:selected'));
      }
      document.activeElement.blur();
    });

  document
    .getElementById(`${cy.paneId}-expandN`)
    .addEventListener('click', () => {
      iteration = 0;
      expandBestPath(cy, cy.$('node.s:selected'));
      document.activeElement.blur();
    });

  document
    .getElementById(`${cy.paneId}-mark`)
    .addEventListener('click', (e) => handleMarkNodes(cy, e));
}

function ctxmenu(cy) {
  const setting = document.getElementById('bestPathLength');
  const l = setting ? setting.value : CONSTANTS.INTERACTIONS.expandN.default;

  const node_options = [
    // node specific
    {
      id: 'expand',
      content: CONSTANTS.INTERACTIONS.expand1.name,
      tooltipText: `${CONSTANTS.INTERACTIONS.expand1.description} \t (${CONSTANTS.INTERACTIONS.expand1.keyboard})`,
      selector: 'node.s:selected',
      onClickFunction: () => {
        setPane(cy.paneId);
        hideAllTippies();
        expandGraph(cy, cy.$('node.s:selected'));
      },
      hasTrailingDivider: false,
    },
    {
      id: 'expand-best-path',
      content: CONSTANTS.INTERACTIONS.expandN.name(l),
      tooltipText: `${CONSTANTS.INTERACTIONS.expandN.description(l)} \t (${
        CONSTANTS.INTERACTIONS.expandN.keyboard
      })`,
      selector: 'node.s:selected',
      onClickFunction: () => {
        iteration = 0;
        expandBestPath(cy, cy.$('node.s:selected'));
      },
      hasTrailingDivider: false,
    },
    {
      id: 'remove',
      content: CONSTANTS.INTERACTIONS.collapse.name,
      tooltipText: `${CONSTANTS.INTERACTIONS.collapse.description}`,
      selector: 'node.s:selected[[outdegree > 0]]',
      onClickFunction: () => {
        const target = cy.$('node.s:selected'); // event.target || event.cyTarget;
        const outgoer_actions = target.outgoers();
        const outgoer_states = outgoer_actions.outgoers();

        const removeOutgoer = (oa) => {
          const d = oa.data();
          if (oa.group() === 'nodes') {
            cy.elementMapper.nodes.delete(d.id);
          } else {
            cy.elementMapper.edges.delete(getEdgeId({ data: d }));
          }
        };

        outgoer_states
          .edges()
          .forEach((oa) => removeOutgoer(oa))
          .remove();
        outgoer_actions.forEach((oa) => removeOutgoer(oa)).remove();

        outgoer_states.nodes().forEach((n) => {
          if (n.incomers().length === 0 && n.outgoers().length === 0) {
            cy.elementMapper.nodes.delete(n.data().id);
            n.remove();
          }
        });

        forceCyUpdate(target);
      },
      hasTrailingDivider: false,
    },
    {
      id: 'mark-node',
      content: CONSTANTS.INTERACTIONS.mark.name,
      tooltipText: `${CONSTANTS.INTERACTIONS.mark.description} \t (${CONSTANTS.INTERACTIONS.mark.keyboard})`,
      selector: 'node.s:selected',
      onClickFunction: (e) => {
        handleMarkNodes(cy, e);
      },
    },
    {
      id: 'inspect-tooltip',
      content: 'Inspect Node Details',
      tooltipText: 'Opens tooltip with node details',
      selector: 'node',
      onClickFunction: (n) => {
        buildDetailsTooltipFromNode(cy, n.target, n?.originalEvent);
      },
      hasTrailingDivider: false,
    },
    {
      id: 'compare-nodes',
      content: 'Compare with Selected Nodes',
      tooltipText: 'Compare this node with the currently selected nodes',
      selector: 'node',
      onClickFunction: (event) => {
        const targetNode = event.target || event.cyTarget;
        const selectedNodes = cy.$('node.s:selected');

        if (selectedNodes.length === 0) {
          Swal.fire({
            title: 'No nodes selected',
            text: 'Please select one or more nodes first, then right-click another node to compare.',
            icon: 'info',
            confirmButtonColor: '#555',
          });
        } else {
          // Check if target is already in selection
          const isTargetSelected = selectedNodes.some(
            (n) => n.id() === targetNode.id(),
          );

          if (isTargetSelected && selectedNodes.length === 1) {
            Swal.fire({
              title: 'Same node',
              text: 'Please select different nodes to compare.',
              icon: 'info',
              confirmButtonColor: '#555',
            });
          } else {
            // Build comparison with selected nodes + target (if not already selected)
            const nodesToCompare = isTargetSelected
              ? selectedNodes.toArray()
              : [...selectedNodes.toArray(), targetNode];

            buildComparisonTooltip(cy, nodesToCompare);
          }
        }
      },
      hasTrailingDivider: false,
    },
    {
      id: 'compare-selected-only',
      content: 'Compare Selected Nodes',
      tooltipText: 'Compare all currently selected nodes with each other',
      selector: 'node.s:selected',
      onClickFunction: () => {
        const selectedNodes = cy.$('node.s:selected');

        if (selectedNodes.length < 2) {
          Swal.fire({
            title: 'Not enough nodes',
            text: 'Please select at least 2 nodes to compare.',
            icon: 'info',
            confirmButtonColor: '#555',
          });
        } else {
          buildComparisonTooltip(cy, selectedNodes.toArray());
        }
      },
      hasTrailingDivider: true,
    },
    {
      id: 'expand-new',
      content: `${CONSTANTS.INTERACTIONS.expand1.name} on New Pane`,
      tooltipText: `${CONSTANTS.INTERACTIONS.expand1.description} \t (${CONSTANTS.INTERACTIONS.expand1.keyboard_pane})`,
      selector: 'node.s:selected',
      onClickFunction: () => {
        const nodes = cy.$('node.s:selected');
        hideAllTippies();
        spawnGraphOnNewPane(
          cy,
          nodes.map((n) => n.data()),
        );
      },
      hasTrailingDivider: false,
    },
    {
      id: 'mark-recurring-node-pane',
      content: 'Mark recurring pane-nodes',
      tooltipText: 'Marks pane-nodes that include this node (in the Overview)',
      selector: 'node.s:selected',
      onClickFunction: (event) => {
        const target = event.target || event.cyTarget;
        const nodeId = target.data().id;
        markRecurringNodesById(nodeId, true);
      },
      hasTrailingDivider: true,
    },
  ];

  if (!cy.vars['pcp-auto-sync'].value) {
    node_options.push({
      id: 'inspect-pcp',
      content: 'Sync Selection in Details View',
      tooltipText: 'Shows the current selection of nodes in the Details View',
      selector: 'node',
      onClickFunction: () => {
        spawnPCP(cy);
      },
      hasTrailingDivider: true,
    });
  }

  cy.ctxmenu = cy.contextMenus({
    menuItems: [
      ...node_options,
      // pane controls
      {
        id: 'fit-to-pane',
        content: 'Fit to view',
        tooltipText: 'fit to pane',
        coreAsWell: true,
        onClickFunction: () => cy.fit(undefined, 30),
        hasTrailingDivider: false,
      },
      {
        id: 'collapse-pane',
        content: 'Collapse/expand pane',
        tooltipText: 'collapse/expand pane',
        coreAsWell: true,
        onClickFunction: () => {
          togglePane(
            document.getElementById(
              document.getElementById('selected-pane').innerHTML,
            ),
          );
        },
        hasTrailingDivider: true,
      },
      {
        id: 'import-pane',
        content: 'Import Graph',
        tooltipText: 'import graph',
        coreAsWell: true,
        onClickFunction: () => {
          importCy(cy);
        },
        hasTrailingDivider: false,
      },
      {
        id: 'export-pane',
        content: 'Export Graph',
        tooltipText: 'export graph',
        coreAsWell: true,
        onClickFunction: () => {
          exportCy(cy);
        },
        hasTrailingDivider: true,
      },
      {
        id: 'duplicate-pane',
        content: 'Duplicate pane',
        tooltipText: 'dup-pane',
        coreAsWell: true,
        onClickFunction: () => {
          duplicatePane(cy);
        },
        hasTrailingDivider: false,
      },
      {
        id: 'destroy-pane',
        content: 'Remove pane',
        tooltipText: 'remove pane',
        coreAsWell: true,
        onClickFunction: () => {
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
        },
        hasTrailingDivider: true,
      },
      // new options
      {
        id: 'reset-pane-node-markings',
        content: 'Reset pane-node markings',
        tooltipText: 'Reset pane-node markings',
        coreAsWell: true,
        onClickFunction: () => {
          resetPaneNodeMarkings();
        },
        hasTrailingDivider: false,
      },
    ],
    menuItemClasses: ['dropdown-item'],
    contextMenuClasses: ['dropdown-menu'],
    submenuIndicator: {
      src: '/style/icons/submenu.svg',
      width: 12,
      height: 12,
    },
  });
}

function selectAll(cy) {
  const m = cy.vars.mode.value;
  const selector = m === 's+t' ? '' : '.' + m;
  cy.$(`node${selector}`).select();
}

function keyboardShortcuts(cy, e) {
  cy.keyboard = e;
  const modifier = e.ctrlKey || e.altKey;
  const shift = e.shiftKey;

  selectifyByMode(cy);

  // ctrl+z: undo
  if (e.keyCode === 90 && modifier) {
    cy.vars.ur.value.undo();
    cy.nodes()
      .filter((d) => d.data()._selected)
      .select();
  }

  // ctrl+y: redo
  if (e.keyCode === 89 && modifier) {
    cy.vars.ur.value.redo();
    cy.nodes()
      .filter((d) => d.data()._selected)
      .select();
  }

  // ctrl+a: select all nodes
  if (e.keyCode === 65 && modifier) {
    e.preventDefault();
    selectAll(cy);
    if (cy.vars['pcp-auto-sync'].value) {
      spawnPCP(cy);
    }
  }

  // ctrl+i: select initial states
  if (e.keyCode === 73 && modifier) {
    selectBasedOnAP(cy, e, CONSTANTS.ap_init);
  }

  // ctrl+d: select deadlock states
  if (e.keyCode === 68 && modifier) {
    selectBasedOnAP(cy, e, CONSTANTS.ap_deadlock);
  }

  // ctrl+e: select end states
  if (e.keyCode === 69 && modifier) {
    selectBasedOnAP(cy, e, CONSTANTS.ap_end);
  }

  // ctrl+m: mark/unmark selected nodes
  if (e.keyCode === 77 && modifier) {
    handleMarkNodes(cy, e);
  }

  // left arrow
  if (e.keyCode === 37) {
    const sources = cy.$('node.s:selected');
    sources.deselect();

    if (modifier) {
      // go to previous pane
    } else {
      // if parents, select parents
      const ids = sources
        .map((src) => getPreviousInPath(cy, src.data().id).prev)
        .flat();
      const parents = cy.nodes(ids.length > 0 ? '#' + ids.join(', #') : '');
      parents.select();
      if (cy.vars['pcp-auto-sync'].value) {
        spawnPCP(cy);
      }
    }
  }

  // right arrow
  if (e.keyCode === 39) {
    const sources = cy.$('node.s:selected');
    sources.deselect();

    if (modifier) {
      // go to next pane
    } else {
      // if children, select next best
      if (cy.vars.scheduler.value === '_none_') {
        // open everything, as there is no decider / DOI / scheduler
        const ids = sources
          .map((src) => getNextInPath(cy, src.data().id).next)
          .flat();
        const nexts = cy.nodes(ids.length > 0 ? '#' + ids.join(', #') : '');
        nexts.select();
      } else {
        // follow only the "best" path according to DOI/scheduler
        const ids = sources.map(
          (src) => getNextBestInPath(cy, src.data().id).bestNext,
        );
        const nextBests = cy.nodes('#' + ids.join(', #'));
        nextBests.select();
      }

      if (cy.vars['pcp-auto-sync'].value) {
        spawnPCP(cy);
      }
    }
  }

  // TODO: visual selection + shift for a single node
  // up arrow
  if (e.keyCode === 38) {
    // if siblings list, go backward
  }

  // down arrow
  if (e.keyCode === 40) {
    // if siblings list, go forward
  }

  // enter, ctrl+enter
  if (e.key === 'Enter' || e.keyCode === 13) {
    if (modifier) {
      spawnGraphOnNewPane(
        cy,
        cy.$('node.s:selected').map((n) => n.data()),
      );
    } else if (shift) {
      expandBestPath(cy, cy.$('node.s:selected'));
    } else {
      expandGraph(cy, cy.$('node.s:selected'));
    }
  }
}

socket.on('handle selection', (data) => {
  if (data) {
    switch (data) {
      case 'merge':
        handleMergePane();
        break;
      case 'delete':
        handleDeletePane();
        break;
      case 'duplicate':
        handleDuplicatePane();
        break;
      case 'expand':
        handleExpandPane();
        break;
      case 'collapse':
        handleCollapsePane();
        break;
      case 'export':
        handleExportPane();
        break;
    }
  }
});

socket.on('overview nodes selected', (data) => {
  if (data) {
    var selectedPanes = [];
    var paneCy;
    data.forEach((id) => {
      const selectedPane = getPanes()[id];
      if (selectedPane) {
        paneCy = getPanes()[id].cy;
        const data = {
          nodes: Array.from(paneCy.elementMapper.nodes.values()),
          edges: Array.from(paneCy.elementMapper.edges.values()),
          info: info,
          cyImport: paneCy.json(),
          paneId: paneCy.paneId,
          paneCy,
        };
        selectedPanes.push(data);
      }
    });
    selectedPanesData = {
      selectedPanes,
      paneCy,
    };
  }
});

// cy.vars stores the settings of the application
// that can be inherited (to next panes) or loaded
function setPublicVars(cy, preset) {
  cy.vars = {
    ur: {
      value: cy.undoRedo(),
      avoidInClone: true, // workaround for structuredClone
      fn: _.throttle(keyboardShortcuts, THROTTLE_DEBOUNCE_DELAY),
    },
    mode: {
      value: 's',
      fn: setSelectMode,
    },
    details: {
      value: {},
      fn: updateDetailsToShow,
    },
    scheduler: {
      value: undefined,
      fn: updateScheduler,
    },
    panePosition: {
      value: 'end',
      fn: updateNewPanePosition,
    },
    'pcp-auto-sync': {
      value: true,
      fn: toggleFullSync,
    },
    'pcp-bi': {
      // bounds-indicator
      value: '><',
      fn: updateBoundsIndicator,
    },
    'pcp-refine': {
      // brushes overwrite selections
      value: true,
      fn: (cy, prop) => togglePCPFlag(cy, prop, 'pcp-refine'),
    },
    'pcp-vs': {
      // violin plots
      value: false,
      fn: (cy, prop) => togglePCPFlag(cy, prop, 'pcp-vs'),
    },
    'pcp-hs': {
      // histograms
      value: false,
      fn: (cy, prop) => togglePCPFlag(cy, prop, 'pcp-hs'),
    },
    'pcp-dfs': {
      // discreet frequencies
      value: false,
      fn: (cy, prop) => togglePCPFlag(cy, prop, 'pcp-dfs'),
    },
    'pcp-colored-comparison': {
      // colored comparison lines
      value: false,
      fn: (cy, prop) => {
        cy.vars['pcp-colored-comparison'].value = prop;
        if (cy.pcp && cy.pcp.toggleColoredComparison) {
          cy.pcp.toggleColoredComparison(prop);
        }
      },
    },
    update: {
      value: CONSTANTS.STATUS.ready,
      fn: async () => {
        await renewInfo(cy);
        updateDetailsToShow(cy, { update: cy.vars.details.value });
        setUpdateState(cy);
      },
    },
  };

  cy.fns = {
    import: importCy,
    export: exportCy,
    mark: mark,
    'undo-mark': unmark,
  };

  // call functions that need to be init
  if (Object.keys(preset).length === 0) {
    setSelectMode(cy, cy.vars.mode.value);
    updateDetailsToShow(cy, { update: false });
    updateScheduler(cy, '_none_');
  } else {
    setSelectMode(cy, preset.mode.value);
    updateDetailsToShow(cy, { update: preset.details.value });
    updateScheduler(cy, preset.scheduler.value);
    updateNewPanePosition(cy, preset.panePosition.value);
    toggleFullSync(cy, preset['pcp-auto-sync'].value);
  }
  setUpdateState(cy);
}

export {
  spawnGraph,
  markRecurringNodes,
  unmarkRecurringNodes,
  setMaxIteration,
  mergePane,
  handleMergePane,
  duplicatePane,
  importCy,
  exportCy,
};
