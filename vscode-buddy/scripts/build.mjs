import { build } from 'esbuild';
import { copyFileSync } from 'node:fs';

await build({
  entryPoints: ['webview/main.js'],
  outfile: 'media/webview.js',
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  minify: true,
  legalComments: 'none',
  logLevel: 'info'
});
await build({
  entryPoints: ['overlay/renderer.js'],
  outfile: 'media/overlay.js',
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  minify: true,
  legalComments: 'none',
  logLevel: 'info'
});
copyFileSync('webview/style.css', 'media/webview.css');
