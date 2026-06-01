import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { config } from './config.js';
import * as db from './db.js';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const currentLevel = LOG_LEVELS[config.logLevel as keyof typeof LOG_LEVELS] ?? 1;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.resolve(__dirname, '..', 'logs');

let logStream: fs.WriteStream | null = null;

function ensureStream(): fs.WriteStream {
  if (logStream) return logStream;
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const name = `proxy_${y}${mo}${dd}_${h}${mi}${s}.log`;
  logStream = fs.createWriteStream(path.join(logDir, name), { flags: 'a', encoding: 'utf-8' });
  return logStream;
}

export const logBus = new EventEmitter();
logBus.setMaxListeners(50);

export function getRecentLogs(count = 200): any[] {
  return db.getRecentLogs(count);
}

export function clearLogBuffer(): void {
  db.clearLogs();
  logBus.emit('cleared');
}

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: string, msg: string, meta?: Record<string, unknown>) {
  const ts = timestamp();
  db.insertLog({ timestamp: ts, level, msg, meta: meta ? JSON.stringify(meta) : undefined });
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`;
  ensureStream().write(line + '\n');
  console.log(line);
  logBus.emit('log', { timestamp: ts, level, msg, meta });
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (currentLevel <= 0) log('debug', msg, meta);
  },
  info: (msg: string, meta?: Record<string, unknown>) => {
    if (currentLevel <= 1) log('info', msg, meta);
  },
  warn: (msg: string, meta?: Record<string, unknown>) => {
    if (currentLevel <= 2) log('warn', msg, meta);
  },
  error: (msg: string, meta?: Record<string, unknown>) => {
    if (currentLevel <= 3) log('error', msg, meta);
  },
};
