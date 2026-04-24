/**
 * Events Module
 *
 * Factory functions for creating custom events used for inter-component
 * communication. Events are dispatched globally and can be listened to
 * by any component in the application.
 *
 * @module events
 */

/**
 * Collection of event factory functions.
 */
const events = {
  /**
   * Event to propagate selection to all panes.
   * @type {CustomEvent}
   */
  GLOBAL_PROPAGATE: new CustomEvent('global-action', {
    detail: {
      action: 'propagate',
    },
  }),

  /**
   * Create a matrix hover event for cross-pane synchronization.
   * Used when hovering over matrix cells to highlight corresponding nodes
   * in other views and panes.
   *
   * @param {string} sourcePaneId - ID of the pane where hover originated
   * @param {Array<string>} ids - Array of node IDs being hovered
   * @param {Object} [edge] - Optional edge info {fromId, toId} for edge highlighting
   * @returns {CustomEvent} The matrix-hover custom event
   */
  MATRIX_HOVER: (sourcePaneId, ids, edge = null) => new CustomEvent('matrix-hover', {
    detail: {
      sourcePaneId,
      ids,
      edge,
    },
  }),

  /**
   * Create a global mark event to highlight elements.
   *
   * @param {Array} elements - Elements to mark
   * @returns {CustomEvent} The global-action mark event
   */
  GLOBAL_MARK: (elements) => new CustomEvent('global-action', {
    detail: {
      action: 'mark',
      type: '',
      elements,
    },
  }),

  /**
   * Create a global unmark event to remove highlighting.
   *
   * @param {Array} elements - Elements to unmark
   * @returns {CustomEvent} The global-action unmark event
   */
  GLOBAL_UNMARK: (elements) => new CustomEvent('global-action', {
    detail: {
      action: 'mark',
      type: 'undo-',
      elements,
    },
  }),

  /**
   * Create a linked selection event for cross-pane selection synchronization.
   *
   * @param {Object} pane - The source pane object
   * @param {Object} selection - The selection data
   * @returns {CustomEvent} The linked-selection event
   */
  LINKED_SELECTION: (pane, selection) => new CustomEvent('linked-selection', {
    detail: {
      pane,
      selection,
    },
  }),

  /**
   * Create a matrix selection event for cross-pane selection synchronization.
   * Used when selecting/deselecting nodes in matrix view to sync across all matrices.
   *
   * @param {string} sourcePaneId - ID of the pane where selection originated
   * @param {string} nodeId - The node ID being selected/deselected
   * @param {boolean} isSelected - Whether the node is now selected
   * @returns {CustomEvent} The matrix-selection custom event
   */
  MATRIX_SELECTION: (sourcePaneId, nodeId, isSelected) => new CustomEvent('matrix-selection', {
    detail: {
      sourcePaneId,
      nodeId,
      isSelected,
    },
  }),
};

export default events;
