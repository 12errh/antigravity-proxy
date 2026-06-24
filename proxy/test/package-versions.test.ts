/**
 * Unit tests for Fix #1 (A1) — package.json version, engines, and test script.
 *
 * These tests guard against regression of the bug where:
 *   - typescript: ^6.0.3   (TypeScript 6 does not exist; latest is 5.x)
 *   - @types/node: ^25.9.1 (Node 25 does not exist; latest LTS is 22/23)
 *
 * If either of those ever creeps back in (or engines.node is removed), the
 * build will fail on a clean install and these tests will catch it early.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
  name?: string;
  version?: string;
  engines?: { node?: string };
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
};

test('A1: package.json has a valid typescript devDependency (^5.x)', () => {
  const ts = pkg.devDependencies?.typescript;
  assert.ok(ts, 'typescript should be listed in devDependencies');
  // Disallow the historical bad values explicitly
  assert.notEqual(ts, '^6.0.3', 'typescript@6.x does not exist yet; do not pin to ^6');
  assert.match(ts, /^\^[45]\.\d+\.\d+/, `typescript should be a ^4.x or ^5.x range, got: ${ts}`);
});

test('A1: package.json has a valid @types/node devDependency (^20-^24.x)', () => {
  const types = pkg.devDependencies?.['@types/node'];
  assert.ok(types, '@types/node should be listed in devDependencies');
  assert.notEqual(types, '^25.9.1', '@types/node@25 does not exist; do not pin to ^25');
  // Allow any reasonable Node-types range (Node 20 LTS through 24)
  assert.match(types, /^\^2[0-4]\.\d+\.\d+/, `@types/node should be a ^20-^24.x range, got: ${types}`);
});

test('A1: package.json declares engines.node >= 20', () => {
  const nodeEngine = pkg.engines?.node;
  assert.ok(nodeEngine, 'engines.node should be specified');
  const m = nodeEngine.match(/>=(\d+)/);
  assert.ok(m, `engines.node should have a >= constraint, got: ${nodeEngine}`);
  const major = parseInt(m[1], 10);
  // Node 18 is EOL (April 2025). undici@7 requires Node >= 20 (global File API).
  assert.ok(major >= 20, `engines.node should require Node >= 20 (Node 18 is EOL and undici@7 requires >=20), got: ${nodeEngine}`);
  // Should not be over-permissive (no unbounded >=)
  assert.ok(/^>=\d+$/.test(nodeEngine), `engines.node should be a simple >= constraint, got: ${nodeEngine}`);
});

test('A1: package.json has a "test" script', () => {
  const testScript = pkg.scripts?.test;
  assert.ok(testScript, 'scripts.test should be defined');
  assert.match(testScript, /test/, 'scripts.test should reference test files');
  // The test script must be runnable (not an empty stub)
  assert.ok(testScript.trim().length > 5, `scripts.test looks too short: ${testScript}`);
});

test('A1: package.json is the Antigravity Proxy package', () => {
  assert.ok(pkg.name === '@12errh/antigravity-proxy' || pkg.name === 'antigravity' || pkg.name === 'antigravity-proxy', 'package name should be @12errh/antigravity-proxy');
  assert.ok(pkg.version, 'package version should be set');
});
