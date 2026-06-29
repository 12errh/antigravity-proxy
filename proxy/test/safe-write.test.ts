import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeWrite } from '../src/utils/safe-write.js';
import fs from 'fs';

describe('safeWrite', () => {
  it('should return true when write succeeds', () => {
    const mockRes = {
      destroyed: false,
      write: (data: string, encoding: string) => {
        return true;
      },
    } as any;

    const result = safeWrite(mockRes, 'test data');
    assert.equal(result, true);
  });

  it('should return false when response is destroyed', () => {
    const mockRes = {
      destroyed: true,
      write: () => true,
    } as any;

    const result = safeWrite(mockRes, 'test data');
    assert.equal(result, false);
  });

  it('should return false when write throws', () => {
    const mockRes = {
      destroyed: false,
      write: () => {
        throw new Error('Stream closed');
      },
    } as any;

    const result = safeWrite(mockRes, 'test data');
    assert.equal(result, false);
  });

  it('should import safeWrite from index.ts', () => {
    const indexSrc = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf-8');
    assert.ok(
      indexSrc.includes("import { safeWrite } from './utils/safe-write.js'"),
      'index.ts should import safeWrite'
    );
  });
});
