import { describe, expect, it } from 'vitest';
import { scanMarkdown } from '../src/parser/markdown';

const tex = (src: string) => scanMarkdown(src).map((t) => [t.tex, t.display]);

describe('scanMarkdown', () => {
  it('finds inline and display math', () => {
    expect(tex('Soit $x^2$ et\n\n$$\n\\int f\n$$')).toEqual([
      ['x^2', false],
      ['\n\\int f\n', true],
    ]);
  });

  it('follows the Pandoc rules for single dollars', () => {
    expect(tex('Prix : $5 et $10.')).toEqual([]);
    expect(tex('de $ a $ b')).toEqual([]);
    expect(tex('$a$5 puis $b$')).toEqual([['a$5 puis $b', false]]);
    expect(tex('un prix de $5 et de $10, et `$HOME` dans du code')).toEqual([]);
  });

  it('does not treat % as a comment', () => {
    expect(tex('50 % de $x$')).toEqual([['x', false]]);
  });

  it('skips code spans and fenced blocks', () => {
    expect(tex('`$x$` et ``a ` $y$`` puis $z$')).toEqual([['z', false]]);
    expect(tex('```sh\necho $HOME $PATH\n```\n$w$')).toEqual([['w', false]]);
    expect(tex('~~~~\n$a$\n~~~\n$b$\n~~~~\n$c$')).toEqual([['c', false]]);
  });

  it('honours escaped dollars and does not cross a blank line', () => {
    expect(tex('5\\$ et 3\\$')).toEqual([]);
    expect(tex('$a\n\nb$')).toEqual([]);
  });
});
