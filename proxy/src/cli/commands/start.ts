import fs from 'fs';
import path from 'path';
import { execSync, spawn, exec } from 'child_process';
import { platform } from 'os';
import { certExists, generateCerts, trustCert, isAdmin } from '../utils/cert.js';
import { killProcessesOnPorts } from '../utils/port.js';
import { startProxy, isProxyRunning, waitForHealth } from '../utils/process.js';
import { openUrl } from '../utils/open.js';
import { PROXY_DIR } from '../utils/paths.js';
import { checkAndPromptUpdate } from '../utils/update-check.js';

interface StartOptions {
  port?: string;
  browser?: boolean;
  foreground?: boolean;
  trustCert?: boolean;
}

function promptForAdmin(): boolean {
  if (platform() !== 'win32') return false;
  if (isAdmin()) return true;

  console.log('');
  console.log('  !! Administrator privileges required for port 443.');
  console.log('  ?? Restart as Administrator? (Y/n)');

  // Simple stdin read for Y/n
  const buf = Buffer.alloc(1);
  try {
    fs.readSync(0, buf, 0, 1, null);
    const answer = buf.toString('utf-8').trim().toLowerCase();
    if (answer === 'n') return false;
  } catch {
    // Non-interactive — default to attempting elevation
  }

  // Elevate via PowerShell UAC prompt
  try {
    const scriptPath = path.join(PROXY_DIR, '..', 'start.ps1');
    if (fs.existsSync(scriptPath)) {
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
        stdio: 'inherit',
        timeout: 5000,
      });
    } else {
      // Fallback: restart this CLI as admin
      const cliPath = process.argv[1];
      execSync(
        `powershell -NoProfile -Command "Start-Process node -ArgumentList '${cliPath}','start' -Verb RunAs"`,
        { stdio: 'inherit', timeout: 10000 }
      );
    }
    process.exit(0);
  } catch {
    console.log('  !! Could not elevate. Run this terminal as Administrator.');
    return false;
  }
}

function launchAntigravityDesktop(): boolean {
  const p = platform();
  let exePath = '';

  if (p === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity', 'Antigravity.exe'),
      path.join(process.env.ProgramFiles || '', 'Antigravity', 'Antigravity.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Antigravity', 'Antigravity.exe'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) { exePath = c; break; }
    }
    if (exePath) {
      try {
        exec(`start "" "${exePath}"`, { timeout: 5000, windowsHide: false }, () => {});
        return true;
      } catch {}
    }
  } else if (p === 'darwin') {
    const candidates = [
      '/Applications/Antigravity.app',
      path.join(process.env.HOME || '', 'Applications', 'Antigravity.app'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) { exePath = c; break; }
    }
    if (exePath) {
      try {
        spawn('open', [exePath], { detached: true, stdio: 'ignore' }).unref();
        return true;
      } catch {}
    }
  } else {
    const candidates = [
      '/usr/bin/antigravity',
      '/usr/local/bin/antigravity',
      path.join(process.env.HOME || '', '.local', 'bin', 'antigravity'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) { exePath = c; break; }
    }
    if (exePath) {
      try {
        spawn(exePath, [], { detached: true, stdio: 'ignore' }).unref();
        return true;
      } catch {}
    }
  }
  return false;
}

export async function startCommand(opts: StartOptions): Promise<void> {
  const proxyPort = parseInt(opts.port || '443', 10);
  const apiPort = 4000;

  console.log('\n==> Checking prerequisites');

  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  if (major < 20) {
    console.error(`  XX Node.js 20+ required (found ${nodeVersion})`);
    process.exit(1);
  }
  console.log(`  OK Node.js ${nodeVersion}`);

  // Check for updates (non-blocking, continues after brief pause)
  try {
    const pkgPath = path.join(PROXY_DIR, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    checkAndPromptUpdate(pkg.version);
  } catch {
    // Skip update check if package.json can't be read
  }

  // Admin check for port 443 on Windows
  if (proxyPort === 443 && platform() === 'win32' && !isAdmin()) {
    console.log('\n==> Checking Administrator privileges');
    const elevated = promptForAdmin();
    if (!elevated) {
      console.log('  !! Continuing without Admin — port 443 may fail.');
      console.log('  !! Tip: Use --port 8443 to run without Admin.');
    }
  }

  const nodeModules = path.join(PROXY_DIR, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    console.log('  Installing dependencies...');
    execSync('npm install --production', { cwd: PROXY_DIR, stdio: 'inherit', timeout: 120000 });
  }

  if (!certExists()) {
    console.log('\n==> Generating TLS certificates');
    generateCerts();
  }
  console.log('  OK TLS certificates ready');

  // Auto-trust certificate on first run (or if --trust-cert flag is set)
  const certTrustedMarker = path.join(PROXY_DIR, 'certs', '.trusted');
  const shouldTrust = opts.trustCert || !fs.existsSync(certTrustedMarker);
  if (shouldTrust) {
    try {
      console.log('\n==> Trusting TLS certificate');
      trustCert();
      fs.writeFileSync(certTrustedMarker, new Date().toISOString());
    } catch (e: any) {
      console.warn(`  !! ${e.message}`);
      console.log('  !! You may need to trust the cert manually. Run: antigravity certs trust');
    }
  }

  console.log('\n==> Checking for old proxy processes');
  const portsToCheck = [443, 8443, apiPort];
  if (!portsToCheck.includes(proxyPort)) portsToCheck.push(proxyPort);
  killProcessesOnPorts(portsToCheck);
  console.log('  OK Ports cleared');

  const envPath = path.join(PROXY_DIR, '.env');
  const envExample = path.join(PROXY_DIR, '.env.example');
  if (!fs.existsSync(envPath) && fs.existsSync(envExample)) {
    console.log('\n==> Creating .env from template');
    fs.copyFileSync(envExample, envPath);
    console.log(`  !! Created ${envPath} — add your API keys before using the proxy.`);
  }

  const logsDir = path.join(PROXY_DIR, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const distDir = path.join(PROXY_DIR, 'dist');
  if (!fs.existsSync(distDir)) {
    console.log('\n==> Building TypeScript');
    try {
      execSync('npx tsc', { cwd: PROXY_DIR, stdio: 'inherit', timeout: 60000 });
    } catch {
      console.log('  !! Build failed, will run in dev mode with tsx');
    }
  }

  if (isProxyRunning()) {
    console.log('  !! Proxy already running. Use `antigravity stop` first.');
    process.exit(1);
  }

  // Foreground mode: launch desktop first, then run proxy inline
  if (opts.foreground) {
    console.log('\n==> Launching Antigravity');
    if (launchAntigravityDesktop()) {
      console.log('  OK Antigravity launched');
    } else {
      console.log('  !! Antigravity not found — launch it manually');
    }

    console.log('\n==> Starting proxy (foreground)');
    startProxy({ proxyPort, apiPort, foreground: true });
    return;
  }

  // Background mode: start proxy, wait for health, then launch desktop + browser
  console.log('\n==> Starting proxy');
  const pid = startProxy({ proxyPort, apiPort, foreground: false });
  if (pid) {
    console.log(`  OK Proxy started (PID ${pid})`);
  } else {
    console.error('  XX Failed to start proxy');
    process.exit(1);
  }

  console.log('\n==> Waiting for dashboard...');
  const healthy = await waitForHealth(apiPort);
  if (healthy) {
    console.log(`  OK Dashboard ready at http://localhost:${apiPort}`);
  } else {
    console.warn('  !! Dashboard not yet responding — check logs');
  }

  if (opts.browser !== false) {
    console.log('\n==> Opening dashboard');
    openUrl(`http://localhost:${apiPort}`);
  }

  console.log('\n==> Launching Antigravity');
  if (launchAntigravityDesktop()) {
    console.log('  OK Antigravity launched');
  } else {
    console.log('  !! Antigravity not found — launch it manually');
  }

  console.log('\n==> Ready!');
  console.log(`  Dashboard:  http://localhost:${apiPort}`);
  console.log(`  TLS Proxy:  https://localhost:${proxyPort}`);
  console.log('');
  console.log('  Configure providers and API keys from the dashboard Config tab.');
  console.log('  Run `antigravity stop` to stop everything.');
  console.log('  Run `antigravity start --foreground` to see live logs.');
}
