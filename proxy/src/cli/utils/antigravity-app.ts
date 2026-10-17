import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { platform } from 'os';
import { PROXY_DIR } from './paths.js';
import { USER_DATA_DIR, REAL_HOME } from '../../data-paths.js';

/**
 * Locate the Antigravity desktop application binary.
 *
 * This package's own executable is named `antigravity` too, so a naive search of
 * $PATH (/usr/bin, /usr/local/bin, ~/.local/bin) finds the CLI itself and
 * launching it re-runs the CLI instead of the desktop app. Every candidate is
 * therefore validated as "not this package's bin".
 */

const CLI_ENTRY = path.resolve(PROXY_DIR, 'bin', 'cli.js');

/** True when `candidate` is this package's own CLI entry (directly or via symlink). */
export function isOwnCliEntry(candidate: string): boolean {
  try {
    const real = fs.realpathSync(candidate);
    if (real === CLI_ENTRY || real === fs.realpathSync(CLI_ENTRY)) return true;
  } catch { /* unresolvable — fall through to name check */ }
  // The compiled/global layout: .../antigravity-proxy/bin/cli.js
  if (/(^|[/\\])@12errh[/\\]antigravity-proxy[/\\]/.test(candidate)) return true;
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

/** Read a user-configured desktop path from ~/.antigravity/cli-config.json. */
function configuredPath(): string | null {
  try {
    const raw = fs.readFileSync(path.join(USER_DATA_DIR, 'cli-config.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    const p = parsed?.antigravityPath;
    if (typeof p === 'string' && p.trim() && isUsableBinary(p)) return p;
  } catch { /* no config */ }
  return null;
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
    const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
    // spawn() reports ENOENT asynchronously; nothing to do but avoid an unhandled error.
    child.on('error', () => { /* noop */ });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
