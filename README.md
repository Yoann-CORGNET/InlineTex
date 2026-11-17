# InlineTeX

**English** | [Français](README.fr.md)

A VS Code extension for **inline WYSIWYG editing** of LaTeX, in the spirit of Typora or Obsidian:
formulas and formatting are rendered directly in the editor, and the LaTeX source reappears as
soon as the cursor enters an element.

The file stays an ordinary `.tex` file edited in the native editor: undo, git diffs, search,
LaTeX Workshop and other extensions work as usual.

## What gets rendered

| Source | Rendering |
| --- | --- |
| `$…$`, `\(…\)` | inline formula (MathJax 4 → SVG) |
| `$$…$$`, `\[…\]`, `equation`, `align`, `gather`, `multline`, `flalign`, `alignat`, `eqnarray`, `displaymath` (and starred variants) | display formula, in place of its source and on the lines it occupies |
| `\textbf`, `\textit`, `\emph`, `\textsl`, `\underline`, `\texttt` | styled text, command hidden |
| `\textcolor{color}{…}` (color name, `[HTML]`, `[rgb]`, `[RGB]`, `[gray]`) | colored text |
| `\href{url}{text}`, `\url`, `\path` | styled link, address on hover |
| `\part`, `\chapter`, `\section` (with or without a short title `[…]`), `\subsection`, `\subsubsection`, `\paragraph` | enlarged heading |
| `\ref`, `\eqref`, `\autoref`, `\cref`, `\cite` and variants, `\label` | key of the reference, citation or label |
| `\footnote{…}` | footnote mark numbered in file order, content on hover |
| `tabular`, `tabular*`, `tabularx` | table rendered by MathJax: `|` rules and `\hline`, frame, formulas and formatting inside cells |
| `\includegraphics{…}` | image preview (PNG, JPEG, GIF, SVG), enlarged on hover |
| `itemize`, `enumerate`, `description` | bullet by level (•, –, ∗, ·), number by level (1., (a), i., A.), bold term; `\begin{…}` and `\end{…}` dimmed |
| `\item[label]` | bold label, without advancing the counter |
| `\ldots`, `\textendash`… | matching symbol |

Macros (`\newcommand`, `\renewcommand`, `\providecommand`, `\def`, `\DeclareMathOperator`) are
passed to MathJax. They are read from the current file and from the rest of the project:

- the root file, given by a `% !TEX root = main.tex` comment at the top of the file, or found in
  the current or parent folder (a file with `\documentclass` that includes the current file);
- files included by `\input`, `\include` and `\subfile`, and local `.sty` files loaded by
  `\usepackage`.

`%` comments, escaped `\$`, the `verbatim`, `lstlisting`, `minted` and `comment` environments,
and `\verb` are ignored. An invalid formula stays as source; its error shows up in the Problems
panel, including while you fix it.

In Markdown (add `markdown` to `inlineTeX.languages`), only formulas are rendered, following the
rules of Pandoc and of the VS Code preview: `$5 and $10` stays text, code blocks and code spans
are ignored, `%` is not a comment.

Hover (enlarged formula, image, footnote content, link address) is implemented but has not yet
been checked under real conditions.

## Usage

- **Toggle rendering**: `Ctrl+Alt+I` (`Cmd+Alt+I` on macOS), active only in the languages of
  `inlineTeX.languages`, or the command "InlineTeX : Activer / désactiver le rendu en ligne".
  The toggle writes the setting where it is defined (workspace or user).
- **Pause a single file**: click the `TeX` indicator in the status bar, or run the command
  "InlineTeX : Suspendre / reprendre le rendu pour ce fichier". Lasts until VS Code is closed.
- **Edit a formula**: put the cursor on it (click or arrow keys), the source appears.

### Settings

| Key | Default | Purpose |
| --- | --- | --- |
| `inlineTeX.enabled` | `true` | Enables rendering. |
| `inlineTeX.languages` | `["latex", "tex"]` | Languages affected (add `markdown` for `$…$` in Markdown). |
| `inlineTeX.renderMath` | `true` | Renders formulas. |
| `inlineTeX.renderTables` | `true` | Renders tables. |
| `inlineTeX.renderFormatting` | `true` | Renders formatting, headings, references, labels and footnotes. |
| `inlineTeX.renderImages` | `true` | Shows a preview of `\includegraphics` images. |
| `inlineTeX.revealOn` | `"cursor"` | `cursor`: reveals the element touched by the cursor; `line`: reveals the whole line. |
| `inlineTeX.scale` | `1` | Scale of formulas. |
| `inlineTeX.color` | `""` | Color of formulas (empty: based on the light or dark theme). |

## Known limitations

- VS Code does not allow changing the height of a line. An inline formula taller than the line is
  scaled down. A display formula or an image uses the lines of its source plus up to three empty
  lines that follow it, and is scaled down beyond that. An image alone on its line therefore only
  gets the height of one line: hover shows it full size.
- Display formulas and images are aligned with the start of their source, not centered: the API
  does not expose the editor width.
- The hidden lines of a multi-line formula remain on screen (empty).
- The formula color follows the theme kind (light, dark, high contrast), not the exact theme
  color. Adjust it with `inlineTeX.color`.
- No equation numbering and no resolution of `\ref` or `\cite`: the key is displayed.
- Lists: numbering follows `\setcounter`/`\addtocounter` (`enumi`…`enumiv`) and the `label`,
  `start` and `resume` options of enumitem, as well as the `[(a)]` syntax of the enumerate
  package. A custom label that uses other commands falls back to the default format. A list opened
  in another file is not seen, and the displayed indentation is the one of the source.
- Tables: rendered as a formula, so in the TeX font and limited in height by the lines of their
  source (write one table row per source line). `p{…}`, `m{…}`, `b{…}` and `X` columns become
  left-aligned columns, without line wrapping in cells. MathJax only knows `\hline`: `\cline`,
  `\cmidrule` and booktabs rules become full-width rules, `\multicolumn` puts its text in the
  first cell (not centered across the merged columns) and `\multirow` keeps only its text.
  `\\[2pt]` spacing is ignored, and a table nested in a cell stays as source.
- Images: PDF and EPS figures cannot be displayed in the editor, and files larger than 1 MB are
  not previewed. `\graphicspath` is not taken into account.
- Macros from packages MathJax does not know (for example `\SI` from siunitx) are shown in red,
  without an error in the Problems panel.

## Development

Requirements: Node.js 20 or newer, npm.

```bash
npm install
npm run build       # esbuild bundle → dist/extension.js
npm run watch       # continuous rebuild
npm test            # unit tests (vitest): parser, macros, MathJax rendering, layout
npm run test:integration  # tests in a real VS Code, on the production bundle
npm run typecheck   # tsc --noEmit
npm run lint        # Biome (lint only; typescript-eslint does not support TypeScript 7)
npm run package     # produces inlinetex-<version>.vsix
```

`test:integration` downloads a VS Code release, or uses the one in `VSCODE_PATH` (the Electron
binary, for example `/usr/share/code/code`, not the `code` script). Without a display, run it
under `xvfb-run -a`; otherwise a window opens for the duration of the test.

To try the extension, open the folder in VS Code and run "Lancer l'extension" (F5): a
development window opens on `samples/demo.tex`, which includes `samples/chapitre.tex` and loads
`samples/demomacros.sty`. `samples/demo.md` is used to check the Markdown mode. To install the
package: `code --install-extension inlinetex-0.2.0.vsix`.

The architecture is described in [docs/architecture.md](docs/architecture.md).

## Releasing

Versions are published by [Release Please](https://github.com/googleapis/release-please) from
commit messages in the [Conventional Commits](https://www.conventionalcommits.org/) format
(`feat:` for an addition, `fix:` for a fix, `perf:` for a performance improvement; `docs:`,
`test:`, `ci:` or `chore:` do not trigger a release). On every push to `main`, a release PR keeps
the version and the CHANGELOG up to date; merging it creates the tag and the GitHub Release (with
the `.vsix`), and publishes the extension to the VS Code Marketplace. The `Release` workflow can
also be run manually from the Actions tab: it publishes the version in `package.json` and creates
the Release if it is missing.

## License

MIT
