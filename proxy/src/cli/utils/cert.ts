import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync, execFileSync } from 'child_process';
import os, { platform } from 'os';
import { PROXY_DIR } from './paths.js';
import { USER_CERTS_DIR, USER_CERT_FILE, USER_KEY_FILE, REAL_HOME, chownIfRoot, chownTreeIfRoot } from '../../data-paths.js';

const CERT_DIR = USER_CERTS_DIR;
const CERT_FILE = USER_CERT_FILE;

/**
 * Marker written after a successful trustCert(); lives next to the cert it
 * describes (user-writable), not in the package dir which is often read-only
 * for global installs. Only a hint — the source of truth is isCertTrusted().
 */
export const CERT_TRUST_MARKER = path.join(USER_CERTS_DIR, '.trusted');
const KEY_FILE = USER_KEY_FILE;

/** Nickname used when the cert is added to the NSS user database. */
const NSS_NICKNAME = 'Antigravity Proxy';

/** Path of the cert when installed into the system CA store (Linux). */
const LINUX_SYSTEM_CERT = '/usr/local/share/ca-certificates/antigravity-proxy.crt';

export function certExists(): boolean {
  return fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);
}

export function generateCerts(): void {
  const scriptPath = path.resolve(PROXY_DIR, 'scripts', 'gen-certs.mjs');
  if (!fs.existsSync(scriptPath)) {
    throw new Error('Certificate generation script not found');
  }
  // Pass the runtime cert directory so generated certs land where the proxy reads them.
  execFileSync(process.execPath, [scriptPath, CERT_DIR], { stdio: 'inherit', timeout: 30000 });
  // If generation ran under sudo, the files must belong to the invoking user —
  // the desktop app and later non-root runs read them from ~/.antigravity.
  chownTreeIfRoot(CERT_DIR);
}

/** Read the local cert as PEM and return its DER bytes, or null. */
function readCertDer(): Buffer | null {
  try {
    const pem = fs.readFileSync(CERT_FILE, 'utf-8');
    const b64 = pem.split('\n').filter(l => !l.startsWith('-----') && l.trim()).join('');
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
}

/** SHA-256 fingerprint of the local cert (colon-separated uppercase hex). */
function localCertFingerprintSha256(): string | null {
  const der = readCertDer();
  if (!der) return null;
  return crypto.createHash('sha256').update(der).digest('hex').toUpperCase().match(/../g)!.join(':');
}

/** SHA-1 thumbprint of the local cert (bare uppercase hex, Windows format). */
function localCertThumbprintSha1(): string | null {
  const der = readCertDer();
  if (!der) return null;
  return crypto.createHash('sha1').update(der).digest('hex').toUpperCase();
}

/** True when we can prompt the user interactively (vs. a detached daemon). */
function canPrompt(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** True when sudo exists and can run without an interactive password prompt. */
function hasPasswordlessSudo(): boolean {
  try {
    execSync('sudo -n true', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a command under sudo, but only when it cannot hang waiting for a password.
 * Returns true on success. When sudo would need a password and we are not on a
 * TTY, returns false so the caller can print the manual command instead.
 */
function runSudo(args: string[], opts: { timeout?: number } = {}): boolean {
  const timeout = opts.timeout ?? 30000;
  try {
    if (hasPasswordlessSudo()) {
      execFileSync('sudo', ['-n', ...args], { stdio: 'ignore', timeout });
      return true;
    }
    if (!canPrompt()) return false;
    execFileSync('sudo', args, { stdio: 'inherit', timeout });
    return true;
  } catch {
    return false;
  }
}

export function isAdmin(): boolean {
  const p = platform();
  if (p === 'win32') {
    try {
      execSync('net session', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
  return process.getuid?.() === 0;
}

// ── NSS (Chromium / Electron) user database ──────────────────────────────────

/**
 * Electron and Chromium on Linux validate TLS against NSS databases, not the
 * OpenSSL ca-certificates bundle. Unless the proxy cert is added to the user's
 * NSS DB, the Antigravity desktop app rejects the intercepted connection.
 */
function nssDbDir(): string {
  return path.join(REAL_HOME, '.pki', 'nssdb');
}

function hasCertutil(): boolean {
  try {
    // `certutil -H` exits 1 (usage-as-error), so it must NOT be used as a
    // presence check — that made every trust run reinstall libnss3-tools.
    execSync('command -v certutil', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install libnss3-tools (which provides `certutil`) via the system package
 * manager. Only attempted when a supported manager and sudo are available.
 */
function ensureCertutil(): boolean {
  if (hasCertutil()) return true;

  const managers: Array<{ bin: string; args: string[] }> = [
    { bin: 'apt-get', args: ['install', '-y', 'libnss3-tools'] },
    { bin: 'dnf', args: ['install', '-y', 'nss-tools'] },
    { bin: 'yum', args: ['install', '-y', 'nss-tools'] },
    { bin: 'pacman', args: ['-S', '--noconfirm', 'nss'] },
    { bin: 'zypper', args: ['install', '-y', 'mozilla-nss-tools'] },
  ];

  for (const m of managers) {
    let present = false;
    try {
      execSync(`command -v ${m.bin}`, { stdio: 'ignore', timeout: 5000 });
      present = true;
    } catch {
      present = false;
    }
    if (!present) continue;
    // apt needs an index refresh before install on a cold container/VM.
    if (m.bin === 'apt-get') runSudo(['apt-get', 'update'], { timeout: 120000 });
    if (runSudo([m.bin, ...m.args], { timeout: 180000 })) {
      return hasCertutil();
    }
  }
  return false;
}

function isCertInNssDb(): boolean {
  if (!hasCertutil()) return false;
  try {
    const out = execSync(`certutil -d sql:"${nssDbDir()}" -L`, {
      encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.split('\n').some(l => l.trim().startsWith(NSS_NICKNAME));
  } catch {
    return false;
  }
}

function trustCertNss(): { ok: boolean; detail: string } {
  const dbDir = nssDbDir();
  try {
    fs.mkdirSync(dbDir, { recursive: true });
    chownIfRoot(dbDir);
    const hasDb = fs.existsSync(path.join(dbDir, 'cert9.db'));
    if (!hasDb) {
      execFileSync('certutil', ['-N', '--empty-password', '-d', `sql:${dbDir}`], { stdio: 'ignore', timeout: 15000 });
    }
    // Remove any prior entry with our nickname so re-trust replaces it.
    try {
      execFileSync('certutil', ['-d', `sql:${dbDir}`, '-D', '-n', NSS_NICKNAME], { stdio: 'ignore', timeout: 10000 });
    } catch { /* not present */ }
    execFileSync('certutil', ['-d', `sql:${dbDir}`, '-A', '-t', 'C,,', '-n', NSS_NICKNAME, '-i', CERT_FILE], {
      stdio: 'ignore', timeout: 15000,
    });
    // certutil ran as root when invoked via sudo — hand the NSS DB back to the
    // user, otherwise their browser/Electron profile can no longer update it.
    chownTreeIfRoot(dbDir);
    return { ok: true, detail: dbDir };
  } catch (e: any) {
    return { ok: false, detail: e?.message || 'certutil failed' };
  }
}

function untrustCertNss(): void {
  if (!hasCertutil()) return;
  try {
    execFileSync('certutil', ['-d', `sql:${nssDbDir()}`, '-D', '-n', NSS_NICKNAME], { stdio: 'ignore', timeout: 10000 });
  } catch { /* not present */ }
}

function isCertInNssSystemDb(): boolean {
  if (!hasCertutil()) return false;
  try {
    const out = execSync('certutil -d sql:/etc/pki/nssdb -L', {
      encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.split('\n').some(l => l.trim().startsWith(NSS_NICKNAME));
  } catch {
    return false;
  }
}

// ── System trust store ───────────────────────────────────────────────────────

/** Which system CA mechanism this distro provides, if any. */
type LinuxTrustTool = 'update-ca-certificates' | 'update-ca-trust' | 'trust-anchor' | 'none';

function detectLinuxTrustTool(): LinuxTrustTool {
  const has = (bin: string) => {
    try { execSync(`command -v ${bin}`, { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; }
  };
  if (has('update-ca-certificates')) return 'update-ca-certificates';
  if (has('update-ca-trust')) return 'update-ca-trust';
  if (has('trust')) return 'trust-anchor';
  return 'none';
}

function linuxTrustManualHint(): string[] {
  const tool = detectLinuxTrustTool();
  if (tool === 'update-ca-certificates') {
    return [
      `  sudo cp "${CERT_FILE}" ${LINUX_SYSTEM_CERT}`,
      '  sudo update-ca-certificates',
    ];
  }
  if (tool === 'update-ca-trust') {
    return [
      `  sudo cp "${CERT_FILE}" /etc/pki/ca-trust/source/anchors/antigravity-proxy.crt`,
      '  sudo update-ca-trust',
    ];
  }
  return [`  sudo trust anchor --store "${CERT_FILE}"`];
}

function isCertInLinuxSystemStore(): boolean {
  const tool = detectLinuxTrustTool();
  const want = localCertFingerprintSha256();
  if (!want) return false;

  const candidates: string[] = [];
  if (tool === 'update-ca-certificates') candidates.push(LINUX_SYSTEM_CERT);
  if (tool === 'update-ca-trust') candidates.push('/etc/pki/ca-trust/source/anchors/antigravity-proxy.crt');
  for (const c of candidates) {
    try {
      const pem = fs.readFileSync(c, 'utf-8');
      const der = Buffer.from(pem.split('\n').filter(l => !l.startsWith('-----') && l.trim()).join(''), 'base64');
      const fp = crypto.createHash('sha256').update(der).digest('hex').toUpperCase().match(/../g)!.join(':');
      if (fp === want) return true;
    } catch { /* try next */ }
  }
  return false;
}

function trustCertLinuxSystem(): boolean {
  const tool = detectLinuxTrustTool();
  if (tool === 'update-ca-certificates') {
    const dir = path.dirname(LINUX_SYSTEM_CERT);
    if (!fs.existsSync(dir)) return false;
    return runSudo(['cp', CERT_FILE, LINUX_SYSTEM_CERT]) && runSudo(['update-ca-certificates']);
  }
  if (tool === 'update-ca-trust') {
    const anchorDir = '/etc/pki/ca-trust/source/anchors';
    return runSudo(['cp', CERT_FILE, path.join(anchorDir, 'antigravity-proxy.crt')]) && runSudo(['update-ca-trust']);
  }
  if (tool === 'trust-anchor') {
    return runSudo(['trust', 'anchor', '--store', CERT_FILE]);
  }
  return false;
}

// ── Public trust API ─────────────────────────────────────────────────────────

export function isCertTrusted(): boolean {
  if (!certExists()) return false;
  const p = platform();

  if (p === 'win32') {
    const sha1 = localCertThumbprintSha1();
    if (!sha1) return false;
    try {
      const out = execSync(
        `powershell -NoProfile -Command "Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Thumbprint -eq '${sha1}' } | Measure-Object | Select-Object -ExpandProperty Count"`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      return out.trim() !== '0';
    } catch {
      return false;
    }
  }

  if (p === 'darwin') {
    const want = localCertFingerprintSha256();
    if (!want) return false;
    try {
      const out = execSync('security find-certificate -a -c localhost -Z /Library/Keychains/System.keychain', {
        encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      // `-Z` prints "SHA-256 hash: <hex>" lines; compare on hex with colons stripped.
      const wantHex = want.replace(/:/g, '');
      return out.split('\n').some(l => l.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() === wantHex);
    } catch {
      return false;
    }
  }

  // Linux: trusted only when BOTH the NSS user DB (what Electron reads) and the
  // system store hold the cert.
  if (isCertInNssDb() && isCertInLinuxSystemStore()) return true;
  if (isCertInNssSystemDb() && isCertInLinuxSystemStore()) return true;
  return false;
}

export function trustCert(): void {
  if (!certExists()) {
    throw new Error('No certificate to trust. Run `antigravity certs generate` first.');
  }

  if (isCertTrusted()) return;

  const p = platform();

  if (p === 'win32') {
    try {
      execSync(
        `powershell -NoProfile -Command "Import-Certificate -FilePath '${CERT_FILE}' -CertStoreLocation Cert:\\LocalMachine\\Root"`,
        { stdio: 'pipe', timeout: 15000 },
      );
      return;
    } catch {
      try {
        execSync(`certutil -addstore -f Root "${CERT_FILE}"`, { stdio: 'pipe', timeout: 15000 });
        return;
      } catch {
        try {
          execSync(
            `powershell -NoProfile -Command "Start-Process certutil -ArgumentList '-addstore','-f','Root','${CERT_FILE}' -Verb RunAs -Wait"`,
            { stdio: 'inherit', timeout: 30000 },
          );
          return;
        } catch {
          throw new Error('Failed to add certificate to Windows trust store. Run as Administrator.');
        }
      }
    }
  }

  if (p === 'darwin') {
    try {
      execSync(`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${CERT_FILE}"`, {
        stdio: 'inherit', timeout: 30000,
      });
    } catch {
      throw new Error('Failed to add certificate to macOS keychain. Run with sudo.');
    }
    return;
  }

  // Linux — trust in both stores and report precisely what happened.
  const notes: string[] = [];

  if (!hasCertutil()) {
    if (ensureCertutil()) {
      notes.push('Installed libnss3-tools (certutil)');
    } else {
      notes.push('certutil not available — Antigravity (Electron) may still reject the certificate');
    }
  }
  if (hasCertutil()) {
    const nss = trustCertNss();
    notes.push(nss.ok ? `NSS user DB: ${nss.detail}` : `NSS user DB failed: ${nss.detail}`);
  }

  if (trustCertLinuxSystem()) {
    notes.push('System CA store updated');
  } else {
    notes.push('System CA store could not be updated (needs sudo)');
  }

  if (!isCertTrusted()) {
    throw new Error(
      [
        'Certificate could not be fully trusted.',
        ...notes.map(n => `  - ${n}`),
        'To trust manually, run:',
        `  certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "${NSS_NICKNAME}" -i "${CERT_FILE}"`,
        ...linuxTrustManualHint(),
      ].join('\n'),
    );
  }

  for (const n of notes) console.log(`  ${n}`);
}

export function untrustCert(): void {
  const p = platform();
  if (certExists()) {
    if (p === 'win32') {
      const sha1 = localCertThumbprintSha1();
      if (sha1) {
        try {
          execSync(
            `powershell -NoProfile -Command "Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Thumbprint -eq '${sha1}' } | Remove-Item"`,
            { stdio: 'pipe', timeout: 15000 },
          );
        } catch { /* may not be trusted */ }
      }
    } else if (p === 'darwin') {
      try {
        execSync('sudo security delete-certificate -c "localhost" -t /Library/Keychains/System.keychain', {
          stdio: 'inherit', timeout: 15000,
        });
      } catch { /* may not be in keychain */ }
    } else {
      untrustCertNss();
      const tool = detectLinuxTrustTool();
      if (tool === 'update-ca-certificates') {
        runSudo(['rm', '-f', LINUX_SYSTEM_CERT]) && runSudo(['update-ca-certificates']);
      } else if (tool === 'update-ca-trust') {
        runSudo(['rm', '-f', '/etc/pki/ca-trust/source/anchors/antigravity-proxy.crt']) && runSudo(['update-ca-trust']);
      } else if (tool === 'trust-anchor') {
        runSudo(['trust', 'anchor', '--remove', '--store', CERT_FILE]);
      }
    }
  }

  // Always clean up hosts file entries that route traffic to the proxy
  cleanHostsFile();
  // The marker only records that a trust *succeeded*; once we untrust, a later
  // `start` must re-trust instead of believing the stale marker (the proxy's
  // certificate would otherwise be rejected with "unknown authority").
  try { fs.rmSync(CERT_TRUST_MARKER, { force: true }); } catch { /* best-effort */ }
}

export interface CertInfo {
  exists: boolean;
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  fingerprint?: string;
  daysRemaining?: number;
}

export function getCertInfo(): CertInfo {
  if (!certExists()) return { exists: false };

  try {
    const fp = localCertFingerprintSha256();

    // Prefer Node's built-in X509 parser so this works without openssl (e.g. Windows).
    try {
      const pem = fs.readFileSync(CERT_FILE, 'utf-8');
      const cert = new crypto.X509Certificate(pem);
      const validTo = new Date(cert.validTo);
      return {
        exists: true,
        subject: cert.subject.replace(/\n/g, ', '),
        issuer: cert.issuer.replace(/\n/g, ', '),
        validFrom: cert.validFrom,
        validTo: cert.validTo,
        fingerprint: fp ? `SHA256 ${fp}` : undefined,
        daysRemaining: Math.floor((validTo.getTime() - Date.now()) / 86400000),
      };
    } catch {
      return { exists: true, fingerprint: fp ? `SHA256 ${fp}` : undefined };
    }
  } catch {
    return { exists: true };
  }
}

// ── Hosts file ───────────────────────────────────────────────────────────────

const PROXY_HOSTS_ENTRIES = [
  '127.0.0.1 cloudcode-pa.googleapis.com',
  '127.0.0.1 daily-cloudcode-pa.googleapis.com',
  '::1 cloudcode-pa.googleapis.com',
  '::1 daily-cloudcode-pa.googleapis.com',
  '127.0.0.1 runtime.us-east-1.kiro.dev',
  '127.0.0.1 kiro.dev',
  '127.0.0.1 app.kiro.dev',
];

const HOSTS_MARKER = '# Antigravity Proxy';

export interface HostsCleanResult {
  found: boolean;
  cleaned: boolean;
  error?: string;
}

function hostsPath(): string {
  return platform() === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
    : '/etc/hosts';
}

/**
 * Parse a hosts line into its hostname fields.
 * Returns null for blank lines, comments and lines with no hostname.
 * Exported for regression tests.
 */
export function parseHostnameFields(line: string): string[] | null {
  const withoutComment = line.split('#')[0];
  const trimmed = withoutComment.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return null;
  return parts.slice(1); // drop the address, keep hostnames
}

/**
 * True when the line maps one of `names` (exact hostname match, not substring).
 * Exported for regression tests.
 */
export function lineMapsAny(line: string, names: Set<string>): boolean {
  const fields = parseHostnameFields(line);
  if (!fields) return false;
  return fields.some(f => names.has(f.toLowerCase()));
}

/**
 * True when the hosts file currently routes the proxy hostnames to localhost.
 * Used by `start` to detect an active interception setup.
 */
export function hostsHasProxyEntries(): boolean {
  try {
    const content = fs.readFileSync(hostsPath(), 'utf-8');
    const names = new Set(PROXY_HOSTS_ENTRIES.map(e => e.trim().split(/\s+/).pop()!.toLowerCase()));
    return content.split('\n').some(line => lineMapsAny(line, names));
  } catch {
    return false;
  }
}

/** Write hosts content atomically (temp + rename), backing up the original once. */
function writeHosts(content: string): void {
  const target = hostsPath();
  const tmp = `${target}.antigravity.tmp`;
  const backup = `${target}.antigravity.bak`;

  let mode: number | undefined;
  try { mode = fs.statSync(target).mode & 0o777; } catch { /* new file */ }

  if (!fs.existsSync(backup)) {
    try { fs.copyFileSync(target, backup); } catch { /* best-effort */ }
  }

  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf-8', mode });
    fs.renameSync(tmp, target);
  } catch {
    // Some systems (Docker bind mounts, hardened /etc) cannot rename over the
    // hosts file. Fall back to an in-place write — still backed up above.
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    fs.writeFileSync(target, content, { encoding: 'utf-8', mode });
  }
}

/**
 * Fallback for non-root users: write the content to a temp file and copy it
 * into place with sudo (which prompts for a password on a TTY, or uses a
 * cached credential). Returns true when the copy succeeded.
 */
function writeHostsViaSudo(content: string): boolean {
  if (platform() === 'win32' || isAdmin()) return false;

  const target = hostsPath();
  const tmp = path.join(os.tmpdir(), `antigravity-hosts-${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, content, 'utf-8');

    let mode: number | undefined;
    try { mode = fs.statSync(target).mode & 0o777; } catch { /* default */ }

    const backup = `${target}.antigravity.bak`;
    if (!fs.existsSync(backup)) {
      runSudo(['cp', target, backup]); // best-effort
    }
    if (!runSudo(['cp', tmp, target])) return false;
    if (mode !== undefined) runSudo(['chmod', mode.toString(8), target]); // best-effort
    return true;
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  }
}

/** Direct write when possible, sudo copy otherwise. */
function writeHostsOrSudo(content: string): boolean {
  try {
    writeHosts(content);
    return true;
  } catch {
    return writeHostsViaSudo(content);
  }
}

export function cleanHostsFile(): HostsCleanResult {
  const target = hostsPath();
  const domains = new Set(
    PROXY_HOSTS_ENTRIES.map(e => e.trim().split(/\s+/).pop()!.toLowerCase()),
  );

  try {
    let content = fs.readFileSync(target, 'utf-8');
    const lines = content.split('\n');
    const kept = lines.filter(line => !lineMapsAny(line, domains));
    const found = kept.length !== lines.length;

    if (!found) return { found: false, cleaned: false };

    content = kept.join('\n').replace(/\n{3,}/g, '\n\n');
    if (writeHostsOrSudo(content)) return { found: true, cleaned: true };
    return { found: true, cleaned: false, error: hostsPermissionError() };
  } catch {
    return { found: true, cleaned: false, error: hostsPermissionError() };
  }
}

function hostsPermissionError(): string {
  if (platform() === 'win32') return 'Could not modify hosts file. Run as Administrator.';
  return `Could not modify hosts file. Run: sudo sed -i "/Antigravity Proxy/d" ${hostsPath()}`;
}

export function setupHostsFile(): HostsCleanResult {
  const target = hostsPath();

  try {
    const content = fs.readFileSync(target, 'utf-8');

    // Exact hostname matching: "daily-cloudcode-pa.googleapis.com" must NOT be
    // treated as satisfying the plain "cloudcode-pa.googleapis.com" entry.
    const entriesToAdd = PROXY_HOSTS_ENTRIES.filter(entry => {
      const [addr, ...names] = entry.trim().split(/\s+/);
      const wanted = new Set(names.map(n => n.toLowerCase()));
      return !content.split('\n').some(line => {
        const fields = parseHostnameFields(line);
        if (!fields) return false;
        const hasName = fields.some(f => wanted.has(f.toLowerCase()));
        if (!hasName) return false;
        // Same address required too, so a 127.0.0.1 entry is not considered
        // present when only an ::1 entry exists (and vice versa).
        const lineAddr = line.split('#')[0].trim().split(/\s+/)[0];
        return lineAddr === addr;
      });
    });

    if (entriesToAdd.length === 0) {
      // Nothing was added — report "not found" so callers print the
      // "already configured" message instead of claiming they added entries.
      return { found: false, cleaned: false };
    }

    let out = content;
    if (!out.includes(HOSTS_MARKER)) {
      out = out.trimEnd() + '\n\n' + HOSTS_MARKER + '\n';
    }
    out = out.trimEnd() + '\n' + entriesToAdd.join('\n') + '\n';

    if (writeHostsOrSudo(out)) return { found: true, cleaned: true };
    return { found: true, cleaned: false, error: hostsPermissionError() };
  } catch {
    return { found: true, cleaned: false, error: hostsPermissionError() };
  }
}
