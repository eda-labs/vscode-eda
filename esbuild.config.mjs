/* eslint-env node */
import { build } from 'esbuild';

async function run() {
  await build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    sourcemap: true,
    minify: true,
    target: 'node16',
    external: ['vscode'],
    outfile: 'dist/extension.js'
  });

  await build({
    entryPoints: ['src/webviews/dashboard/toponodes/toponodesDashboard.webview.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    sourcemap: false,
    outfile: 'dist/toponodesDashboard.js'
  });

  await build({
    entryPoints: ['src/webviews/dashboard/crd/crdBrowserPanel.webview.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    sourcemap: false,
    outfile: 'dist/crdBrowserPanel.js'
  });
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
