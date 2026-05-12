const path = require('node:path');

const { defineConfig } = require('vite');
const reactPlugin = require('@vitejs/plugin-react');

const { createRealEdaDevMiddleware } = require('./devEdaMiddleware');

const react = reactPlugin.default || reactPlugin;

module.exports = defineConfig({
  root: __dirname,
  plugins: [
    react(),
    {
      name: 'eda-real-explorer-dev-middleware',
      configureServer(server) {
        server.middlewares.use(createRealEdaDevMiddleware());
      }
    }
  ],
  base: './',
  resolve: {
    alias: [
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
