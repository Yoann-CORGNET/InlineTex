import * as esbuild from 'esbuild';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  minify: production,
  logLevel: 'info',
};

const ctx = await esbuild.context({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
});

/*
 * MathJax 4 keeps rare glyphs in "dynamic" files that it loads on demand.
 * Each one becomes its own file in dist/fonts, loaded only when needed. They
 * register into the font class of the main bundle, shared through a global
 * (see FONT_GLOBAL in src/render/mathjax.ts) instead of bundling a second copy.
 */
const fontDir = join(
  dirname(createRequire(import.meta.url).resolve('@mathjax/mathjax-newcm-font/package.json')),
  'mjs/svg/dynamic',
);
const sharedFont = {
  name: 'shared-font',
  setup(build) {
    build.onResolve({ filter: /\/svg\.js$/ }, () => ({ path: 'font', namespace: 'shared-font' }));
    build.onLoad({ filter: /.*/, namespace: 'shared-font' }, () => ({
      contents: "export const MathJaxNewcmFont = globalThis[Symbol.for('inlineTeX.mathjaxNewcmFont')];",
    }));
  },
};
await esbuild.build({
  ...common,
  minify: true,
  entryPoints: readdirSync(fontDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(fontDir, f)),
  outdir: 'dist/fonts',
  plugins: [sharedFont],
  logLevel: 'warning',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
