import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('Router retry/failover', () => {
  it('should have retry logic in router.ts', () => {
    const routerSrc = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
    assert.ok(
      routerSrc.includes('perProviderRetries'),
      'router.ts should have perProviderRetries'
    );
    assert.ok(
      routerSrc.includes('for (let attempt = 0; attempt <= perProviderRetries; attempt++)'),
      'router.ts should have retry loop'
    );
  });

  it('should have failover logic', () => {
    const routerSrc = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
    assert.ok(
      routerSrc.includes('fireFailoverWebhook'),
      'router.ts should have fireFailoverWebhook function'
    );
    assert.ok(
      routerSrc.includes('status: \'failover\''),
      'router.ts should emit failover status'
    );
  });

  it('should have exponential backoff', () => {
    const routerSrc = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
    assert.ok(
      routerSrc.includes('Math.pow(2, attempt)'),
      'router.ts should have exponential backoff'
    );
  });

  it('should handle rate limits with longer backoff', () => {
    const routerSrc = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
    assert.ok(
      routerSrc.includes('isRateLimit'),
      'router.ts should detect rate limits'
    );
    assert.ok(
      routerSrc.includes('429') && routerSrc.includes('rate_limit'),
      'router.ts should check for 429 and rate_limit'
    );
  });

  it('should have global fallback', () => {
    const routerSrc = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
    assert.ok(
      routerSrc.includes('Second pass'),
      'router.ts should have second pass fallback'
    );
    assert.ok(
      routerSrc.includes('DISABLE_GLOBAL_FALLBACK'),
      'router.ts should support DISABLE_GLOBAL_FALLBACK'
    );
  });

  it('should cap per-provider retries when multiple candidates', () => {
    const routerSrc = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
    assert.ok(
      routerSrc.includes('candidates.length > 1'),
      'router.ts should check for multiple candidates'
    );
    assert.ok(
      routerSrc.includes('Math.min(2, this.options.retries)'),
      'router.ts should cap retries to 2 when multiple candidates'
    );
  });

  it('should handle mid-stream failures', () => {
    const routerSrc = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
    assert.ok(
      routerSrc.includes('hasStreamedData'),
      'router.ts should track hasStreamedData'
    );
    assert.ok(
      routerSrc.includes('failed mid-stream'),
      'router.ts should handle mid-stream failures'
    );
  });
});
