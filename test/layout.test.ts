import { describe, expect, it } from 'vitest';
import { layoutImage, resolveLineHeight } from '../src/editor/layout';
import { renderMath } from '../src/render/mathjax';

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

describe('renderMath', () => {
  const opts = { color: '#123456', exPx: 6, display: false };

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
});

describe('resizeSvg', () => {
  it('rewrites only the root width and height', async () => {
    const { resizeSvg } = await import('../src/render/mathjax');
    const out = resizeSvg('<svg width="10px" height="20px"><rect width="3" height="4"/></svg>', 5, 6);
    expect(out).toBe('<svg width="5.00px" height="6.00px"><rect width="3" height="4"/></svg>');
  });
});
