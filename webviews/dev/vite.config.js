const path = require('node:path');

const { defineConfig } = require('vite');
const reactPlugin = require('@vitejs/plugin-react');

const react = reactPlugin.default || reactPlugin;

module.exports = defineConfig({
  root: __dirname,
  plugins: [react()],
  base: './',
  resolve: {
    alias: [
      {
        find: /^@eda-labs\/topo-builder\/styles\.css$/,
        replacement: path.resolve(__dirname, '../../node_modules/@eda-labs/topo-builder/src/styles.css')
      },
      {
        find: /^@eda-labs\/topo-builder$/,
        replacement: path.resolve(__dirname, '../../node_modules/@eda-labs/topo-builder/src/index.ts')
      },
      {
        find: /^ajv$/,
        replacement: path.resolve(__dirname, './src/shims/ajv.ts')
      }
    ],
    conditions: ['style']
  },
  server: {
    port: 5173,
    strictPort: false,
    fs: {
      allow: [path.resolve(__dirname, '../..')]
    }
  },
  optimizeDeps: {
    exclude: ['@eda-labs/topo-builder']
  },
  build: {
    outDir: path.resolve(__dirname, '../../dist/webviews-dev'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        preview: path.resolve(__dirname, 'preview.html')
      }
    }
  }
});
