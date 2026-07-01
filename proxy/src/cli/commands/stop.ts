import { execSync } from 'child_process';
import { platform } from 'os';
import { stopProxy, isProxyRunning } from '../utils/process.js';
import { killProcessesOnPorts } from '../utils/port.js';
import { logger } from '../../logger.js';

function killAntigravityDesktop(): boolean {
  const p = platform();
  let killed = false;
  try {
    if (p === 'win32') {
      // Kill Antigravity.exe by name — try multiple approaches
      try {
        execSync('taskkill /F /IM Antigravity.exe', { stdio: 'ignore', timeout: 5000 });
        killed = true;
      } catch { /* not running or no permission */ }

      // Also try the Electron process name (some builds use this)
      try {
        execSync('taskkill /F /IM antigravity-desktop.exe', { stdio: 'ignore', timeout: 5000 });
        killed = true;
      } catch { /* not running */ }

      // Also kill any node processes running the proxy source directly
      try {
        const out = execSync('wmic process where "commandline like \'%antigravity%\'" get processid /format:csv 2>nul', {
          encoding: 'utf-8', timeout: 5000,
        });
        const pids = out.split('\n')
          .filter(l => l.includes(',') && !l.includes('NodeId'))
          .map(l => l.split(',')[1]?.trim())
          .filter(Boolean);
        for (const pid of pids) {
          try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 3000 }); } catch {}
        }
        if (pids.length > 0) killed = true;
      } catch { /* wmic not available */ }
    } else if (p === 'darwin') {
      execSync('pkill -f Antigravity 2>/dev/null', { stdio: 'ignore', timeout: 5000 });
      killed = true;
    } else {
      execSync('pkill -f antigravity 2>/dev/null', { stdio: 'ignore', timeout: 5000 });
      killed = true;
    }
  } catch {
    // Ignore errors
  }
  return killed;
}

export function stopCommand(): void {
  console.log('\n==> Stopping Antigravity');

  // Kill the desktop app
  console.log('  Stopping Antigravity desktop...');
  const desktopKilled = killAntigravityDesktop();
  if (desktopKilled) {
    console.log('  OK Desktop app stopped');
  } else {
    console.log('  -- Desktop app not running or already closed');
  }

  // Kill the proxy
  if (isProxyRunning()) {
    console.log('  Stopping proxy...');
    const stopped = stopProxy();
    if (stopped) {
      console.log('  OK Proxy stopped');
    } else {
      console.warn('  !! Could not stop proxy by PID — killing by port');
      killProcessesOnPorts([443, 8443, 4000]);
    }
  } else {
    console.log('  -- Proxy not running');
    // Still try to clean up ports
    killProcessesOnPorts([443, 8443, 4000]);
  }

  console.log('\n  OK All stopped');
}
