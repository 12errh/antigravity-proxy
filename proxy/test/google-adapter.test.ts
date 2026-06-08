/**
 * Unit tests for Fix #2 (A2) — Google API key never appears in request URLs.
 *
 * Background:
 *   The old code built URLs like:
 *     https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?alt=sse&key=AIza...
 *   That leaks the API key into logs, HTTP referers, and any proxy in the path.
 *   The fix routes the key via the x-goog-api-key header instead.
 *
 * The fix is verified by asserting that:
 *   1. buildStreamUrl() returns a URL with no `key=` query param.
 *   2. buildAuthHeaders() includes x-goog-api-key with the original key.
 *   3. The API key value never appears anywhere in the URL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAdapter } from '../src/adapters/google.js';

const FAKE_KEY = 'test-google-api-key-do-not-use-12345';
const FAKE_BASE = 'https://generativelanguage.googleapis.com';

test('A2: GoogleAdapter.buildStreamUrl does not include any "key=" query parameter', () => {
  const adapter = new GoogleAdapter(FAKE_BASE, FAKE_KEY);
  const url = (adapter as any).buildStreamUrl('gemini-1.5-pro-latest') as string;
  assert.ok(!url.includes('key='), `URL must not contain "key=" query param, got: ${url}`);
  assert.ok(!url.includes(encodeURIComponent(FAKE_KEY)), `URL must not contain the encoded key, got: ${url}`);
});

test('A2: GoogleAdapter.buildStreamUrl does not leak the API key value', () => {
  const adapter = new GoogleAdapter(FAKE_BASE, FAKE_KEY);
  const url = (adapter as any).buildStreamUrl('gemini-1.5-pro-latest') as string;
  assert.ok(!url.includes(FAKE_KEY), `URL must not contain the raw API key, got: ${url}`);
  // The only query param should be alt=sse
  assert.match(url, /[?&]alt=sse(?:&|$)/, `URL should still include alt=sse, got: ${url}`);
});

test('A2: GoogleAdapter.buildStreamUrl preserves the path and base URL', () => {
  const adapter = new GoogleAdapter(FAKE_BASE, FAKE_KEY);
  const url = (adapter as any).buildStreamUrl('gemini-1.5-pro-latest') as string;
  assert.equal(
    url,
    `${FAKE_BASE}/v1beta/models/gemini-1.5-pro-latest:streamGenerateContent?alt=sse`,
    'URL shape should be unchanged (sans key=)',
  );
});

test('A2: GoogleAdapter.buildStreamUrl handles trailing slashes in baseUrl', () => {
  const adapter = new GoogleAdapter(FAKE_BASE + '///', FAKE_KEY);
  const url = (adapter as any).buildStreamUrl('gemini-1.5-pro-latest') as string;
  assert.ok(!url.includes('//v1beta'), `URL should not contain double-slashes, got: ${url}`);
  assert.equal(url, `${FAKE_BASE}/v1beta/models/gemini-1.5-pro-latest:streamGenerateContent?alt=sse`);
});

test('A2: GoogleAdapter.buildAuthHeaders puts the key in x-goog-api-key header', () => {
  const adapter = new GoogleAdapter(FAKE_BASE, FAKE_KEY);
  const headers = (adapter as any).buildAuthHeaders() as Record<string, string>;
  assert.equal(headers['x-goog-api-key'], FAKE_KEY, 'x-goog-api-key header must hold the API key');
  assert.equal(headers['Content-Type'], 'application/json', 'Content-Type must remain application/json');
  // Ensure no Authorization header (we use x-goog-api-key, not Bearer)
  assert.ok(!headers['Authorization'], 'Google auth uses x-goog-api-key, not Authorization');
});

test('A2: GoogleAdapter.buildAuthHeaders does not put the key in the URL', () => {
  const adapter = new GoogleAdapter(FAKE_BASE, FAKE_KEY);
  const headers = (adapter as any).buildAuthHeaders() as Record<string, string>;
  const headerStr = JSON.stringify(headers);
  // The URL is not in headers, but verify the key appears in x-goog-api-key, not some other header
  assert.ok(headerStr.includes(FAKE_KEY), 'Key should appear in x-goog-api-key');
  assert.ok(!headerStr.includes(`key=${FAKE_KEY}`), 'Key should not be in query-string form');
});
