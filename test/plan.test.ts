import { describe, expect, it } from 'vitest';
import { blankLinesAfter, displaySpan, isRevealed, lineAt, lineStarts, linesToOffsets, tokensToDecorate } from '../src/editor/plan';
import { scan } from '../src/parser/scan';
import { Lru } from '../src/util/lru';

describe('lines', () => {
  const src = 'ab\ncd\n\nef';
  const starts = lineStarts(src);

  it('indexes line starts and finds the line of an offset', () => {
    expect(starts).toEqual([0, 3, 6, 7]);
    expect([0, 2, 3, 6, 7, 9].map((o) => lineAt(starts, o))).toEqual([0, 0, 1, 2, 3, 3]);
  });

  it('converts visible lines to offsets with a margin', () => {
    expect(linesToOffsets(starts, src.length, 1, 1, 0)).toEqual({ start: 3, end: 6 });
    expect(linesToOffsets(starts, src.length, 1, 2, 5)).toEqual({ start: 0, end: src.length });
  });

  it('counts blank lines after a line', () => {
    expect(blankLinesAfter(src, starts, 1, 3)).toBe(1);
    expect(blankLinesAfter(src, starts, 0, 3)).toBe(0);
    expect(blankLinesAfter('a\n\n\n\n', lineStarts('a\n\n\n\n'), 0, 2)).toBe(2);
  });
});

describe('reveal', () => {
  const src = 'aa $x$ bb\ncc $y$';
  const starts = lineStarts(src);
  const [x, y] = scan(src);

  it('reveals a token touched by the cursor, including at its edges', () => {
    expect(isRevealed(x, [{ start: 3, end: 3 }], 'cursor', starts)).toBe(true);
    expect(isRevealed(x, [{ start: 6, end: 6 }], 'cursor', starts)).toBe(true);
    expect(isRevealed(x, [{ start: 8, end: 8 }], 'cursor', starts)).toBe(false);
  });

  it('reveals the whole line in line mode', () => {
    expect(isRevealed(x, [{ start: 8, end: 8 }], 'line', starts)).toBe(true);
    expect(isRevealed(y, [{ start: 8, end: 8 }], 'line', starts)).toBe(false);
  });

  it('keeps visible, untouched tokens, including a format token starting above the viewport', () => {
    const doc = '\\textbf{long x\ny} $z$';
    const tokens = scan(doc);
    const docStarts = lineStarts(doc);
    const kept = tokensToDecorate({
      tokens,
      lineStarts: docStarts,
      visible: [linesToOffsets(docStarts, doc.length, 1, 1, 0)],
      selections: [],
      revealOn: 'cursor',
    });
    expect(kept.map((t) => t.type)).toEqual(['format', 'math']);
    const none = tokensToDecorate({
      tokens,
      lineStarts: docStarts,
      visible: [linesToOffsets(docStarts, doc.length, 1, 1, 0)],
      selections: [{ start: doc.length - 2, end: doc.length - 2 }],
      revealOn: 'line',
    });
    expect(none).toEqual([]);
  });
});

describe('Lru', () => {
  it('evicts the least recently used entry', () => {
    const lru = new Lru<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a');
    lru.set('c', 3);
    expect([lru.get('a'), lru.get('b'), lru.get('c')]).toEqual([1, undefined, 3]);
  });
});

describe('displaySpan', () => {
  const src = 'a\n$$x\ny$$\n\n\nb';
  const starts = lineStarts(src);
  const start = src.indexOf('$$');
  const end = src.lastIndexOf('$$') + 2;

  it('counts the lines of the token', () => {
    expect(displaySpan(src, starts, start, end, 0)).toBe(2);
  });

  it('adds the blank lines after it, up to the bound', () => {
    expect(displaySpan(src, starts, start, end, 3)).toBe(4);
    expect(displaySpan(src, starts, start, end, 1)).toBe(3);
  });
});
