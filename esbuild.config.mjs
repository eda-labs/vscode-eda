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
    entryPoints: ['src/panels/dashboard/toponodes/toponodesDashboardView.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    sourcemap: false,
    outfile: 'dist/toponodesDashboard.js'
  });
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
