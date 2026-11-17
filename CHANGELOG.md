# Changelog

## [0.3.1](https://github.com/Yoann-CORGNET/InlineTex/compare/v0.3.0...v0.3.1) (2026-11-17)


### Corrections

* manifeste et interface en anglais, traduction française via package.nls et l10n ([6f1a0be](https://github.com/Yoann-CORGNET/InlineTex/commit/6f1a0be034eb4b9394726d70edf3867854b187c1))
* manifeste et interface en anglais, traduction française via package.nls et l10n ([301bd4c](https://github.com/Yoann-CORGNET/InlineTex/commit/301bd4c90eeac1c4f648a3a63c8e97c0e239ae1f))

## [0.3.0](https://github.com/Yoann-CORGNET/InlineTex/compare/v0.2.0...v0.3.0) (2026-11-17)


### Ajouts

* macros de texte suivies hors formules (renommages et textes simples) ([e5c83f6](https://github.com/Yoann-CORGNET/InlineTex/commit/e5c83f64ad343e505744748a1a5ef540d854c2f5))
* macros de texte suivies hors formules (renommages et textes simples) ([4e3e6ad](https://github.com/Yoann-CORGNET/InlineTex/commit/4e3e6add5bdad84ab3e012df4bde6a81e0260351))

## 0.2.0

### Ajouts

- Formules en Markdown avec les règles de Pandoc et de l'aperçu VS Code : `$5 et $10` reste du
  texte, les blocs et extraits de code sont ignorés, `%` n'est pas un commentaire.
- Macros des autres fichiers du projet : fichier racine (`% !TEX root`, ou fichier voisin avec
  `\documentclass` qui inclut le fichier courant), `\input`, `\include`, `\subfile` et `.sty` locaux.
- `\textcolor`, `\href`, `\url` et `\path` stylés ; `\ref`, `\eqref`, `\cite` et `\label` remplacés
  par leur clé ; `\footnote` replié en appel de note numéroté, contenu au survol.
- Tableaux `tabular`, `tabular*` et `tabularx` rendus par MathJax, réglage `inlineTeX.renderTables`.
  `\cline`, booktabs, `\multicolumn` et `\multirow` sont approchés (MathJax ne connaît que `\hline`).
- Aperçu des images de `\includegraphics` (PNG, JPEG, GIF, SVG), réglage `inlineTeX.renderImages`.
- `\section[court]{Long}` et `\item[label]` rendus.
- Listes imbriquées : puce selon le niveau dans `itemize`, vrais numéros dans `enumerate` (1., (a), i.,
  A.), avec `\setcounter`, `\addtocounter`, les options `label`, `start` et `resume` d'enumitem et
  la syntaxe du paquet enumerate ; `\begin{…}` et `\end{…}` des listes grisés.
- Erreurs TeX des formules dans le panneau Problèmes, y compris pour la formule en cours d'édition.
- Indicateur dans la barre d'état et commande « Suspendre / reprendre le rendu pour ce fichier ».

### Changements

- Passage à MathJax 4 (`@mathjax/src`) : nouvelle police New Computer Modern, glyphes rares
  chargés à la demande depuis `dist/fonts`.
- MathJax n'est chargé qu'au premier rendu.
- Couleur des formules en noir ou blanc pur pour les thèmes à contraste élevé.

### Corrections

- Les éléments de `enumerate` affichaient une puce au lieu de leur numéro.
- Les filets et cadres de `array` (matrices à barres, tableaux) étaient invisibles ou remplis en noir :
  la feuille de style de MathJax qui les dessine est maintenant intégrée au SVG.
- Le délai avant réanalyse pendant la frappe était annulé par l'événement de sélection : le document
  était réanalysé à chaque touche.
- La bascule `Ctrl+Alt+I` écrit au niveau où le réglage est défini (espace de travail ou utilisateur) ; elle était sans effet quand l'espace de travail fixait `inlineTeX.enabled`.
- Un argument non fermé en cours de frappe (`\textbf{…`) ne s'étend plus au-delà du paragraphe.
- Une formule contenant `\label` passait en erreur (« Label multiply defined ») dès sa deuxième
  conversion, par exemple au survol : l'état TeX est désormais remis à zéro avant chaque formule.

### Performances

- Images de plus de 1 Mo non prévisualisées : leur data URI repartirait vers l'éditeur à chaque passe.
- Seuls les éléments visibles (plus une marge) sont traités à chaque passe, sur des offsets entiers.
- Cache de l'image finale de chaque formule, caches LRU (éviction du moins récemment utilisé) au
  lieu d'un vidage complet, et un document MathJax par jeu de macros.

## 0.1.0

Première version.
