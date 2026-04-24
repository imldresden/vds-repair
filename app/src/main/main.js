import { spawnPane, getPanes, resizeSplit } from '../views/panes/panes.js';
import { params } from '../views/graph/layout-options/klay.js';
import { spawnGraph } from '../views/graph/node-link.js';
import { PROJECT } from '../utils/controls.js';
import { CONSTANTS } from '../utils/names.js';
import { socket } from '../views/imports/import-socket.js';
import { startDLRepairProject } from './dl-repair-mode.js';
import {
  isMatrixEnabled,
  enableMatrixView,
  disableMatrixView,
  setMatrixOrdering,
  resetMatrixZoom,
} from '../views/matrix/matrix-view.js';

let BACKEND = import.meta.env.VITE_BACKEND_RESTFUL;

// Throttle resize observer using requestAnimationFrame to avoid excessive calls
const info = {
  details: {},
  observer: new ResizeObserver((entries) => {
    const panes = getPanes();
    entries.forEach((entry) => {
      const pane = panes[entry.target.pane];
      if (!pane?.cy) {
        return;
      }
      pane.cy.fit(undefined, 30);
      pane.cy.pcp?.redraw();
    });
  }),
};

function getDefaultBadge(name) {
  return `<i class="fa-xs ${CONSTANTS.INTERACTIONS[name].icon}" title="${CONSTANTS.INTERACTIONS[name].type}"></i>`;
}

function setInfo(newInfo) {
  Object.keys(newInfo).forEach((k) => {
    info[k] = newInfo[k];
  });

  info.details = {};
  info.types = {};
  ['s', 't'].forEach((type) => {
    Object.keys(info[type]).forEach((k) => {
      info.details[k] = info[type][k];
      const t = info.types[k];
      info.types[k] = t ? `${t}+${type}` : type;
    });
    delete info[type];
  });

  info.badges = {
    ap_init: getDefaultBadge('ap_init'),
    ap_deadlock: getDefaultBadge('ap_deadlock'),
    ap_end: getDefaultBadge('ap_end'),
  };

  Object.keys(info.badges).forEach((ap) => {
    const userSelected = info.details[CONSTANTS.atomicPropositions][CONSTANTS[ap]];
    if (userSelected) {
      info.badges[ap] = userSelected.icon
        ? `<i class="fa-xs ${userSelected.identifier}" title="${CONSTANTS.INTERACTIONS[ap].type}"></i>`
        : `<p title="${CONSTANTS.INTERACTIONS[ap].type}">${userSelected.identifier}</p>`;
    }
  });

  Object.values(getPanes()).forEach((pane) => {
    pane.cy.vars['update'].fn(pane.cy);
  });
}

if (import.meta.env.VITE_HIDE_TODOS !== 'true') {
  document.querySelectorAll('.to-do').forEach((el) => el.classList.remove('to-do'));
}

addEventListener('linked-selection', (e) => {
  const selection = e.detail.selection;
  const panes = getPanes();
  panes[e.detail.pane].cy.nodes().unselect();
  const ids = Array.from(new Set(selection.map((n) => n.linkedId || n.id).filter(Boolean)));
  const strSelection = `#${ids.join(', #')}`;
  if (strSelection !== '#') {
    panes[e.detail.pane].cy.$(strSelection).select();
  }
}, true);

// ============================================================================
// Global Keyboard Shortcuts
// ============================================================================

/**
 * Get the currently active pane (the one with .active-pane class)
 * @returns {Object|null} The active pane object, or null if none
 */
function getActivePane() {
  const activePaneElement = document.querySelector('.active-pane');
  if (!activePaneElement) return null;
  const panes = getPanes();
  return panes[activePaneElement.id] || null;
}

/**
 * Close all node detail windows
 */
function closeAllDetailWindows() {
  const windows = document.querySelectorAll('[id^="node-details-window-"]');
  windows.forEach((win) => win.remove());
}

/**
 * Toggle PCP visibility for a pane by maximizing/restoring the structural view
 * @param {Object} pane - The pane object
 */
function togglePcpVisibility(pane) {
  if (!pane) return;
  const cyContainer = document.getElementById(pane.container);
  if (!cyContainer) return;

  const maxHeight = pane.height - 20; // MIN_SIZE * 2 approximation

  if (cyContainer.clientHeight >= maxHeight - 5) {
    // PCP is hidden (structural view is maximized), restore it
    const savedSplit = pane._split || pane.height * 0.7;
    resizeSplit(cyContainer, savedSplit);
  } else {
    // PCP is visible, hide it (maximize structural view)
    resizeSplit(cyContainer, maxHeight);
  }
}

document.addEventListener('keydown', (e) => {
  // Skip if user is typing in an input field
  const tagName = e.target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || e.target.isContentEditable) {
    return;
  }

  const activePane = getActivePane();
  const panes = getPanes();

  switch (e.key) {
    // Matrix ordering shortcuts (1, 2, 3) - only in matrix view
    case '1':
      if (activePane && isMatrixEnabled(activePane)) {
        setMatrixOrdering(activePane, 'id');
        e.preventDefault();
      }
      break;
    case '2':
      if (activePane && isMatrixEnabled(activePane)) {
        setMatrixOrdering(activePane, 'degree');
        e.preventDefault();
      }
      break;
    case '3':
      if (activePane && isMatrixEnabled(activePane)) {
        setMatrixOrdering(activePane, 'bfs');
        e.preventDefault();
      }
      break;
    // Fit to view (f)
    case 'f':
    case 'F':
      if (activePane) {
        if (isMatrixEnabled(activePane)) {
          // Matrix view: reset zoom
          resetMatrixZoom(activePane);
        } else if (activePane.cy?.fit) {
          // Node-link view: fit to viewport
          activePane.cy.fit(undefined, 30);
        }
        e.preventDefault();
      }
      break;

    // Toggle node-link/matrix view (m)
    case 'm':
    case 'M':
      if (activePane && !activePane.cy?.multiMatrixData) {
        // Don't toggle for multi-matrix panes
        if (isMatrixEnabled(activePane)) {
          disableMatrixView(activePane);
        } else {
          enableMatrixView(activePane);
        }
        e.preventDefault();
      }
      break;

    // Toggle PCP visibility (p)
    case 'p':
    case 'P':
      if (activePane) {
        togglePcpVisibility(activePane);
        e.preventDefault();
      }
      break;

    // Clear selection (Escape)
    case 'Escape':
      // Clear selection in all panes
      Object.values(panes).forEach((pane) => {
        if (pane?.cy?.nodes) {
          try {
            pane.cy.nodes().unselect();
          } catch {
            console.log('tried to draw on unrendered pcp canvas...');
          }
        }
      });
      e.preventDefault();
      break;

    // Close all detail windows (Delete)
    case 'Delete':
      closeAllDetailWindows();
      e.preventDefault();
      break;
  }
});

startDLRepairProject();

export {
  info, setInfo, BACKEND,
};
