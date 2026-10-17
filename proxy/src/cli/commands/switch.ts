import { platform } from 'os';
import { isProxyRunning, stopProxy, startProxy, waitForHealth } from '../utils/process.js';
import { isCertTrusted, trustCert, untrustCert, cleanHostsFile, setupHostsFile } from '../utils/cert.js';
import { launchAntigravity } from '../utils/antigravity-app.js';
import { header, section, ok, warn, info, confirm, divider } from '../ui.js';

type Mode = 'proxy' | 'simple';

function detectMode(): Mode {
  // Proxy mode = cert is trusted in OS store OR proxy is running
  // The cert files may exist but if not trusted, we're in simple mode
  if (isCertTrusted() || isProxyRunning()) {
    return 'proxy';
  }
  return 'simple';
}

function elevationHint(): string {
  return platform() === 'win32' ? 'Run as Administrator' : 'Run with sudo';
}

function launchAntigravityOrWarn(): void {
  if (!launchAntigravity()) {
    console.log(`  ${warn('Antigravity not found — set its path with: antigravity path <binary>')}`);
  }
}

export async function switchCommand(): Promise<void> {
  const currentMode = detectMode();

  header('Antigravity Mode Switch');

  if (currentMode === 'proxy') {
    section('Current Mode: Proxy');
    console.log(`  ${info('The proxy is currently active (intercepting traffic)')}\n`);

    console.log(`  To switch to Simple mode, the following will happen:`);
    console.log(`  1. Stop proxy process`);
    console.log(`  2. Remove certificate from OS trust store`);
    console.log(`  3. Clean hosts file (remove proxy routing)`);
    console.log(`  4. Launch Antigravity normally (direct Google access)\n`);

    const proceed = await confirm('Switch to Simple mode?', true);
    if (!proceed) {
      console.log(`  ${info('Cancelled')}\n`);
      return;
    }

    section('Stopping proxy');
    const stopped = stopProxy();
    if (stopped) {
      console.log(`  ${ok('Proxy stopped')}`);
    } else {
      console.log(`  ${warn('Proxy was not running')}`);
    }

    section('Removing certificate from trust store');
    untrustCert();
    console.log(`  ${ok('Certificate removed')}`);

    section('Cleaning hosts file');
    const hostsResult = cleanHostsFile();
    if (hostsResult.found && hostsResult.cleaned) {
      console.log(`  ${ok('Proxy routing entries removed from hosts file')}`);
    } else if (hostsResult.found && !hostsResult.cleaned) {
      console.log(`  ${warn(`Found proxy entries but could not remove: ${hostsResult.error}`)}`);
      console.log(`  ${info(`${elevationHint()} to clean the hosts file`)}`);
    } else {
      console.log(`  ${ok('No proxy routing entries found in hosts file')}`);
    }

    divider();
    console.log(`  ${ok('Switched to Simple mode')}`);
    console.log(`  ${info('Antigravity will now connect directly to Google')}\n`);

    const launch = await confirm('Launch Antigravity now?', true);
    if (launch) {
      launchAntigravityOrWarn();
    }
  } else {
    section('Current Mode: Simple');
    console.log(`  ${info('The proxy is not active (direct Google access)')}\n`);

    console.log(`  To switch to Proxy mode, the following will happen:`);
    console.log(`  1. Trust TLS certificate in OS store`);
    console.log(`  2. Add proxy routing to hosts file`);
    console.log(`  3. Start proxy on port 443`);
    console.log(`  4. Launch Antigravity through proxy\n`);

    const proceed = await confirm('Switch to Proxy mode?', true);
    if (!proceed) {
      console.log(`  ${info('Cancelled')}\n`);
      return;
    }

    section('Trusting certificate');
    try {
      trustCert();
      console.log(`  ${ok('Certificate trusted')}`);
    } catch (e: any) {
      console.log(`  ${warn(`Certificate trust failed: ${e.message}`)}`);
      console.log(`  ${info('Continuing anyway...')}`);
    }

    section('Setting up hosts file');
    const hostsResult = setupHostsFile();
    if (hostsResult.found && hostsResult.cleaned) {
      console.log(`  ${ok('Proxy routing entries added to hosts file')}`);
    } else if (hostsResult.found && !hostsResult.cleaned) {
      console.log(`  ${warn(`Could not add routing entries: ${hostsResult.error}`)}`);
      console.log(`  ${info(`${elevationHint()} to update the hosts file`)}`);
    } else {
      console.log(`  ${ok('Hosts file already configured')}`);
    }

    section('Starting proxy');
    const pid = startProxy({ proxyPort: 443, apiPort: 4000 });
    if (pid) {
      console.log(`  ${ok(`Proxy started (PID ${pid})`)}`);

      section('Waiting for proxy to be ready');
      const ready = await waitForHealth(4000);
      if (ready) {
        console.log(`  ${ok('Proxy ready')}`);
      } else {
        console.log(`  ${warn('Proxy may not be fully ready yet')}`);
      }
    } else {
      console.log(`  ${warn('Failed to start proxy')}`);
    }

    divider();
    console.log(`  ${ok('Switched to Proxy mode')}`);
    console.log(`  ${info('Antigravity will now route through the proxy')}\n`);

    const launch = await confirm('Launch Antigravity now?', true);
    if (launch) {
      launchAntigravityOrWarn();
    }
  }
}
