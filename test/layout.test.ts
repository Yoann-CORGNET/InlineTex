import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutImage, resolveLineHeight } from '../src/editor/layout';
import { tabularToArray } from '../src/parser/table';
import { checkMath, renderMath, setFontLoader } from '../src/render/mathjax';
import { resizeSvg } from '../src/render/svg';

// Load glyph files from the font package, as the extension does from dist/fonts.
const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('@mathjax/mathjax-newcm-font/package.json')), 'mjs/svg/dynamic');
const loadedFonts: string[] = [];
setFontLoader((name) => {
  loadedFonts.push(name);
  require(join(fontDir, `${name}.js`));
});

const metrics = { fontSizePx: 14, lineHeightPx: 19, scale: 1 };

describe('resolveLineHeight', () => {
  it('follows VS Code rules', () => {
    expect(resolveLineHeight(14, 0, false)).toBe(19);
    expect(resolveLineHeight(14, 1.5, false)).toBe(21);
    expect(resolveLineHeight(14, 24, false)).toBe(24);
  });
});

describe('layoutImage', () => {
  it('scales tall inline math down to the line height', () => {
    const box = layoutImage({ widthPx: 60, heightPx: 38, depthPx: 15 }, false, 1, metrics);
    expect(box.heightPx).toBeCloseTo(19);
    expect(box.widthPx).toBeCloseTo(30);
  });

  it('lets multi-line display math use all its lines', () => {
    const box = layoutImage({ widthPx: 200, heightPx: 50, depthPx: 20 }, true, 3, metrics);
    expect(box.heightPx).toBe(50);
    expect(box.verticalAlign).toBe('top');
  });
});

const opts = { color: '#123456', exPx: 6, display: false };

describe('renderMath', () => {

  it('produces a self-contained coloured SVG', () => {
    const r = renderMath('\\frac{a}{b}', opts);
    expect(r.error).toBeUndefined();
    expect(r.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(r.svg).toContain('#123456');
    expect(r.svg).not.toContain('currentColor');
    expect(r.svg).not.toContain('<use');
    expect(r.heightPx).toBeGreaterThan(0);
  });

  it('reports TeX errors instead of throwing', () => {
    const r = renderMath('\\frac{a', opts);
    expect(r.error).toMatch(/\w/);
    expect(r.error).not.toBe('[object Object]');
  });

  it('loads rare glyphs synchronously', () => {
    const r = renderMath('\\leadsto', opts);
    expect(r.error).toBeUndefined();
    expect(r.widthPx).toBeGreaterThan(0);
    expect(loadedFonts.length).toBeGreaterThan(0);
  });

  it('reuses glyph files loaded for another macro set', () => {
    expect(renderMath('\\mathbb{Q}', opts).error).toBeUndefined();
    expect(renderMath('\\mathbb{Q}', opts, { other: 'x' }).error).toBeUndefined();
  });

  it('applies document macros', () => {
    const r = renderMath('\\R', opts, { R: '\\mathbb{R}' });
    expect(r.error).toBeUndefined();
    // Without the macro, noundefined draws "\R" as text instead of the double-struck R.
    expect(renderMath('\\R', opts).svg).not.toBe(r.svg);
  });
});

describe('tables through MathJax', () => {
  const tables = [
    ['|l|c|r|', '\\hline Nom & Valeur & $x^2$ \\\\ \\hline a & \\textbf{b} & \\emph{c} \\\\ \\hline'],
    ['p{3cm}X', 'Un long texte & 50\\% \\& co \\\\'],
    ['@{}lr@{}', '\\toprule A & B \\\\ \\midrule \\multicolumn{2}{c}{Fusion} \\\\ \\cmidrule(lr){1-2} \\multirow{2}{*}{M} & 1 \\\\ \\bottomrule'],
  ];

  it.each(tables)('renders {%s} without error', (spec, body) => {
    const tex = tabularToArray(spec, body);
    expect(checkMath(tex, true)).toBeUndefined();
    const r = renderMath(tex, { ...opts, display: true });
    expect(r.error).toBeUndefined();
    expect(r.heightPx).toBeGreaterThan(0);
    // noundefined draws unknown commands in red instead of failing.
    expect(r.svg).not.toMatch(/"red"/);
  });

  it('embeds the stylesheet that draws rules and frames', () => {
    const r = renderMath(tabularToArray('|l|l|', '\\hline a & b \\\\ \\hline'), { ...opts, display: true });
    expect(r.svg).toMatch(/^<svg[^>]*><style>line\[data-line\],rect\[data-frame\]\{stroke-width:70px;fill:none\}/);
    expect(renderMath('x', opts).svg).not.toContain('<style>');
  });

  it('shows unknown commands in red, which the table checks rely on', () => {
    expect(renderMath('\\multicolumn{2}{c}{x}', opts).svg).toMatch(/"red"/);
  });
});

describe('checkMath', () => {
  it('can convert the same labelled formula again', () => {
    const tex = '\\begin{align}a \\label{eq:x}\\end{align}';
    expect(checkMath(tex, true)).toBeUndefined();
    expect(checkMath(tex, true)).toBeUndefined();
    expect(renderMath(tex, { ...opts, display: true }).error).toBeUndefined();
  });

  it('reports errors without typesetting', () => {
    expect(checkMath('\\frac{a}{b}', false)).toBeUndefined();
    expect(checkMath('\\frac{a', false)).toMatch(/\w/);
    expect(checkMath('\\norm{x}', true, { norm: ['\\lVert #1 \\rVert', 1] })).toBeUndefined();
  });
});

describe('resizeSvg', () => {
  it('rewrites only the root width and height', () => {
    const out = resizeSvg('<svg width="10px" height="20px"><rect width="3" height="4"/></svg>', 5, 6);
    expect(out).toBe('<svg width="5.00px" height="6.00px"><rect width="3" height="4"/></svg>');
  });
});
