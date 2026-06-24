#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

import { startCommand } from '../dist/cli/commands/start.js';
import { stopCommand } from '../dist/cli/commands/stop.js';
import { statusCommand } from '../dist/cli/commands/status.js';
import { healthCommand } from '../dist/cli/commands/health.js';
import { configCommand } from '../dist/cli/commands/config.js';
import { logsCommand } from '../dist/cli/commands/logs.js';
import { certsCommand } from '../dist/cli/commands/certs.js';
import { setupCommand } from '../dist/cli/commands/setup.js';

const program = new Command();

program
  .name('antigravity')
  .description('LLM proxy for Antigravity — translate Google Gemini API calls to any provider')
  .version(pkg.version);

program
  .command('start')
  .description('Start the proxy and dashboard')
  .option('-p, --port <port>', 'proxy port', '443')
  .option('--no-browser', 'do not open dashboard in browser')
  .option('-f, --foreground', 'run in foreground (do not detach)')
  .option('--trust-cert', 'auto-trust TLS certificate')
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

program.parse();
