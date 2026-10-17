import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { platform } from 'os';
import { stopProxy, isProxyRunning, getProxyPid } from '../utils/process.js';
import { killProcessesOnPorts } from '../utils/port.js';
import { resolveAntigravityApp } from '../utils/antigravity-app.js';
import { header, section, ok, warn, info, error, divider } from '../ui.js';

/** Process names of the desktop app we may terminate. */
function desktopProcessNames(): Set<string> {
  const names = new Set<string>(['antigravity', 'antigravity-desktop', 'Antigravity']);
  const desktop = resolveAntigravityApp();
  if (desktop) {
    try { names.add(path.basename(desktop)); } catch { /* best-effort */ }
  }
  return names;
}

/**
 * Linux: PIDs whose executable basename is one of `names`.
 *
 * Matching the *executable* (not the command line) is what makes this safe:
 * `pkill -f antigravity` also matches this package's own path
 * (.../antigravity-proxy/...), so it killed the proxy too. Electron helper
 * processes share the same executable, so they are covered as well.
 */
function listPidsByExeBasename(names: Set<string>): number[] {
  const pids: number[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return pids;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = parseInt(entry, 10);
    if (pid === process.pid) continue;
    try {
      const exe = fs.realpathSync(`/proc/${entry}/exe`);
      if (names.has(path.basename(exe))) pids.push(pid);
    } catch {
      // Kernel threads have no exe; other users' processes may be unreadable.
    }
  }
  return pids;
}

/** macOS: `pgrep -x` matches the process name exactly (`antigravity`, not node). */
function listPidsByExactName(names: Set<string>): number[] {
  const pids = new Set<number>();
  for (const name of names) {
    try {
      const out = execSync(`pgrep -x "${name}"`, { encoding: 'utf-8', timeout: 5000 });
      for (const line of out.split('\n')) {
        const pid = parseInt(line.trim(), 10);
        if (!Number.isNaN(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
      }
    } catch {
      // pgrep exits non-zero when nothing matches.
    }
  }
  return [...pids];
}

function signalPids(pids: number[], signal: NodeJS.Signals): boolean {
  let signalled = false;
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
      signalled = true;
    } catch {
      // Already exited or not ours.
    }
  }
  return signalled;
}

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killAntigravityDesktop(): boolean {
  const p = platform();

  if (p === 'win32') {
    let killed = false;
    for (const image of ['Antigravity.exe', 'antigravity-desktop.exe']) {
      try {
        execSync(`taskkill /F /IM ${image}`, { stdio: 'ignore', timeout: 3000 });
        killed = true;
      } catch {
        // Not running.
      }
    }
    return killed;
  }

  const names = desktopProcessNames();
  const pids = p === 'darwin' ? listPidsByExactName(names) : listPidsByExeBasename(names);
  if (pids.length === 0) return false;

  signalPids(pids, 'SIGTERM');
  // Escalate only if a process is still alive after a short grace period.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (pids.every(pid => !isAlive(pid))) break;
    sleepSync(100);
  }
  signalPids(pids, 'SIGKILL');
  return true;
}

export async function stopCommand(): Promise<void> {
  header('Stopping Antigravity');

  section('Killing desktop app');
  console.log(`  ${info('Checking for Antigravity desktop...')}`);
  const desktopKilled = killAntigravityDesktop();
  if (desktopKilled) {
    console.log(`  ${ok('Desktop app stopped')}`);
  } else {
    console.log(`  ${warn('Desktop app not running or already closed')}`);
  }

  section('Killing proxy');
  const proxyRunning = isProxyRunning();
  let proxyStillRunning = false;
  if (proxyRunning) {
    console.log(`  ${info('Stopping proxy...')}`);
    const stopped = stopProxy();
    if (stopped) {
      console.log(`  ${ok('Proxy stopped by PID')}`);
    } else if (getProxyPid() !== null) {
      // The PID file is still there and we could not signal the process — it
      // belongs to another user (typically started with sudo).
      proxyStillRunning = true;
      console.log(`  ${warn('Proxy was started by another user (sudo?) — not permitted to stop it')}`);
      console.log(`  ${info('Run: sudo antigravity stop')}`);
    } else {
      console.log(`  ${warn('PID file not found — killing by port')}`);
      killProcessesOnPorts([443, 8443, 4000]);
      console.log(`  ${ok('Ports cleared')}`);
    }
  } else {
    console.log(`  ${info('Proxy not running — cleaning up ports anyway')}`);
    killProcessesOnPorts([443, 8443, 4000]);
    console.log(`  ${ok('Ports cleared')}`);
  }

  divider();
  if (proxyStillRunning) {
    console.log(`  ${warn('Proxy is still running.')} ${info('Run: sudo antigravity stop')}`);
  } else {
    console.log(`  ${ok('All stopped')}`);
    console.log(`  ${info('Run')} ${info('antigravity start')} ${info('to start again.')}`);
  }
  console.log('');
}
