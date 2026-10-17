#!/usr/bin/env node
// Bootstrap for the antigravity CLI.
//
// This file deliberately uses only Node built-ins and old-compatible syntax:
// it is what runs first, possibly under an ancient `node` (e.g. Debian's
// v18 in /usr/bin, selected by sudo's secure_path while the user's shell has
// a modern nvm node). The real CLI lives in dist/cli/main.js (src/cli/main.ts)
// and needs Node 20+.
//
// When the current Node is too old, a modern one is located (typically the
// invoking user's nvm install, discovered via SUDO_USER) and this entrypoint
// is re-executed under it with stdio inherited, so interactive sudo prompts
// still work.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_MAJOR = 20;
const self = fileURLToPath(import.meta.url);

function isModernNode(exe) {
  try {
    const res = spawnSync(exe, ['--version'], { encoding: 'utf-8', timeout: 5000 });
    if (res.status !== 0 || !res.stdout) return false;
    const major = Number(String(res.stdout).trim().replace(/^v/, '').split('.')[0]);
    return major >= MIN_MAJOR;
  } catch {
    return false;
  }
}

function nvmNodes(home) {
  const base = path.join(home, '.nvm', 'versions', 'node');
  let entries;
  try {
    entries = readdirSync(base);
  } catch {
    return [];
  }
  const parse = v => String(v).replace(/^v/, '').split('.').map(Number);
  entries.sort((a, b) => {
    const A = parse(a);
    const B = parse(b);
    for (let i = 0; i < 3; i++) {
      const diff = (B[i] || 0) - (A[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  return entries.slice(0, 5).map(v => path.join(base, v, 'bin', 'node'));
}

function findModernNode() {
  const candidates = [];
  if (process.env.ANTIGRAVITY_NODE) candidates.push(process.env.ANTIGRAVITY_NODE);

  const homes = [];
  if (process.env.SUDO_USER) {
    homes.push(`/home/${process.env.SUDO_USER}`, `/Users/${process.env.SUDO_USER}`);
  }
  homes.push(homedir());

  for (const home of homes) {
    candidates.push(...nvmNodes(home));
    candidates.push(path.join(home, '.volta', 'bin', 'node'));
    candidates.push(path.join(home, '.local', 'bin', 'node'));
    candidates.push(path.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin', 'node'));
  }

  candidates.push('/usr/local/bin/node', '/opt/homebrew/bin/node');

  for (const candidate of candidates) {
    if (isModernNode(candidate)) return candidate;
  }
  return null;
}

function printVersionError() {
  console.error('');
  console.error(`  antigravity requires Node.js ${MIN_MAJOR}+ but the current node is v${process.versions.node}`);
  console.error(`  (${process.execPath}) and no newer Node.js installation was found.`);
  console.error('');
  console.error('  Fixes:');
  console.error('    - keep your shell PATH under sudo:  sudo env "PATH=$PATH" antigravity <command>');
  console.error('    - or point at a modern node:       ANTIGRAVITY_NODE=/path/to/node antigravity <command>');
  console.error('');
}

async function main() {
  const currentMajor = Number(process.versions.node.split('.')[0]);
  if (currentMajor >= MIN_MAJOR) {
    const { runCli } = await import('../dist/cli/main.js');
    runCli();
    return;
  }

  const modern = findModernNode();
  if (modern && path.resolve(modern) !== path.resolve(process.execPath)) {
    const res = spawnSync(modern, [self, ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(res.status === null ? 1 : res.status);
  }

  printVersionError();
  process.exit(1);
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
