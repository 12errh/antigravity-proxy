import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger, logBus, getRecentLogs, clearLogBuffer, getLogStats } from './logger.js';
import { poolFetch } from './http-pool.js';
import { requestStore } from './request-store.js';
import { reloadRouter, streamResponse } from './engine.js';
import * as db from './db.js';
import { getAllPricing, savePricing, reload as reloadPricing } from './pricing.js';
import { setRateLimitConfig, getRateLimitConfig, getRateLimitStats, resetRateLimits } from './rate-limiter.js';
import { getBlocklist, saveBlocklist, reload as reloadBlocklist } from './blocklist.js';
import { scanLocalProviders, getCachedLocalProviders } from './local-discovery.js';
import { fetchProviderModels, getCachedProviderModels, clearProviderCache, warmProviderCache } from './provider-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardHtml = path.resolve(__dirname, '..', 'dashboard', 'index.html');
const logDir = path.resolve(__dirname, '..', 'logs');

// ---- Session helpers (DB-backed, no raw log reads) ----

interface SessionSummary {
  file: string;
  date: string;
  startTime: string;
  endTime: string | null;
  duration: string | null;
  requestCount: number;
  models: string[];
  sizeBytes: number;
}

interface SessionCacheEntry {
  date: string;
  count: number;
  sessions: SessionSummary[];
  cachedAt: number;
}

let sessionListCache: SessionCacheEntry[] = [];
let sessionListCacheTime = 0;
const SESSION_LIST_CACHE_TTL_MS = 30_000;

function fileToSession(file: string, stat: fs.Stats): SessionSummary | null {
  const m = file.match(/proxy_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.log$/);
  if (!m) return null;
  const [, yr, mo, dy, hr, mi, sc] = m;
  const date = `${yr}-${mo}-${dy}`;
  const startTime = `${date}T${hr}:${mi}:${sc}`;
  return { file, date, startTime, endTime: null, duration: null, requestCount: 0, models: [], sizeBytes: stat.size };
}

function refreshSessionListCache(): SessionCacheEntry[] {
  const now = Date.now();
  if (now - sessionListCacheTime < SESSION_LIST_CACHE_TTL_MS && sessionListCache.length > 0) {
    return sessionListCache;
  }
  try {
    if (!fs.existsSync(logDir)) { sessionListCache = []; sessionListCacheTime = now; return []; }
    const files = fs.readdirSync(logDir).filter(f => f.startsWith('proxy_') && f.endsWith('.log'));
    const byDate = new Map<string, SessionSummary[]>();
    for (const f of files) {
      try {
        const st = fs.statSync(path.join(logDir, f));
        const summary = fileToSession(f, st);
        if (!summary) continue;
        const list = byDate.get(summary.date) || [];
        list.push(summary);
        byDate.set(summary.date, list);
      } catch { /* ignore */ }
    }
    const entries: SessionCacheEntry[] = [];
    for (const [date, sessions] of byDate) {
      sessions.sort((a, b) => a.startTime.localeCompare(b.startTime));
      // Backfill request count from DB (cheap, indexed by timestamp)
      for (const s of sessions) {
        const sessionStart = new Date(s.startTime);
        const reqs = db.getRequestsByTimeRange(sessionStart.toISOString());
        s.requestCount = reqs.length;
        if (reqs.length > 0) {
          const models = new Set<string>();
          for (const r of reqs) { if (r.model) models.add(r.model); }
          s.models = Array.from(models);
          const firstTs = reqs[0].timestamp;
          const lastTs = reqs[reqs.length - 1].timestamp;
          s.endTime = lastTs;
          const durMs = new Date(lastTs).getTime() - new Date(firstTs).getTime();
          s.duration = durMs > 0
            ? (durMs >= 3600000 ? `${(durMs / 3600000).toFixed(1)}h` : durMs >= 60000 ? `${Math.floor(durMs / 60000)}m ${Math.floor((durMs % 60000) / 1000)}s` : `${Math.floor(durMs / 1000)}s`)
            : '—';
        }
      }
      entries.push({ date, count: sessions.length, sessions, cachedAt: now });
    }
    entries.sort((a, b) => b.date.localeCompare(a.date));
    sessionListCache = entries;
    sessionListCacheTime = now;
    return entries;
  } catch (err: any) {
    logger.warn('[dashboard] session list refresh failed', { error: err.message });
    return sessionListCache;
  }
}

function invalidateSessionListCache(): void {
  sessionListCacheTime = 0;
}

function getSessionDates(): { date: string; count: number; totalSizeBytes: number }[] {
  return refreshSessionListCache().map(e => ({
    date: e.date,
    count: e.count,
    totalSizeBytes: e.sessions.reduce((s, x) => s + x.sizeBytes, 0),
  }));
}

function getSessionsForDate(date: string): SessionSummary[] {
  const entry = refreshSessionListCache().find(e => e.date === date);
  return entry ? entry.sessions : [];
}

function getSessionContent(filename: string, maxBytes = 2_000_000): { content: string; truncated: boolean; sizeBytes: number } | null {
  try {
    const filepath = path.join(logDir, path.basename(filename));
    if (!filepath.startsWith(logDir)) return null;
    const stat = fs.statSync(filepath);
    const fd = fs.openSync(filepath, 'r');
    try {
      const size = stat.size;
      const readSize = Math.min(size, maxBytes);
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, size - readSize);
      const text = (size >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) ? buf.toString('utf16le') : buf.toString('utf-8');
      return { content: text, truncated: size > readSize, sizeBytes: size };
    } finally {
      fs.closeSync(fd);
    }
  } catch { return null; }
}

function deleteSessionFile(filename: string): boolean {
  try {
    const filepath = path.join(logDir, path.basename(filename));
    if (!filepath.startsWith(logDir)) return false;
    fs.unlinkSync(filepath);
    invalidateSessionListCache();
    return true;
  } catch { return false; }
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

    // Basic auth check (skip for health endpoint)
    if (url.pathname !== '/api/health' && config.dashboardUser && config.dashboardPassword) {
      const auth = req.headers.authorization || '';
      const b64 = auth.startsWith('Basic ') ? auth.slice(6) : '';
      let valid = false;
      try {
        const decoded = Buffer.from(b64, 'base64').toString();
        const [user, pass] = decoded.split(':');
        valid = user === config.dashboardUser && pass === config.dashboardPassword;
      } catch {}
      if (!valid) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="Antigravity Proxy Dashboard"' });
        res.end('Unauthorized');
        return;
      }
    }

    // Health endpoint (no auth required)
    if (url.pathname === '/api/health' && method === 'GET') {
      jsonResp(res, { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
      return;
    }

    // Cert info endpoint
    if (url.pathname === '/api/cert' && method === 'GET') {
      const certPath = path.resolve(__dirname, '..', 'certs', 'cert.pem');
      try {
        if (!fs.existsSync(certPath)) { jsonResp(res, { status: 'missing' }); return; }
        const pem = fs.readFileSync(certPath, 'utf-8');
        const cert = new crypto.X509Certificate(pem);
        jsonResp(res, {
          status: 'ok',
          subject: cert.subject,
          issuer: cert.issuer,
          validFrom: cert.validFrom,
          validTo: cert.validTo,
          fingerprint: cert.fingerprint,
          serialNumber: cert.serialNumber,
          daysRemaining: Math.floor((new Date(cert.validTo).getTime() - Date.now()) / 86400000),
        });
      } catch (e: any) { jsonResp(res, { status: 'error', error: e.message }); }
      return;
    }

    // Auth configure endpoint
    if (url.pathname === '/api/auth/configure' && method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        try {
          const { username, password } = JSON.parse(body);
          if (!username || !password) { jsonResp(res, { ok: false, error: 'Username and password are required' }, 400); return; }
          if (writeEnv({ DASHBOARD_USER: username, DASHBOARD_PASSWORD: password })) {
            config.reload();
            logger.info('[dashboard] Auth credentials updated via dashboard');
            jsonResp(res, { ok: true });
          } else { jsonResp(res, { ok: false, error: 'Failed to write .env' }, 500); }
        } catch (e: any) { jsonResp(res, { ok: false, error: e.message }, 400); }
      });
      return;
    }

    // Auth disable endpoint
    if (url.pathname === '/api/auth/disable' && method === 'POST') {
      if (writeEnv({ DASHBOARD_USER: '', DASHBOARD_PASSWORD: '' })) {
        config.reload();
        logger.info('[dashboard] Auth disabled via dashboard');
        jsonResp(res, { ok: true });
      } else { jsonResp(res, { ok: false, error: 'Failed to write .env' }, 500); }
      return;
    }

    // Webhook configure endpoint
    if (url.pathname === '/api/webhook/configure' && method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        try {
          const { url: webhookUrl } = JSON.parse(body);
          if (writeEnv({ FAILOVER_WEBHOOK_URL: webhookUrl || '' })) {
            config.reload();
            logger.info('[dashboard] Webhook URL updated via dashboard');
            jsonResp(res, { ok: true });
          } else { jsonResp(res, { ok: false, error: 'Failed to write .env' }, 500); }
        } catch (e: any) { jsonResp(res, { ok: false, error: e.message }, 400); }
      });
      return;
    }

    // Webhook test endpoint
    if (url.pathname === '/api/webhook-test' && method === 'POST') {
      const webhookUrl = config.failoverWebhookUrl;
      if (!webhookUrl) { jsonResp(res, { ok: false, error: 'No FAILOVER_WEBHOOK_URL configured' }); return; }
      const body = JSON.stringify({ event: 'test', timestamp: new Date().toISOString(), message: 'Antigravity webhook test' });
      fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
        .then(r => r.text().then(t => jsonResp(res, { ok: r.ok, status: r.status, body: t })))
        .catch((e: any) => jsonResp(res, { ok: false, error: e.message }));
      return;
    }

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
      const stats = requestStore.getStats(true);
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
        dashboardAuth: !!config.dashboardUser && !!config.dashboardPassword,
        failoverWebhookUrl: config.failoverWebhookUrl || '',
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

    // Fetch models available on a provider (POST = fetch, GET = cached)
    if (url.pathname === '/api/provider-models' && method === 'GET') {
      const provider = (url.searchParams.get('provider') || '').trim();
      if (!provider) {
        const all = ['nvidia','openrouter','openai','groq','anthropic','google','ollama','vllm','lmstudio']
          .map(p => ({ provider: p, ...(getCachedProviderModels(p) || { models: [], fetchedAt: 0, error: 'not fetched' }) }));
        jsonResp(res, { providers: all });
        return;
      }
      const cached = getCachedProviderModels(provider);
      jsonResp(res, cached || { models: [], fetchedAt: 0, error: 'not fetched' });
      return;
    }

    if (url.pathname === '/api/provider-models' && method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', async () => {
        try {
          const { provider, apiKey, force } = JSON.parse(body);
          if (!provider) { jsonResp(res, { error: 'provider required' }, 400); return; }
          const result = await fetchProviderModels(provider, apiKey, !!force);
          jsonResp(res, result);
        } catch (e: any) { jsonResp(res, { error: e.message }, 500); }
      });
      return;
    }

    if (url.pathname === '/api/provider-models/cache' && method === 'DELETE') {
      const provider = (url.searchParams.get('provider') || '').trim() || undefined;
      clearProviderCache(provider);
      jsonResp(res, { ok: true });
      return;
    }

    if (url.pathname === '/api/provider-models/warm' && method === 'POST') {
      warmProviderCache().then(() => jsonResp(res, { ok: true }));
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

    // Session history (DB-backed; no raw log reads for stats)
    if (url.pathname === '/api/sessions' && method === 'GET') {
      const date = (url.searchParams.get('date') || '').trim();
      if (date) {
        jsonResp(res, getSessionsForDate(date));
      } else {
        jsonResp(res, getSessionDates());
      }
      return;
    }

    if (url.pathname === '/api/sessions/refresh' && method === 'POST') {
      invalidateSessionListCache();
      jsonResp(res, { ok: true });
      return;
    }

    if (url.pathname === '/api/sessions/content' && method === 'GET') {
      const file = (url.searchParams.get('file') || '').trim();
      if (!file) { jsonResp(res, { error: 'file param required' }, 400); return; }
      const content = getSessionContent(file);
      if (content === null) { jsonResp(res, { error: 'not found' }, 404); return; }
      jsonResp(res, { file, content, truncated: content.truncated, sizeBytes: content.sizeBytes });
      return;
    }

    if (url.pathname === '/api/sessions/requests' && method === 'GET') {
      const file = (url.searchParams.get('file') || '').trim();
      if (!file) { jsonResp(res, { error: 'file param required' }, 400); return; }
      const m = file.match(/proxy_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.log/);
      if (!m) { jsonResp(res, { error: 'invalid file name' }, 400); return; }
      const [yr, mo, dy, hr, mi, sc] = [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]];
      const sessionStart = new Date(yr, mo - 1, dy, hr, mi, sc);
      const startTime = sessionStart.toISOString();
      const requests = db.getRequestsByTimeRange(startTime);
      jsonResp(res, requests);
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

    if (url.pathname === '/api/logs/stats' && method === 'GET') {
      jsonResp(res, getLogStats());
      return;
    }

    // Cost & Pricing
    if (url.pathname === '/api/cost' && method === 'GET') {
      const date = (url.searchParams.get('date') || '').trim();
      const all = url.searchParams.get('all') === '1' || url.searchParams.get('all') === 'true';
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const total = db.getCostForDate(date);
        jsonResp(res, {
          scope: 'day',
          date,
          total,
          byDay: [{ key: date, requests: total.requests, prompt_tokens: total.prompt_tokens, output_tokens: total.output_tokens, total_cost: total.total_cost }],
          byModel: db.getCostByModelForDate(date),
          byProvider: db.getCostByProviderForDate(date),
        });
        return;
      }
      jsonResp(res, {
        scope: all ? 'all' : 'today',
        date: null,
        byDay: db.getCostByDay(90),
        byModel: db.getCostAggregation('model', !all),
        byProvider: db.getCostAggregation('provider', !all),
        total: db.getStats(!all),
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

warmProviderCache().catch(err => logger.warn('[dashboard] provider cache warm failed', { error: err.message }));
