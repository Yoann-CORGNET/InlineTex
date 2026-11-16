# CLAUDE.md

Extension VS Code de rendu WYSIWYG en ligne pour LaTeX.

- Usage, réglages, commandes : [README.md](README.md)
- Architecture et choix techniques : [docs/architecture.md](docs/architecture.md)

## Notes pour l'agent

- Garder `src/parser`, `src/render` et `src/editor/layout.ts` sans import de `vscode` : c'est ce qui
  les rend testables avec vitest. La logique testable va dans ces modules, pas dans `controller.ts`.
- Vérifier : `npm run typecheck && npm test && npm run build`. Pour le rendu, il faut une vérification
  visuelle dans l'Extension Development Host avec `samples/demo.tex`. Les décorations ne sont pas
  lisibles par l'API.
- TypeScript 7 : `moduleResolution: node10` est refusé, d'où `bundler` et `module: preserve` dans
  `tsconfig.json`.
- `@types/vscode` ne doit pas dépasser `engines.vscode` dans `package.json` (vsce refuse le paquet).
- `dist/` et `*.vsix` sont générés, ne pas les éditer à la main.
