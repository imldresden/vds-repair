class GraphDataStore {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.listeners = new Set();
    this.selectedNodes = new Set();
    this.selectionListeners = new Set();
    this.edgeNotes = new Map();
    this.selectedEdgeId = null;
  }

  addNode(nodeId, nodeData) {
    this.nodes.set(nodeId, { ...nodeData, id: nodeId });
    this.notifyListeners('nodeAdded', { nodeId, nodeData: this.nodes.get(nodeId) });
  }

  removeNode(nodeId) {
    if (this.nodes.has(nodeId)) {
      this.nodes.delete(nodeId);
      const edgesToRemove = [];
      this.edges.forEach((edge, edgeId) => {
        if (edge.source === nodeId || edge.target === nodeId) {
          edgesToRemove.push(edgeId);
        }
      });
      edgesToRemove.forEach(edgeId => this.removeEdge(edgeId));
      this.notifyListeners('nodeRemoved', { nodeId });
    }
  }

  updateNode(nodeId, updates) {
    if (this.nodes.has(nodeId)) {
      const existing = this.nodes.get(nodeId);
      this.nodes.set(nodeId, { ...existing, ...updates });
      this.notifyListeners('nodeUpdated', { nodeId, nodeData: this.nodes.get(nodeId) });
    }
  }

  getNode(nodeId) {
    return this.nodes.get(nodeId) || null;
  }

  getAllNodes() {
    return Array.from(this.nodes.values());
  }

  addEdge(edgeId, edgeData) {
    this.edges.set(edgeId, { ...edgeData, id: edgeId });
    this.notifyListeners('edgeAdded', { edgeId, edgeData: this.edges.get(edgeId) });
  }

  removeEdge(edgeId) {
    if (this.edges.has(edgeId)) {
      this.edges.delete(edgeId);
      this.edgeNotes.delete(edgeId);
      if (this.selectedEdgeId === edgeId) {
        this.selectedEdgeId = null;
      }
      this.notifyListeners('edgeRemoved', { edgeId });
    }
  }

  updateEdge(edgeId, updates) {
    if (this.edges.has(edgeId)) {
      const existing = this.edges.get(edgeId);
      this.edges.set(edgeId, { ...existing, ...updates });
      this.notifyListeners('edgeUpdated', { edgeId, edgeData: this.edges.get(edgeId) });
    }
  }

  getEdge(edgeId) {
    return this.edges.get(edgeId) || null;
  }

  getAllEdges() {
    return Array.from(this.edges.values());
  }

  getEdgesForNode(nodeId) {
    return this.getAllEdges().filter(edge => edge.source === nodeId || edge.target === nodeId);
  }

  getOutgoingEdges(nodeId) {
    return this.getAllEdges().filter(edge => edge.source === nodeId);
  }

  getIncomingEdges(nodeId) {
    return this.getAllEdges().filter(edge => edge.target === nodeId);
  }

  clear() {
    this.nodes.clear();
    this.edges.clear();
    this.edgeNotes.clear();
    this.selectedEdgeId = null;
    this.notifyListeners('cleared', {});
  }

  addListener(listener) {
    this.listeners.add(listener);
  }

  removeListener(listener) {
    this.listeners.delete(listener);
  }

  notifyListeners(event, data) {
    this.listeners.forEach(listener => {
      try {
        listener(event, data);
      } catch (error) {
        console.error('Error in graph data listener:', error);
      }
    });
  }

  filterNodes(predicate) {
    return this.getAllNodes().filter(predicate);
  }

  filterEdges(predicate) {
    return this.getAllEdges().filter(predicate);
  }

  selectNode(nodeId, additive = false) {
    if (!additive) {
      this.clearSelection();
    }
    if (!this.selectedNodes.has(nodeId)) {
      this.selectedNodes.add(nodeId);
      this.notifySelectionListeners('nodeSelected', { nodeId });
    }
  }

  unselectNode(nodeId) {
    if (this.selectedNodes.has(nodeId)) {
      this.selectedNodes.delete(nodeId);
      this.notifySelectionListeners('nodeUnselected', { nodeId });
    }
  }

  toggleNodeSelection(nodeId, additive = false) {
    if (this.isNodeSelected(nodeId)) {
      this.unselectNode(nodeId);
    } else {
      this.selectNode(nodeId, additive);
    }
  }

  clearSelection() {
    const selectedIds = Array.from(this.selectedNodes);
    this.selectedNodes.clear();
    selectedIds.forEach(nodeId => {
      this.notifySelectionListeners('nodeUnselected', { nodeId });
    });
  }

  isNodeSelected(nodeId) {
    return this.selectedNodes.has(nodeId);
  }

  getSelectedNodeIds() {
    return Array.from(this.selectedNodes);
  }

  addSelectionListener(listener) {
    this.selectionListeners.add(listener);
  }

  removeSelectionListener(listener) {
    this.selectionListeners.delete(listener);
  }

  notifySelectionListeners(event, data) {
    this.selectionListeners.forEach(listener => {
      try {
        listener(event, data);
      } catch (error) {
        console.error('Error in graph data selection listener:', error);
      }
    });
  }

  getEdgeNote(edgeId) {
    return this.edgeNotes.get(edgeId) || '';
  }

  setEdgeNote(edgeId, note) {
    this.edgeNotes.set(edgeId, note);
  }

  setEdgeNotes(edgeIds, note) {
    edgeIds.forEach(edgeId => {
      this.edgeNotes.set(edgeId, note);
    });
  }

  getSelectedEdgeId() {
    return this.selectedEdgeId;
  }

  setSelectedEdgeId(edgeId) {
    this.selectedEdgeId = edgeId;
  }

  clearSelectedEdge() {
    this.selectedEdgeId = null;
  }
}

export const graphDataStore = new GraphDataStore();
