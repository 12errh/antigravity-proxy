import { execSync } from 'child_process';
import { platform } from 'os';

/** Extract the port from an `ss`/`netstat` local-address column. */
function portFromAddress(addr: string): number | null {
  const m = addr.match(/:(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Find PIDs listening on `port`.
 *
 * Over-matching here is destructive: callers SIGTERM every returned PID, and on
 * Linux `lsof -i tcp:PORT` also matches outbound connections, which would kill
 * unrelated TLS clients (browsers, editors). Both paths are therefore restricted
 * to listening sockets.
 */
export function findProcessesOnPort(port: number): number[] {
  const pids: number[] = [];
  try {
    if (platform() === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf-8', timeout: 5000 });
      for (const line of out.split('\n')) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const localAddr = parts[1] || '';
          if (portFromAddress(localAddr) !== port) continue;
          const pid = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(pid) && pid > 0) pids.push(pid);
        }
      }
    } else {
      // `lsof -ti tcp:PORT -sTCP:LISTEN` restricts to listening sockets.
      let out: string | null = null;
      try {
        out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf-8', timeout: 5000 });
      } catch {
        out = null;
      }
      if (out === null) {
        // lsof missing or failed — fall back to `ss`, also LISTEN-only.
        try {
          const ssOut = execSync('ss -lntp', { encoding: 'utf-8', timeout: 5000 });
          for (const line of ssOut.split('\n')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 4) continue;
            if (portFromAddress(parts[3]) !== port) continue;
            const m = line.match(/pid=(\d+)/);
            if (m) pids.push(parseInt(m[1], 10));
          }
        } catch { /* no listener */ }
        return [...new Set(pids)];
      }
      for (const line of out.split('\n')) {
        const pid = parseInt(line.trim(), 10);
        if (!isNaN(pid) && pid > 0) pids.push(pid);
      }
    }
  } catch {
    // Command failed — port probably free
  }
  return [...new Set(pids)];
}

export function isPortAvailable(port: number): boolean {
  return findProcessesOnPort(port).length === 0;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    // EPERM means the process exists but is owned by another user.
    return e?.code === 'EPERM';
  }
}

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

export function killProcessOnPort(port: number): void {
  const pids = findProcessesOnPort(port);
  for (const pid of pids) {
    try {
      if (platform() === 'win32') {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
        continue;
      }
      // Graceful first, then escalate: a wedged process would otherwise hold the
      // port and the subsequent listen() fails with EADDRINUSE.
      process.kill(pid, 'SIGTERM');
      for (let i = 0; i < 10 && processAlive(pid); i++) sleepSync(100);
      if (processAlive(pid)) process.kill(pid, 'SIGKILL');
    } catch {
      // Process may have already exited
    }
  }
}

export function killProcessesOnPorts(ports: number[]): void {
  for (const port of ports) {
    killProcessOnPort(port);
  }
}
