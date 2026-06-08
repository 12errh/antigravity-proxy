import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { config } from './config.js';
import * as db from './db.js';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

// Read log level dynamically so config.reload() takes effect without restart.
function getCurrentLevel(): number {
  return LOG_LEVELS[config.logLevel as keyof typeof LOG_LEVELS] ?? 1;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.resolve(__dirname, '..', 'logs');

const LOG_MAX_SIZE_BYTES = Math.max(0, parseInt(process.env.LOG_MAX_SIZE_MB || '25', 10)) * 1024 * 1024;
const LOG_MAX_FILES = Math.max(1, parseInt(process.env.LOG_MAX_FILES || '7', 10));
const LOG_MAX_AGE_DAYS = Math.max(1, parseInt(process.env.LOG_MAX_AGE_DAYS || '14', 10));

let logStream: fs.WriteStream | null = null;
let currentLogFile: string | null = null;
let currentLogSize = 0;

function makeLogFilename(d: Date = new Date()): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `proxy_${y}${mo}${dd}_${h}${mi}${s}.log`;
}

function pruneOldLogs(): void {
  try {
    if (!fs.existsSync(logDir)) return;
    const now = Date.now();
    const maxAgeMs = LOG_MAX_AGE_DAYS * 86400 * 1000;
    const files = fs.readdirSync(logDir)
      .filter(f => f.startsWith('proxy_') && f.endsWith('.log'))
      .map(f => {
        const p = path.join(logDir, f);
        try { return { p, mtime: fs.statSync(p).mtimeMs, size: fs.statSync(p).size }; } catch { return null; }
      })
      .filter((x): x is { p: string; mtime: number; size: number } => x !== null);

    for (const f of files) {
      if (now - f.mtime > maxAgeMs) {
        try { fs.unlinkSync(f.p); } catch { /* ignore */ }
      }
    }

    const remaining = files
      .filter(f => fs.existsSync(f.p))
      .sort((a, b) => b.mtime - a.mtime);
    if (remaining.length > LOG_MAX_FILES) {
      for (const f of remaining.slice(LOG_MAX_FILES)) {
        try { fs.unlinkSync(f.p); } catch { /* ignore */ }
      }
    }
  } catch { /* best-effort */ }
}

function rotateIfNeeded(): void {
  if (LOG_MAX_SIZE_BYTES <= 0) return;
  if (!currentLogFile) return;
  if (currentLogSize < LOG_MAX_SIZE_BYTES) return;
  try {
    if (logStream) { logStream.end(); logStream = null; }
    const rotated = currentLogFile.replace(/\.log$/, '.1.log');
    try { fs.renameSync(currentLogFile, rotated); } catch { /* ignore */ }
    currentLogFile = null;
    currentLogSize = 0;
    pruneOldLogs();
  } catch { /* ignore */ }
}

function ensureStream(): fs.WriteStream {
  if (logStream) return logStream;
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  pruneOldLogs();
  const name = makeLogFilename();
  const filepath = path.join(logDir, name);
  currentLogFile = filepath;
  try { currentLogSize = fs.statSync(filepath).size; } catch { currentLogSize = 0; }
  logStream = fs.createWriteStream(filepath, { flags: 'a', encoding: 'utf-8' });
  logStream.on('drain', () => { /* noop */ });
  return logStream;
}

export function getLogStats(): { current: string | null; sizeBytes: number; maxBytes: number; files: number; maxFiles: number; maxAgeDays: number } {
  let count = 0;
  try {
    if (fs.existsSync(logDir)) {
      count = fs.readdirSync(logDir).filter(f => f.startsWith('proxy_') && f.endsWith('.log')).length;
    }
  } catch { /* ignore */ }
  return { current: currentLogFile, sizeBytes: currentLogSize, maxBytes: LOG_MAX_SIZE_BYTES, files: count, maxFiles: LOG_MAX_FILES, maxAgeDays: LOG_MAX_AGE_DAYS };
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
  try { db.insertLog({ timestamp: ts, level, msg, meta: meta ? JSON.stringify(meta) : undefined }); } catch { /* db may not be ready */ }
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`;
  rotateIfNeeded();
  const stream = ensureStream();
  const written = stream.write(line + '\n');
  currentLogSize += Buffer.byteLength(line + '\n');
  if (written === false) { /* backpressure handled by node */ }
  console.log(line);
  logBus.emit('log', { timestamp: ts, level, msg, meta });
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (getCurrentLevel() <= 0) log('debug', msg, meta);
  },
  info: (msg: string, meta?: Record<string, unknown>) => {
    if (getCurrentLevel() <= 1) log('info', msg, meta);
  },
  warn: (msg: string, meta?: Record<string, unknown>) => {
    if (getCurrentLevel() <= 2) log('warn', msg, meta);
  },
  error: (msg: string, meta?: Record<string, unknown>) => {
    if (getCurrentLevel() <= 3) log('error', msg, meta);
  },
};
