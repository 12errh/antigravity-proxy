import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import http2 from 'http2';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger } from './logger.js';
import { validateApiKey } from './auth.js';
import { streamResponse } from './engine.js';
import { mapContentsToMessages, mapTools, mapGenerationConfig, extractToolCalls } from './mapper.js';
import { requestStore } from './request-store.js';
import { createDashboardHandler } from './dashboard.js';
import * as db from './db.js';
import { calculateCost } from './pricing.js';
import { httpPool } from './http-pool.js';
import { checkRateLimit, recordRequest, setRateLimitConfig, resetRateLimits } from './rate-limiter.js';
import { checkBlocked } from './blocklist.js';
import type { Content, Tool, GenerationConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let backendIp = '';

const INTERCEPT_PATHS = new Set([
  '/v1internal:streamGenerateContent',
  '/v1internal:cascadeGenerateContent',
  '/v1internal:cascadeStreamGenerateContent',
]);

async function resolveBackend(hostname: string): Promise<string> {
  if (process.env.GOOGLE_BACKEND_IP) return process.env.GOOGLE_BACKEND_IP;
  const { Resolver } = await import('dns/promises');
  const r = new Resolver();
  r.setServers(['8.8.8.8', '1.1.1.1']);
  const [ip] = await r.resolve4(hostname);
  return ip;
}

// Dashboard handler for port 4000
const dashboardHandler = createDashboardHandler();

// Shared handler for port 4000: dashboard paths or Google forward
function port4000Handler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const pathname = req.url || '/';
  if (pathname === '/' || pathname.startsWith('/api/')) {
    dashboardHandler(req, res);
    return;
  }
  const hostname = 'cloudcode-pa.googleapis.com';
  logger.debug('REST forward', { method: req.method, path: pathname });
  const proxyReq = https.request(
    { hostname: backendIp, port: 443, path: pathname, method: req.method, servername: hostname, rejectUnauthorized: true, headers: { ...req.headers, host: hostname } },
    (proxyRes) => { res.writeHead(proxyRes.statusCode || 200, proxyRes.headers); proxyRes.pipe(res); },
  );
  proxyReq.on('error', (err) => {
    logger.error('REST forward error', { path: pathname, error: err.message });
    if (!res.headersSent) { res.writeHead(502); res.end(`Proxy error: ${err.message}`); }
  });
  req.pipe(proxyReq);
}

function genGoogleId(): string {
  const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
  let r = '';
  for (let i = 0; i < 24; i++) r += c[Math.floor(Math.random() * c.length)];
  return `req_vrtx_${r}`;
}
function genTraceId(): string {
  const h = '0123456789abcdef';
  return Array.from({ length: 16 }, () => h[Math.floor(Math.random() * 16)]).join('');
}
function estTokens(t: string): number { return Math.max(1, Math.ceil(t.length / 4)); }

const BULK_CONTEXT_TAGS = ['skills', 'plugins', 'user_rules'];

function stripInlineContext(contents: Content[]): Content[] {
  const filtered: Content[] = [];
  let hasAdapterRef = false;
  for (const c of contents) {
    const text = c.parts?.map((p: any) => p.text || '').join('') || '';
    const hasBulkTag = BULK_CONTEXT_TAGS.some(tag => text.includes(`<${tag}>`));
    if (!hasBulkTag) {
      filtered.push(c);
      continue;
    }
    // Extract only the USER_REQUEST and ADDITIONAL_METADATA if they exist within this bulk content
    const requestMatch = text.match(/(<USER_REQUEST>[\s\S]*?<\/USER_REQUEST>)/);
    const metaMatch = text.match(/(<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>)/);
    if (requestMatch || metaMatch) {
      const kept: string[] = [];
      if (requestMatch) kept.push(requestMatch[1]);
      if (metaMatch) kept.push(metaMatch[1]);
      if (kept.length > 0) {
        filtered.push({ role: 'user', parts: [{ text: kept.join('\n') }] });
      }
    }
  }
  // Inject agent-context.md reference as first system-level instruction
  const adapterRef = {
    role: 'user' as const,
    parts: [{
      text: `<SYSTEM_ADAPTER>
IMPORTANT: Your workspace rules, skills, plugins, and context inheritance hierarchy are defined in the file:
<file:///D:\\AI_AGENTS\\antigravity\\agent-context.md>

Read that file now using view_file to adopt the Antigravity v2.0 runtime identity.
Do NOT treat the context below as your full context - use the file above as your operating runtime definition.
</SYSTEM_ADAPTER>`,
    }],
  };
  filtered.unshift(adapterRef);
  return filtered;
}

function stripSystemContext(text: string): string {
  if (!text) return '';
  // Strip massive agent identity context that duplicates what's in agent-context.md
  const identityMatch = text.match(/<identity>[\s\S]*?<\/identity>/);
  if (identityMatch && text.length > 2000) {
    return text.replace(/<identity>[\s\S]*?<\/identity>/, 'See agent-context.md for runtime identity.');
  }
  return text;
}

const SAFETY_RATINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', probability: 'NEGLIGIBLE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' },
];

const GROUNDING_METADATA = { groundingChunks: [], groundingSupports: [] };

interface BuildEventOpts {
  modelVersion: string;
  projectPath: string;
  responseId: string;
  traceId: string;
  promptTokens: number;
  finishReason?: string;
  thoughtText?: string;
  functionCalls?: { name: string; args: any }[];
  text?: string;
}

function buildGoogleEvent(opts: BuildEventOpts): string {
  const parts: any[] = [];
  if (opts.thoughtText) parts.push({ thought: true, text: opts.thoughtText });
  if (opts.functionCalls) {
    for (const fc of opts.functionCalls) {
      parts.push({ functionCall: { name: fc.name, args: fc.args } });
    }
  } else if (opts.text != null) {
    parts.push({ text: opts.text });
  }

  const candidate: any = {
    index: 0,
    content: { role: 'model', parts },
    safetyRatings: SAFETY_RATINGS,
    groundingMetadata: GROUNDING_METADATA,
  };
  if (opts.finishReason) candidate.finishReason = opts.finishReason;

  const outTokens = estTokens(opts.text || '');
  return `data: ${JSON.stringify({
    response: {
      candidates: [candidate],
      usageMetadata: {
        promptTokenCount: opts.promptTokens,
        candidatesTokenCount: outTokens,
        totalTokenCount: opts.promptTokens + outTokens,
      },
      modelVersion: `${opts.projectPath}/publishers/${config.provider}/models/${opts.modelVersion}`,
      responseId: opts.responseId,
    },
    traceId: opts.traceId,
    metadata: {},
  })}\n\n`;
}

// Handle SSE streaming generate content (model inference)
async function handleStreamGenerate(req: http2.Http2ServerRequest, res: http2.Http2ServerResponse, body: Buffer): Promise<void> {
  let request: any;
  try {
    request = JSON.parse(body.toString('utf-8'));
  } catch {
    await forwardToGoogle(req, res, body);
    return;
  }

  // The request is wrapped: {"project":"...","requestId":"...","request":{...}}
  const inner = request.request || request;
  const model = inner.model || request.model || 'unknown';
  const projectPath = request.project || 'projects/-/locations/-';
  const tools: Tool[] = inner.tools || [];
  const genConfig: GenerationConfig = inner.generationConfig;

  // Check blocklist against all priority providers + model
  const blockCheck = checkBlocked(config.providerPriority, model);
  if (blockCheck.blocked) {
    logger.warn(`BLOCKED: ${model} — ${blockCheck.reason}`);
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Request blocked: ${blockCheck.reason}`, code: 403 } }));
    return;
  }

  // Check global rate limit
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    logger.warn(`RATE LIMITED: global limit exceeded`);
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(rateCheck.retryAfter) });
    res.end(JSON.stringify({ error: { message: `Rate limit exceeded. Retry after ${rateCheck.retryAfter}s`, code: 429 } }));
    return;
  }

  // Strip massive inline context and inject agent-context.md reference
  const contents = stripInlineContext(inner.contents || []);
  const systemInstruction = stripSystemContext(inner.system_instruction?.parts?.[0]?.text || '');

  const bodyStr = body.toString('utf-8');
  logger.info(`>>> INTERCEPTED: ${req.url} model=${model}`, {
    model, contentCount: contents.length, hasTools: tools.length > 0,
    bodySnippet: bodyStr.substring(0, 500),
  });
  // DEBUG: log full body once to see Antigravity's tool format
  if (!process.env._LOGGED_FULL_BODY) {
    process.env._LOGGED_FULL_BODY = '1';
    logger.info(`FULL BODY: ${bodyStr}`);
  }

  // Estimate prompt tokens from input
  const promptText = JSON.stringify(request);
  const promptTokens = estTokens(promptText);

  const mapped = mapContentsToMessages(contents, systemInstruction);
  const mappedTools = mapTools(tools);
  const cfg = mapGenerationConfig(genConfig);
  Object.assign(mapped, cfg);
  if (mappedTools) {
    mapped.tools = mappedTools;
  }

  logger.info(`  Provider priority: ${config.providerPriority.join(', ')}`);

  const responseId = genGoogleId();
  const traceId = genTraceId();

  requestStore.push({
    id: responseId, timestamp: new Date().toISOString(), model, resolvedModel: model,
    direction: 'incoming', type: 'text', content: `Prompt: ${promptText.substring(0, 500)}${promptText.length > 500 ? '...' : ''}`,
    promptTokens,
  });

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    'x-goog-api-version': '2',
  });

  const genStart = Date.now();
  try {
    const generator = streamResponse(mapped, model);
    let fullText = '';
    let thoughtText = '';
    const toolCalls: { name: string; args: Record<string, unknown> }[] = [];

    let usedProvider = '';
    let usedModel = '';

    for await (const chunk of generator) {
      const ctype = (chunk as any).type as string;
      if ((chunk as any).provider) usedProvider = (chunk as any).provider;
      if ((chunk as any).resolvedModel) usedModel = (chunk as any).resolvedModel;
      if (ctype === 'text') {
        const c = (chunk as any).content as string || '';
        fullText += c;
        // Send only the delta — Google's client concatenates text from each event
        const deltaParts: any[] = [{ text: c }];
        const outTokens = estTokens(fullText + thoughtText);
        res.write(`data: ${JSON.stringify({
          response: {
            candidates: [{
              index: 0, content: { role: 'model', parts: deltaParts },
              safetyRatings: SAFETY_RATINGS, groundingMetadata: GROUNDING_METADATA,
            }],
            usageMetadata: { promptTokenCount: promptTokens, candidatesTokenCount: outTokens, totalTokenCount: promptTokens + outTokens },
            modelVersion: `${projectPath}/publishers/${config.provider}/models/${model}`,
            responseId,
          }, traceId, metadata: {},
        })}\n\n`, 'utf-8');
      } else if (ctype === 'thought') {
        const c = (chunk as any).content as string || '';
        thoughtText += c;
        const deltaParts: any[] = [{ thought: true, text: c }];
        res.write(`data: ${JSON.stringify({
          response: {
            candidates: [{
              index: 0, content: { role: 'model', parts: deltaParts },
              safetyRatings: SAFETY_RATINGS, groundingMetadata: GROUNDING_METADATA,
            }],
            modelVersion: `${projectPath}/publishers/${config.provider}/models/${model}`,
            responseId,
          }, traceId, metadata: {},
        })}\n\n`, 'utf-8');
      } else if (ctype === 'tool-call') {
        toolCalls.push({ name: (chunk as any).name, args: (chunk as any).args });
      }
    }

    const duration = Date.now() - genStart;
    const outputTokens = estTokens(fullText + thoughtText);
    const cost = usedProvider ? calculateCost(usedProvider, usedModel || model, promptTokens, outputTokens) : 0;
    recordRequest(usedProvider);

    // Send final event with finishReason and metadata (no text — already streamed incrementally)
    const hasToolCalls = toolCalls.length > 0;
    if (hasToolCalls) {
      const finalParts: any[] = [];
      if (thoughtText) finalParts.push({ thought: true, text: thoughtText });
      if (fullText) finalParts.push({ text: fullText });
      for (const tc of toolCalls) finalParts.push({ functionCall: { name: tc.name, args: tc.args } });
      const candidate: any = {
        index: 0, content: { role: 'model', parts: finalParts },
        safetyRatings: SAFETY_RATINGS, groundingMetadata: GROUNDING_METADATA,
        finishReason: 'STOP',
      };
      res.write(`data: ${JSON.stringify({
        response: {
          candidates: [candidate],
          usageMetadata: { promptTokenCount: promptTokens, candidatesTokenCount: outputTokens, totalTokenCount: promptTokens + outputTokens },
          modelVersion: `${projectPath}/publishers/${config.provider}/models/${model}`,
          responseId,
        }, traceId, metadata: {},
      })}\n\n`, 'utf-8');
    } else {
      const candidate: any = {
        index: 0, content: { role: 'model', parts: [] },
        safetyRatings: SAFETY_RATINGS, groundingMetadata: GROUNDING_METADATA,
        finishReason: 'STOP',
      };
      res.write(`data: ${JSON.stringify({
        response: {
          candidates: [candidate],
          usageMetadata: { promptTokenCount: promptTokens, candidatesTokenCount: outputTokens, totalTokenCount: promptTokens + outputTokens },
          modelVersion: `${projectPath}/publishers/${config.provider}/models/${model}`,
          responseId,
        }, traceId, metadata: {},
      })}\n\n`, 'utf-8');
    }
    res.end();

    if (toolCalls.length > 0) {
      logger.info(`<<< Completed: ${req.url} (${fullText.length} chars, ${toolCalls.length} tool calls)`, { toolCalls: toolCalls.map(tc => ({ name: tc.name, args: tc.args })) });
      requestStore.push({
        id: responseId, timestamp: new Date().toISOString(), model, resolvedModel: usedModel || model,
        provider: usedProvider, direction: 'outgoing', type: 'tool-call', content: fullText,
        toolCalls: toolCalls.map(tc => ({ name: tc.name, args: tc.args })),
        promptTokens, outputTokens, cost, duration,
      });
    } else {
      logger.info(`<<< Completed: ${req.url} (${fullText.length} chars, model: ${model}, provider: ${usedProvider})`);
      requestStore.push({
        id: responseId, timestamp: new Date().toISOString(), model, resolvedModel: usedModel || model,
        provider: usedProvider, direction: 'outgoing', type: 'text', content: fullText,
        promptTokens, outputTokens, cost, duration,
      });
    }
  } catch (err: any) {
    logger.error(`<<< Error: ${req.url}`, { error: err.message });
    requestStore.push({
        id: responseId, timestamp: new Date().toISOString(), model, resolvedModel: model,
        direction: 'outgoing', type: 'error', content: '',
      error: err.message, duration: Date.now() - genStart,
    });
    const errResp = JSON.stringify({
      response: {
        candidates: [{
          content: { role: 'model', parts: [{ text: `Error: ${err.message}. Check proxy log for details.` }] },
          finishReason: 'ERROR',
        }],
        modelVersion: `${projectPath}/publishers/${config.provider}/models/${model}`,
        responseId,
      },
      traceId,
      error: { message: err.message, code: 503 },
    });
    res.write(`data: ${errResp}\n\n`);
    res.end();
  }
}

// Forward any request to real Google
async function forwardToGoogle(
  req: http2.Http2ServerRequest,
  res: http2.Http2ServerResponse,
  body: Buffer,
): Promise<void> {
  const url = req.url || '/';
  const method = req.method || 'GET';
  const host = req.headers[':authority'] as string || req.headers.host as string || '';
  const hostname = host?.toLowerCase().includes('daily-cloudcode')
    ? 'daily-cloudcode-pa.googleapis.com' : 'cloudcode-pa.googleapis.com';

  logger.debug(`  FWD ${method} ${url} → ${hostname}`, { host });

  const h1Headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!k.startsWith(':') && k !== 'host') h1Headers[k] = String(v);
  }
  h1Headers['host'] = hostname;

  const proxyReq = https.request(
    { hostname: backendIp, port: 443, path: url, method, servername: hostname, rejectUnauthorized: true, headers: h1Headers },
    (proxyRes) => {
      const fwdHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) fwdHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
      res.writeHead(proxyRes.statusCode || 200, fwdHeaders);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    logger.error('Forward error', { url, error: err.message });
    if (!res.headersSent) { res.writeHead(502); res.end(`Proxy error: ${err.message}`); }
  });
  if (body.length > 0) proxyReq.write(body);
  proxyReq.end();
}

// Main TLS handler
async function handleTlsRequest(req: http2.Http2ServerRequest, res: http2.Http2ServerResponse): Promise<void> {
  const url = req.url || '/';
  const method = req.method || 'GET';

  logger.debug(`>>> ${method} ${url}`);

  try {
    // Collect body for POST
    let body: Buffer = Buffer.alloc(0);
    if (method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      body = Buffer.concat(chunks);
    }

    // Check if this is a model inference call we should intercept
    const pathOnly = url.split('?')[0];
    if (INTERCEPT_PATHS.has(pathOnly)) {
      const req2 = { ...req, url, method } as any;
      // Re-create a readable stream from body for the handler
      const { Readable } = await import('stream');
      const fakeReq = new Readable({
        read() {
          this.push(body);
          this.push(null);
        },
      });
      Object.assign(fakeReq, { headers: req.headers, url, method });
      await handleStreamGenerate(fakeReq as any, res, body);
    } else {
      logger.debug(`  PASS ${method} ${url}`);
      await forwardToGoogle(req, res, body);
    }
  } catch (error: any) {
    logger.error('Handler error', { url, error: error.message });
    if (!res.headersSent) { res.writeHead(502); res.end(`Proxy error: ${error.message}`); }
  }
}

// Main
async function main(): Promise<void> {
  db.init();
  setRateLimitConfig({ globalMax: config.rateLimitGlobal, providerMax: config.rateLimitProvider, windowMs: config.rateLimitWindow });
  logger.info(`=== Antigravity Proxy (${config.provider}) ===`);

  if (!validateApiKey()) process.exit(1);

  try {
    backendIp = await resolveBackend('cloudcode-pa.googleapis.com');
    logger.info('Google backend resolved', { ip: backendIp });
  } catch (e: any) {
    logger.error('DNS resolution failed', { error: e.message });
    process.exit(1);
  }

  // HTTP server on port 4000 (dashboard + language_server init calls)
  const restServer = http.createServer(port4000Handler);
  restServer.on('error', (err) => logger.error('Port 4000 server error', { error: err.message }));
  restServer.listen(config.apiPort, '0.0.0.0', () => {
    logger.info(`Port ${config.apiPort} (HTTP) → Dashboard + init calls`);
    logger.info(`Dashboard: http://localhost:${config.apiPort}`);
  });

  // TLS server on port 443 (model inference + all other traffic)
  const certPath = path.resolve(__dirname, '..', 'certs', 'cert.pem');
  const keyPath = path.resolve(__dirname, '..', 'certs', 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const tlsServer = http2.createSecureServer(
      { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath), allowHTTP1: true },
      handleTlsRequest,
    );
    tlsServer.on('sessionError', (err) => logger.debug('TLS session error', { error: err.message }));
    tlsServer.on('error', (err) => logger.error('TLS server error', { error: err.message }));
    tlsServer.listen(config.proxyPort, '0.0.0.0', () => {
      logger.info(`Port ${config.proxyPort} (HTTPS) → Intercept: [${Array.from(INTERCEPT_PATHS).join(', ')}]`);
    });
  } else {
    logger.warn('TLS certs missing - run: node scripts/gen-certs.mjs');
  }

  logger.info(`${config.provider}: ${config.baseUrl}`);
  logger.info('Ready');
}

async function shutdown(): Promise<void> {
  logger.info('Shutdown');
  await httpPool.closeAll();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
main().catch((err) => { logger.error('Fatal', { error: String(err) }); process.exit(1); });
