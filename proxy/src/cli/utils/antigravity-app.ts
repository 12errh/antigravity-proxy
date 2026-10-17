import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { platform } from 'os';
import { PROXY_DIR } from './paths.js';
import { USER_DATA_DIR, REAL_HOME, REAL_UID, REAL_GID } from '../../data-paths.js';

/**
 * Locate the Antigravity desktop application binary.
 *
 * This package's own executable is named `antigravity` too, so a naive search of
 * $PATH (/usr/bin, /usr/local/bin, ~/.local/bin) finds the CLI itself and
 * launching it re-runs the CLI instead of the desktop app. Every candidate is
 * therefore validated as "not this package's bin".
 */

const CLI_ENTRY = path.resolve(PROXY_DIR, 'bin', 'cli.js');

/** The compiled/global layout: .../node_modules/@12errh/antigravity-proxy/bin/cli.js */
const OWN_PACKAGE_RE = /(^|[/\\])@12errh[/\\]antigravity-proxy[/\\]/;

/** True when `candidate` is this package's own CLI entry (directly or via symlink). */
export function isOwnCliEntry(candidate: string): boolean {
  try {
    const real = fs.realpathSync(candidate);
    // Covers both the repo checkout and a globally installed copy of this
    // package (npm puts it under .../lib/node_modules/@12errh/antigravity-proxy,
    // which is a *different* real path than this checkout's bin/cli.js).
    if (real === CLI_ENTRY || real === fs.realpathSync(CLI_ENTRY) || OWN_PACKAGE_RE.test(real)) return true;
  } catch { /* unresolvable — fall through to name check */ }
  if (OWN_PACKAGE_RE.test(candidate)) return true;
  return false;
}

/** `agy-node` runs Electron in ELECTRON_RUN_AS_NODE mode, i.e. headless — never the GUI. */
function isHeadlessWrapper(candidate: string): boolean {
  return path.basename(candidate) === 'agy-node';
}

function isUsableBinary(candidate: string): boolean {
  try {
    const st = fs.statSync(candidate);
    if (!st.isFile() && !st.isSymbolicLink()) return false;
  } catch {
    return false;
  }
  if (isOwnCliEntry(candidate) || isHeadlessWrapper(candidate)) return false;
  if (platform() !== 'win32') {
    try { fs.accessSync(candidate, fs.constants.X_OK); } catch { return false; }
  }
  return true;
}

/** Path of the CLI config file that stores the desktop binary path. */
const CLI_CONFIG_PATH = path.join(USER_DATA_DIR, 'cli-config.json');

/** Read the user-configured desktop path (raw, unvalidated). */
export function getConfiguredPath(): string | null {
  try {
    const raw = fs.readFileSync(CLI_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const p = parsed?.antigravityPath;
    if (typeof p === 'string' && p.trim()) return p.trim();
  } catch { /* no config */ }
  return null;
}

/** The configured path, but only when it currently points at a usable binary. */
function configuredPath(): string | null {
  const p = getConfiguredPath();
  if (p && isUsableBinary(p)) return p;
  return null;
}

export interface SetPathResult { ok: boolean; error?: string }

/**
 * Persist the desktop binary path to ~/.antigravity/cli-config.json.
 * Validates the target so users can't accidentally point it at this CLI
 * (which is also named `antigravity`) or the headless `agy-node` wrapper.
 */
export function setConfiguredPath(binary: string): SetPathResult {
  let resolved = binary.trim();
  if (resolved.startsWith('~/')) resolved = path.join(REAL_HOME, resolved.slice(2));
  resolved = path.resolve(resolved);

  try {
    const st = fs.statSync(resolved);
    if (!st.isFile() && !st.isSymbolicLink()) return { ok: false, error: `not a file: ${resolved}` };
  } catch {
    return { ok: false, error: `not found: ${resolved}` };
  }
  if (isOwnCliEntry(resolved)) {
    return { ok: false, error: 'that is this package\'s own CLI, not the desktop app' };
  }
  if (isHeadlessWrapper(resolved)) {
    return { ok: false, error: 'agy-node is the headless Electron helper, not the desktop app' };
  }
  if (platform() !== 'win32') {
    try { fs.accessSync(resolved, fs.constants.X_OK); } catch {
      return { ok: false, error: `not executable: ${resolved}` };
    }
  }

  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(fs.readFileSync(CLI_CONFIG_PATH, 'utf-8')) ?? {}; } catch { /* fresh config */ }
  if (typeof cfg !== 'object' || cfg === null) cfg = {};
  cfg.antigravityPath = resolved;
  try {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    fs.writeFileSync(CLI_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  } catch (e: any) {
    return { ok: false, error: `could not write ${CLI_CONFIG_PATH}: ${e?.message}` };
  }
  return { ok: true };
}

/** Remove the configured desktop path (falls back to auto-discovery). */
export function clearConfiguredPath(): void {
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(fs.readFileSync(CLI_CONFIG_PATH, 'utf-8')) ?? {}; } catch { return; }
  if (typeof cfg !== 'object' || cfg === null) return;
  delete (cfg as any).antigravityPath;
  try {
    fs.writeFileSync(CLI_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  } catch { /* best-effort */ }
}

/** Directories that commonly hold an unpacked Antigravity install on Linux. */
function linuxSearchRoots(): string[] {
  const roots = [
    '/opt',
    '/usr/local/opt',
    path.join(REAL_HOME, 'Applications'),
    path.join(REAL_HOME, 'Downloads'),
    path.join(REAL_HOME, '.local', 'share'),
    path.join(REAL_HOME, 'AppImages'),
  ];
  return roots.filter(r => {
    try { return fs.statSync(r).isDirectory(); } catch { return false; }
  });
}

/** Find an `antigravity` binary inside an Antigravity* install dir, bounded in depth. */
function findLinuxBinaries(): string[] {
  const found: string[] = [];
  const maxDepth = 3;

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile() || e.isSymbolicLink()) {
        if (e.name === 'antigravity' && /Antigravity/i.test(dir)) {
          found.push(full);
        } else if (e.name.endsWith('.AppImage') && /antigravity/i.test(e.name)) {
          found.push(full);
        }
      }
    }
  };

  for (const root of linuxSearchRoots()) walk(root, 0);
  return found;
}

/** Ordered candidate list for the current platform. */
export function antigravityCandidates(): string[] {
  const p = platform();
  const out: string[] = [];

  const configured = configuredPath();
  if (configured) out.push(configured);

  if (p === 'win32') {
    const bases = [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Antigravity') : '',
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Antigravity') : '',
      process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Antigravity') : '',
    ].filter(Boolean);
    for (const b of bases) out.push(path.join(b, 'Antigravity.exe'));
  } else if (p === 'darwin') {
    out.push('/Applications/Antigravity.app');
    out.push(path.join(REAL_HOME, 'Applications', 'Antigravity.app'));
  } else {
    out.push(...findLinuxBinaries());
  }

  return [...new Set(out)].filter(Boolean);
}

/** Resolve the desktop binary, or null when nothing suitable is installed. */
export function resolveAntigravityApp(): string | null {
  for (const c of antigravityCandidates()) {
    if (isUsableBinary(c)) return c;
  }
  return null;
}

/**
 * Environment for the desktop app when it is launched from a root/sudo
 * context. sudo's env_reset strips the session-critical variables:
 *
 *  - DBUS_SESSION_BUS_ADDRESS — without it the desktop portal cannot open the
 *    sign-in page in the browser and the LS keyring access fails
 *    ("dbus: invalid bus address" in language_server.log).
 *  - XDG_RUNTIME_DIR — flatpak, PulseAudio and portals need it.
 *  - XDG_DATA_DIRS — sudo resets it, dropping the flatpak exports dirs. When
 *    Chrome is installed as a Flatpak, `xdg-open` then cannot resolve
 *    com.google.Chrome.desktop at all, so shell.openExternal (the sign-in
 *    button) silently does nothing and the UI spinner never resolves.
 *
 * Existing values are preserved; missing pieces are reconstructed and the
 * flatpak exports dirs are prepended (user dir, then system-wide) so browser
 * resolution works exactly like in the user's own shell.
 */
export function desktopSessionEnv(
  uid: number,
  home: string,
  base: NodeJS.ProcessEnv,
  exists: (p: string) => boolean = fs.existsSync,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, HOME: home };
  const runtimeDir = `/run/user/${uid}`;
  env.XDG_RUNTIME_DIR = runtimeDir;
  const bus = path.join(runtimeDir, 'bus');
  if (exists(bus)) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${bus}`;

  const dataDirs: string[] = [];
  const add = (d: string): void => {
    if (d && !dataDirs.includes(d)) dataDirs.push(d);
  };
  for (const d of [
    path.join(home, '.local', 'share', 'flatpak', 'exports', 'share'),
    '/var/lib/flatpak/exports/share',
  ]) {
    if (exists(d)) add(d);
  }
  for (const d of (base.XDG_DATA_DIRS ?? '/usr/local/share:/usr/share').split(':')) add(d);
  add('/usr/local/share');
  add('/usr/share');
  if (exists('/var/lib/snapd/desktop')) add('/var/lib/snapd/desktop');
  env.XDG_DATA_DIRS = dataDirs.join(':');
  return env;
}

/**
 * Launch the desktop app detached from this process.
 * Returns true only when a child was actually spawned.
 */
export function launchAntigravity(): boolean {
  const exe = resolveAntigravityApp();
  if (!exe) return false;

  try {
    if (exe.endsWith('.app')) {
      // macOS bundle: `open` resolves the bundle's own executable.
      const child = spawn('open', [exe], { detached: true, stdio: 'ignore' });
      child.on('error', () => { /* reported by caller as not launched */ });
      child.unref();
      return true;
    }
    const child = spawn(exe, [], {
      detached: true,
      stdio: 'ignore',
      // Under `sudo antigravity start`, the desktop must NOT run as root:
      // Electron/Chromium refuses to run as root without --no-sandbox, and a
      // root-owned profile would corrupt the user's app state. Drop to the
      // invoking user (uid/gid options are ignored for non-root callers) and
      // rebuild the session env sudo stripped, or sign-in can never open a
      // browser (see desktopSessionEnv).
      ...(REAL_UID !== undefined
        ? { uid: REAL_UID, gid: REAL_GID, env: desktopSessionEnv(REAL_UID, REAL_HOME, process.env) }
        : {}),
    });
    // spawn() reports ENOENT asynchronously; nothing to do but avoid an unhandled error.
    child.on('error', () => { /* noop */ });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
