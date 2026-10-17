import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { platform } from 'os';
import { certExists, generateCerts, trustCert, cleanHostsFile, setupHostsFile } from '../utils/cert.js';
import { killProcessesOnPorts } from '../utils/port.js';
import { startProxy, isProxyRunning, waitForHealth } from '../utils/process.js';
import { openUrl } from '../utils/open.js';
import { PROXY_DIR } from '../utils/paths.js';
import { USER_DATA_DIR, USER_CERTS_DIR, USER_ENV_PATH, USER_LOGS_DIR, chownIfRoot, chownTreeIfRoot } from '../../data-paths.js';
import { launchAntigravity } from '../utils/antigravity-app.js';
import { checkAndPromptUpdate } from '../utils/update-check.js';
import chalk from 'chalk';
import { section, ok, fail, warn, info, header, startSpinner, succeedSpinner, failSpinner, warnSpinner, arrow, error } from '../ui.js';

interface StartOptions {
  port?: string;
  browser?: boolean;
  foreground?: boolean;
  trustCert?: boolean;
  simple?: boolean;
}

const launchAntigravityDesktop = launchAntigravity;

/** Platform-appropriate wording for "we need elevated privileges here". */
function elevationHint(): string {
  return platform() === 'win32' ? 'Run as Administrator' : 'Run with sudo';
}

export interface ResolvedPorts { proxyPort: number; apiPort: number }

/**
 * Resolve the effective ports. Precedence: explicit --port flag (or the
 * wizard passing `port`) wins, then PROXY_PORT from the config (.env is
 * loaded into process.env), then 443. Exported for regression tests.
 */
export function resolvePorts(opts: { port?: string }): ResolvedPorts {
  return {
    proxyPort: parseInt(opts.port ?? process.env.PROXY_PORT ?? '443', 10),
    apiPort: parseInt(process.env.API_PORT ?? '4000', 10),
  };
}

export async function startCommand(opts: StartOptions): Promise<void> {
  const { proxyPort, apiPort } = resolvePorts(opts);

  // After a `sudo antigravity start`, files created as root in ~/.antigravity
  // (logs, PID, SQLite DB) would break every later non-root run. Hand any
  // root-owned state back to the invoking user before doing anything else.
  // No-op when not running as root via sudo.
  chownTreeIfRoot(USER_DATA_DIR);

  header('Antigravity Proxy', `v${JSON.parse(fs.readFileSync(path.join(PROXY_DIR, 'package.json'), 'utf-8')).version}`);

  // Simple mode: just launch Antigravity directly without proxy
  if (opts.simple) {
    section('Simple Mode');
    console.log(`  ${info('Launching Antigravity directly (no proxy)')}\n`);

    // Clean up hosts file entries that route traffic to the proxy
    section('Cleaning up proxy routing');
    const hostsResult = cleanHostsFile();
    if (hostsResult.found && hostsResult.cleaned) {
      console.log(`  ${ok('Proxy routing entries removed from hosts file')}`);
    } else if (hostsResult.found && !hostsResult.cleaned) {
      console.log(`  ${warn(`Found proxy entries but could not remove: ${hostsResult.error}`)}`);
      console.log(`  ${info(`${elevationHint()} to clean the hosts file`)}`);
    } else {
      console.log(`  ${ok('No proxy routing entries found in hosts file')}`);
    }

    console.log(`  ${arrow('Launching Antigravity desktop')}`);
    if (launchAntigravityDesktop()) {
      console.log(`  ${ok('Antigravity launched')}`);
    } else {
      console.log(`  ${warn('Antigravity not found — set its path with: antigravity path <binary>')}`);
    }

    console.log('');
    console.log(`  ${chalk.bold.green('✓ Ready!')}`);
    console.log(`  ${info('Antigravity is running in simple mode (direct Google access)')}`);
    console.log('');
    console.log(`  ${chalk.dim('Run')} ${chalk.cyan('antigravity start')} ${chalk.dim('to start with proxy.')}`);
    return;
  }

  section('Checking prerequisites');

  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  if (major < 20) {
    fail(`Node.js 20+ required (found ${nodeVersion})`);
    process.exit(1);
  }
  console.log(`  ${ok(`Node.js ${nodeVersion}`)}`);

  const updateSpinner = startSpinner('Checking for updates');
  try {
    const pkgPath = path.join(PROXY_DIR, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    checkAndPromptUpdate(pkg.version);
    succeedSpinner(updateSpinner);
  } catch {
    succeedSpinner(updateSpinner);
  }

  section('Setting up environment');
  const depSpinner = startSpinner('Checking dependencies');
  const nodeModules = path.join(PROXY_DIR, 'node_modules');
  if (!fs.existsSync(nodeModules) && !fs.existsSync(path.join(PROXY_DIR, 'dist', 'index.js'))) {
    depSpinner.text = 'Installing dependencies...';
    execSync('npm install --production', { cwd: PROXY_DIR, stdio: 'pipe', timeout: 120000 });
    succeedSpinner(depSpinner, 'Dependencies installed');
  } else {
    succeedSpinner(depSpinner, 'Dependencies ready');
  }

  const certSpinner = startSpinner('Setting up TLS certificates');
  if (!certExists()) {
    generateCerts();
    succeedSpinner(certSpinner, 'TLS certificates generated');
  } else {
    succeedSpinner(certSpinner, 'TLS certificates ready');
  }

  const certTrustSpinner = startSpinner('Trusting TLS certificate');
  // Marker lives next to the cert it describes (user-writable), not in the
  // package dir which is often read-only for global installs.
  const certTrustedMarker = path.join(USER_CERTS_DIR, '.trusted');
  const shouldTrust = opts.trustCert || !fs.existsSync(certTrustedMarker);
  if (shouldTrust) {
    try {
      trustCert();
      try {
        fs.writeFileSync(certTrustedMarker, new Date().toISOString());
        chownIfRoot(certTrustedMarker);
      } catch { /* non-fatal */ }
      succeedSpinner(certTrustSpinner, 'Certificate trusted');
    } catch (e: any) {
      warnSpinner(certTrustSpinner, `Certificate not auto-trusted: ${e.message}`);
      console.log(`  ${info('Run: antigravity certs trust')}`);
    }
  } else {
    succeedSpinner(certTrustSpinner, 'Certificate already trusted');
  }

  section('Clearing old processes');
  const portsToCheck = [443, 8443, apiPort];
  if (!portsToCheck.includes(proxyPort)) portsToCheck.push(proxyPort);
  killProcessesOnPorts(portsToCheck);
  console.log(`  ${ok('Ports cleared')}`);

  section('Setting up proxy routing');
  const hostsSpinner = startSpinner('Configuring hosts file');
  const hostsResult = setupHostsFile();
  if (hostsResult.found && hostsResult.cleaned) {
    succeedSpinner(hostsSpinner, 'Proxy routing entries added to hosts file');
  } else if (hostsResult.found && !hostsResult.cleaned) {
    warnSpinner(hostsSpinner, `Could not add routing entries: ${hostsResult.error}`);
    console.log(`  ${info(`${elevationHint()} to update the hosts file`)}`);
  } else {
    succeedSpinner(hostsSpinner, 'Hosts file already configured');
  }

  // Config lives in the user directory (that is where config.ts reads it from),
  // so create it there rather than in the package dir where it would be ignored.
  const envExample = path.join(PROXY_DIR, '.env.example');
  if (!fs.existsSync(USER_ENV_PATH) && fs.existsSync(envExample)) {
    try {
      fs.mkdirSync(path.dirname(USER_ENV_PATH), { recursive: true });
      chownIfRoot(path.dirname(USER_ENV_PATH));
      fs.copyFileSync(envExample, USER_ENV_PATH);
      chownIfRoot(USER_ENV_PATH);
      console.log(`  ${warn(`.env created at ${USER_ENV_PATH} — add API keys in the dashboard Config tab`)}`);
    } catch { /* non-fatal */ }
  }

  // The logger and dashboard both use the user logs dir; create the same one
  // here so `--foreground` output and the dashboard Sessions/Logs tabs agree.
  if (!fs.existsSync(USER_LOGS_DIR)) {
    fs.mkdirSync(USER_LOGS_DIR, { recursive: true });
    chownIfRoot(USER_LOGS_DIR);
  }

  const distDir = path.join(PROXY_DIR, 'dist');
  if (!fs.existsSync(distDir)) {
    const buildSpinner = startSpinner('Building TypeScript');
    try {
      execSync('npx tsc', { cwd: PROXY_DIR, stdio: 'pipe', timeout: 60000 });
      succeedSpinner(buildSpinner, 'TypeScript compiled');
    } catch {
      warnSpinner(buildSpinner, 'Build failed, running in dev mode with tsx');
    }
  }

  if (isProxyRunning()) {
    error('Proxy already running. Use `antigravity stop` first.');
    process.exit(1);
  }

  section('Starting proxy');

  if (opts.foreground) {
    console.log(`  ${arrow('Launching Antigravity desktop')}`);
    if (launchAntigravityDesktop()) {
      console.log(`  ${ok('Antigravity launched')}`);
    } else {
      console.log(`  ${warn('Antigravity not found — set its path with: antigravity path <binary>')}`);
    }

    console.log(`  ${arrow('Starting proxy in foreground')}`);
    startProxy({ proxyPort, apiPort, foreground: true });
    return;
  }

  const proxySpinner = startSpinner('Starting proxy');
  const pid = startProxy({ proxyPort, apiPort, foreground: false });
  if (pid) {
    succeedSpinner(proxySpinner, `Proxy started (PID ${pid})`);
  } else {
    failSpinner(proxySpinner, 'Failed to start proxy');
    process.exit(1);
  }

  const healthSpinner = startSpinner('Waiting for dashboard');
  const healthy = await waitForHealth(apiPort);
  if (healthy) {
    succeedSpinner(healthSpinner, 'Dashboard ready');
  } else {
    warnSpinner(healthSpinner, 'Dashboard not yet responding — check logs');
    if (!isProxyRunning()) {
      console.log(`  ${info('The proxy process exited during startup. Run: antigravity start --foreground to see the error.')}`);
    }
  }

  if (opts.browser !== false) {
    openUrl(`http://localhost:${apiPort}`);
  }

  console.log(`  ${arrow('Launching Antigravity desktop')}`);
  if (launchAntigravityDesktop()) {
    console.log(`  ${ok('Antigravity launched')}`);
  } else {
    console.log(`  ${warn('Antigravity not found — set its path with: antigravity path <binary>')}`);
  }

  console.log('');
  console.log(`  ${chalk.bold.green('✓ Ready!')}`);
  console.log(`  ${info(`Dashboard:  http://localhost:${apiPort}`)}`);
  console.log(`  ${info(`TLS Proxy:  https://localhost:${proxyPort}`)}`);
  console.log('');
  console.log(`  ${chalk.dim('Configure providers and API keys from the dashboard Config tab.')}`);
  console.log(`  ${chalk.dim('Run')} ${chalk.cyan('antigravity stop')} ${chalk.dim('to stop everything.')}`);
  console.log(`  ${chalk.dim('Run')} ${chalk.cyan('antigravity start --foreground')} ${chalk.dim('to see live logs.')}`);
}
