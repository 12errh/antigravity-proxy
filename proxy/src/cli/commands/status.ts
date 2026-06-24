import { isProxyRunning, getProxyPid } from '../utils/process.js';

interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(opts: StatusOptions): Promise<void> {
  const running = isProxyRunning();
  const pid = getProxyPid();

  let healthData: any = null;
  if (running) {
    try {
      const res = await fetch('http://localhost:4000/api/health');
      if (res.ok) healthData = await res.json();
    } catch {}
  }

  if (opts.json) {
    console.log(JSON.stringify({ running, pid, health: healthData }, null, 2));
    return;
  }

  console.log('\n==> Antigravity Proxy Status');
  if (running) {
    console.log(`  Status:   Running (PID ${pid})`);
    if (healthData) {
      console.log(`  Uptime:   ${Math.floor(healthData.uptime)}s`);
      console.log(`  Health:   ${healthData.status}`);
    }
    console.log(`  Dashboard: http://localhost:4000`);
    console.log(`  TLS Proxy: https://localhost:443`);
  } else {
    console.log('  Status:   Stopped');
    console.log('  Run `antigravity start` to start the proxy.');
  }
  console.log('');
}
