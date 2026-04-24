import Swal from 'sweetalert2/dist/sweetalert2.all.min.js';
import { h, t } from '../../utils/utils.js';
import { socket } from '../imports/import-socket.js';
import { applyBioFabricLayout } from './layouts/biofabric-layout.js';
import { graphDataStore } from './graph-data.js';

function applyLayout() {
  const biofabricLayoutContainer = document.getElementById('biofabric-layout-container');

  if (biofabricLayoutContainer) {
    biofabricLayoutContainer.style.display = 'flex';
  }

  applyBioFabricLayout(
    graphDataStore,
    socket,
  );
}

var isInitialized = false;
var cy2 = null;

const $ = document.querySelector.bind(document);
const $overview_graph_config = $('#overview-graph-config');

function setupSidebarToggle() {
  const toggleButton = document.getElementById('overview-config-toggle');
  const body = document.body;
  const configSidebar = document.getElementById('config');

  if (!toggleButton || !configSidebar) {
    console.warn('Sidebar toggle elements not found');
    return;
  }

  toggleButton.addEventListener('click', () => {
    body.classList.toggle('overview-config-collapsed');
    configSidebar.classList.toggle('collapsed');

    const isCollapsed = body.classList.contains('overview-config-collapsed');
    toggleButton.setAttribute('title', isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar');
  });
}

window.addEventListener('load', () => {
  makeOverviewSettings();

  setupSidebarToggle();

  const biofabricLayoutContainer = document.getElementById('biofabric-layout-container');
  const graphPanel = document.getElementById('biofabric-graph-panel');
  const edgeBoxesPanel = document.getElementById('biofabric-edge-boxes-panel');

  if (biofabricLayoutContainer && graphPanel && edgeBoxesPanel) {
    if (!document.getElementById('d3-biofabric-container')) {
      const d3Container = h('div', { id: 'd3-biofabric-container' }, []);
      graphPanel.appendChild(d3Container);
    }
    if (!document.getElementById('biofabric-edge-boxes-container')) {
      const biofabricEdgeBoxes = h('div', {
        id: 'biofabric-edge-boxes-container',
        class: 'edge-boxes-container',
      }, []);
      edgeBoxesPanel.appendChild(biofabricEdgeBoxes);
    }
  }
});

socket.on('pane added', (data) => {
  onPaneAdded(data);

  if (data.id === 'pane-0' && !isInitialized) {
    isInitialized = true;
  }
});

socket.on('pane removed', (data) => {
  removeNode(data);
});

socket.on('disconnect', () => {
  location.reload();
});

socket.on('duplicate pane ids', (data) => {
  if (data && data.length > 0) {
    data.forEach((nodeId) => {
      cy2
        .style()
        .selector('#' + nodeId)
        .style({
          label: '*',
          'text-halign': 'center',
          'text-valign': 'center',
        })
        .update();
    });
  } else {
    cy2
      .style()
      .selector('node')
      .style({
        label: '',
      })
      .update();
  }
});

socket.on('reset pane-node markings', () => {
  cy2
    .style()
    .selector('node')
    .style({
      label: '',
    })
    .update();
});

function onPaneAdded(newPaneData) {
  const paneId = newPaneData.id;
  const spawnerNodes = newPaneData.spawnerNodes;
  const spawner = [];

  const isDuplicate = paneId.includes('DUPLICATE');

  if (paneId !== 'pane-0') {
    if (newPaneData.spawner && Array.isArray(newPaneData.spawner)) {
      newPaneData.spawner.forEach((spawnerId) => {
        let edgeId = spawnerId + paneId;
        let counter = 1;
        while (graphDataStore.getEdge(edgeId) !== null) {
          edgeId = `${spawnerId}-${paneId}-merge-${counter}`;
          counter += 1;
        }
        spawner.push({
          id: edgeId,
          source: spawnerId,
          target: paneId,
          label: 'merged',
          classes: 'merge-edge',
        });
      });
    } else if (newPaneData.spawner) {
      let edgeId = spawnerNodes?.join(', ') + paneId;
      let counter = 1;
      while (graphDataStore.getEdge(edgeId) !== null) {
        edgeId = `${spawnerNodes?.join(', ')}-${paneId}-${counter}`;
        counter += 1;
      }
      spawner.push({
        id: edgeId,
        source: newPaneData.spawner,
        target: paneId,
        label: isDuplicate
          ? 'DUPL-' + spawnerNodes?.join(', ')
          : spawnerNodes?.join(', '),
      });
    }
  }

  graphDataStore.addNode(paneId, {
    id: paneId,
    label: paneId,
  });

  spawner.forEach(edgeData => {
    graphDataStore.addEdge(edgeData.id, edgeData);
  });

  applyLayout();
}

function removeNode(id) {
  const nodeIdToRemove = id;

  const edgesToRemove = graphDataStore.getEdgesForNode(nodeIdToRemove);
  edgesToRemove.forEach(edge => {
    graphDataStore.removeEdge(edge.id);
  });

  graphDataStore.removeNode(nodeIdToRemove);

  applyLayout();
}

function makeOverviewSettings() {
  const $buttons = h('div', { class: 'buttons param' }, []);
  const $buttons2 = h('div', { class: 'buttons param' }, []);
  const $buttons3 = h('div', { class: 'buttons param' }, []);

  const $buttonMerge = h(
    'button',
    { class: 'ui button', id: 'child-button' },
    [h('i', { class: 'fa-solid fa-object-group button-icon' }, []), h('span', {}, [t('Merge')])],
  );
  const $buttonRemove = h(
    'button',
    { class: 'ui button', id: 'child-button' },
    [h('i', { class: 'fa-solid fa-trash button-icon' }, []), h('span', {}, [t('Remove')])],
  );
  const $buttonDuplicate = h(
    'button',
    { class: 'ui button', id: 'child-button' },
    [h('i', { class: 'fa-solid fa-copy button-icon' }, []), h('span', {}, [t('Duplicate')])],
  );
  const $buttonExport = h(
    'button',
    { class: 'ui button', id: 'child-button' },
    [h('i', { class: 'fa-solid fa-download button-icon' }, []), h('span', {}, [t('Export')])],
  );
  const $buttonExpand = h(
    'button',
    { class: 'ui button', id: 'child-button' },
    [h('i', { class: 'fa-solid fa-expand button-icon' }, []), h('span', {}, [t('Expand')])],
  );
  const $buttonCollapse = h(
    'button',
    { class: 'ui button', id: 'child-button' },
    [h('i', { class: 'fa-solid fa-compress button-icon' }, []), h('span', {}, [t('Collapse')])],
  );

  const $collapsedButtonExpand = h(
    'button',
    { class: 'ui button icon-only-button', title: 'Expand' },
    [h('i', { class: 'fa-solid fa-expand' }, [])],
  );
  const $collapsedButtonCollapse = h(
    'button',
    { class: 'ui button icon-only-button', title: 'Collapse' },
    [h('i', { class: 'fa-solid fa-compress' }, [])],
  );
  const $collapsedButtonMerge = h(
    'button',
    { class: 'ui button icon-only-button', title: 'Merge' },
    [h('i', { class: 'fa-solid fa-object-group' }, [])],
  );
  const $collapsedButtonRemove = h(
    'button',
    { class: 'ui button icon-only-button', title: 'Remove' },
    [h('i', { class: 'fa-solid fa-trash' }, [])],
  );
  const $collapsedButtonDuplicate = h(
    'button',
    { class: 'ui button icon-only-button', title: 'Duplicate' },
    [h('i', { class: 'fa-solid fa-copy' }, [])],
  );
  const $collapsedButtonExport = h(
    'button',
    { class: 'ui button icon-only-button', title: 'Export' },
    [h('i', { class: 'fa-solid fa-download' }, [])],
  );

  const ensureSelectionEmitted = () => {
    const finalSelectedIDs = graphDataStore.getSelectedNodeIds();
    socket.emit('overview nodes selected', finalSelectedIDs);
  };

  $buttonMerge.addEventListener('click', async () => {
    ensureSelectionEmitted();
    socket.emit('handle selection', 'merge');
  });
  $buttonRemove.addEventListener('click', async () => {
    ensureSelectionEmitted();
    const selectedNodeIds = graphDataStore.getSelectedNodeIds();
    selectedNodeIds.forEach(nodeId => {
      removeNode(nodeId);
    });
    socket.emit('handle selection', 'delete');
  });
  $buttonDuplicate.addEventListener('click', async () => {
    ensureSelectionEmitted();
    const selectedCount = graphDataStore.getSelectedNodeIds().length;
    if (selectedCount === 0) {
      Swal.fire({
        icon: 'error',
        title: 'No pane selected',
        html: 'Please select exactly one pane to duplicate',
      });
      return;
    } else if (selectedCount > 1) {
      Swal.fire({
        icon: 'error',
        title: 'Multiple panes selected',
        html: 'Please select exactly one pane to duplicate',
      });
      return;
    }

    socket.emit('handle selection', 'duplicate');
  });
  $buttonExport.addEventListener('click', async () => {
    socket.emit('handle selection', 'export');
  });
  $buttonExpand.addEventListener('click', async () => {
    socket.emit('handle selection', 'expand');
  });
  $buttonCollapse.addEventListener('click', async () => {
    socket.emit('handle selection', 'collapse');
  });

  $collapsedButtonExpand.addEventListener('click', async () => {
    socket.emit('handle selection', 'expand');
  });
  $collapsedButtonCollapse.addEventListener('click', async () => {
    socket.emit('handle selection', 'collapse');
  });
  $collapsedButtonMerge.addEventListener('click', async () => {
    ensureSelectionEmitted();
    socket.emit('handle selection', 'merge');
  });
  $collapsedButtonRemove.addEventListener('click', async () => {
    ensureSelectionEmitted();
    const selectedNodeIds = graphDataStore.getSelectedNodeIds();
    selectedNodeIds.forEach(nodeId => {
      removeNode(nodeId);
    });
    socket.emit('handle selection', 'delete');
  });
  $collapsedButtonDuplicate.addEventListener('click', async () => {
    ensureSelectionEmitted();
    const selectedCount = graphDataStore.getSelectedNodeIds().length;
    // Validate selection count
    if (selectedCount === 0) {
      Swal.fire({
        icon: 'error',
        title: 'No pane selected',
        html: 'Please select exactly one pane to duplicate',
        timer: 3000,
        timerProgressBar: true,
      });
      return;
    } else if (selectedCount > 1) {
      Swal.fire({
        icon: 'error',
        title: 'Multiple panes selected',
        html: 'Please select exactly one pane to duplicate',
        timer: 3000,
        timerProgressBar: true,
      });
      return;
    }

    socket.emit('handle selection', 'duplicate');
  });
  $collapsedButtonExport.addEventListener('click', async () => {
    socket.emit('handle selection', 'export');
  });

  $buttons.appendChild($buttonMerge);
  $buttons.appendChild($buttonRemove);
  $buttons2.appendChild($buttonDuplicate);
  $buttons2.appendChild($buttonExport);
  $buttons3.appendChild($buttonExpand);
  $buttons3.appendChild($buttonCollapse);

  const $normalContent = h('div', { class: 'overview-config-normal-content' }, [
    $buttons3,
    $buttons,
    $buttons2,
  ]);

  const $collapsedContent = h('div', { class: 'overview-config-collapsed-content' }, [
    h('div', { class: 'collapsed-button-row' }, [$collapsedButtonExpand]),
    h('div', { class: 'collapsed-button-row' }, [$collapsedButtonCollapse]),
    h('div', { class: 'collapsed-button-row' }, [$collapsedButtonMerge]),
    h('div', { class: 'collapsed-button-row' }, [$collapsedButtonRemove]),
    h('div', { class: 'collapsed-button-row' }, [$collapsedButtonDuplicate]),
    h('div', { class: 'collapsed-button-row' }, [$collapsedButtonExport]),
  ]);

  $overview_graph_config?.appendChild($normalContent);
  $overview_graph_config?.appendChild($collapsedContent);
}
