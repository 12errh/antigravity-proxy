/**
 * Unit tests for Fix #3 (A2 followup) — provider-cache.ts Google model list endpoint.
 *
 * Background:
 *   The old code built URLs like:
 *     https://generativelanguage.googleapis.com/v1/models?key=AIza...
 *   The fix routes the key via the x-goog-api-key header.
 *
 * Since this function performs a real HTTP call (we can't easily mock
 * poolFetch without a full module-mock setup), we do a static check on
 * the source code: assert that the key is sent via header, not URL.
 *
 * The actual end-to-end behavior is also exercised by the smoke test
 * (smoke.test.ts) which hits /api/provider-models and the live proxy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const providerCachePath = resolve(__dirname, '..', 'src', 'provider-cache.ts');
const providerCache = readFileSync(providerCachePath, 'utf-8');

test('A2: provider-cache.ts Google model list does not use ?key= in URL', () => {
  // The old buggy line was:
  //   const u = `${meta.baseUrl}/v1/models?key=${encodeURIComponent(key)}`;
  // The fix should remove the `?key=` from the URL.
  const oldPattern = /v1\/models\?key\s*=\s*\$\{encodeURIComponent\(key\)\}/;
  assert.ok(
    !oldPattern.test(providerCache),
    'provider-cache.ts should not build Google model-list URL with ?key= query param',
  );
  // The Google branch should still exist
  assert.ok(/provider\s*===\s*['"]google['"]/.test(providerCache), 'Google branch should be preserved');
});

test('A2: provider-cache.ts Google branch uses x-goog-api-key header', () => {
  // Verify the fix sends the key via header instead. The actual code shape is:
  //   headers: { 'x-goog-api-key': key }
  // so we need to allow for the single-quote between the key name and the colon.
  assert.ok(
    /['"]x-goog-api-key['"]\s*:\s*key/.test(providerCache),
    'provider-cache.ts should send x-goog-api-key header for Google model list',
  );
});

test('A2: provider-cache.ts Google model list URL is well-formed', () => {
  // The new URL should be `${meta.baseUrl}/v1/models` (no query string)
  const newPattern = /v1\/models`/;
  assert.ok(
    newPattern.test(providerCache),
    'provider-cache.ts should build Google URL as `${meta.baseUrl}/v1/models` (no query)',
  );
});
