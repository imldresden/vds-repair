import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        overview: 'overview/index.html',
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
          // elk: ['cytoscape-elk'],
          utils: ['cytoscape-layout-utilities'],
        }
      }
    },
  },
})
