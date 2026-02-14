const path = require('node:path');

const { defineConfig } = require('vite');
const reactPlugin = require('@vitejs/plugin-react');

const react = reactPlugin.default || reactPlugin;

module.exports = defineConfig({
  root: __dirname,
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: false,
    fs: {
      allow: [path.resolve(__dirname, '../..')]
    }
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
