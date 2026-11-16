/**
 * Pure helpers to follow a multi-file LaTeX project: magic root comment,
 * \documentclass detection and the files a document pulls in.
 */

export interface Include {
  /** `tex` for \input / \include / \subfile, `sty` for \usepackage / \RequirePackage. */
  kind: 'tex' | 'sty';
  /** Name as written, without the extension LaTeX would add. */
  name: string;
}

/** Source with comments removed (an unescaped `%` runs to the end of the line). */
function stripComments(src: string): string {
  return src.replaceAll(/(^|[^\\])%.*$/gm, '$1');
}

/** Path given by a `% !TEX root = path` magic comment in the first lines, if any. */
export function magicRoot(src: string): string | undefined {
  const head = src.split('\n', 30).join('\n');
  const m = /^\s*%\s*!\s*TEX\s+root\s*=\s*(.+?)\s*$/im.exec(head);
  return m?.[1];
}

export function hasDocumentClass(src: string): boolean {
  return /\\documentclass\b/.test(stripComments(src));
}

/** Files pulled in by `src`, in document order. */
export function findIncludes(src: string): Include[] {
  const out: Include[] = [];
  const re = /\\(input|include|subfile|usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
  for (const m of stripComments(src).matchAll(re)) {
    const kind = m[1] === 'usepackage' || m[1] === 'RequirePackage' ? 'sty' : 'tex';
    for (const raw of kind === 'sty' ? m[2].split(',') : [m[2]]) {
      const name = raw.trim();
      if (name) {
        out.push({ kind, name });
      }
    }
  }
  return out;
}

/** File name LaTeX would open for an include: `.tex` / `.sty` added when there is no extension. */
export function includeFileName(inc: Include): string {
  if (inc.kind === 'sty') {
    return `${inc.name}.sty`;
  }
  return /\.[A-Za-z]+$/.test(inc.name) ? inc.name : `${inc.name}.tex`;
}
