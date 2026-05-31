import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { config } from './config.js';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const currentLevel = LOG_LEVELS[config.logLevel as keyof typeof LOG_LEVELS] ?? 1;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.resolve(__dirname, '..', 'logs');
function makeLogFilename(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `proxy_${y}${mo}${dd}_${h}${mi}${s}.log`;
}
const logFile = path.join(logDir, makeLogFilename());
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logStream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf-8' });

export const logBus = new EventEmitter();
logBus.setMaxListeners(50);

const logBuffer: { timestamp: string; level: string; msg: string; meta?: Record<string, unknown> }[] = [];
const MAX_LOG = 500;

export function getRecentLogs(count = 200): typeof logBuffer {
  return logBuffer.slice(-count);
}

export function clearLogBuffer(): void {
  logBuffer.length = 0;
  logBus.emit('cleared');
}

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: string, msg: string, meta?: Record<string, unknown>) {
  const entry = { timestamp: timestamp(), level, msg, meta };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG) logBuffer.shift();
  const line = `[${entry.timestamp}] [${level.toUpperCase()}] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`;
  logStream.write(line + '\n');
  console.log(line);
  logBus.emit('log', entry);
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
