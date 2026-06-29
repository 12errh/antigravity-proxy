import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('Config hot-reload', () => {
  it('should have reload method in config', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    assert.ok(
      configSrc.includes('reload(): void'),
      'config.ts should have reload method'
    );
  });

  it('should reload all config values', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    assert.ok(
      configSrc.includes('this.proxyPort = parseInt(process.env.PROXY_PORT'),
      'config.ts reload should update proxyPort'
    );
    assert.ok(
      configSrc.includes('this.apiPort = parseInt(process.env.API_PORT'),
      'config.ts reload should update apiPort'
    );
    assert.ok(
      configSrc.includes('this.logLevel = process.env.LOG_LEVEL'),
      'config.ts reload should update logLevel'
    );
  });

  it('should reload provider priority', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    assert.ok(
      configSrc.includes('this.providerPriority = parsePriority()'),
      'config.ts reload should update providerPriority'
    );
  });

  it('should reload providers', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    assert.ok(
      configSrc.includes('this.providers = buildProviders(this.providerPriority, localProviders)'),
      'config.ts reload should update providers'
    );
  });

  it('should have parsePriority function', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    assert.ok(
      configSrc.includes('function parsePriority()'),
      'config.ts should have parsePriority function'
    );
  });

  it('should have buildProviders function', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    assert.ok(
      configSrc.includes('function buildProviders('),
      'config.ts should have buildProviders function'
    );
  });

  it('should validate CONTEXT_STRIP_MODE on reload', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    assert.ok(
      configSrc.includes('validateContextStripMode(process.env.CONTEXT_STRIP_MODE'),
      'config.ts reload should validate CONTEXT_STRIP_MODE'
    );
  });

  it('should reload REQUEST_TIMEOUT_MS', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    assert.ok(
      configSrc.includes('this.requestTimeoutMs = parseInt(process.env.REQUEST_TIMEOUT_MS'),
      'config.ts reload should update requestTimeoutMs'
    );
  });
});
