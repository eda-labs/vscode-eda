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
    entryPoints: ['src/webviews/dashboard/resource/resourceBrowserPanel.webview.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    sourcemap: false,
    outfile: 'dist/resourceBrowserPanel.js'
  });

  await build({
    entryPoints: ['src/webviews/dashboard/fabric/fabricDashboard.webview.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    sourcemap: false,
    outfile: 'dist/fabricDashboard.js'
  });

  await build({
    entryPoints: ['src/webviews/dashboard/queries/queriesDashboard.webview.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    sourcemap: false,
    outfile: 'dist/queriesDashboard.js'
  });

  await build({
    entryPoints: ['src/webviews/dashboard/topology/topologyDashboard.webview.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    sourcemap: false,
    outfile: 'dist/topologyDashboard.js'
  });

  await build({
    entryPoints: ['src/webviews/targetWizard/targetWizardPanel.webview.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    sourcemap: false,
    outfile: 'dist/targetWizardPanel.js'
  });

  await build({
    entryPoints: ['src/webviews/nodeConfig/nodeConfigPanel.webview.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    sourcemap: false,
    outfile: 'dist/nodeConfigPanel.js'
  });
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
