import { EventEmitter } from 'events';
import { config } from './config.js';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const currentLevel = LOG_LEVELS[config.logLevel as keyof typeof LOG_LEVELS] ?? 1;

export const logBus = new EventEmitter();
logBus.setMaxListeners(50);

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: string, msg: string, meta?: Record<string, unknown>) {
  const entry = { timestamp: timestamp(), level, msg, meta };
  const extra = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${msg}${extra}`);
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
