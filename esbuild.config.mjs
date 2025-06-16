/* eslint-env node */
import { build } from 'esbuild';

build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  minify: true,
  target: 'node16',
  external: ['vscode'],
  outfile: 'dist/extension.js'
}).catch(err => {
  console.error(err);
  process.exit(1);
});
