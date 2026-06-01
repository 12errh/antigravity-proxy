import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger, logBus, getRecentLogs, clearLogBuffer } from './logger.js';
import { poolFetch } from './http-pool.js';
import { requestStore } from './request-store.js';
import { reloadRouter, streamResponse } from './engine.js';
import * as db from './db.js';
import { getAllPricing, savePricing, reload as reloadPricing } from './pricing.js';
import { setRateLimitConfig, getRateLimitConfig, getRateLimitStats, resetRateLimits } from './rate-limiter.js';
import { getBlocklist, saveBlocklist, reload as reloadBlocklist } from './blocklist.js';
import { scanLocalProviders, getCachedLocalProviders } from './local-discovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardHtml = path.resolve(__dirname, '..', 'dashboard', 'index.html');
const logDir = path.resolve(__dirname, '..', 'logs');

// ---- Session helpers ----
function readLogFile(filepath: string): string {
  const raw = fs.readFileSync(filepath);
  if (raw.length >= 2 && raw[0] === 0xFF && raw[1] === 0xFE) {
    return raw.toString('utf16le');
  }
  return raw.toString('utf-8');
}

interface SessionSummary {
  file: string;
  date: string;
  startTime: string;
  endTime: string | null;
  duration: string | null;
  requestCount: number;
  models: string[];
}

function parseSessionFile(filepath: string): SessionSummary | null {
  try {
    const basename = path.basename(filepath);
    const m = basename.match(/proxy_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.log/);
    if (!m) return null;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    const startTime = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;

    const content = readLogFile(filepath);
    const lines = content.split('\n').filter(l => l.trim());

    let lastTs = startTime;
    const models = new Set<string>();
    let requestCount = 0;

    for (const line of lines) {
      const tsMatch = line.match(/^\[([^\]]+)\]/);
      if (tsMatch) lastTs = tsMatch[1];

      if (line.includes('INTERCEPTED:')) {
        requestCount++;
      }

      const modelMatch = line.match(/model=([^\s&]+)/);
      if (modelMatch && !modelMatch[1].includes('gemini')) {
        models.add(modelMatch[1]);
      }
    }

    const endTime = lastTs;
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const durMs = endMs - startMs;
    const duration = durMs > 0
      ? (durMs >= 3600000 ? `${(durMs / 3600000).toFixed(1)}h` : durMs >= 60000 ? `${Math.floor(durMs / 60000)}m ${Math.floor((durMs % 60000) / 1000)}s` : `${Math.floor(durMs / 1000)}s`)
      : null;

    return { file: basename, date, startTime, endTime, duration, requestCount, models: Array.from(models) };
  } catch { return null; }
}

function getSessionsForDate(date: string): SessionSummary[] {
  try {
    const datePrefix = 'proxy_' + date.replace(/-/g, '');
    const files = fs.readdirSync(logDir).filter(f => f.startsWith(datePrefix) && f.endsWith('.log'));
    return files.map(f => parseSessionFile(path.join(logDir, f))).filter((s): s is SessionSummary => s !== null);
  } catch { return []; }
}

function getSessionContent(filename: string): string | null {
  try {
    const filepath = path.join(logDir, path.basename(filename));
    if (!filepath.startsWith(logDir)) return null;
    return readLogFile(filepath);
  } catch { return null; }
}

function deleteSessionFile(filename: string): boolean {
  try {
    const filepath = path.join(logDir, path.basename(filename));
    if (!filepath.startsWith(logDir)) return false;
    fs.unlinkSync(filepath);
    return true;
  } catch { return false; }
}

function getAllSessionDates(): { date: string; count: number }[] {
  try {
    const map = new Map<string, number>();
    const files = fs.readdirSync(logDir).filter(f => f.startsWith('proxy_') && f.endsWith('.log'));
    for (const f of files) {
      const m = f.match(/proxy_(\d{4})(\d{2})(\d{2})_/);
      if (m) {
        const d = `${m[1]}-${m[2]}-${m[3]}`;
        map.set(d, (map.get(d) || 0) + 1);
      }
    }
    return Array.from(map.entries()).map(([date, count]) => ({ date, count })).sort((a, b) => b.date.localeCompare(a.date));
  } catch { return []; }
}

function jsonResp(res: http.ServerResponse, data: any, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(data));
}

function maskKey(key: string): string {
  if (!key) return '';
  return key.length > 8 ? key.slice(0, 4) + '••••' + key.slice(-4) : '••••••••';
}

function readEnv(): Record<string, string> {
  try {
    const envPath = path.resolve(__dirname, '..', '.env');
    const raw = fs.readFileSync(envPath, 'utf-8');
    const result: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.+)/);
      if (m) result[m[1]] = m[2].trim();
    }
    return result;
  } catch { return {}; }
}

function writeEnv(updates: Record<string, string>): boolean {
  try {
    const envPath = path.resolve(__dirname, '..', '.env');
    let raw = fs.readFileSync(envPath, 'utf-8');
    for (const [k, v] of Object.entries(updates)) {
      const re = new RegExp(`^${k}=.*`, 'm');
      if (re.test(raw)) raw = raw.replace(re, `${k}=${v}`);
      else raw += `\n${k}=${v}`;
    }
    fs.writeFileSync(envPath, raw, 'utf-8');
    return true;
  } catch { return false; }
}

function readModels(): Record<string, string> {
  try {
    const modelsPath = path.resolve(__dirname, '..', 'models.json');
    return JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
  } catch { return {}; }
}

function writeModels(models: Record<string, string>): boolean {
  try {
    const modelsPath = path.resolve(__dirname, '..', 'models.json');
    fs.writeFileSync(modelsPath, JSON.stringify(models, null, 2), 'utf-8');
    return true;
  } catch { return false; }
}

export function createDashboardHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const method = req.method || 'GET';

    // Serve dashboard SPA
    if (url.pathname === '/' && method === 'GET') {
      if (fs.existsSync(dashboardHtml)) {
        const html = fs.readFileSync(dashboardHtml, 'utf-8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<h1>Dashboard</h1><p>Build dashboard/index.html</p>');
      }
      return;
    }

    // API routes
    if (url.pathname === '/api/status' && method === 'GET') {
      const env = readEnv();
      const stats = requestStore.getStats();
      jsonResp(res, {
        provider: config.provider,
        baseUrl: config.baseUrl,
        configured: config.isConfigured,
        apiPort: config.apiPort,
        proxyPort: config.proxyPort,
        logLevel: config.logLevel,
        retries: config.retries,
        backoffMs: config.backoffMs,
        rateLimitGlobal: config.rateLimitGlobal,
        rateLimitProvider: config.rateLimitProvider,
        rateLimitWindow: config.rateLimitWindow,
        providerPriority: config.providerPriority,
        providers: config.providers.map(p => ({ id: p.id, priority: p.priority, hasKey: !!p.apiKey, enabled: p.enabled })),
        env: { PROVIDER: env.PROVIDER, LOG_LEVEL: env.LOG_LEVEL, PROXY_PORT: env.PROXY_PORT, API_PORT: env.API_PORT, PROVIDER_PRIORITY: env.PROVIDER_PRIORITY, PROXY_RETRIES: env.PROXY_RETRIES, PROXY_BACKOFF_MS: env.PROXY_BACKOFF_MS, NVIDIA_API_KEY: maskKey(env.NVIDIA_API_KEY), OPENROUTER_API_KEY: maskKey(env.OPENROUTER_API_KEY), ANTHROPIC_API_KEY: maskKey(env.ANTHROPIC_API_KEY), OPENAI_API_KEY: maskKey(env.OPENAI_API_KEY), GROQ_API_KEY: maskKey(env.GROQ_API_KEY), GOOGLE_API_KEY: maskKey(env.GOOGLE_API_KEY) },
        stats,
      });
      return;
    }

    if (url.pathname === '/api/config' && method === 'GET') {
      jsonResp(res, readEnv());
      return;
    }

    if (url.pathname === '/api/config' && method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        try {
          const updates = JSON.parse(body);
          if (writeEnv(updates)) {
            config.reload();
            reloadRouter();
            setRateLimitConfig({ globalMax: config.rateLimitGlobal, providerMax: config.rateLimitProvider, windowMs: config.rateLimitWindow });
            jsonResp(res, { ok: true });
          } else jsonResp(res, { ok: false, error: 'write failed' }, 500);
        } catch (e: any) { jsonResp(res, { ok: false, error: e.message }, 400); }
      });
      return;
    }

    if (url.pathname === '/api/models' && method === 'GET') {
      jsonResp(res, readModels());
      return;
    }

    if (url.pathname === '/api/models' && method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        try {
          const models = JSON.parse(body);
          if (writeModels(models)) {
            reloadRouter();
            jsonResp(res, { ok: true });
          } else jsonResp(res, { ok: false, error: 'write failed' }, 500);
        } catch (e: any) { jsonResp(res, { ok: false, error: e.message }, 400); }
      });
      return;
    }

    if (url.pathname === '/api/reload' && method === 'POST') {
      try {
        config.reload();
        reloadRouter();
        logger.info('[dashboard] Hot-reload complete');
        jsonResp(res, { ok: true });
      } catch (e: any) { jsonResp(res, { ok: false, error: e.message }, 500); }
      return;
    }

    // Fetch models available on a provider
    if (url.pathname === '/api/provider-models' && method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', async () => {
        try {
          const { provider, apiKey } = JSON.parse(body);

          const defaults: Record<string, { baseUrl: string; envKey: string }> = {
            nvidia:    { baseUrl: 'https://integrate.api.nvidia.com/v1',         envKey: 'NVIDIA_API_KEY' },
            openrouter:{ baseUrl: 'https://openrouter.ai/api/v1',                envKey: 'OPENROUTER_API_KEY' },
            openai:    { baseUrl: 'https://api.openai.com/v1',                   envKey: 'OPENAI_API_KEY' },
            groq:      { baseUrl: 'https://api.groq.com/openai/v1',             envKey: 'GROQ_API_KEY' },
            anthropic: { baseUrl: 'https://api.anthropic.com/v1',                envKey: 'ANTHROPIC_API_KEY' },
            google:    { baseUrl: 'https://generativelanguage.googleapis.com',    envKey: 'GOOGLE_API_KEY' },
            ollama:    { baseUrl: 'http://localhost:11434',                      envKey: '' },
            vllm:      { baseUrl: 'http://localhost:8000',                       envKey: '' },
            lmstudio:  { baseUrl: 'http://localhost:1234',                       envKey: '' },
          };

          const def = defaults[provider as string];
          if (!def) { jsonResp(res, { error: 'Unknown provider' }, 400); return; }

          const key = apiKey || (def.envKey ? (process.env[def.envKey] || '') : '');
          let models: string[] = [];

          if (provider === 'google') {
            const u = `${def.baseUrl}/v1/models?key=${encodeURIComponent(key)}`;
            const r = await poolFetch(u);
            const d = await r.json();
            models = (d.models || []).map((m: any) => m.name.replace(/^models\//, ''));
          } else {
            const h: Record<string, string> = {};
            if (provider === 'anthropic') { h['x-api-key'] = key; h['anthropic-version'] = '2023-06-01'; }
            else if (key) h['Authorization'] = `Bearer ${key}`;
            const url = provider === 'ollama' ? `${def.baseUrl}/api/tags` : `${def.baseUrl}/models`;
            const r = await poolFetch(url, { headers: h });
            const d = await r.json();
            if (provider === 'ollama') models = (d.models || []).map((m: any) => m.name);
            else models = (d.data || []).map((m: any) => m.id);
          }

          models.sort();
          jsonResp(res, { models });
        } catch (e: any) { jsonResp(res, { error: e.message }, 500); }
      });
      return;
    }

    if (url.pathname === '/api/requests' && method === 'GET') {
      jsonResp(res, requestStore.getAll());
      return;
    }

    if (url.pathname === '/api/requests' && method === 'DELETE') {
      requestStore.clear();
      jsonResp(res, { ok: true });
      return;
    }

    if (url.pathname === '/api/requests/dates' && method === 'GET') {
      jsonResp(res, requestStore.getDates());
      return;
    }

    if (url.pathname === '/api/requests/by-date' && method === 'GET') {
      const date = (url.searchParams.get('date') || '').trim();
      if (!date) { jsonResp(res, { error: 'date param required' }, 400); return; }
      jsonResp(res, requestStore.getByDate(date));
      return;
    }

    if (url.pathname === '/api/requests/search' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) { jsonResp(res, { rows: [], total: 0 }); return; }
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const perPage = parseInt(url.searchParams.get('per_page') || '50', 10);
      jsonResp(res, requestStore.search(q, page, perPage));
      return;
    }

    // Session history (legacy — kept for log view access)
    if (url.pathname === '/api/sessions' && method === 'GET') {
      const date = (url.searchParams.get('date') || '').trim();
      if (date) {
        jsonResp(res, getSessionsForDate(date));
      } else {
        jsonResp(res, getAllSessionDates());
      }
      return;
    }

    if (url.pathname === '/api/sessions/content' && method === 'GET') {
      const file = (url.searchParams.get('file') || '').trim();
      if (!file) { jsonResp(res, { error: 'file param required' }, 400); return; }
      const content = getSessionContent(file);
      if (content === null) { jsonResp(res, { error: 'not found' }, 404); return; }
      jsonResp(res, { file, content });
      return;
    }

    if (url.pathname === '/api/sessions' && method === 'DELETE') {
      const file = (url.searchParams.get('file') || '').trim();
      if (!file) { jsonResp(res, { error: 'file param required' }, 400); return; }
      if (deleteSessionFile(file)) jsonResp(res, { ok: true });
      else jsonResp(res, { error: 'not found' }, 404);
      return;
    }

    if (url.pathname === '/api/logs' && method === 'GET') {
      try {
        const logs = getRecentLogs();
        jsonResp(res, logs);
      } catch (e: any) {
        logger.error('dashboard logs API error', { error: e.message, stack: e.stack });
        jsonResp(res, { error: e.message }, 500);
      }
      return;
    }

    if (url.pathname === '/api/logs' && method === 'DELETE') {
      clearLogBuffer();
      jsonResp(res, { ok: true });
      return;
    }

    // Cost & Pricing
    if (url.pathname === '/api/cost' && method === 'GET') {
      jsonResp(res, {
        byDay: db.getCostAggregation('day'),
        byModel: db.getCostAggregation('model'),
        byProvider: db.getCostAggregation('provider'),
        total: db.getStats(),
      });
      return;
    }

    if (url.pathname === '/api/pricing' && method === 'GET') {
      jsonResp(res, getAllPricing());
      return;
    }

    if (url.pathname === '/api/pricing' && method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (savePricing(data)) { reloadPricing(); jsonResp(res, { ok: true }); }
          else jsonResp(res, { ok: false, error: 'write failed' }, 500);
        } catch (e: any) { jsonResp(res, { ok: false, error: e.message }, 400); }
      });
      return;
    }

    if (url.pathname === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'access-control-allow-origin': '*',
      });
      res.write('event: connected\ndata: {}\n\n');

      const onLog = (entry: any) => {
        res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
      };
      const onRequest = (record: any) => {
        res.write(`event: request\ndata: ${JSON.stringify(record)}\n\n`);
      };
      const onClear = () => {
        res.write(`event: cleared\ndata: {}\n\n`);
      };

      logBus.on('log', onLog);
      logBus.on('cleared', onClear);
      requestStore.on('request', onRequest);
      requestStore.on('cleared', onClear);

      const sent = setInterval(() => res.write(':keepalive\n\n'), 15000);

      req.on('close', () => {
        logBus.off('log', onLog);
        logBus.off('cleared', onClear);
        requestStore.off('request', onRequest);
        requestStore.off('cleared', onClear);
        clearInterval(sent);
      });
      return;
    }

    // Rate limit config
    if (url.pathname === '/api/rate-limit' && method === 'GET') {
      jsonResp(res, { config: getRateLimitConfig(), stats: getRateLimitStats() });
      return;
    }
    if (url.pathname === '/api/rate-limit' && method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          setRateLimitConfig({ globalMax: data.globalMax, providerMax: data.providerMax, windowMs: data.windowMs });
          jsonResp(res, { ok: true });
        } catch (e: any) { jsonResp(res, { ok: false, error: e.message }, 400); }
      });
      return;
    }
    if (url.pathname === '/api/rate-limit/reset' && method === 'POST') {
      resetRateLimits();
      jsonResp(res, { ok: true });
      return;
    }

    // Blocklist
    if (url.pathname === '/api/blocklist' && method === 'GET') {
      jsonResp(res, getBlocklist());
      return;
    }
    if (url.pathname === '/api/blocklist' && method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (saveBlocklist(data)) { reloadBlocklist(); jsonResp(res, { ok: true }); }
          else jsonResp(res, { ok: false, error: 'write failed' }, 500);
        } catch (e: any) { jsonResp(res, { ok: false, error: e.message }, 400); }
      });
      return;
    }

    // Local provider discovery
    if (url.pathname === '/api/local/discover' && method === 'POST') {
      scanLocalProviders().then(results => {
        jsonResp(res, { providers: results });
      });
      return;
    }
    if (url.pathname === '/api/local/discover' && method === 'GET') {
      jsonResp(res, { providers: getCachedLocalProviders() });
      return;
    }
    if (url.pathname === '/api/local/apply' && method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          config.setLocalProviders(data.providers || getCachedLocalProviders());
          reloadRouter();
          jsonResp(res, { ok: true, providers: config.providers.map(p => ({ id: p.id, priority: p.priority, hasKey: !!p.apiKey, enabled: p.enabled })) });
        } catch (e: any) { jsonResp(res, { ok: false, error: e.message }, 400); }
      });
      return;
    }

    // Unified search across requests, sessions, logs
    if (url.pathname === '/api/search' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) { jsonResp(res, { requests: { rows: [], total: 0 }, sessions: { rows: [], total: 0 }, logs: { rows: [], total: 0 } }); return; }
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const perPage = parseInt(url.searchParams.get('per_page') || '20', 10);
      jsonResp(res, requestStore.searchAll(q, page, perPage));
      return;
    }

    // Replay a request
    if (url.pathname === '/api/replay' && method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', async () => {
        try {
          const { model, messages } = JSON.parse(body);
          if (!model || !messages) { jsonResp(res, { ok: false, error: 'model and messages required' }, 400); return; }
          const mapped: any = { messages };
          let text = '';
          for await (const chunk of streamResponse(mapped, model)) {
            const c = chunk as any;
            if (c.type === 'text') text += c.content;
            if (c.type === 'error') throw new Error(c.content);
          }
          jsonResp(res, { ok: true, text });
        } catch (e: any) { jsonResp(res, { ok: false, error: e.message }, 400); }
      });
      return;
    }

    jsonResp(res, { error: 'not found' }, 404);
  };
  return handler;
}
