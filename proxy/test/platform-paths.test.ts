/**
 * Regression tests for the Windows/Linux platform-path fixes.
 *
 * Rationale: the proxy worked on Windows but silently failed to start its TLS
 * server on Linux because gen-certs wrote to <pkg>/certs while the runtime read
 * ~/.antigravity/certs. These tests pin down the invariants that keep the two
 * halves (generator + runtime) pointed at the same place, and guard the other
 * platform-facing fixes: exact hosts matching, LISTEN-only port cleanup, the
 * desktop-binary resolver, dual-stack binds and the start.sh shim.
 *
 * Mix of behavioral tests (parse helpers, resolver, gen-certs) and static
 * source assertions (following test/start-script.test.ts's pattern).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  USER_DATA_DIR, USER_CERTS_DIR, USER_CERT_FILE, USER_KEY_FILE, USER_LOGS_DIR, USER_ENV_PATH,
} from '../src/data-paths.js';
import { parseHostnameFields, lineMapsAny } from '../src/cli/utils/cert.js';
import { isOwnCliEntry, antigravityCandidates } from '../src/cli/utils/antigravity-app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(PROXY_DIR, '..');
const src = (rel: string) => fs.readFileSync(path.resolve(PROXY_DIR, 'src', rel), 'utf-8');

// ── Canonical path derivation ────────────────────────────────────────────────

test('path constants: certs, key, logs and .env all derive from USER_DATA_DIR', () => {
  assert.equal(USER_CERTS_DIR, path.join(USER_DATA_DIR, 'certs'));
  assert.equal(USER_CERT_FILE, path.join(USER_CERTS_DIR, 'cert.pem'));
  assert.equal(USER_KEY_FILE, path.join(USER_CERTS_DIR, 'key.pem'));
  assert.equal(USER_LOGS_DIR, path.join(USER_DATA_DIR, 'logs'));
  assert.equal(USER_ENV_PATH, path.join(USER_DATA_DIR, '.env'));
});

test('data-paths resolves the invoking user home under sudo (SUDO_USER), not /root', () => {
  const dp = src('data-paths.ts');
  assert.match(dp, /SUDO_USER/, 'data-paths must consult SUDO_USER');
  assert.match(dp, /\/etc\/passwd/, 'data-paths must fall back to the passwd database');
  assert.match(dp, /export const REAL_HOME/, 'REAL_HOME must be exported for reuse');
});

// ── Cert generation targets the runtime location ─────────────────────────────

test('generateCerts() passes the runtime cert dir to gen-certs.mjs', () => {
  const certTs = src('cli/utils/cert.ts');
  assert.match(
    certTs,
    /execFileSync\(process\.execPath,\s*\[scriptPath,\s*CERT_DIR\]/,
    'generateCerts must pass CERT_DIR (data-paths) as the output directory',
  );
  assert.match(certTs, /const CERT_DIR = USER_CERTS_DIR/, 'CERT_DIR must come from data-paths');
});

test('gen-certs.mjs writes to a caller-supplied output directory (and 0600 key)', () => {
  const scriptPath = path.resolve(PROXY_DIR, 'scripts', 'gen-certs.mjs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-certs-'));
  try {
    const res = spawnSync(process.execPath, [scriptPath, tmpDir], { encoding: 'utf-8', timeout: 30000 });
    assert.equal(res.status, 0, `gen-certs failed: ${res.stderr}`);
    const certFile = path.join(tmpDir, 'cert.pem');
    const keyFile = path.join(tmpDir, 'key.pem');
    assert.ok(fs.existsSync(certFile), 'cert.pem should land in the supplied directory');
    assert.ok(fs.existsSync(keyFile), 'key.pem should land in the supplied directory');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600, 'key.pem must be 0600');
    }
    // And nothing may be written into the package's own certs/ dir by this run.
    const pkgCerts = path.join(PROXY_DIR, 'certs', 'cert.pem');
    const script = fs.readFileSync(scriptPath, 'utf-8');
    assert.match(script, /process\.argv\[2\]/, 'the output dir must be accepted as argv[2]');
    assert.ok(!script.includes(`writeFileSync('${pkgCerts}'`), 'script must not hardcode the package certs dir');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Consumers reference the canonical paths ──────────────────────────────────

test('dashboard logs/cert endpoints use the canonical user paths', () => {
  const dash = src('dashboard.ts');
  assert.match(dash, /const logDir = USER_LOGS_DIR/, 'dashboard must read logs from USER_LOGS_DIR');
  assert.match(dash, /const certPath = USER_CERT_FILE/, '/api/cert must read USER_CERT_FILE');
  assert.ok(
    !/path\.resolve\(__dirname,\s*'\.\.',\s*'logs'\)/.test(dash),
    'dashboard must not derive a private logs dir from __dirname',
  );
  assert.ok(
    !/path\.resolve\(__dirname,\s*'\.\.',\s*'certs'/.test(dash),
    'dashboard must not derive a private certs dir from __dirname',
  );
});

test('start.ts .trusted marker lives next to the served cert, not in the package dir', () => {
  const startTs = src('cli/commands/start.ts');
  assert.match(
    startTs,
    /const certTrustedMarker = path\.join\(USER_CERTS_DIR, '\.trusted'\)/,
    'the .trusted marker must be user-writable and track the served cert',
  );
  assert.ok(
    !/path\.join\(PROXY_DIR, 'certs', '\.trusted'\)/.test(startTs),
    'the .trusted marker must not live in the (often read-only) package dir',
  );
});

test('start.ts creates the user logs dir that logger.ts writes to', () => {
  const startTs = src('cli/commands/start.ts');
  const loggerTs = src('logger.ts');
  assert.match(startTs, /mkdirSync\(USER_LOGS_DIR/, 'start.ts must create USER_LOGS_DIR');
  assert.match(loggerTs, /const logDir = USER_LOGS_DIR/, 'logger.ts must write to USER_LOGS_DIR');
});

// ── ESM guard ────────────────────────────────────────────────────────────────

test('no bare require() calls in src/**/*.ts (ESM modules have no require)', () => {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const text = fs.readFileSync(full, 'utf-8');
      // Exclude `createRequire(...)` and `_require(...)` (legitimate CJS bridge).
      if (/(?<![\w$.])require\s*\(/.test(text)) offenders.push(path.relative(PROXY_DIR, full));
    }
  };
  walk(path.resolve(PROXY_DIR, 'src'));
  assert.deepEqual(offenders, [], `bare require() found in: ${offenders.join(', ')}`);
});

// ── Hosts parser: exact hostname matching ────────────────────────────────────

const HOST_DOMAINS = new Set(['cloudcode-pa.googleapis.com', 'daily-cloudcode-pa.googleapis.com']);

test('hosts parser: a longer sibling domain does NOT satisfy a shorter entry', () => {
  assert.equal(
    lineMapsAny('127.0.0.1 daily-cloudcode-pa.googleapis.com', new Set(['cloudcode-pa.googleapis.com'])),
    false,
    'daily-cloudcode-pa.googleapis.com must not count as cloudcode-pa.googleapis.com',
  );
  assert.equal(
    lineMapsAny('127.0.0.1 cloudcode-pa.googleapis.com', new Set(['cloudcode-pa.googleapis.com'])),
    true,
    'an exact hostname match must count',
  );
});

test('hosts parser: comments and unrelated lines are untouched by cleanup', () => {
  assert.equal(lineMapsAny('# 127.0.0.1 cloudcode-pa.googleapis.com', HOST_DOMAINS), false);
  assert.equal(lineMapsAny('127.0.0.1 cloudcode-pa.googleapis.com # pinned', HOST_DOMAINS), true,
    'an inline comment after the hostname must not hide the mapping');
  assert.equal(lineMapsAny('127.0.0.1 example.com', HOST_DOMAINS), false);
  assert.equal(lineMapsAny('', HOST_DOMAINS), false);
});

test('hosts parser: hostname fields are extracted after the address', () => {
  assert.deepEqual(parseHostnameFields('127.0.0.1 foo.example bar.example # c'), ['foo.example', 'bar.example']);
  assert.deepEqual(parseHostnameFields('::1 foo.example'), ['foo.example']);
  assert.equal(parseHostnameFields('127.0.0.1'), null);
  assert.equal(parseHostnameFields('   # just a comment'), null);
});

test('cert.ts adds both IPv4 and IPv6 routing entries', () => {
  const certTs = src('cli/utils/cert.ts');
  assert.match(certTs, /'::1 cloudcode-pa\.googleapis\.com'/, 'IPv6 entry required for AAAA-preferring clients');
  assert.match(certTs, /'::1 daily-cloudcode-pa\.googleapis\.com'/);
});

// ── Port cleanup is LISTEN-only ──────────────────────────────────────────────

test('port.ts restricts lsof to listening sockets (never outbound connections)', () => {
  const portTs = src('cli/utils/port.ts');
  assert.match(portTs, /-sTCP:LISTEN/, 'lsof must be filtered with -sTCP:LISTEN');
  assert.match(portTs, /ss -lntp/, 'the ss fallback must be LISTEN-only (-lnt)');
  assert.ok(
    !/execSync\(`lsof -ti tcp:\$\{port\}`/.test(portTs),
    'unfiltered `lsof -ti tcp:PORT` matches outbound TLS clients and must not return',
  );
});

// ── Desktop binary resolver ──────────────────────────────────────────────────

test('desktop resolver rejects this package\u2019s own CLI entry', () => {
  const ownEntry = path.resolve(PROXY_DIR, 'bin', 'cli.js');
  assert.equal(isOwnCliEntry(ownEntry), true, 'the package bin/cli.js is its own CLI');
  assert.equal(isOwnCliEntry('/usr/lib/node_modules/@12errh/antigravity-proxy/bin/cli.js'), true);
  assert.equal(isOwnCliEntry('/usr/bin/antigravity'), false);
});

test('desktop resolver never offers PATH CLI locations (/usr/bin, /usr/local/bin, ~/.local/bin)', () => {
  const banned = new Set([
    '/usr/bin/antigravity',
    '/usr/local/bin/antigravity',
    path.join(os.homedir(), '.local', 'bin', 'antigravity'),
  ]);
  for (const c of antigravityCandidates()) {
    assert.ok(!banned.has(c), `candidate ${c} is this package's own CLI location`);
  }
});

// ── index.ts: DNS + dual-stack ───────────────────────────────────────────────

test('index.ts resolves DNS with a loopback guard and does not exit on failure', () => {
  const indexTs = src('index.ts');
  assert.match(indexTs, /isLoopbackAddress/, 'a loopback answer (our own hosts entry) must be rejected');
  assert.match(indexTs, /dns\.promises\.lookup/, 'system resolver tried before public DNS');
  assert.match(indexTs, /GOOGLE_BACKEND_IP/, 'manual escape hatch must be documented in the log line');
  const dnsBlock = indexTs.match(/DNS resolution failed[\s\S]{0,400}/)?.[0] || '';
  assert.ok(!dnsBlock.includes('process.exit'), 'DNS failure must not exit — the dashboard stays up');
});

test('index.ts binds both servers dual-stack via listenDualStack', () => {
  const indexTs = src('index.ts');
  const calls = indexTs.match(/listenDualStack\(/g) || [];
  assert.ok(calls.length >= 3, `expected listenDualStack definition + 2 call sites, found ${calls.length}`);
  assert.ok(!/restServer\.listen\(config\.apiPort, '0\.0\.0\.0'/.test(indexTs), 'rest server must not be IPv4-only');
  assert.ok(!/tlsServer\.listen\(config\.proxyPort, '0\.0\.0\.0'/.test(indexTs), 'tls server must not be IPv4-only');
  assert.match(indexTs, /server\.listen\(port, '::'\)/, 'dual-stack bind uses :: with ipv6Only=false');
});

// ── start.sh is a thin wrapper ───────────────────────────────────────────────

test('start.sh delegates to the CLI and keeps no duplicated platform logic', () => {
  const sh = fs.readFileSync(path.resolve(REPO_DIR, 'start.sh'), 'utf-8');
  assert.match(sh, /bin\/cli\.js"? start/, 'start.sh must exec the CLI start command');
  assert.ok(!sh.includes('gen-certs.mjs'), 'cert generation belongs to the CLI');
  assert.ok(!/lsof|update-ca-certificates|add-trusted-cert/.test(sh), 'trust/port logic belongs to the CLI');
  assert.ok(!/sudo cp|sudo security/.test(sh), 'trust installation belongs to the CLI');
});
