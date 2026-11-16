import { describe, expect, it } from 'vitest';
import { cssColor, matchBrace, scan, type FormatToken, type MathToken, type SymbolToken } from '../src/parser/scan';
import { collectMacros } from '../src/parser/macros';

const math = (src: string) => scan(src).filter((t): t is MathToken => t.type === 'math');
const formats = (src: string) => scan(src).filter((t): t is FormatToken => t.type === 'format');
const symbols = (src: string) => scan(src).filter((t): t is SymbolToken => t.type === 'symbol');

describe('scan: math', () => {
  it('finds inline $...$', () => {
    const src = 'Soit $x^2$ et $y$.';
    const t = math(src);
    expect(t.map((m) => m.tex)).toEqual(['x^2', 'y']);
    expect(src.slice(t[0].start, t[0].end)).toBe('$x^2$');
    expect(t[0].display).toBe(false);
  });

  it('finds display $$...$$, \\[...\\] and \\(...\\)', () => {
    const t = math('$$a$$ \\[b\\] \\(c\\)');
    expect(t.map((m) => [m.tex, m.display])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
    ]);
  });

  it('ignores escaped dollars', () => {
    expect(math('Prix : 5\\$ et 3\\$.')).toEqual([]);
    expect(math('$a\\$b$').map((m) => m.tex)).toEqual(['a\\$b']);
  });

  it('ignores math in comments', () => {
    expect(math('% $x$\ntexte')).toEqual([]);
    expect(math('$a % $\n+b$').map((m) => m.tex)).toEqual(['a % $\n+b']);
  });

  it('does not let inline math cross a blank line', () => {
    expect(math('$a\n\nb$')).toEqual([]);
  });

  it('passes amsmath environments whole, multi-line', () => {
    const src = 'x\n\\begin{align*}\n a &= b \\\\\n c &= d\n\\end{align*}\ny';
    const [t] = math(src);
    expect(t.display).toBe(true);
    expect(t.tex.startsWith('\\begin{align*}')).toBe(true);
    expect(src.slice(t.end)).toBe('\ny');
  });

  it('passes only the body of displaymath', () => {
    expect(math('\\begin{displaymath}e^x\\end{displaymath}')[0].tex).toBe('e^x');
  });

  it('skips verbatim environments', () => {
    expect(math('\\begin{verbatim}$x$\\end{verbatim} $y$').map((m) => m.tex)).toEqual(['y']);
  });

  it('does not let inline math cross a blank line in CRLF files', () => {
    expect(math('$a\r\n\r\nb$')).toEqual([]);
  });

  it('skips \\verb content', () => {
    expect(math('\\verb|$| puis $x$').map((m) => m.tex)).toEqual(['x']);
    expect(math('\\verb*+$+ puis $y$').map((m) => m.tex)).toEqual(['y']);
  });

  it('treats \\url and \\path arguments as literal', () => {
    expect(math('\\url{http://a.b/%7E$x} et $z$').map((m) => m.tex)).toEqual(['z']);
  });

  it('keeps $ nested in \\text{} inside the formula', () => {
    expect(math('$\\sum_{\\text{$n$ odd}} n$ et $y$').map((m) => m.tex)).toEqual([
      '\\sum_{\\text{$n$ odd}} n',
      'y',
    ]);
  });

  it('does not let an unclosed environment swallow the next paragraphs', () => {
    const src = '\\begin{align}\n a &= b\n\nTexte $x$.\n\\begin{align}\nc\n\\end{align}';
    const t = math(src);
    expect(t.map((m) => m.tex)).toEqual(['x', '\\begin{align}\nc\n\\end{align}']);
  });

  it('survives an unbalanced brace inside a formula', () => {
    // The broken formula stays one token (shown as an error); the next one is intact.
    expect(math('$\\frac{1}{$ ;\n\npuis $z$').map((m) => m.tex)).toEqual(['\\frac{1}{', 'z']);
  });

  it('ignores an unclosed dollar', () => {
    expect(math('cost $5 only')).toEqual([]);
  });
});

describe('scan: formatting', () => {
  it('finds \\textbf with its argument range', () => {
    const src = 'a \\textbf{gras} b';
    const [f] = formats(src);
    expect(f.kind).toBe('bold');
    expect(src.slice(f.argStart, f.argEnd)).toBe('gras');
    expect(src.slice(f.start, f.end)).toBe('\\textbf{gras}');
  });

  it('handles nesting and math inside arguments', () => {
    const src = '\\textbf{a \\emph{b} $c$}';
    expect(formats(src).map((f) => f.kind)).toEqual(['bold', 'italic']);
    expect(math(src).map((m) => m.tex)).toEqual(['c']);
  });

  it('handles starred sections', () => {
    const src = '\\section*{Intro}';
    const [f] = formats(src);
    expect(f.kind).toBe('section');
    expect(src.slice(f.argStart, f.argEnd)).toBe('Intro');
  });

  it('does not confuse \\textbfx with \\textbf', () => {
    expect(formats('\\textbfx{a}')).toEqual([]);
  });

  it('turns \\item into a bullet', () => {
    const t = scan('\\item un');
    expect(t[0]).toMatchObject({ type: 'symbol', text: '•', start: 0, end: 5 });
  });

  it('shows the label of \\item[...] in bold', () => {
    const src = '\\item[Note $x$] texte';
    const [f] = formats(src);
    expect(f.kind).toBe('bold');
    expect(src.slice(f.argStart, f.argEnd)).toBe('Note $x$');
    expect(src.slice(f.start, f.end)).toBe('\\item[Note $x$]');
    expect(math(src).map((m) => m.tex)).toEqual(['x']);
  });

  it('shows the full title of \\section[short]{full}', () => {
    const src = '\\section[Court]{Titre complet}';
    const [f] = formats(src);
    expect(src.slice(f.argStart, f.argEnd)).toBe('Titre complet');
    expect(f.end).toBe(src.length);
  });

  it('does not let an unclosed argument run past the paragraph', () => {
    const src = '{\\textbf{abc\n\nsuite} fin}';
    expect(formats(src)).toEqual([]);
  });

  it('reads \\textcolor with named and model colors', () => {
    const src = '\\textcolor{red}{a} \\textcolor[HTML]{00FF00}{b} \\textcolor[rgb]{0,0,1}{c}';
    expect(formats(src).map((f) => [f.kind, f.color, src.slice(f.argStart, f.argEnd)])).toEqual([
      ['color', 'red', 'a'],
      ['color', '#00FF00', 'b'],
      ['color', 'rgb(0, 0, 255)', 'c'],
    ]);
  });

  it('styles \\href text and \\url as links', () => {
    const src = '\\href{https://a.b}{site} \\url{http://c.d/%7E}';
    expect(formats(src).map((f) => [f.kind, f.target, src.slice(f.argStart, f.argEnd)])).toEqual([
      ['link', 'https://a.b', 'site'],
      ['link', 'http://c.d/%7E', 'http://c.d/%7E'],
    ]);
  });
});

describe('scan: references, notes and images', () => {
  it('replaces references, citations and labels by their keys', () => {
    const src = '\\ref{sec:a} \\eqref{eq:b} \\cite[p.~3]{knuth, lamport} \\label{fig:c}';
    expect(symbols(src).map((t) => [t.style, t.text])).toEqual([
      ['ref', 'sec:a'],
      ['ref', '(eq:b)'],
      ['ref', '[knuth, lamport]'],
      ['label', 'fig:c'],
    ]);
  });

  it('folds footnotes into numbered marks and does not scan their content', () => {
    const src = 'a\\footnote{Voir $x$.} b\\footnote{Deux}';
    expect(symbols(src).map((t) => [t.style, t.text, t.hover])).toEqual([
      ['note', '¹', 'Voir $x$.'],
      ['note', '²', 'Deux'],
    ]);
    expect(math(src)).toEqual([]);
  });

  it('finds \\includegraphics paths', () => {
    const t = scan('\\includegraphics[width=0.5\\linewidth]{img/plot}');
    expect(t).toMatchObject([{ type: 'image', path: 'img/plot' }]);
  });
});

describe('matchBrace', () => {
  it('can stop at a blank line', () => {
    const src = '{a\n\n}';
    expect(matchBrace(src, 0)).toBe(4);
    expect(matchBrace(src, 0, true)).toBe(-1);
  });
});

describe('cssColor', () => {
  it('rejects what CSS cannot show', () => {
    expect(cssColor(undefined, 'red!50')).toBeUndefined();
    expect(cssColor('cmyk', '0,1,1,0')).toBeUndefined();
    expect(cssColor('gray', '0.5')).toBe('rgb(128, 128, 128)');
  });
});

describe('collectMacros', () => {
  it('reads newcommand with and without arguments', () => {
    const m = collectMacros('\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\norm}[1]{\\lVert #1 \\rVert}');
    expect(m).toEqual({ R: '\\mathbb{R}', norm: ['\\lVert #1 \\rVert', 1] });
  });

  it('reads \\def and DeclareMathOperator', () => {
    const m = collectMacros('\\def\\eps{\\varepsilon}\n\\DeclareMathOperator{\\tr}{tr}');
    expect(m).toEqual({ eps: '\\varepsilon', tr: '\\operatorname{tr}' });
  });

  it('ignores commented definitions', () => {
    expect(collectMacros('% \\newcommand{\\R}{x}')).toEqual({});
  });
});

describe('scan: blank-line guard', () => {
  it('only stops at a blank line inside the formula, not one shortly after it', () => {
    const src = '\\[\n  e^{i\\pi} + 1 = 0\n\\]\n\n\\begin{align*}\n a\n\\end{align*}';
    expect(math(src)).toHaveLength(2);
  });
});
