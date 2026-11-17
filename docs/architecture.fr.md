# Architecture

[English](architecture.md) | **Français**

InlineTeX ne remplace pas l'éditeur. Il pose des **décorations** sur l'éditeur de texte natif :

1. une décoration masque le source (`display: none` injecté via `textDecoration`) ;
2. une autre insère le rendu juste avant (`before.contentIconPath` = SVG en data URI, ou
   `before.contentText` pour les symboles et les références), ou stylise l'argument d'une commande
   de mise en forme ;
3. les éléments touchés par une sélection ne sont pas décorés, et le source réapparaît.

## Modules

| Fichier | Rôle | Dépend de VS Code |
| --- | --- | --- |
| `src/parser/tokens.ts` | Types des jetons produits par les scanners. Positions en offsets UTF-16. | non |
| `src/parser/syntax.ts` | Lecture bas niveau : commandes, commentaires, groupes `{…}` et arguments optionnels `[…]`, délimiteurs, `\verb`. Respecte les échappements et s'arrête à une ligne vide. | non |
| `src/parser/scan.ts` | Scanner LaTeX : boucle principale, formules, environnements (listes, tableaux, verbatim), compteurs, `\item`. | non |
| `src/parser/commands.ts` | Commandes en ligne : mise en forme, couleurs, liens, images, symboles, références, citations, étiquettes, notes. | non |
| `src/parser/lists.ts` | Étiquettes des éléments de liste : puces et numéros par niveau, libellés enumitem et enumerate. | non |
| `src/parser/table.ts` | Convertit un `tabular` en `array` MathJax : spécification de colonnes adaptée, filets hors des cellules, cellules dans `\text{…}`. | non |
| `src/parser/markdown.ts` | Scanner Markdown : formules seulement, règles de Pandoc, code ignoré. | non |
| `src/parser/macros.ts` | Extrait `\newcommand`, `\def` et `\DeclareMathOperator` pour MathJax. | non |
| `src/parser/project.ts` | Commentaire `% !TEX root`, détection de `\documentclass`, liste des `\input`, `\include`, `\subfile` et `\usepackage`. | non |
| `src/render/mathjax.ts` | MathJax 4 (`@mathjax/src`, adaptateur lite) : TeX → SVG autonome (`fontCache: 'none'`), couleur figée, dimensions en px ; `checkMath` compile sans mettre en page. | non |
| `src/render/svg.ts` | Redimensionnement d'un SVG et data URI, séparés de MathJax pour rester légers. | non |
| `src/render/image.ts` | Noms de fichier essayés pour un `\includegraphics`, taille d'une image lue dans son en-tête (PNG, JPEG, GIF, SVG) et SVG d'encadrement. | non |
| `src/editor/layout.ts` | Calcule la taille d'image à partir de la police, de la hauteur de ligne et du nombre de lignes disponibles. | non |
| `src/editor/plan.ts` | Choix des jetons à décorer dans une passe : plages visibles, règle de révélation, lignes vides disponibles. Tout en offsets entiers. | non |
| `src/util/lru.ts` | Cache borné à éviction du moins récemment utilisé. | non |
| `src/editor/project.ts` | Lecture asynchrone des autres fichiers du projet et fusion de leurs macros. | oui |
| `src/editor/settings.ts` | Lecture des réglages, couleur des formules selon le thème. | oui |
| `src/editor/decorations.ts` | Types de décoration et construction des décorations d'une passe (masquage, images, symboles, mise en forme, couleurs). | oui |
| `src/editor/images.ts` | Recherche et chargement asynchrone des images de `\includegraphics`, oubliées quand un fichier image change. | oui |
| `src/editor/diagnostics.ts` | Erreurs TeX de chaque formule dans le panneau Problèmes, calculées par tranches. | oui |
| `src/editor/controller.ts` | Cycle de vie : cache d'analyse par version de document, caches de rendu, passe de décoration, survol (non vérifié visuellement), barre d'état, clé de contexte `inlineTeX.languageActive`. | oui |
| `src/extension.ts` | Activation et commandes. | oui |

## Points techniques

- **Taille des images.** VS Code dessine une image de décoration à sa taille intrinsèque, sans tenir
  compte de `width`/`height`. Toute réduction est donc écrite dans les attributs du SVG
  (`resizeSvg`). Les images de `\includegraphics` sont incluses dans un SVG à la taille voulue
  (`framedImageSvg`).
- **Filets de tableau.** MathJax dessine filets et cadres en `<line>` et `<rect>` stylés par sa
  feuille CSS, absente d'une image autonome : les règles nécessaires sont insérées dans le SVG
  (`TABLE_STYLE`).
- **Couleur.** Une image n'hérite pas de `currentColor`. La couleur est fixée dans le SVG selon
  le type de thème actif, et tout est re-rendu quand le thème change.
- **Data URI en base64.** C'est plus robuste que de l'UTF-8 encodé dans `Uri.parse`.
- **Taille du ex.** MathJax raisonne en ex. On prend 1ex = 0,5 × la taille de police de l'éditeur, ce
  qui correspond à la hauteur de x des polices monospace et aligne visuellement les formules sur le
  texte.
- **Glyphes de MathJax 4.** La police New Computer Modern range les glyphes rares dans des fichiers
  « dynamiques » chargés à la demande. `esbuild.mjs` compile chacun dans `dist/fonts/`, en
  remplaçant son import de la classe de police par une référence globale
  (`Symbol.for('inlineTeX.mathjaxNewcmFont')`) posée par `setFontLoader`. Le chargement est
  synchrone (`mathjax.asyncIsSynchronous`), donc une conversion n'est jamais à relancer. Les tests
  chargent les mêmes fichiers depuis le paquet de la police.
- **Paquets TeX.** MathJax 4 n'a plus de liste `AllPackages` : les paquets sont importés un par un
  dans `src/render/mathjax.ts`. `noundefined` est inclus, donc une macro inconnue s'affiche en
  rouge au lieu de produire une erreur.
- **Chargement différé.** Le contrôleur charge `src/render/mathjax.ts` par `require` au premier
  rendu ; esbuild l'enveloppe dans une initialisation paresseuse. L'activation en Markdown, même
  sans rendu, ne paie donc pas le coût de MathJax.
- **Performances.** L'analyse porte sur tout le document, une fois par version. Pendant la frappe,
  l'événement de sélection n'a pas d'effet tant que la nouvelle version n'est pas analysée : seule
  la passe différée de 150 ms s'exécute. Une passe ne traite que les jetons visibles (plus 30
  lignes de marge). Les SVG, les data URI finales et les erreurs sont en cache LRU, et un document
  MathJax est gardé par jeu de macros.
- **Listes.** Le scanner garde la pile des environnements de liste ouverts (`ScanState.lists`) :
  chaque `\item` prend la puce ou le numéro de son niveau, compté parmi les listes du même type.
  `\begin` et `\end` des listes donnent un jeton `muted` (grisé, rien de masqué).
- **Tableaux.** MathJax n'a pas de `tabular`, mais son `array` accepte les mêmes filets, `@{}`,
  `*{n}{}`. Il ne connaît en revanche ni `\multicolumn`, ni `\multirow`, ni `\cline`, ni booktabs
  (`noundefined` les affiche en rouge sans erreur : les tests cherchent ce rouge) ; ils sont
  approchés. La conversion enveloppe chaque cellule dans
  `\text{…}`, où `$…$` et `\textbf` restent valides. Les colonnes `p`, `m`, `b` sont déjà en mode
  texte (`\text` y échoue) et `X` est inconnu : elles deviennent `l`. Le jeton produit est un
  `MathToken` marqué `table`, rendu par le même pipeline que les formules.
- **Diagnostics.** Toutes les formules sont compilées (sans mise en page) 300 ms après une
  modification, par tranches de 100 pour ne pas bloquer l'éditeur.
- **Macros du projet.** `ProjectMacros` cherche le fichier racine, parcourt ses inclusions dans
  l'ordre (64 fichiers au plus) et rend les macros trouvées. Le fichier en cours d'édition est
  suivi mais pas collecté : ses macros sont lues en direct et l'emportent. Un enregistrement ou une
  modification sur disque d'un `.tex` ou d'un `.sty` relance la recherche.

## Vérification

`npm test` couvre les parties pures. La partie décorations ne peut pas être relue par l'API de
VS Code et se vérifie à l'œil dans la fenêtre de développement (F5) avec `samples/demo.tex`,
`samples/chapitre.tex` et `samples/demo.md`.
