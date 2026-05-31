import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger, logBus, getRecentLogs, clearLogBuffer } from './logger.js';
import { requestStore } from './request-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardHtml = path.resolve(__dirname, '..', 'dashboard', 'index.html');

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
        env: { PROVIDER: env.PROVIDER, LOG_LEVEL: env.LOG_LEVEL, PROXY_PORT: env.PROXY_PORT, API_PORT: env.API_PORT, NVIDIA_API_KEY: maskKey(env.NVIDIA_API_KEY), OPENROUTER_API_KEY: maskKey(env.OPENROUTER_API_KEY) },
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
          if (writeEnv(updates)) jsonResp(res, { ok: true });
          else jsonResp(res, { ok: false, error: 'write failed' }, 500);
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
          if (writeModels(models)) jsonResp(res, { ok: true });
          else jsonResp(res, { ok: false, error: 'write failed' }, 500);
        } catch (e: any) { jsonResp(res, { ok: false, error: e.message }, 400); }
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

    jsonResp(res, { error: 'not found' }, 404);
  };
  return handler;
}
