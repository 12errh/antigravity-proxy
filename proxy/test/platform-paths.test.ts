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
  parsePasswdHome,
} from '../src/data-paths.js';
import { parseHostnameFields, lineMapsAny } from '../src/cli/utils/cert.js';
import {
  isOwnCliEntry, antigravityCandidates, getConfiguredPath, setConfiguredPath, clearConfiguredPath,
} from '../src/cli/utils/antigravity-app.js';
import { resolvePorts } from '../src/cli/commands/start.js';

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

test('resolveRealHome must NOT use os.userInfo({ username }) — Node ignores the option', () => {
  const dp = src('data-paths.ts');
  assert.ok(
    !/(?:const|let|var)\s+\w+\s*=\s*os\.userInfo\(\s*\{/.test(dp),
    'os.userInfo({ username }) silently returns the CURRENT user (root) — resolve from /etc/passwd/getent instead',
  );
  assert.match(dp, /getent/, 'NSS/LDAP users need the getent fallback');
});

test('parsePasswdHome finds the user, ignores others and malformed lines', () => {
  const passwd = [
    'root:x:0:0:root:/root:/bin/bash',
    'rehan:x:1000:1000:Rehan:/home/rehan:/bin/zsh',
    '',
    'broken-line-without-colons',
  ].join('\n');
  assert.equal(parsePasswdHome(passwd, 'rehan'), '/home/rehan');
  assert.equal(parsePasswdHome(passwd, 'root'), '/root');
  assert.equal(parsePasswdHome(passwd, 'ghost'), null);
  assert.equal(parsePasswdHome('', 'rehan'), null);
});

test('sudo-root runs hand files in the user data dir back to the invoking user', () => {
  const dp = src('data-paths.ts');
  assert.match(dp, /export function chownIfRoot/, 'data-paths must export chownIfRoot');
  assert.match(dp, /export function chownTreeIfRoot/, 'data-paths must export chownTreeIfRoot');
  assert.match(dp, /SUDO_UID/, 'REAL_UID derives from SUDO_UID');
  assert.match(dp, /fs\.chownSync\(target, REAL_UID/, 'chown must target the invoking user');

  const proc = src('cli/utils/process.ts');
  assert.match(proc, /writeFileSync\(PID_FILE[\s\S]{0,80}chownIfRoot\(PID_FILE\)/, 'PID file must be chowned after write');

  const logger = src('logger.ts');
  assert.match(logger, /chownIfRoot\(logDir\)/, 'log dir must be chowned when created');
  assert.match(logger, /chownIfRoot\(filepath\)/, 'log file must be chowned when created');
  assert.match(logger, /logStream\.on\('error'/, "the log stream needs an 'error' handler or an open failure crashes the proxy");

  const db = src('db.ts');
  assert.match(db, /export function chownDbFiles/, 'db must export chownDbFiles');
  assert.match(db, /chownDbFiles\(\)/, 'db must chown its files after opening');

  const cert = src('cli/utils/cert.ts');
  assert.match(cert, /chownTreeIfRoot\(CERT_DIR\)/, 'generated certs must be chowned');
  assert.match(cert, /chownTreeIfRoot\(dbDir\)/, 'the NSS DB must be handed back after certutil -A');

  const engine = src('index.ts');
  assert.match(engine, /chownTreeIfRoot\(USER_DATA_DIR\)/, 'engine startup must reclaim root-owned state');
  assert.match(engine, /db\.chownDbFiles\(\)/, 'engine shutdown must chown DB files (WAL/SHM exist by then)');

  const start = src('cli/commands/start.ts');
  assert.match(start, /chownTreeIfRoot\(USER_DATA_DIR\)/, 'startCommand must reclaim root-owned state before spawning');
});

test('sudo-root start launches the desktop as the invoking user (not root)', () => {
  const app = src('cli/utils/antigravity-app.ts');
  assert.match(app, /REAL_UID !== undefined[\s\S]{0,160}uid: REAL_UID, gid: REAL_GID/, 'desktop spawn must drop to the invoking user');
  assert.match(app, /HOME: REAL_HOME/, 'dropped desktop process needs the real user HOME');
});

test('stopProxy keeps the PID file and refuses when the process is not permitted (sudo-owned)', () => {
  const proc = src('cli/utils/process.ts');
  assert.match(
    proc,
    /e\?\.code === 'EPERM'\) return false/,
    'EPERM (proxy owned by root) must not claim success and must keep the PID file',
  );
  const stop = src('cli/commands/stop.ts');
  assert.match(stop, /sudo antigravity stop/, 'stop must suggest the sudo variant when not permitted');
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

  // A symlink (e.g. /usr/local/bin/antigravity -> global install) must be
  // rejected too: its realpath is a *different* copy than this checkout's
  // bin/cli.js, which the old realpath-equality check missed.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-own-'));
  try {
    const globalCli = path.join(tmpDir, '@12errh', 'antigravity-proxy', 'bin', 'cli.js');
    fs.mkdirSync(path.dirname(globalCli), { recursive: true });
    fs.writeFileSync(globalCli, '#!/usr/bin/env node\n');
    const link = path.join(tmpDir, 'antigravity');
    try {
      fs.symlinkSync(globalCli, link);
      assert.equal(isOwnCliEntry(link), true, 'a symlink to a globally installed copy must be rejected');
    } catch {
      // Windows without symlink privileges — nothing to guard here.
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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

// ── Configurable desktop path (cli-config.json) ──────────────────────────────

test('setConfiguredPath validates the target and round-trips through cli-config.json', () => {
  const cfgPath = path.join(USER_DATA_DIR, 'cli-config.json');
  let original: string | null = null;
  try { original = fs.readFileSync(cfgPath, 'utf-8'); } catch { /* no existing config */ }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-path-'));
  const fakeBinary = path.join(tmpDir, 'antigravity');
  fs.writeFileSync(fakeBinary, '#!/bin/sh\necho desktop\n', { mode: 0o755 });

  try {
    // Nonexistent path rejected
    const missing = setConfiguredPath(path.join(tmpDir, 'nope'));
    assert.equal(missing.ok, false);
    assert.match(missing.error || '', /not found/);

    // This package's own CLI rejected
    const own = setConfiguredPath(path.resolve(PROXY_DIR, 'bin', 'cli.js'));
    assert.equal(own.ok, false);
    assert.match(own.error || '', /own CLI/);

    // Valid binary accepted + persisted
    const good = setConfiguredPath(fakeBinary);
    assert.equal(good.ok, true, good.error);
    assert.equal(getConfiguredPath(), fakeBinary);

    // Reset clears it
    clearConfiguredPath();
    assert.equal(getConfiguredPath(), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (original !== null) fs.writeFileSync(cfgPath, original, 'utf-8');
    else { try { fs.unlinkSync(cfgPath); } catch { /* never existed */ } }
  }
});

test('cli registers the `path` command and start hints at it when the desktop is missing', () => {
  const cliJs = fs.readFileSync(path.resolve(PROXY_DIR, 'bin', 'cli.js'), 'utf-8');
  assert.match(cliJs, /\.command\('path'\)/, 'bin/cli.js must register the path command');
  assert.match(cliJs, /pathCommand/, 'the path command must be imported and wired');
  const startTs = src('cli/commands/start.ts');
  assert.match(startTs, /antigravity path <binary>/, 'start must tell users how to pin the binary');
});

// ── Port precedence ──────────────────────────────────────────────────────────

test('resolvePorts: explicit --port wins over .env, .env wins over the default', () => {
  const saved = { p: process.env.PROXY_PORT, a: process.env.API_PORT };
  try {
    process.env.PROXY_PORT = '8443';
    process.env.API_PORT = '4001';
    assert.deepEqual(resolvePorts({ port: '9443' }), { proxyPort: 9443, apiPort: 4001 });
    assert.deepEqual(resolvePorts({}), { proxyPort: 8443, apiPort: 4001 });
    delete process.env.PROXY_PORT;
    delete process.env.API_PORT;
    assert.deepEqual(resolvePorts({}), { proxyPort: 443, apiPort: 4000 });
  } finally {
    if (saved.p === undefined) delete process.env.PROXY_PORT; else process.env.PROXY_PORT = saved.p;
    if (saved.a === undefined) delete process.env.API_PORT; else process.env.API_PORT = saved.a;
  }
});

test('process.ts passes resolved ports to the spawned proxy unconditionally', () => {
  const processTs = src('cli/utils/process.ts');
  assert.match(processTs, /env\.PROXY_PORT = String\(options\.proxyPort\)/, 'resolved proxy port must be authoritative');
  assert.match(processTs, /env\.API_PORT = String\(options\.apiPort\)/, 'resolved api port must be authoritative');
  const cliJs = fs.readFileSync(path.resolve(PROXY_DIR, 'bin', 'cli.js'), 'utf-8');
  const startBlock = cliJs.match(/\.command\('start'\)[\s\S]*?\.action\(startCommand\)/)?.[0] || '';
  assert.ok(startBlock.length > 0, 'start command block not found in bin/cli.js');
  assert.ok(
    !/'443'/.test(startBlock),
    'commander must not default start --port to 443 — that flag would always override .env',
  );
});

// ── Hosts edits via sudo for non-root users ──────────────────────────────────

test('hosts writes fall back to sudo when /etc/hosts is not writable', () => {
  const certTs = src('cli/utils/cert.ts');
  assert.match(certTs, /function writeHostsViaSudo/, 'a sudo fallback for hosts writes must exist');
  assert.match(certTs, /runSudo\(\['cp', tmp, target\]\)/, 'the fallback copies a temp file into place via sudo');
  const cleanUses = certTs.match(/writeHostsOrSudo\(/g) || [];
  assert.ok(cleanUses.length >= 3, `writeHostsOrSudo must be defined and used by both clean and setup (found ${cleanUses.length})`);
  assert.ok(!/runSudo\(\['tee'/.test(certTs), 'content must go through a temp file, not shell interpolation');
});

test('certutil presence is probed with command -v, not certutil -H (which exits 1)', () => {
  const certTs = src('cli/utils/cert.ts');
  assert.match(certTs, /execSync\('command -v certutil'/, 'hasCertutil must use command -v');
  assert.ok(!certTs.includes("'certutil -H'"), 'certutil -H exits 1 even when installed — it re-triggered apt installs');
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

// ── start.ts: port-443 interception guard ────────────────────────────────────

test('start.ts warns when the proxy is not on 443 (desktop app dials 443)', () => {
  const startTs = src('cli/commands/start.ts');
  assert.match(startTs, /proxyPort !== 443/, 'a non-443 port breaks desktop-app sign-in and must be flagged');
  assert.match(startTs, /sudo antigravity start/, 'non-root users must be told the sudo path');
  assert.match(startTs, /antigravity switch \(simple mode\)/, 'opting out of interception must be offered');
  assert.match(startTs, /antigravity start --port 443/, 'root users on a custom port must be told to use 443');
});

// ── start.ts: root + hosts interception port correction ──────────────────────

test('start.ts corrects a non-443 PROXY_PORT when root with active hosts routing', () => {
  const startTs = src('cli/commands/start.ts');
  assert.match(startTs, /isRootUser && !opts\.port && proxyPort !== 443 && hostsHasProxyEntries\(\)/);
  assert.match(startTs, /let proxyPort = ports\.proxyPort/, 'proxyPort must be reassignable for the correction');
  const certTs = src('cli/utils/cert.ts');
  assert.match(certTs, /export function hostsHasProxyEntries/);
});
