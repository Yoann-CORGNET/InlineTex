# InlineTeX

[English](README.md) | **Français**

Extension VS Code d'édition **WYSIWYG en ligne** pour LaTeX, dans l'esprit de Typora ou Obsidian :
les formules et la mise en forme sont rendues directement dans l'éditeur, et le source LaTeX
réapparaît dès que le curseur entre dans un élément.

Le fichier reste un `.tex` ordinaire édité dans l'éditeur natif : annulation, diffs git,
recherche, LaTeX Workshop et les autres extensions fonctionnent comme d'habitude.

## Ce qui est rendu

| Source | Rendu |
| --- | --- |
| `$…$`, `\(…\)` | formule en ligne (MathJax 4 → SVG) |
| `$$…$$`, `\[…\]`, `equation`, `align`, `gather`, `multline`, `flalign`, `alignat`, `eqnarray`, `displaymath` (et variantes étoilées) | formule hors texte, à la place de son source et sur les lignes qu'il occupe |
| `\textbf`, `\textit`, `\emph`, `\textsl`, `\underline`, `\texttt` | texte stylé, commande masquée |
| `\textcolor{couleur}{…}` (nom de couleur, `[HTML]`, `[rgb]`, `[RGB]`, `[gray]`) | texte coloré |
| `\href{url}{texte}`, `\url`, `\path` | lien stylé, adresse au survol |
| `\part`, `\chapter`, `\section` (avec ou sans titre court `[…]`), `\subsection`, `\subsubsection`, `\paragraph` | titre agrandi |
| `\ref`, `\eqref`, `\autoref`, `\cref`, `\cite` et variantes, `\label` | clé de la référence, de la citation ou de l'étiquette |
| `\footnote{…}` | appel de note numéroté dans l'ordre du fichier, contenu au survol |
| `tabular`, `tabular*`, `tabularx` | tableau rendu par MathJax : filets `|` et `\hline`, cadre, formules et mise en forme dans les cellules |
| `\includegraphics{…}` | aperçu de l'image (PNG, JPEG, GIF, SVG), agrandi au survol |
| `itemize`, `enumerate`, `description` | puce selon le niveau (•, –, ∗, ·), numéro selon le niveau (1., (a), i., A.), terme en gras ; `\begin{…}` et `\end{…}` grisés |
| `\item[label]` | étiquette en gras, sans faire avancer le compteur |
| `\ldots`, `\textendash`… | symbole correspondant |

Les macros (`\newcommand`, `\renewcommand`, `\providecommand`, `\def`, `\DeclareMathOperator`)
sont transmises à MathJax. Elles sont lues dans le fichier courant et dans le reste du projet :

- le fichier racine, donné par un commentaire `% !TEX root = main.tex` en tête de fichier, ou
  trouvé dans le dossier courant ou le dossier parent (fichier avec `\documentclass` qui inclut le
  fichier courant) ;
- les fichiers inclus par `\input`, `\include` et `\subfile`, et les `.sty` locaux chargés par
  `\usepackage`.

Dans le texte, hors formules, deux sortes de macros sont aussi suivies : le renommage d'une commande
(`\newcommand{\code}[1]{\texttt{#1}}` s'affiche comme `\texttt`) et une macro sans argument dont
le corps est un texte simple, éventuellement dans une seule commande de texte
(`\newcommand{\SAT}{\textsc{sat}}` s'affiche « sat », sans les petites capitales). Les autres
macros de texte, par exemple celles qui imbriquent plusieurs commandes, restent en source.

Les commentaires `%`, les `\$` échappés et les environnements `verbatim`, `lstlisting`, `minted` et
`comment`, ainsi que `\verb`, sont ignorés. Une formule invalide reste en source ; son erreur
apparaît dans le panneau Problèmes, y compris pendant qu'on la corrige.

En Markdown (ajoutez `markdown` à `inlineTeX.languages`), seules les formules sont rendues, avec
les règles de Pandoc et de l'aperçu de VS Code : `$5 et $10` reste du texte, les blocs et extraits
de code sont ignorés, `%` n'est pas un commentaire.

Le survol (formule agrandie, image, contenu de note, adresse de lien) est implémenté mais n'a pas
encore été vérifié en conditions réelles.

## Utilisation

- **Basculer le rendu** : `Ctrl+Alt+I` (`Cmd+Alt+I` sur macOS), actif seulement dans les langages
  de `inlineTeX.languages`, ou la commande « InlineTeX : Activer / désactiver le rendu en ligne ».
  La bascule écrit le réglage là où il est défini (espace de travail ou utilisateur).
- **Suspendre un seul fichier** : cliquer sur l'indicateur `TeX` de la barre d'état, ou la commande
  « InlineTeX : Suspendre / reprendre le rendu pour ce fichier ». Valable jusqu'à la fermeture de
  VS Code.
- **Modifier une formule** : placez le curseur dessus (clic ou flèches), le source s'affiche.

L'interface (commandes, réglages, barre d'état) est en anglais, et en français quand VS Code est
affiché en français.

### Réglages

| Clé | Défaut | Rôle |
| --- | --- | --- |
| `inlineTeX.enabled` | `true` | Active le rendu. |
| `inlineTeX.languages` | `["latex", "tex"]` | Langages concernés (ajoutez `markdown` pour les `$…$` en Markdown). |
| `inlineTeX.renderMath` | `true` | Rend les formules. |
| `inlineTeX.renderTables` | `true` | Rend les tableaux. |
| `inlineTeX.renderFormatting` | `true` | Rend la mise en forme, les titres, les références, les étiquettes et les notes. |
| `inlineTeX.renderImages` | `true` | Affiche l'aperçu des images de `\includegraphics`. |
| `inlineTeX.revealOn` | `"cursor"` | `cursor` : révèle l'élément touché par le curseur ; `line` : révèle toute la ligne. |
| `inlineTeX.scale` | `1` | Échelle des formules. |
| `inlineTeX.color` | `""` | Couleur des formules (vide : selon le thème clair ou sombre). |

## Limites connues

- VS Code ne permet pas de changer la hauteur d'une ligne. Une formule en ligne plus haute que la
  ligne est réduite. Une formule hors texte ou une image utilise les lignes de son source plus
  jusqu'à trois lignes vides qui la suivent, et elle est réduite au-delà. Une image seule sur sa
  ligne n'a donc que la hauteur d'une ligne : le survol l'affiche en grand.
- Les formules hors texte et les images sont alignées sur le début de leur source, pas centrées :
  l'API ne donne pas la largeur de l'éditeur.
- Les lignes masquées d'une formule multi-ligne restent présentes (vides) à l'écran.
- La couleur des formules suit le type de thème (clair, sombre, contraste élevé), pas la couleur
  exacte du thème. Ajustez-la avec `inlineTeX.color`.
- Pas de numérotation des équations ni de résolution de `\ref` ou de `\cite` : c'est la clé qui
  s'affiche.
- Listes : la numérotation suit `\setcounter`/`\addtocounter` (`enumi`…`enumiv`) et les options
  `label`, `start` et `resume` d'enumitem, ainsi que la syntaxe `[(a)]` du paquet enumerate.
  Un libellé personnalisé qui utilise d'autres commandes revient au format par défaut. Une liste
  ouverte dans un autre fichier n'est pas vue, et l'indentation affichée est celle du source.
- Tableaux : rendus comme une formule, donc dans la police de TeX et limités en hauteur par les
  lignes de leur source (écrivez une ligne de tableau par ligne de source). Les colonnes `p{…}`,
  `m{…}`, `b{…}` et `X` deviennent des colonnes alignées à gauche, sans retour à la ligne dans les
  cellules. MathJax ne connaît que `\hline` : `\cline`, `\cmidrule` et les filets booktabs
  deviennent des filets pleine largeur, `\multicolumn` place son texte dans la première cellule
  (sans centrage sur les colonnes fusionnées) et `\multirow` ne garde que son texte. L'espacement
  `\\[2pt]` est ignoré, et un tableau imbriqué dans une cellule reste en source.
- Images : les figures PDF et EPS ne peuvent pas s'afficher dans l'éditeur, et les fichiers de
  plus de 1 Mo ne sont pas prévisualisés. `\graphicspath` n'est pas pris en compte.
- Les macros des paquets que MathJax ne connaît pas (par exemple `\SI` de siunitx) s'affichent en
  rouge, sans erreur dans le panneau Problèmes.

## Développement

Prérequis : Node.js 20 ou plus récent, npm.

```bash
npm install
npm run build       # bundle esbuild → dist/extension.js
npm run watch       # rebuild continu
npm test            # tests unitaires (vitest) : parseur, macros, rendu MathJax, mise en page
npm run test:coverage  # idem, avec un rapport de couverture dans coverage/ (lcov, lu par SonarCloud)
npm run test:integration  # tests dans un vrai VS Code, sur le bundle de production
npm run typecheck   # tsc --noEmit
npm run lint        # Biome (lint seul ; typescript-eslint ne prend pas en charge TypeScript 7)
npm run package     # produit inlinetex-<version>.vsix
```

`test:integration` télécharge une version de VS Code, ou utilise celle de `VSCODE_PATH` (le binaire
Electron, par exemple `/usr/share/code/code`, pas le script `code`). Sans écran, lancez-le sous
`xvfb-run -a` ; sinon une fenêtre s'ouvre le temps du test.

Pour essayer l'extension, ouvrez le dossier dans VS Code et lancez « Lancer l'extension » (F5) :
une fenêtre de développement s'ouvre sur `samples/demo.tex`, qui inclut `samples/chapitre.tex`
et charge `samples/demomacros.sty`. `samples/demo.md` sert à vérifier le mode Markdown. Pour installer le paquet :
`code --install-extension inlinetex-0.2.0.vsix`.

L'architecture est décrite dans [docs/architecture.fr.md](docs/architecture.fr.md).

## Publication

Les versions sont publiées par [Release Please](https://github.com/googleapis/release-please) à
partir des messages de commit au format [Conventional Commits](https://www.conventionalcommits.org/fr/)
(`feat:` pour un ajout, `fix:` pour une correction, `perf:` pour une amélioration de performance ;
`docs:`, `test:`, `ci:` ou `chore:` ne déclenchent pas de version). À chaque push sur `main`, une PR
de release tient à jour la version et le CHANGELOG ; la merger crée le tag et la Release GitHub (avec le
`.vsix`), et publie l'extension sur le Marketplace de VS Code. Le workflow `Release` peut aussi
être lancé à la main depuis l'onglet Actions : il publie la version de `package.json` et crée la
Release si elle manque.

## Licence

MIT
