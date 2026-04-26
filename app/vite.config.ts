import { defineConfig } from 'vite';

export default defineConfig({
  base: './vds-repair/',
  plugins: [],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
      },
      output: {
        manualChunks: {
          lodash: ['lodash'], 
          d3: ['d3'],
          cytoscape: ['cytoscape', 
            'cytoscape-undo-redo', 
            'cytoscape-context-menus', 
            'cytoscape-node-html-label', 
            'cytoscape-popper',
          ],
          cola: ['cytoscape-cola'], 
          dagre: ['cytoscape-dagre'], 
          klay: ['cytoscape-klay'],
          utils: ['cytoscape-layout-utilities'],
        }
      }
    },
  },
})
