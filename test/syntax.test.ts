import { describe, expect, it } from 'vitest';
import { stripComments } from '../src/parser/syntax';

describe('stripComments', () => {
  it('removes a comment up to the end of its line', () => {
    expect(stripComments('a % b\nc %d')).toBe('a \nc ');
    expect(stripComments('%x\n%y\nz')).toBe('\n\nz');
  });

  it('keeps an escaped percent sign', () => {
    expect(stripComments('50\\% off % note')).toBe('50\\% off ');
  });

  it('treats \\\\% as a line break followed by a comment', () => {
    expect(stripComments('a \\\\% note\nb')).toBe('a \\\\\nb');
  });
});
