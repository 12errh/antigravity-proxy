import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('Dashboard KNOWN_ENV_KEYS', () => {
  it('should include OPENCODE_GO_API_KEY', () => {
    const dashboardSrc = fs.readFileSync(new URL('../src/dashboard.ts', import.meta.url), 'utf-8');
    assert.ok(
      dashboardSrc.includes('OPENCODE_GO_API_KEY'),
      'dashboard.ts KNOWN_ENV_KEYS should include OPENCODE_GO_API_KEY'
    );
  });
});
