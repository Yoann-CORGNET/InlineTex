import { describe, expect, it } from 'vitest';
import { scan } from '../src/parser/scan';
import type { MathToken } from '../src/parser/tokens';
import { convertColumnSpec, tabularToArray } from '../src/parser/table';

describe('convertColumnSpec', () => {
  it('keeps what MathJax knows and maps paragraph and X columns to l', () => {
    expect(convertColumnSpec('|l|c|r|')).toBe('|l|c|r|');
    expect(convertColumnSpec('p{3cm}m{2cm}b{1cm}X')).toBe('llll');
    expect(convertColumnSpec('@{}l@{\\quad}r')).toBe('@{}l@{\\quad}r');
    expect(convertColumnSpec('*{3}{p{1cm}|}')).toBe('*{3}{l|}');
    expect(convertColumnSpec('>{\\bfseries}p{2cm}')).toBe('>{\\bfseries}l');
  });

  it('keeps inter-column material verbatim, with or without a group', () => {
    expect(convertColumnSpec(String.raw`l!{\vrule}r<{\,}c`)).toBe(String.raw`l!{\vrule}r<{\,}c`);
    expect(convertColumnSpec('l@{a{b}c}r')).toBe('l@{a{b}c}r');
    expect(convertColumnSpec('l@r')).toBe('l@r');
    expect(convertColumnSpec('l>{')).toBe('l>{');
  });

  it('maps paragraph columns without a width group to l', () => {
    expect(convertColumnSpec('pc')).toBe('lc');
    expect(convertColumnSpec('m{')).toBe('l{');
    expect(convertColumnSpec('XXc')).toBe('llc');
  });

  it('converts repeated columns recursively and keeps malformed ones as is', () => {
    expect(convertColumnSpec('*{2}{*{3}{X}|}')).toBe('*{2}{*{3}{l}|}');
    expect(convertColumnSpec('c*{2}p{1cm}')).toBe('c*{2}p{1cm}');
    expect(convertColumnSpec('l*3c')).toBe('l*3c');
    expect(convertColumnSpec('l*{2}')).toBe('l*{2}');
  });

  it('passes through unknown specifiers and the empty spec', () => {
    expect(convertColumnSpec('')).toBe('');
    expect(convertColumnSpec('S[2.1]c')).toBe('S[2.1]c');
  });
});

describe('tabularToArray', () => {
  it('wraps cells as text and keeps rules out of them', () => {
    expect(tabularToArray('|l|c|', '\n\\hline\nNom & $x^2$ \\\\\n\\hline\n')).toBe(
      '\\begin{array}{|l|c|}\n\\hline \\text{Nom} & \\text{$x^2$} \\\\\n\\hline \n\\end{array}',
    );
  });

  it('drops the empty row after a final row break', () => {
    expect(tabularToArray('l', 'a \\\\\n')).toBe('\\begin{array}{l}\n\\text{a}\n\\end{array}');
  });

  it('handles booktabs, cmidrule, spacing and escaped ampersands', () => {
    const out = tabularToArray('ll', '\\toprule A \\& B & C \\\\[2pt] \\cmidrule(lr){1-2} D & E \\\\ \\bottomrule');
    expect(out).toContain('\\hline \\text{A \\& B} & \\text{C}');
    expect(out).toContain('\\hline \\text{D} & \\text{E}');
    expect(out).not.toContain('[2pt]');
  });

  it('spreads multicolumn over empty cells and keeps the text of multirow', () => {
    expect(tabularToArray('lll', '\\multicolumn{2}{c}{Titre} & x \\\\ \\multirow{2}{*}{M} & a & b')).toContain(
      '\\text{Titre} &  & \\text{x} \\\\\n\\text{M} & \\text{a} & \\text{b}',
    );
  });

  it('does not split on separators inside braces, and drops comments', () => {
    const out = tabularToArray('l', '\\textbf{a & b \\\\ c} % x & y \\\\\n');
    expect(out).toContain('\\text{\\textbf{a & b \\\\ c}}');
    expect(out).not.toContain('x & y');
  });
});

describe('scan: tables', () => {
  it('finds tabular, tabular* and tabularx with their arguments', () => {
    const src =
      '\\begin{tabular}[t]{lr}a & b\\end{tabular}\n' +
      '\\begin{tabular*}{\\linewidth}{lc}c & d\\end{tabular*}\n' +
      '\\begin{tabularx}{0.5\\textwidth}{lX}e & f\\end{tabularx}';
    const t = scan(src).filter((x): x is MathToken => x.type === 'math');
    expect(t).toHaveLength(3);
    expect(t.every((x) => x.table && x.display)).toBe(true);
    expect(t.map((x) => x.tex.split('\n')[0])).toEqual([
      '\\begin{array}{lr}',
      '\\begin{array}{lc}',
      '\\begin{array}{ll}',
    ]);
    expect(src.slice(t[2].start, t[2].end)).toMatch(/^\\begin\{tabularx\}.*\\end\{tabularx\}$/);
  });

  it('leaves an unclosed tabular as source', () => {
    expect(scan('\\begin{tabular}{l} a \n\nsuite').filter((x) => x.type === 'math')).toEqual([]);
  });
});
