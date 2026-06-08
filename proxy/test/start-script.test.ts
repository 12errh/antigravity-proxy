/**
 * Unit tests for Fix #4 (A7 + A8) — start.ps1 elevation logic and port checks.
 *
 * Background:
 *   A7: Old code always called Start-Process -Verb RunAs on launch, triggering
 *       a SECOND UAC prompt even when the user was already elevated, which
 *       spawned a separate admin process that lost the original env / cert
 *       store state. The fix is to only request UAC when $IsAdmin is false.
 *
 *   A8: Old code used a fragile netstat regex to find the previous proxy's
 *       PID, and only checked port 4000. The proxy also binds 443, so a
 *       half-dead instance on 443 would be missed. The fix uses
 *       Get-NetTCPConnection on BOTH 4000 and 443.
 *
 * Since this is a PowerShell script, we can't unit-test the behavior at
 * runtime from Node. We do a static check on the file content to ensure
 * the buggy patterns are gone and the fixed patterns are present.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const startPs1Path = resolve(__dirname, '..', '..', 'start.ps1');
const startPs1 = readFileSync(startPs1Path, 'utf-8');

test('A7: start.ps1 no longer has unconditional "-Verb RunAs" on the launch line', () => {
  // The old buggy pattern was a single line like:
  //   $proc = Start-Process powershell -Verb RunAs -WindowStyle Normal ...
  // The fix uses splatting (@startArgs) and sets Verb=RunAs only if not admin.
  // We check that the old single-line pattern is gone.
  const oldPattern = /Start-Process\s+powershell\s+-Verb\s+RunAs[\s\S]{0,200}-PassThru/;
  assert.ok(
    !oldPattern.test(startPs1),
    'start.ps1 should not have an unconditional "-Verb RunAs" on Start-Process powershell',
  );
});

test('A7: start.ps1 launch uses splatting and does not directly use -Verb RunAs', () => {
  // The script has multiple Start-Process calls:
  //   1. The initial admin elevation at the top (intentional — gets the user admin)
  //   2. The proxy launch (must NOT directly use -Verb RunAs — it should use splatting)
  //   3. The Antigravity desktop launch (uses a direct file path, no -Verb RunAs)
  // We locate the proxy launch line by its splatting syntax (e.g., @startArgs)
  // which is unique to it.
  const lines = startPs1.split('\n');
  const splattingLines = lines.filter((l) => /Start-Process\s+@[\w$]+/.test(l));
  assert.ok(
    splattingLines.length >= 1,
    'start.ps1 should have at least one Start-Process call using splatting (@<var>)',
  );
  const launchLine = splattingLines[splattingLines.length - 1];
  // The launch line should NOT contain "-Verb RunAs" — that should be set
  // conditionally in the splat hashtable before the call.
  assert.ok(
    !launchLine.includes('-Verb RunAs'),
    `Launch line should not directly use -Verb RunAs (should be set conditionally in the splat hashtable), got: ${launchLine.trim()}`,
  );
  // And a conditional like `if (-not $IsAdmin) { ... Verb ... RunAs ... }`
  // should be present somewhere above the launch.
  const conditionalRunAs = /if\s*\(\s*-not\s+\$IsAdmin\s*\)[\s\S]{0,200}RunAs/i;
  assert.ok(
    conditionalRunAs.test(startPs1),
    'start.ps1 should wrap -Verb RunAs in `if (-not $IsAdmin)` to avoid a second UAC prompt',
  );
});

test('A8: start.ps1 uses Get-NetTCPConnection (not fragile netstat regex)', () => {
  assert.ok(
    startPs1.includes('Get-NetTCPConnection'),
    'start.ps1 should use Get-NetTCPConnection for port-based process lookup',
  );
  // The old `netstat -ano | Select-String ':4000 '` pattern should be gone
  const oldNetstatRegex = /netstat\s+-ano\s*\|?\s*Select-String\s+['"]:4000['"]/;
  assert.ok(
    !oldNetstatRegex.test(startPs1),
    'start.ps1 should no longer use `netstat -ano | Select-String ":4000 "` to find old PIDs',
  );
});

test('A8: start.ps1 checks BOTH ports 4000 and 443 for old proxy processes', () => {
  // The fix uses -LocalPort 4000,443 in a single Get-NetTCPConnection call.
  // Check that both ports are mentioned together in the kill-old section.
  // We allow either ordering: "4000,443" or "443,4000".
  const bothPorts = /(4000\s*,\s*443|443\s*,\s*4000)/;
  assert.ok(
    bothPorts.test(startPs1),
    'start.ps1 should check both 4000 and 443 in a single port lookup (e.g., -LocalPort 4000,443)',
  );
  // And both port numbers should appear in the file at least once each
  assert.ok(startPs1.includes('4000'), 'start.ps1 should reference port 4000');
  assert.ok(startPs1.includes('443'), 'start.ps1 should reference port 443');
});

test('start.ps1: the existing $IsAdmin check at the top is still present', () => {
  // Sanity check: the initial admin check at the top of the script wasn't
  // accidentally removed during the fix.
  assert.ok(
    /IsInRole\([\s\S]*?Administrator\)/.test(startPs1),
    'start.ps1 should still check for Administrator role at the top',
  );
  assert.ok(
    /\$IsAdmin\s*=/.test(startPs1),
    'start.ps1 should still define $IsAdmin for use by the launch logic',
  );
});
