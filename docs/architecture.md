# Architecture

InlineTeX ne remplace pas l'éditeur. Il pose des **décorations** sur l'éditeur de texte natif :

1. une décoration masque le source (`display: none` injecté via `textDecoration`) ;
2. une autre insère le rendu juste avant (`before.contentIconPath` = SVG en data URI, ou
   `before.contentText` pour les symboles), ou stylise l'argument d'une commande de mise en forme ;
3. les éléments touchés par une sélection ne sont pas décorés, et le source réapparaît.

## Modules

| Fichier | Rôle | Dépend de VS Code |
| --- | --- | --- |
| `src/parser/scan.ts` | Scanner LaTeX : formules, commandes de mise en forme, symboles. Gère les commentaires, les échappements et les environnements verbatim. Positions en offsets UTF-16. | non |
| `src/parser/macros.ts` | Extrait `\newcommand`, `\def` et `\DeclareMathOperator` pour MathJax. | non |
| `src/render/mathjax.ts` | MathJax 3 (`mathjax-full`, adaptateur lite) : TeX → SVG autonome (`fontCache: 'none'`), couleur figée, dimensions en px. | non |
| `src/editor/layout.ts` | Calcule la taille d'image à partir de la police, de la hauteur de ligne et du nombre de lignes disponibles. | non |
| `src/editor/controller.ts` | Cycle de vie : cache d'analyse par version de document, cache SVG, décorations des plages visibles, révélation au curseur, survol (non vérifié visuellement), clé de contexte `inlineTeX.languageActive` pour le raccourci. | oui |
| `src/extension.ts` | Activation et commande de bascule. | oui |

## Points techniques

- **Taille des images.** VS Code dessine une image de décoration à sa taille intrinsèque, sans tenir
  compte de `width`/`height`. Toute réduction est donc écrite dans les attributs du SVG
  (`resizeSvg`).
- **Couleur.** Une image n'hérite pas de `currentColor`. La couleur est fixée dans le SVG selon
  le type de thème actif, et tout est re-rendu quand le thème change.
- **Data URI en base64.** C'est plus robuste que de l'UTF-8 encodé dans `Uri.parse`.
- **Taille du ex.** MathJax raisonne en ex. On prend 1ex = 0,5 × la taille de police de l'éditeur, ce
  qui correspond à la hauteur de x des polices monospace et aligne visuellement les formules sur le
  texte.
- **Performances.** L'analyse porte sur tout le document, une fois par version. Le rendu ne concerne
  que les formules visibles (plus 30 lignes de marge), avec un cache par source, couleur, taille et
  jeu de macros.

## Vérification

`npm test` couvre les parties pures. La partie décorations ne peut pas être relue par l'API de
VS Code et se vérifie à l'œil dans la fenêtre de développement (F5) avec `samples/demo.tex`.
