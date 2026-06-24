import { execSync } from 'child_process';
import { platform } from 'os';

export function findProcessesOnPort(port: number): number[] {
  const pids: number[] = [];
  try {
    if (platform() === 'win32') {
      const out = execSync(`netstat -ano`, { encoding: 'utf-8', timeout: 5000 });
      for (const line of out.split('\n')) {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(pid) && pid > 0) pids.push(pid);
        }
      }
    } else {
      let out: string;
      try {
        out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf-8', timeout: 5000 });
      } catch {
        out = execSync(`ss -tlnp`, { encoding: 'utf-8', timeout: 5000 });
        for (const line of out.split('\n')) {
          if (line.includes(`:${port}`)) {
            const m = line.match(/pid=(\d+)/);
            if (m) pids.push(parseInt(m[1], 10));
          }
        }
        return pids;
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

export function killProcessOnPort(port: number): void {
  const pids = findProcessesOnPort(port);
  for (const pid of pids) {
    try {
      if (platform() === 'win32') {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
      } else {
        process.kill(pid, 'SIGTERM');
      }
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
