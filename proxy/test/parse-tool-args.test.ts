import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseToolArgs } from '../src/utils/parse-tool-args.js';

describe('parseToolArgs', () => {
  it('should parse valid JSON string', () => {
    const result = parseToolArgs('{"key": "value"}');
    assert.deepEqual(result, { key: 'value' });
  });

  it('should parse object directly', () => {
    const result = parseToolArgs({ key: 'value' });
    assert.deepEqual(result, { key: 'value' });
  });

  it('should return empty object for invalid JSON', () => {
    const result = parseToolArgs('invalid json');
    assert.deepEqual(result, {});
  });

  it('should return empty object for null', () => {
    const result = parseToolArgs(null);
    assert.deepEqual(result, {});
  });

  it('should return empty object for undefined', () => {
    const result = parseToolArgs(undefined);
    assert.deepEqual(result, {});
  });

  it('should handle nested objects', () => {
    const result = parseToolArgs('{"nested": {"key": "value"}}');
    assert.deepEqual(result, { nested: { key: 'value' } });
  });

  it('should handle arrays', () => {
    const result = parseToolArgs('["item1", "item2"]');
    assert.deepEqual(result, ['item1', 'item2']);
  });
});
