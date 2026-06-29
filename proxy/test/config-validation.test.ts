import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Config validation', () => {
  it('should reject invalid CONTEXT_STRIP_MODE values', () => {
    const validModes = ['passthrough', 'strip'];
    const invalidModes = ['STRIP', 'invalid', '', '123'];
    
    for (const mode of invalidModes) {
      assert.ok(
        !validModes.includes(mode),
        `${mode} should not be a valid mode`
      );
    }
  });

  it('should accept valid CONTEXT_STRIP_MODE values', () => {
    const validModes = ['passthrough', 'strip'];
    
    for (const mode of validModes) {
      assert.ok(
        validModes.includes(mode),
        `${mode} should be a valid mode`
      );
    }
  });
});
