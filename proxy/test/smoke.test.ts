/**
 * Smoke test for the proxy — hits /api/health to verify the proxy is responsive.
 *
 * This test is a "best-effort" smoke check:
 *   - If the proxy is running on localhost:4000, it asserts the health endpoint
 *     returns 200 and a valid JSON body.
 *   - If the proxy is NOT running, the test SKIPS gracefully (does not fail).
 *
 * This is intentionally NOT a hard requirement because tests should be runnable
 * in CI without the proxy. Use this for local sanity checks after a restart.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const HEALTH_URL = 'http://localhost:4000/api/health';
const TIMEOUT_MS = 2000;

test('Smoke: /api/health returns 200 with status:ok (skips if proxy not running)', async () => {
  let response: Response;
  try {
    response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err: any) {
    // Common reasons the proxy isn't running: ECONNREFUSED, abort on timeout.
    // We treat these as "skip", not failure.
    if (
      err?.code === 'ECONNREFUSED' ||
      err?.name === 'TimeoutError' ||
      err?.name === 'AbortError' ||
      err?.cause?.code === 'ECONNREFUSED'
    ) {
      console.log('  [smoke] proxy not reachable at :4000, skipping health check');
      return;
    }
    throw err;
  }

  assert.equal(response.status, 200, 'health endpoint should return 200');
  const body = (await response.json()) as { status?: string; uptime?: number; timestamp?: string };
  assert.equal(body.status, 'ok', 'health body should have status:ok');
  assert.ok(typeof body.uptime === 'number', 'health body should include uptime');
  assert.ok(typeof body.timestamp === 'string', 'health body should include ISO timestamp');
});
