# CLAUDE.md

Extension VS Code de rendu WYSIWYG en ligne pour LaTeX.

- Usage, réglages, commandes : [README.md](README.md)
- Architecture et choix techniques : [docs/architecture.md](docs/architecture.md)
- La documentation de référence est en anglais (`README.md`, `docs/architecture.md`), traduite dans
  `README.fr.md` et `docs/architecture.fr.md` : toute modification se reporte dans les deux langues.

## Notes pour l'agent

- Garder `src/parser`, `src/render`, `src/util`, `src/editor/layout.ts` et `src/editor/plan.ts` sans import de `vscode` : c'est ce qui
  les rend testables avec vitest. La logique testable va dans ces modules, pas dans `controller.ts`.
- Vérifier : `npm run typecheck && npm run lint && npm test && npm run build`. Pour le rendu, il faut une vérification
  visuelle dans l'Extension Development Host avec `samples/demo.tex`. Les décorations ne sont pas
  lisibles par l'API.
- TypeScript 7 : `moduleResolution: node10` est refusé, d'où `bundler` et `module: preserve` dans
  `tsconfig.json`.
- `@types/vscode` ne doit pas dépasser `engines.vscode` dans `package.json` (vsce refuse le paquet).
- `dist/` et `*.vsix` sont générés, ne pas les éditer à la main.
- Lint avec Biome : typescript-eslint dépend de l'API JavaScript de TypeScript, absente de la v7.
- MathJax 4 : les glyphes rares sont dans `dist/fonts/`, construits par `esbuild.mjs`. Voir
  « Glyphes de MathJax 4 » dans l'architecture avant de toucher au rendu ou au bundling.
- Messages de commit au format Conventional Commits (`feat:`, `fix:`, `perf:`, `docs:`, `test:`, `ci:`,
  `chore:`), description en français : Release Please en déduit la version et le CHANGELOG.
