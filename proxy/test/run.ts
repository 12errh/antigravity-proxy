/**
 * Test bootstrap. Discovers all *.test.ts files in this directory and runs
 * them under `node --import tsx --test`. This avoids a quirk in tsx's import
 * hook where passing a directory path to --test triggers a module-resolution
 * error (it tries to resolve test/ as a module and look for test/index.json).
 *
 * Usage:
 *   tsx test/run.ts            (used by `npm test`)
 *   tsx test/run.ts <pattern>  (e.g., `tsx test/run.ts google` to run a subset)
 */

import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const allTestFiles = readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.ts'))
  .sort();

const filter = process.argv[2];
const testFiles = filter
  ? allTestFiles.filter((f) => f.toLowerCase().includes(filter.toLowerCase()))
  : allTestFiles;

if (testFiles.length === 0) {
  console.error(`No test files matched filter: ${filter ?? '(none)'}`);
  console.error(`Available tests:`);
  for (const f of allTestFiles) console.error(`  - ${f}`);
  process.exit(1);
}

const args = ['--import', 'tsx', '--test', ...testFiles.map((f) => join(__dirname, f))];

console.log(`> node ${args.join(' ')}\n`);

const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('Failed to start node:', err);
  process.exit(1);
});
