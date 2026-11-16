import { describe, expect, it } from 'vitest';
import { findIncludes, hasDocumentClass, includeFileName, magicRoot } from '../src/parser/project';

describe('project files', () => {
  it('reads the magic root comment', () => {
    expect(magicRoot('% !TEX root = ../main.tex\n\\section{A}')).toBe('../main.tex');
    expect(magicRoot('%!TeX root=main.tex')).toBe('main.tex');
    expect(magicRoot('\\section{A}')).toBeUndefined();
  });

  it('detects a main document, ignoring comments', () => {
    expect(hasDocumentClass('\\documentclass{article}')).toBe(true);
    expect(hasDocumentClass('% \\documentclass{article}')).toBe(false);
  });

  it('lists inputs and local packages in order', () => {
    const src = '\\usepackage[utf8]{inputenc,mymacros}\n% \\input{old}\n\\input{chap/one}\n\\include{two.tex}';
    expect(findIncludes(src)).toEqual([
      { kind: 'sty', name: 'inputenc' },
      { kind: 'sty', name: 'mymacros' },
      { kind: 'tex', name: 'chap/one' },
      { kind: 'tex', name: 'two.tex' },
    ]);
  });

  it('adds the extension LaTeX would', () => {
    expect(includeFileName({ kind: 'tex', name: 'chap/one' })).toBe('chap/one.tex');
    expect(includeFileName({ kind: 'tex', name: 'two.tex' })).toBe('two.tex');
    expect(includeFileName({ kind: 'sty', name: 'mymacros' })).toBe('mymacros.sty');
  });
});
