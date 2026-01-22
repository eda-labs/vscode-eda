/* eslint-env node */
import { build } from 'esbuild';

// Common options for webview builds
const webviewOptions = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  sourcemap: false,
  jsx: 'automatic',
  jsxImportSource: 'react'
};

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
    entryPoints: ['src/webviews/dashboard/toponodes/toponodesDashboard.webview.tsx'],
    ...webviewOptions,
    outfile: 'dist/toponodesDashboard.js'
  });

  await build({
    entryPoints: ['src/webviews/dashboard/simnodes/simnodesDashboard.webview.tsx'],
    ...webviewOptions,
    outfile: 'dist/simnodesDashboard.js'
  });

  await build({
    entryPoints: ['src/webviews/dashboard/resource/resourceBrowserPanel.webview.tsx'],
    ...webviewOptions,
    outfile: 'dist/resourceBrowserPanel.js'
  });

  await build({
    entryPoints: ['src/webviews/dashboard/fabric/fabricDashboard.webview.tsx'],
    ...webviewOptions,
    outfile: 'dist/fabricDashboard.js'
  });

  await build({
    entryPoints: ['src/webviews/dashboard/queries/queriesDashboard.webview.tsx'],
    ...webviewOptions,
    outfile: 'dist/queriesDashboard.js'
  });

  await build({
    entryPoints: ['src/webviews/dashboard/topology/topologyDashboard.webview.tsx'],
    ...webviewOptions,
    outfile: 'dist/topologyDashboard.js'
  });

  await build({
    entryPoints: ['src/webviews/targetWizard/targetWizardPanel.webview.tsx'],
    ...webviewOptions,
    outfile: 'dist/targetWizardPanel.js'
  });

  await build({
    entryPoints: ['src/webviews/nodeConfig/nodeConfigPanel.webview.tsx'],
    ...webviewOptions,
    outfile: 'dist/nodeConfigPanel.js'
  });

  await build({
    entryPoints: ['src/webviews/alarmDetails/alarmDetailsPanel.webview.tsx'],
    ...webviewOptions,
    outfile: 'dist/alarmDetailsPanel.js'
  });

  await build({
    entryPoints: ['src/webviews/transactionDetails/transactionDetailsPanel.webview.tsx'],
    ...webviewOptions,
    outfile: 'dist/transactionDetailsPanel.js'
  });

  await build({
    entryPoints: ['src/webviews/transactionDiffs/transactionDiffsPanel.webview.tsx'],
    ...webviewOptions,
    outfile: 'dist/transactionDiffsPanel.js'
  });
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
