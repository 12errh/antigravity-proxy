import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatErrorResponse } from '../src/utils/error-response.js';

describe('formatErrorResponse', () => {
  it('should format Error object correctly', () => {
    const error = new Error('Test error');
    const result = formatErrorResponse(error);

    assert.deepEqual(result, {
      error: {
        message: 'Test error',
        code: 'INTERNAL_ERROR',
      }
    });
  });

  it('should format string error correctly', () => {
    const result = formatErrorResponse('String error');

    assert.deepEqual(result, {
      error: {
        message: 'String error',
        code: 'INTERNAL_ERROR',
      }
    });
  });

  it('should preserve custom code', () => {
    const error = new Error('Rate limited');
    (error as any).code = 'RATE_LIMITED';
    const result = formatErrorResponse(error);

    assert.equal(result.error.code, 'RATE_LIMITED');
  });

  it('should handle empty string', () => {
    const result = formatErrorResponse('');

    assert.deepEqual(result, {
      error: {
        message: '',
        code: 'INTERNAL_ERROR',
      }
    });
  });
});
