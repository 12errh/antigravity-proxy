/**
 * Unit tests for Phase 2 — Dead Code Removal.
 *
 * Each test asserts a specific dead-code symbol is no longer present in
 * the source. These are static-analysis tests (read the file, check for
 * substrings) that act as a regression guard: if any of these symbols
 * sneak back in, the test fails and forces a deliberate review.
 *
 * If a removed symbol ever NEEDS to be re-added, update the test with a
 * comment explaining why.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(__dirname, '..', 'src', rel), 'utf-8');
const startPs1 = readFileSync(resolve(__dirname, '..', '..', 'start.ps1'), 'utf-8');

// ---- B3: auth.ts ------------------------------------------------------------

test('Phase 2 / B3: auth.ts no longer exports getAuthHeaders', () => {
  const auth = src('auth.ts');
  assert.ok(
    !auth.includes('getAuthHeaders'),
    'auth.ts should not contain the dead getAuthHeaders function (was unused, see fix B3)',
  );
});

test('Phase 2 / B3: auth.ts no longer exports captureCredentials', () => {
  const auth = src('auth.ts');
  assert.ok(
    !auth.includes('captureCredentials'),
    'auth.ts should not contain the dead captureCredentials stub (was a no-op, see fix B3)',
  );
});

test('Phase 2 / B3: auth.ts still exports validateApiKey (the only function it needs)', () => {
  const auth = src('auth.ts');
  assert.ok(
    /export\s+function\s+validateApiKey\s*\(/.test(auth),
    'auth.ts should still export validateApiKey (used by index.ts main())',
  );
});

// ---- B4: mapper.ts ----------------------------------------------------------

test('Phase 2 / B4: mapper.ts no longer exports extractToolCalls', () => {
  const mapper = src('mapper.ts');
  assert.ok(
    !mapper.includes('extractToolCalls'),
    'mapper.ts should not export extractToolCalls (was never imported, see fix B4)',
  );
});

test('Phase 2 / B4: index.ts does not import extractToolCalls from mapper', () => {
  const index = src('index.ts');
  const mapperImport = index.match(/import\s+\{[^}]+\}\s+from\s+['"]\.\/mapper\.js['"]/);
  assert.ok(mapperImport, 'index.ts should have an import from ./mapper.js');
  assert.ok(
    !mapperImport[0].includes('extractToolCalls'),
    'index.ts should not import extractToolCalls from mapper (was a dead import, see fix B4)',
  );
});

// ---- D5: mapper.ts ----------------------------------------------------------

test('Phase 2 / D5: mapper.ts no longer exports mapModelName', () => {
  const mapper = src('mapper.ts');
  assert.ok(
    !mapper.includes('mapModelName'),
    'mapper.ts should not export mapModelName (was the only consumer of types.ts DEFAULT_MODEL_MAP, see fix D5)',
  );
});

// ---- B5: types.ts -----------------------------------------------------------

test('Phase 2 / B5: types.ts no longer exports DEFAULT_MODEL_MAP', () => {
  const types = src('types.ts');
  assert.ok(
    !types.includes('DEFAULT_MODEL_MAP'),
    'types.ts should not export DEFAULT_MODEL_MAP (only consumer was the dead mapModelName, see fix B5)',
  );
});

test('Phase 2 / B5: types.ts no longer defines ModelMap, loadModelMap, or cachedModelMap', () => {
  const types = src('types.ts');
  for (const sym of ['ModelMap', 'loadModelMap', 'cachedModelMap', 'MODELS_PATH']) {
    assert.ok(!types.includes(sym), `types.ts should not contain the dead symbol "${sym}"`);
  }
});

test('Phase 2 / B5: types.ts is now a pure interface file (no fs/path/url imports)', () => {
  const types = src('types.ts');
  assert.ok(
    !/^import\s+.+from\s+['"]fs['"]/m.test(types),
    'types.ts should not import fs (loadModelMap was the only user)',
  );
  assert.ok(
    !/^import\s+.+from\s+['"]path['"]/m.test(types),
    'types.ts should not import path (MODELS_PATH was the only user)',
  );
  assert.ok(
    !/^import\s+.+from\s+['"]url['"]/m.test(types),
    'types.ts should not import url (fileURLToPath was the only user)',
  );
});

// ---- B6: index.ts ----------------------------------------------------------

test('Phase 2 / B6: index.ts no longer defines buildGoogleEvent', () => {
  const index = src('index.ts');
  assert.ok(
    !index.includes('buildGoogleEvent'),
    'index.ts should not define buildGoogleEvent (was never called, see fix B6)',
  );
});

test('Phase 2 / B6: index.ts no longer defines BuildEventOpts interface', () => {
  const index = src('index.ts');
  assert.ok(
    !index.includes('BuildEventOpts'),
    'index.ts should not define the BuildEventOpts interface (used only by the dead buildGoogleEvent)',
  );
});

test('Phase 2 / B6: index.ts still defines SAFETY_RATINGS and GROUNDING_METADATA', () => {
  // Sanity check: these constants are used by the streaming response loop
  // and must NOT be deleted.
  const index = src('index.ts');
  assert.ok(index.includes('SAFETY_RATINGS'), 'SAFETY_RATINGS is still used by the streaming loop');
  assert.ok(index.includes('GROUNDING_METADATA'), 'GROUNDING_METADATA is still used by the streaming loop');
});

// ---- C1: dist cleanup verification -----------------------------------------

test('Phase 2 / C1: start.ps1 does not reference any built dist/ artifacts', () => {
  // The proxy should always run from source (tsx src/index.ts), never from
  // pre-built dist/ files. Stale dist/ is a build-output smell, not a runtime
  // dependency.
  assert.ok(
    !/(node|tsx)\s+dist[\/\\]/i.test(startPs1),
    'start.ps1 should not run from dist/ (always use src/index.ts)',
  );
  assert.ok(
    startPs1.includes('tsx src/index.ts'),
    'start.ps1 should still launch the proxy via `tsx src/index.ts`',
  );
});
