# Architecture

**English** | [Français](architecture.fr.md)

InlineTeX does not replace the editor. It places **decorations** on the native text editor:

1. one decoration hides the source (`display: none` injected through `textDecoration`);
2. another inserts the rendering right before it (`before.contentIconPath` = SVG as a data URI, or
   `before.contentText` for symbols and references), or styles the argument of a formatting
   command;
3. elements touched by a selection are not decorated, and the source reappears.

## Modules

| File | Role | Depends on VS Code |
| --- | --- | --- |
| `src/parser/tokens.ts` | Types of the tokens produced by the scanners. Positions as UTF-16 offsets. | no |
| `src/parser/syntax.ts` | Low-level reading: commands, comments, `{…}` groups and `[…]` optional arguments, delimiters, `\verb`. Honors escapes and stops at an empty line. | no |
| `src/parser/scan.ts` | LaTeX scanner: main loop, formulas, environments (lists, tables, verbatim), counters, `\item`. | no |
| `src/parser/commands.ts` | Inline commands: formatting, colors, links, images, symbols, references, citations, labels, footnotes. | no |
| `src/parser/lists.ts` | List item labels: bullets and numbers by level, enumitem and enumerate labels. | no |
| `src/parser/table.ts` | Converts a `tabular` into a MathJax `array`: adapted column specification, rules outside cells, cells inside `\text{…}`. | no |
| `src/parser/markdown.ts` | Markdown scanner: formulas only, Pandoc rules, code ignored. | no |
| `src/parser/macros.ts` | Extracts `\newcommand`, `\def` and `\DeclareMathOperator` for MathJax, and those the text scanner can follow (renames, plain texts). | no |
| `src/parser/project.ts` | `% !TEX root` comment, `\documentclass` detection, list of `\input`, `\include`, `\subfile` and `\usepackage`. | no |
| `src/render/mathjax.ts` | MathJax 4 (`@mathjax/src`, lite adaptor): TeX → standalone SVG (`fontCache: 'none'`), fixed color, dimensions in px; `checkMath` compiles without layout. | no |
| `src/render/svg.ts` | SVG resizing and data URI, kept apart from MathJax to stay lightweight. | no |
| `src/render/image.ts` | File names tried for an `\includegraphics`, image size read from its header (PNG, JPEG, GIF, SVG) and framing SVG. | no |
| `src/editor/layout.ts` | Computes the image size from the font, the line height and the number of available lines. | no |
| `src/editor/plan.ts` | Chooses the tokens to decorate in a pass: visible ranges, reveal rule, available empty lines. All in integer offsets. | no |
| `src/util/lru.ts` | Bounded cache with least-recently-used eviction. | no |
| `src/editor/project.ts` | Asynchronous reading of the other project files and merging of their macros. | yes |
| `src/editor/settings.ts` | Reading settings, formula color based on the theme. | yes |
| `src/editor/decorations.ts` | Decoration types and construction of a pass's decorations (hiding, images, symbols, formatting, colors). | yes |
| `src/editor/images.ts` | Asynchronous lookup and loading of `\includegraphics` images, forgotten when an image file changes. | yes |
| `src/editor/diagnostics.ts` | TeX errors of each formula in the Problems panel, computed in batches. | yes |
| `src/editor/controller.ts` | Lifecycle: parse cache per document version, render caches, decoration pass, hover (not visually checked), status bar, `inlineTeX.languageActive` context key. | yes |
| `src/extension.ts` | Activation and commands. | yes |

## Technical notes

- **Image size.** VS Code draws a decoration image at its intrinsic size, ignoring
  `width`/`height`. Any scaling is therefore written into the SVG attributes (`resizeSvg`).
  `\includegraphics` images are embedded in an SVG at the desired size (`framedImageSvg`).
- **Table rules.** MathJax draws rules and frames as `<line>` and `<rect>` styled by its CSS
  stylesheet, which is missing from a standalone image: the required rules are inserted into the
  SVG (`TABLE_STYLE`).
- **Color.** An image does not inherit `currentColor`. The color is fixed in the SVG based on the
  active theme kind, and everything is re-rendered when the theme changes.
- **Base64 data URI.** More robust than UTF-8 encoded through `Uri.parse`.
- **Size of the ex.** MathJax works in ex units. We take 1ex = 0.5 × the editor font size, which
  matches the x-height of monospace fonts and visually aligns formulas with the text.
- **MathJax 4 glyphs.** The New Computer Modern font stores rare glyphs in "dynamic" files loaded
  on demand. `esbuild.mjs` compiles each one into `dist/fonts/`, replacing its import of the font
  class with a global reference (`Symbol.for('inlineTeX.mathjaxNewcmFont')`) set by
  `setFontLoader`. Loading is synchronous (`mathjax.asyncIsSynchronous`), so a conversion never
  needs to be retried. Tests load the same files from the font package.
- **TeX packages.** MathJax 4 no longer has an `AllPackages` list: packages are imported one by one
  in `src/render/mathjax.ts`. `noundefined` is included, so an unknown macro is shown in red
  instead of raising an error.
- **Lazy loading.** The controller loads `src/render/mathjax.ts` with `require` on the first
  render; esbuild wraps it in a lazy initializer. Activation in Markdown, even without rendering,
  therefore does not pay the cost of MathJax.
- **Performance.** The whole document is parsed, once per version. While typing, the selection
  event has no effect until the new version has been parsed: only the 150 ms deferred pass runs. A
  pass only processes visible tokens (plus a 30-line margin). SVGs, final data URIs and errors are
  kept in an LRU cache, and one MathJax document is kept per macro set.
- **Lists.** The scanner keeps the stack of open list environments (`ScanState.lists`): each
  `\item` takes the bullet or number of its level, counted among lists of the same type. `\begin`
  and `\end` of lists produce a `muted` token (dimmed, nothing hidden).
- **Tables.** MathJax has no `tabular`, but its `array` accepts the same rules, `@{}` and
  `*{n}{}`. It does not know `\multicolumn`, `\multirow`, `\cline` or booktabs, though
  (`noundefined` shows them in red without an error: tests look for that red); they are
  approximated. The conversion wraps each cell in `\text{…}`, where `$…$` and `\textbf` remain
  valid. `p`, `m`, `b` columns are already in text mode (`\text` fails there) and `X` is unknown:
  they become `l`. The resulting token is a `MathToken` flagged `table`, rendered by the same
  pipeline as formulas.
- **Diagnostics.** All formulas are compiled (without layout) 300 ms after a change, in batches of
  100 so as not to block the editor.
- **Project macros.** `ProjectMacros` looks for the root file, walks its inclusions in order (64
  files at most) and returns the macros found. The file being edited is tracked but not
  collected: its macros are read live and take precedence. Saving or changing a `.tex` or `.sty`
  file on disk restarts the lookup.
- **Macros in text.** The scanner does not expand macros: `textMacros` keeps only those it can read
  as a known command or as a fixed text, and `scan` receives them. The text therefore depends on
  the project macros, and is scanned again when they arrive.

## Verification

`npm test` covers the pure parts. The decoration part cannot be read back through the VS Code API
and is checked by eye in the development window (F5) with `samples/demo.tex`,
`samples/chapitre.tex` and `samples/demo.md`.
