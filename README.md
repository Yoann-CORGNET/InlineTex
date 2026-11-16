# InlineTeX

Extension VS Code d'édition **WYSIWYG en ligne** pour LaTeX, dans l'esprit de Typora ou Obsidian :
les formules et la mise en forme sont rendues directement dans l'éditeur, et le source LaTeX
réapparaît dès que le curseur entre dans un élément.

Le fichier reste un `.tex` ordinaire édité dans l'éditeur natif : annulation, diffs git,
recherche, LaTeX Workshop et les autres extensions fonctionnent comme d'habitude.

## Ce qui est rendu

| Source | Rendu |
| --- | --- |
| `$…$`, `\(…\)` | formule en ligne (MathJax → SVG) |
| `$$…$$`, `\[…\]`, `equation`, `align`, `gather`, `multline`, `flalign`, `alignat`, `eqnarray`, `displaymath` (et variantes étoilées) | formule centrée, sur les lignes qu'occupe son source |
| `\textbf`, `\textit`, `\emph`, `\textsl`, `\underline`, `\texttt` | texte stylé, commande masquée |
| `\part`, `\chapter`, `\section`, `\subsection`, `\subsubsection`, `\paragraph` | titre agrandi |
| `\item`, `\ldots`, `\textendash`… | symbole correspondant |

Les macros du document (`\newcommand`, `\renewcommand`, `\providecommand`, `\def`,
`\DeclareMathOperator`) sont transmises à MathJax. Les commentaires `%`, les `\$` échappés et les
environnements `verbatim`, `lstlisting`, `minted` et `comment`, ainsi que `\verb`, `\url` et `\path`,
sont ignorés. Une formule invalide reste
en source, soulignée en rouge. Un fournisseur de survol (message d'erreur, formule agrandie) est
implémenté mais n'a pas encore été vérifié en conditions réelles.

## Utilisation

- **Basculer le rendu** : `Ctrl+Alt+I` (`Cmd+Alt+I` sur macOS), actif seulement dans les langages
  de `inlineTeX.languages`, ou la commande « InlineTeX : Activer / désactiver le rendu en ligne ».
- **Modifier une formule** : placez le curseur dessus (clic ou flèches), le source s'affiche.

### Réglages

| Clé | Défaut | Rôle |
| --- | --- | --- |
| `inlineTeX.enabled` | `true` | Active le rendu. |
| `inlineTeX.languages` | `["latex", "tex"]` | Langages concernés (ajoutez `markdown` pour les `$…$` en Markdown). |
| `inlineTeX.renderMath` | `true` | Rend les formules. |
| `inlineTeX.renderFormatting` | `true` | Rend la mise en forme et les titres. |
| `inlineTeX.revealOn` | `"cursor"` | `cursor` : révèle l'élément touché par le curseur ; `line` : révèle toute la ligne. |
| `inlineTeX.scale` | `1` | Échelle des formules. |
| `inlineTeX.color` | `""` | Couleur des formules (vide : selon le thème clair ou sombre). |

## Limites connues

- VS Code ne permet pas de changer la hauteur d'une ligne. Une formule en ligne plus haute que la
  ligne est réduite. Une formule centrée utilise les lignes de son
  source plus jusqu'à trois lignes vides qui la suivent, et elle est réduite au-delà.
- Les lignes masquées d'une formule multi-ligne restent présentes (vides) à l'écran.
- La couleur des formules suit le type de thème (clair ou sombre), pas la couleur exacte du thème.
  Ajustez-la avec `inlineTeX.color`.
- Pas de numérotation des équations ni de résolution de `\ref` ou de `\cite`.

## Développement

Prérequis : Node.js 20 ou plus récent, npm.

```bash
npm install
npm run build       # bundle esbuild → dist/extension.js
npm run watch       # rebuild continu
npm test            # tests unitaires (vitest) : parseur, macros, rendu MathJax, mise en page
npm run typecheck   # tsc --noEmit
npm run package     # produit inlinetex-<version>.vsix
```

Pour essayer l'extension, ouvrez le dossier dans VS Code et lancez « Lancer l'extension » (F5) :
une fenêtre de développement s'ouvre sur `samples/demo.tex`. Pour installer le paquet :
`code --install-extension inlinetex-0.1.0.vsix`.

L'architecture est décrite dans [docs/architecture.md](docs/architecture.md).

## Licence

MIT
