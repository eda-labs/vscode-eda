/* eslint-env node */
import { build } from 'esbuild';

const webviewEntryPoints = {
  toponodesDashboard: 'src/webviews/dashboard/toponodes/toponodesDashboard.webview.tsx',
  simnodesDashboard: 'src/webviews/dashboard/simnodes/simnodesDashboard.webview.tsx',
  resourceBrowserPanel: 'src/webviews/dashboard/resource/resourceBrowserPanel.webview.tsx',
  fabricDashboard: 'src/webviews/dashboard/fabric/fabricDashboard.webview.tsx',
  queriesDashboard: 'src/webviews/dashboard/queries/queriesDashboard.webview.tsx',
  topologyFlowDashboard: 'src/webviews/dashboard/topologyFlow/topologyFlowDashboard.webview.tsx',
  workflowsDashboard: 'src/webviews/dashboard/workflows/workflowsDashboard.webview.tsx',
  targetWizardPanel: 'src/webviews/targetWizard/targetWizardPanel.webview.tsx',
  nodeConfigPanel: 'src/webviews/nodeConfig/nodeConfigPanel.webview.tsx',
  alarmDetailsPanel: 'src/webviews/alarmDetails/alarmDetailsPanel.webview.tsx',
  deviationDetailsPanel: 'src/webviews/deviationDetails/deviationDetailsPanel.webview.tsx',
  transactionDetailsPanel: 'src/webviews/transactionDetails/transactionDetailsPanel.webview.tsx',
  transactionDiffsPanel: 'src/webviews/transactionDiffs/transactionDiffsPanel.webview.tsx',
  edaExplorerView: 'src/webviews/explorer/edaExplorerView.webview.tsx'
};

// Build webview entrypoints together so React/MUI dependencies are emitted once in shared chunks.
const webviewOptions = {
  bundle: true,
  platform: 'browser',
  format: 'esm',
  splitting: true,
  sourcemap: false,
  minify: true,
  treeShaking: true,
  jsx: 'automatic',
  jsxImportSource: 'react',
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  outdir: 'dist'
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
    entryPoints: webviewEntryPoints,
    ...webviewOptions
  });
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
