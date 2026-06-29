import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('DB fallback behavior', () => {
  it('should NOT import logger to avoid circular dependency', () => {
    const dbSrc = fs.readFileSync(new URL('../src/db.ts', import.meta.url), 'utf-8');
    assert.ok(
      !dbSrc.includes("import { logger } from './logger.js'"),
      'db.ts should NOT import logger (circular dependency with logger.ts)'
    );
  });

  it('should document why logger is not used', () => {
    const dbSrc = fs.readFileSync(new URL('../src/db.ts', import.meta.url), 'utf-8');
    assert.ok(
      dbSrc.includes('circular dependency') || dbSrc.includes('Cannot use logger'),
      'db.ts should explain why logger is not used'
    );
  });
});
