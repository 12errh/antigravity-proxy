import fs from 'fs';
import { ENV_PATH } from '../utils/paths.js';

function readEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf-8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)/);
      if (m) result[m[1]] = m[2].trim();
    }
  } catch {}
  return result;
}

function writeEnv(updates: Record<string, string>): boolean {
  try {
    let raw = '';
    try { raw = fs.readFileSync(ENV_PATH, 'utf-8'); } catch { raw = ''; }
    for (const [k, v] of Object.entries(updates)) {
      const re = new RegExp(`^${k}=.*`, 'm');
      if (re.test(raw)) raw = raw.replace(re, `${k}=${v}`);
      else raw += `\n${k}=${v}`;
    }
    fs.writeFileSync(ENV_PATH, raw, 'utf-8');
    return true;
  } catch { return false; }
}

interface ConfigOptions {
  json?: boolean;
}

export function configCommand(action?: string, key?: string, value?: string, opts?: ConfigOptions): void {
  if (!action || action === 'show') {
    const env = readEnv();
    if (opts?.json) {
      console.log(JSON.stringify(env, null, 2));
      return;
    }
    console.log('\n==> Current Configuration');
    for (const [k, v] of Object.entries(env)) {
      const display = k.includes('KEY') ? v.slice(0, 8) + '***' : v;
      console.log(`  ${k}=${display}`);
    }
    console.log('');
    return;
  }

  if (action === 'get' && key) {
    const env = readEnv();
    const val = env[key];
    if (opts?.json) {
      console.log(JSON.stringify({ key, value: val || null }));
    } else if (val) {
      console.log(`${key}=${val}`);
    } else {
      console.error(`  Key "${key}" not found in .env`);
      process.exit(1);
    }
    return;
  }

  if (action === 'set' && key && value !== undefined) {
    if (!writeEnv({ [key]: value })) {
      console.error('  XX Failed to write .env');
      process.exit(1);
    }
    console.log(`  OK ${key} updated`);
    return;
  }

  console.error('Usage: antigravity config [show|get|set] [key] [value]');
  process.exit(1);
}
