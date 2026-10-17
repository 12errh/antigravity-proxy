#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'module';
import { execSync, spawn } from 'child_process';
import { platform } from 'os';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// Commands that need admin privileges on Windows
const ADMIN_COMMANDS = ['start', 'switch', 'remove', 'setup', 'certs', 'stop'];

function isAdmin() {
  if (platform() !== 'win32') return true;
  try {
    execSync('net session', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function elevateAndRun() {
  const args = process.argv.slice(2);
  const cmd = args[0] || '';

  if (platform() !== 'win32' || !ADMIN_COMMANDS.includes(cmd)) return false;
  // start --simple doesn't need admin (just launches desktop app)
  if (cmd === 'start' && args.includes('--simple')) return false;
  if (isAdmin()) return false;

  console.log('');
  console.log('  Requesting Administrator access...');
  console.log('');

  try {
    // Simple, reliable elevation: write a .cmd file and run it with cmd /c start
    const nodeExe = process.execPath;
    const scriptPath = process.argv[1];
    const cmdLine = `"${nodeExe}" "${scriptPath}" ${args.join(' ')}`;

    const fs = require('fs');
    const tmpFile = `${process.env.TEMP || ''}\\antigravity_elevate.cmd`;
    fs.writeFileSync(tmpFile, `@echo off\n${cmdLine}\npause`, 'utf-8');

    // Use Shell.Application via VBScript for reliable elevation
    const vbsFile = `${process.env.TEMP || ''}\\antigravity_elevate.vbs`;
    const vbs = `Set oShell = CreateObject("Shell.Application")\noShell.ShellExecute "cmd.exe", "/c ""${tmpFile}""", "", "runas", 1`;
    fs.writeFileSync(vbsFile, vbs, 'ascii');

    // Launch VBScript - this triggers UAC and runs elevated
    const child = require('child_process').spawn('cscript', ['//nologo', vbsFile], {
      stdio: 'ignore',
      detached: true,
    });
    child.unref();

    // Clean up VBScript file after a delay
    setTimeout(() => {
      try { fs.unlinkSync(vbsFile); } catch {}
    }, 2000);

    return true;
  } catch {
    console.log('  Failed. Please run this terminal as Administrator.');
    console.log('');
    return true;
  }
}

// Try to elevate if needed — exits the original terminal cleanly
if (elevateAndRun()) {
  process.exit(0);
}

import { startCommand } from '../dist/cli/commands/start.js';
import { stopCommand } from '../dist/cli/commands/stop.js';
import { statusCommand } from '../dist/cli/commands/status.js';
import { healthCommand } from '../dist/cli/commands/health.js';
import { configCommand } from '../dist/cli/commands/config.js';
import { logsCommand } from '../dist/cli/commands/logs.js';
import { certsCommand } from '../dist/cli/commands/certs.js';
import { setupCommand } from '../dist/cli/commands/setup.js';
import { shellCommand } from '../dist/cli/commands/shell.js';
import { switchCommand } from '../dist/cli/commands/switch.js';
import { removeCommand } from '../dist/cli/commands/remove.js';
import { pathCommand } from '../dist/cli/commands/path.js';

const program = new Command();

program
  .name('antigravity')
  .description('LLM proxy for Antigravity — translate Google Gemini API calls to any provider')
  .version(pkg.version);

program
  .command('start')
  .description('Start the proxy and dashboard')
  .option('-p, --port <port>', 'proxy port (overrides PROXY_PORT from .env)')
  .option('--no-browser', 'do not open dashboard in browser')
  .option('-f, --foreground', 'run in foreground (do not detach)')
  .option('--trust-cert', 'auto-trust TLS certificate')
  .option('-s, --simple', 'launch Antigravity directly without proxy')
  .action(startCommand);

program
  .command('stop')
  .description('Stop the running proxy')
  .action(stopCommand);

program
  .command('status')
  .description('Show proxy status and uptime')
  .option('--json', 'output as JSON')
  .action(statusCommand);

program
  .command('health')
  .description('Check proxy health endpoint')
  .option('--json', 'output as JSON')
  .action(healthCommand);

program
  .command('config')
  .description('Show or update configuration')
  .argument('[action]', 'show, get, or set')
  .argument('[key]', 'environment variable name')
  .argument('[value]', 'value to set (for set action)')
  .option('--json', 'output as JSON')
  .action(configCommand);

program
  .command('logs')
  .description('View proxy logs')
  .argument('[action]', 'tail, list, or show')
  .argument('[file]', 'log filename (for show action)')
  .action(logsCommand);

program
  .command('certs')
  .description('Manage TLS certificates')
  .argument('[action]', 'show, generate, or trust')
  .action(certsCommand);

program
  .command('setup')
  .description('Run the onboarding wizard')
  .action(setupCommand);

program
  .command('shell')
  .description('Interactive monitoring shell')
  .option('-p, --port <port>', 'proxy port', '443')
  .action(shellCommand);

program
  .command('switch')
  .description('Switch between proxy and simple mode')
  .action(switchCommand);

program
  .command('path')
  .description('Show or set the Antigravity desktop binary path')
  .argument('[binary]', 'path to the Antigravity executable')
  .option('--reset', 'clear the configured path and use auto-discovery')
  .action(pathCommand);

program
  .command('remove')
  .description('Remove proxy artifacts and clean up')
  .action(removeCommand);

program.parse();
