import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { platform } from 'os';
import { PROXY_DIR } from './paths.js';
import { USER_DATA_DIR, chownIfRoot } from '../../data-paths.js';

const PID_DIR = USER_DATA_DIR;
const PID_FILE = path.join(PID_DIR, 'proxy.pid');

function ensurePidDir(): void {
  if (!fs.existsSync(PID_DIR)) {
    fs.mkdirSync(PID_DIR, { recursive: true });
  }
}

export function getProxyPid(): number | null {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function isProxyRunning(): boolean {
  const pid = getProxyPid();
  if (pid === null) return false;
  try {
    if (platform() === 'win32') {
      const out = execSync(`tasklist /FI "PID eq ${pid}" 2>nul`, { encoding: 'utf-8', timeout: 5000 });
      return out.includes(String(pid));
    } else {
      process.kill(pid, 0);
      return true;
    }
  } catch (e: any) {
    // EPERM means the process exists but belongs to another user (e.g. a proxy
    // started with sudo). Treat it as running, so we don't report "stopped" and
    // delete the PID file of a live process.
    if (e?.code === 'EPERM') return true;
    try { fs.unlinkSync(PID_FILE); } catch {}
    return false;
  }
}

export interface StartProxyOptions {
  proxyPort: number;
  apiPort: number;
  foreground?: boolean;
}

function buildNodeArgs(entryPoint: string, useTsx: boolean): string[] {
  return useTsx ? ['--import', 'tsx/esm', entryPoint] : [entryPoint];
}

export function startProxy(options: StartProxyOptions): number | null {
  ensurePidDir();

  const proxyDir = PROXY_DIR;
  const distIndex = path.join(proxyDir, 'dist', 'index.js');
  const srcIndex = path.join(proxyDir, 'src', 'index.ts');
  const entryPoint = fs.existsSync(distIndex) ? distIndex : srcIndex;
  const useTsx = entryPoint.endsWith('.ts');

  const env = { ...process.env };
  // The caller (start.ts) already resolved precedence (--port flag > .env >
  // default), so these values are authoritative — do not let a stale .env
  // silently re-override an explicitly requested port.
  env.PROXY_PORT = String(options.proxyPort);
  env.API_PORT = String(options.apiPort);

  // Spawn the Node that is running this CLI (process.execPath) rather than
  // relying on `node` being on PATH. Under nvm, or when the CLI was invoked via
  // sudo (whose secure_path excludes nvm/volta shims), a bare 'node' resolves to
  // a different or missing interpreter.
  if (options.foreground) {
    const args = buildNodeArgs(entryPoint, useTsx);
    const child = spawn(process.execPath, args, { cwd: proxyDir, env, stdio: 'inherit' });
    fs.writeFileSync(PID_FILE, String(child.pid));
    chownIfRoot(PID_FILE);
    child.on('exit', () => { try { fs.unlinkSync(PID_FILE); } catch {} });
    return child.pid ?? null;
  }

  const args = buildNodeArgs(entryPoint, useTsx);
  const child = spawn(process.execPath, args, {
    cwd: proxyDir,
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const pid = child.pid || null;
  if (pid) {
    fs.writeFileSync(PID_FILE, String(pid));
    chownIfRoot(PID_FILE);
  }
  return pid;
}

export function stopProxy(): boolean {
  const pid = getProxyPid();
  if (pid === null) return false;

  try {
    if (platform() === 'win32') {
      execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore', timeout: 3000 });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    try { fs.unlinkSync(PID_FILE); } catch {}
    return true;
  } catch (e: any) {
    // A proxy started with sudo is not ours to kill. Keep the PID file so a
    // later `sudo antigravity stop` can still find the process.
    if (e?.code === 'EPERM') return false;
    try { fs.unlinkSync(PID_FILE); } catch {}
    return true;
  }
}

export function waitForHealth(apiPort: number, timeoutMs = 15000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = async () => {
      try {
        const res = await fetch(`http://localhost:${apiPort}/api/health`);
        if (res.ok) { resolve(true); return; }
      } catch {}
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      setTimeout(check, 500);
    };
    check();
  });
}
