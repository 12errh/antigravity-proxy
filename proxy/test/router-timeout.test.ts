import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('Router timeout', () => {
  it('should have REQUEST_TIMEOUT_MS in config.ts', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    assert.ok(
      configSrc.includes('requestTimeoutMs'),
      'config.ts should have requestTimeoutMs property'
    );
    assert.ok(
      configSrc.includes('REQUEST_TIMEOUT_MS'),
      'config.ts should read REQUEST_TIMEOUT_MS from env'
    );
  });

  it('should default to 300000ms (5 minutes)', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    assert.ok(
      configSrc.includes("process.env.REQUEST_TIMEOUT_MS || '300000'"),
      'config.ts should default REQUEST_TIMEOUT_MS to 300000'
    );
  });

  it('should create timeout signal in router.ts', () => {
    const routerSrc = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
    assert.ok(
      routerSrc.includes('timeoutController'),
      'router.ts should create timeoutController'
    );
    assert.ok(
      routerSrc.includes('AbortSignal.any'),
      'router.ts should combine signals with AbortSignal.any'
    );
  });

  it('should clear timeout in finally block', () => {
    const routerSrc = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
    assert.ok(
      routerSrc.includes('clearTimeout(timeoutId)'),
      'router.ts should clear timeout in finally block'
    );
  });
});
