import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    try {
      const uid = process.env.SUDO_UID ? parseInt(process.env.SUDO_UID, 10) : NaN;
      // os.userInfo({ username }) resolves from passwd, independent of HOME.
      const info = os.userInfo({ username: sudoUser } as any);
      if (info?.homedir) return info.homedir;
      void uid;
    } catch {
      // Fall through to the passwd lookup below
    }
    try {
      const passwd = fs.readFileSync('/etc/passwd', 'utf-8');
      for (const line of passwd.split('\n')) {
        const fields = line.split(':');
        if (fields[0] === sudoUser && fields[5]) return fields[5];
      }
    } catch {
      // Fall through to os.homedir()
    }
  }
  return os.homedir();
}

export const REAL_HOME = resolveRealHome();
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
    } catch { /* best-effort */ }
  }
}
