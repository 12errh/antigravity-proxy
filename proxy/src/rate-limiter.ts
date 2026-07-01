import { logger } from './logger.js';

interface RateLimitConfig {
  globalMax: number;
  providerMax: number;
  windowMs: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  globalMax: 60,
  providerMax: 30,
  windowMs: 60000,
};

let config: RateLimitConfig = { ...DEFAULT_CONFIG };

const windows = new Map<string, number[]>();
const globalKey = '__global__';

function prune(key: string, now: number): void {
  const timestamps = windows.get(key);
  if (!timestamps) return;
  const cutoff = now - config.windowMs;
  let i = 0;
  while (i < timestamps.length && timestamps[i] < cutoff) i++;
  if (i > 0) {
    const remaining = timestamps.slice(i);
    if (remaining.length === 0) {
      windows.delete(key);
    } else {
      windows.set(key, remaining);
    }
  }
}

export function checkRateLimit(provider?: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  if (config.globalMax > 0) {
    prune(globalKey, now);
    const globalTimestamps = windows.get(globalKey) || [];
    if (globalTimestamps.length >= config.globalMax) {
      const oldest = globalTimestamps[0] || now;
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000)) };
    }
  }
  if (provider && config.providerMax > 0) {
    prune(provider, now);
    const provTimestamps = windows.get(provider) || [];
    if (provTimestamps.length >= config.providerMax) {
      const oldest = provTimestamps[0] || now;
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000)) };
    }
  }
  return { allowed: true, retryAfter: 0 };
}

export function recordRequest(provider?: string): void {
  const now = Date.now();
  prune(globalKey, now);
  const globalTimestamps = windows.get(globalKey) || [];
  globalTimestamps.push(now);
  windows.set(globalKey, globalTimestamps);
  if (provider) {
    prune(provider, now);
    const provTimestamps = windows.get(provider) || [];
    provTimestamps.push(now);
    windows.set(provider, provTimestamps);
  }
}

export function setRateLimitConfig(cfg: Partial<RateLimitConfig>): void {
  if (cfg.globalMax !== undefined) config.globalMax = cfg.globalMax;
  if (cfg.providerMax !== undefined) config.providerMax = cfg.providerMax;
  if (cfg.windowMs !== undefined) config.windowMs = cfg.windowMs;
}

export function getRateLimitConfig(): RateLimitConfig & { active: boolean } {
  return { ...config, active: config.globalMax > 0 || config.providerMax > 0 };
}

export function getRateLimitStats(): { global: number; providers: Record<string, number> } {
  const now = Date.now();
  const cutoff = now - config.windowMs;
  const stats: { global: number; providers: Record<string, number> } = { global: 0, providers: {} };
  for (const [key, timestamps] of windows) {
    const count = timestamps.filter(t => t >= cutoff).length;
    if (key === globalKey) stats.global = count;
    else stats.providers[key] = count;
  }
  return stats;
}

export function resetRateLimits(): void {
  windows.clear();
  logger.info('[rate-limiter] All rate limit windows cleared');
}
