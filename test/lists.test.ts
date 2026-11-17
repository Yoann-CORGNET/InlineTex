import { describe, expect, it } from 'vitest';
import { enumeratePackageLabel, enumitemLabel, itemLabel, parseListOptions } from '../src/parser/lists';
import { scan } from '../src/parser/scan';
import type { FormatToken, SymbolToken } from '../src/parser/tokens';

/** Labels drawn for each \item, in order. */
const labels = (src: string) =>
  scan(src)
    .filter((t): t is SymbolToken | FormatToken => t.type === 'symbol' || (t.type === 'format' && t.kind === 'bold'))
    .map((t) => (t.type === 'symbol' ? t.text : `[${src.slice(t.argStart, t.argEnd)}]`));

const muted = (src: string) =>
  scan(src)
    .filter((t): t is FormatToken => t.type === 'format' && t.kind === 'muted')
    .map((t) => src.slice(t.start, t.end));

describe('lists: bullets', () => {
  it('changes the bullet with the nesting level', () => {
    const src = `\\begin{itemize}
  \\item a
  \\begin{itemize}
    \\item b
    \\begin{itemize}
      \\item c
      \\begin{itemize} \\item d \\end{itemize}
    \\end{itemize}
  \\end{itemize}
  \\item e
\\end{itemize}`;
    expect(labels(src)).toEqual(['•', '–', '∗', '·', '•']);
  });

  it('dims the environment markup, options included', () => {
    expect(muted('\\begin{itemize}[label=--] \\item a \\end{itemize}')).toEqual([
      '\\begin{itemize}[label=--]',
      '\\end{itemize}',
    ]);
  });

  it('keeps a bullet for an \\item outside any list', () => {
    expect(labels('\\item a')).toEqual(['•']);
  });
});

describe('lists: numbering', () => {
  it('numbers items per level with the LaTeX defaults', () => {
    const src = `\\begin{enumerate}
  \\item a \\item b
  \\begin{enumerate}
    \\item c \\item d
    \\begin{enumerate} \\item e \\begin{enumerate} \\item f \\end{enumerate} \\end{enumerate}
  \\end{enumerate}
  \\item g
\\end{enumerate}
\\begin{enumerate} \\item h \\end{enumerate}`;
    expect(labels(src)).toEqual(['1.', '2.', '(a)', '(b)', 'i.', 'A.', '3.', '1.']);
  });

  it('counts enumerate and itemize levels separately when mixed', () => {
    const src = '\\begin{enumerate}\\item a\\begin{itemize}\\item b\\begin{enumerate}\\item c\\end{enumerate}\\end{itemize}\\end{enumerate}';
    expect(labels(src)).toEqual(['1.', '•', '(a)']);
  });

  it('shows explicit labels without moving the counter', () => {
    expect(labels('\\begin{enumerate}\\item a\\item[x] b\\item c\\end{enumerate}')).toEqual(['1.', '[x]', '2.']);
  });

  it('follows \\setcounter and \\addtocounter', () => {
    const src = '\\begin{enumerate}\\setcounter{enumi}{4}\\item a\\addtocounter{enumi}{2}\\item b\\end{enumerate}';
    expect(labels(src)).toEqual(['5.', '8.']);
  });

  it('reads enumitem label, start and resume', () => {
    const src = `\\begin{enumerate}[label=\\alph*)] \\item a \\item b \\end{enumerate}
\\begin{enumerate}[label=\\textbf{\\Roman*.}, start=3] \\item c \\end{enumerate}
\\begin{enumerate}[resume] \\item d \\end{enumerate}`;
    expect(labels(src)).toEqual(['a)', 'b)', 'III.', '4.']);
  });

  it('reads the enumerate package syntax', () => {
    expect(labels('\\begin{enumerate}[(i)] \\item a \\item b \\end{enumerate}')).toEqual(['(i)', '(ii)']);
  });

  it('shows nothing for an unlabelled description item, and the term otherwise', () => {
    expect(labels('\\begin{description}\\item[Terme] déf \\item x\\end{description}')).toEqual(['[Terme]', '']);
  });
});

describe('list labels', () => {
  it('formats counters', () => {
    const f = enumitemLabel('(\\roman*)');
    expect([1, 4, 9, 14].map((n) => f?.(n))).toEqual(['(i)', '(iv)', '(ix)', '(xiv)']);
    expect(enumitemLabel('\\Alph*.')?.(28)).toBe('AB.');
  });

  it('maps common itemize symbols and gives up on other commands', () => {
    expect(enumitemLabel('$\\star$')?.(0)).toBe('⋆');
    expect(enumitemLabel('--')?.(0)).toBe('–');
    expect(enumitemLabel('\\ding{51}')).toBeUndefined();
    expect(enumeratePackageLabel('{Ex.} 1')?.(2)).toBe('Ex. 2');
  });

  it('falls back to the default label when the custom one is unsupported', () => {
    const level = { kind: 'enumerate' as const, counter: 2, format: parseListOptions('enumerate', 'label=\\ding{1}').format };
    expect(itemLabel(level, 1)).toBe('2.');
  });
});
