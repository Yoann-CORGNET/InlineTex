// Builds the integration suite and runs it in VS Code against a temporary copy of samples/.
// VSCODE_PATH selects a local VS Code; otherwise @vscode/test-electron downloads one.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { runTests } from '@vscode/test-electron';

const root = resolve(import.meta.dirname, '../..');
await esbuild.build({
  entryPoints: [join(root, 'test/integration/suite.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  outfile: join(root, 'dist-test/suite.js'),
  logLevel: 'warning',
});

const scratch = mkdtempSync(join(tmpdir(), 'inlinetex-it-'));
const workspace = join(scratch, 'workspace');
const results = join(scratch, 'results.txt');
const EXPECTED_CHECKS = 3;
cpSync(join(root, 'samples'), workspace, { recursive: true });
try {
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_PATH,
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'dist-test/suite.js'),
    launchArgs: [workspace, '--disable-extensions', '--user-data-dir', join(scratch, 'user')],
    extensionTestsEnv: { INLINETEX_RESULTS: results },
  });
  const lines = existsSync(results) ? readFileSync(results, 'utf8').trim().split('\n') : [];
  console.log(lines.join('\n'));
  if (lines.length !== EXPECTED_CHECKS || lines.some((l) => !l.startsWith('ok'))) {
    throw new Error(`expected ${EXPECTED_CHECKS} passing checks, got ${lines.length}`);
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
