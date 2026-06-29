import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('Config reload defaults', () => {
  it('should use validateContextStripMode for CONTEXT_STRIP_MODE on reload', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    
    // The reload method should use validateContextStripMode function
    assert.ok(
      configSrc.includes('this.contextStripMode = validateContextStripMode(process.env.CONTEXT_STRIP_MODE || \'passthrough\')'),
      'config.ts reload should use validateContextStripMode with passthrough default'
    );
  });

  it('should have validateContextStripMode function that defaults to passthrough', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    
    // Check that the validation function exists and defaults to passthrough
    assert.ok(
      configSrc.includes('function validateContextStripMode'),
      'config.ts should have validateContextStripMode function'
    );
    assert.ok(
      configSrc.includes('return \'passthrough\''),
      'validateContextStripMode should default to passthrough'
    );
  });
});
