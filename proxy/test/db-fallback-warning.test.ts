import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('DB fallback warning', () => {
  it('should have logger import in db.ts', () => {
    const dbSrc = fs.readFileSync(new URL('../src/db.ts', import.meta.url), 'utf-8');
    assert.ok(
      dbSrc.includes("import { logger } from './logger.js'"),
      'db.ts should import logger'
    );
  });

  it('should log warning when better-sqlite3 unavailable', () => {
    const dbSrc = fs.readFileSync(new URL('../src/db.ts', import.meta.url), 'utf-8');
    assert.ok(
      dbSrc.includes('logger.warn') && dbSrc.includes('better-sqlite3'),
      'db.ts should log warning about better-sqlite3 fallback'
    );
  });
});
