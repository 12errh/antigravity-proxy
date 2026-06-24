import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { platform } from 'os';
import { PROXY_DIR } from './paths.js';

const PID_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.antigravity');
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
  } catch {
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
  if (!env.PROXY_PORT) env.PROXY_PORT = String(options.proxyPort);
  if (!env.API_PORT) env.API_PORT = String(options.apiPort);

  if (options.foreground) {
    const args = buildNodeArgs(entryPoint, useTsx);
    const child = spawn('node', args, { cwd: proxyDir, env, stdio: 'inherit' });
    fs.writeFileSync(PID_FILE, String(child.pid));
    child.on('exit', () => { try { fs.unlinkSync(PID_FILE); } catch {} });
    return child.pid ?? null;
  }

  const args = buildNodeArgs(entryPoint, useTsx);
  const child = spawn('node', args, {
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
  }
  return pid;
}

export function stopProxy(): boolean {
  const pid = getProxyPid();
  if (pid === null) return false;

  try {
    if (platform() === 'win32') {
      execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore', timeout: 5000 });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {}

  try { fs.unlinkSync(PID_FILE); } catch {}
  return true;
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
