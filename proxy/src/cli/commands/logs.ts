import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { LOGS_DIR } from '../utils/paths.js';

function getLogFiles(): string[] {
  try {
    return fs.readdirSync(LOGS_DIR)
      .filter(f => f.startsWith('proxy_') && f.endsWith('.log'))
      .sort()
      .reverse();
  } catch { return []; }
}

export function logsCommand(action?: string, file?: string): void {
  if (!action || action === 'tail') {
    const files = getLogFiles();
    if (files.length === 0) {
      console.log('  No log files found in logs/');
      return;
    }
    const latest = path.join(LOGS_DIR, files[0]);
    console.log(`  Tailing ${files[0]} (Ctrl+C to stop)\n`);
    const rl = createInterface({ input: createReadStream(latest), crlfDelay: Infinity });
    rl.on('line', (line) => console.log(line));
    rl.on('close', () => console.log('\n  [End of log]'));
    return;
  }

  if (action === 'list') {
    const files = getLogFiles();
    if (files.length === 0) {
      console.log('  No log files found');
      return;
    }
    console.log('\n==> Log files');
    for (const f of files) {
      const stat = fs.statSync(path.join(LOGS_DIR, f));
      const size = stat.size > 1024 * 1024 ? `${(stat.size / 1024 / 1024).toFixed(1)}MB` : `${(stat.size / 1024).toFixed(1)}KB`;
      console.log(`  ${f}  (${size})`);
    }
    console.log('');
    return;
  }

  if (action === 'show' && file) {
    const filepath = path.join(LOGS_DIR, path.basename(file));
    if (!fs.existsSync(filepath)) {
      console.error(`  XX Log file not found: ${file}`);
      process.exit(1);
    }
    const content = fs.readFileSync(filepath, 'utf-8');
    console.log(content);
    return;
  }

  console.error('Usage: antigravity logs [tail|list|show <file>]');
  process.exit(1);
}
