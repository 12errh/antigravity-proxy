import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Extract a user's home directory from passwd-format content.
 * Returns null when the user has no entry. Exported for regression tests.
 */
export function parsePasswdHome(passwdContent: string, user: string): string | null {
  for (const line of passwdContent.split('\n')) {
    const fields = line.split(':');
    if (fields[0] === user && fields[5]) return fields[5];
  }
  return null;
}

/**
 * Resolve the home directory of the real (invoking) user.
 *
 * `sudo` resets HOME to /root, so a root-run proxy would keep its certs, config,
 * DB and logs in /root/.antigravity while the desktop app (running as the normal
 * user) looks in ~/.antigravity. That splits state across two homes and the app
 * never finds the cert. When we detect we were invoked via sudo, resolve the
 * invoking user's home from the passwd database instead.
 */
function resolveRealHome(): string {
  const sudoUser = process.env.SUDO_USER;
  if (process.getuid?.() === 0 && sudoUser && sudoUser !== 'root') {
    // NOTE: do NOT use os.userInfo({ username }) here. Node's userInfo ignores
    // unknown options and silently returns the *current* user (root), which
    // sent all state to /root. Resolve from the passwd database instead.
    try {
      const home = parsePasswdHome(fs.readFileSync('/etc/passwd', 'utf-8'), sudoUser);
      if (home) return home;
    } catch {
      // Fall through to the getent lookup below
    }
    // NSS/LDAP/SSSD-backed users are not listed in /etc/passwd — ask getent.
    try {
      const out = execFileSync('getent', ['passwd', sudoUser], { encoding: 'utf-8', timeout: 5000 });
      const home = out.trim().split(':')[5];
      if (home) return home;
    } catch {
      // Fall through to os.homedir()
    }
  }
  return os.homedir();
}

export const REAL_HOME = resolveRealHome();

/**
 * UID/GID of the invoking user when running under sudo, else undefined.
 * Used to hand root-created files back to the real user.
 */
export const REAL_UID: number | undefined = (() => {
  if (process.getuid?.() !== 0) return undefined;
  const uid = parseInt(process.env.SUDO_UID ?? '', 10);
  return Number.isInteger(uid) && uid > 0 ? uid : undefined;
})();

export const REAL_GID: number | undefined = (() => {
  if (REAL_UID === undefined) return undefined;
  const gid = parseInt(process.env.SUDO_GID ?? '', 10);
  return Number.isInteger(gid) && gid > 0 ? gid : undefined;
})();

/**
 * Hand a file/dir created by a sudo-root run back to the invoking user.
 * Without this, root-owned files in ~/.antigravity (logs, PID file, SQLite
 * DB) break every later non-root run. Best-effort, no-op when not root.
 */
export function chownIfRoot(target: string): void {
  if (REAL_UID === undefined) return;
  try { fs.chownSync(target, REAL_UID, REAL_GID ?? -1); } catch { /* best-effort */ }
}

/** Recursively hand a directory tree back to the invoking user. */
export function chownTreeIfRoot(dir: string): void {
  if (REAL_UID === undefined) return;
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* missing/unreadable */ }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) chownTreeIfRoot(p);
    else chownIfRoot(p);
  }
  chownIfRoot(dir);
}
export const USER_DATA_DIR = path.join(REAL_HOME, '.antigravity');
export const USER_DB_DIR = path.join(USER_DATA_DIR, 'data');
export const USER_DB_PATH = path.join(USER_DB_DIR, 'proxy.db');
export const USER_CERTS_DIR = path.join(USER_DATA_DIR, 'certs');
export const USER_CERT_FILE = path.join(USER_CERTS_DIR, 'cert.pem');
export const USER_KEY_FILE = path.join(USER_CERTS_DIR, 'key.pem');
export const USER_LOGS_DIR = path.join(USER_DATA_DIR, 'logs');
export const USER_ENV_PATH = path.join(USER_DATA_DIR, '.env');

const OLD_DATA_DIR = path.resolve(__dirname, '..', 'data');
const OLD_CERTS_DIR = path.resolve(__dirname, '..', 'certs');
const OLD_LOGS_DIR = path.resolve(__dirname, '..', 'logs');
const MIGRATION_MARKER = path.join(USER_DATA_DIR, '.data-migrated');

/**
 * Copy a file only when the destination does not already exist.
 * Returns true when a copy happened.
 */
export function copyFileIfMissing(src: string, dest: string): boolean {
  try {
    if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    chownIfRoot(path.dirname(dest));
    chownIfRoot(dest);
    return true;
  } catch {
    return false;
  }
}

/** Copy every regular file from `srcDir` into `destDir` when not already present. */
function copyDirIfMissing(srcDir: string, destDir: string): boolean {
  if (!fs.existsSync(srcDir)) return false;
  let copied = false;
  fs.mkdirSync(destDir, { recursive: true });
  chownIfRoot(destDir);
  for (const f of fs.readdirSync(srcDir)) {
    if (copyFileIfMissing(path.join(srcDir, f), path.join(destDir, f))) copied = true;
  }
  return copied;
}

export function migrateUserData(): void {
  let migrated = false;

  // Certs are migrated per-file on every startup, not gated behind the one-shot
  // marker: gen-certs writes into proxy/certs/, and a stale or empty
  // ~/.antigravity/certs used to suppress the copy forever, leaving the TLS
  // server unable to start. Per-file copying makes that state self-heal.
  migrated = copyDirIfMissing(OLD_CERTS_DIR, USER_CERTS_DIR) || migrated;

  if (fs.existsSync(MIGRATION_MARKER)) return;

  if (!fs.existsSync(USER_DB_DIR) && fs.existsSync(OLD_DATA_DIR)) {
    migrated = copyDirIfMissing(OLD_DATA_DIR, USER_DB_DIR) || migrated;
  }

  if (!fs.existsSync(USER_LOGS_DIR) && fs.existsSync(OLD_LOGS_DIR)) {
    migrated = copyDirIfMissing(OLD_LOGS_DIR, USER_LOGS_DIR) || migrated;
  }

  if (migrated || fs.existsSync(USER_DATA_DIR)) {
    try {
      fs.writeFileSync(MIGRATION_MARKER, new Date().toISOString(), 'utf-8');
      chownIfRoot(MIGRATION_MARKER);
    } catch { /* best-effort */ }
  }
}
