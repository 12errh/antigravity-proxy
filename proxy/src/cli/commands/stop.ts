import { execSync } from 'child_process';
import { platform } from 'os';
import { stopProxy, isProxyRunning } from '../utils/process.js';
import { killProcessesOnPorts } from '../utils/port.js';

function killAntigravityDesktop(): boolean {
  const p = platform();
  try {
    if (p === 'win32') {
      // Kill Antigravity.exe by name
      execSync('taskkill /F /IM Antigravity.exe 2>nul', { stdio: 'ignore', timeout: 5000 });
      return true;
    } else if (p === 'darwin') {
      execSync('pkill -f Antigravity 2>/dev/null', { stdio: 'ignore', timeout: 5000 });
      return true;
    } else {
      execSync('pkill -f antigravity 2>/dev/null', { stdio: 'ignore', timeout: 5000 });
      return true;
    }
  } catch {
    return false;
  }
}

export function stopCommand(): void {
  console.log('\n==> Stopping Antigravity');

  // Kill the desktop app
  console.log('  Stopping Antigravity desktop...');
  killAntigravityDesktop();

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
    // Still try to clean up ports
    killProcessesOnPorts([443, 8443, 4000]);
  }

  console.log('  OK All stopped');
}
