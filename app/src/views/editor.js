import { socket } from './imports/import-socket.js';

function handleEditorSelection(event, cy) {
  socket.emit('STATE_SELECTED', {
    id: document.getElementById('project-id').innerHTML,
    states: cy.$('node.s:selected').map((n) => n.data()),
  }, (err, resp) => {
    if (err) console.error(err);
    if (resp) console.log(resp);
  });
}

export { handleEditorSelection };
