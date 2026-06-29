import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import http2 from 'http2';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger } from './logger.js';
import { validateApiKey } from './auth.js';
import { streamResponse, saveReasoning, injectReasoning, extractConvId } from './engine.js';
import { reloadRouter } from './engine.js';
import { mapContentsToMessages, mapTools, mapGenerationConfig } from './mapper.js';
import { requestStore } from './request-store.js';
import { createDashboardHandler } from './dashboard.js';
import * as db from './db.js';
import { calculateCost } from './pricing.js';
import { httpPool } from './http-pool.js';
import { checkRateLimit, recordRequest, setRateLimitConfig } from './rate-limiter.js';
import { checkBlocked } from './blocklist.js';
import { scanLocalProviders } from './local-discovery.js';
import { installAgentContext } from './install-context.js';
import { getWorkspaceContextEnvelope, wrapToolResultForContextFile, isWorkspaceContextFile } from './workspace-context.js';
import { getSessionId, setSessionId } from './session-store.js';
import { safeWrite } from './utils/safe-write.js';
import { formatErrorResponse } from './utils/error-response.js';
import type { Content, Tool, GenerationConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let backendIp = '';

// Set workspace root so antigravity-context.ts can inject it into the system prompt.
// If WORKSPACE_ROOT is not set via env/dashboard, default to the repo root.
// Users can override this in the dashboard Config tab to point to their actual project.
if (!process.env.WORKSPACE_ROOT) {
  process.env.WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
}

const INTERCEPT_PATHS = new Set([
  '/v1internal:streamGenerateContent',
  '/v1internal:cascadeGenerateContent',
  '/v1internal:cascadeStreamGenerateContent',
]);

let AGENT_CONTEXT_PATH = process.env.AGENT_CONTEXT_PATH
  || (() => {
    // __dirname is .../proxy/src when running via tsx, and .../proxy/dist when compiled.
    // agent-context.md lives at .../antigravity/agent-context.md (two levels up from proxy/).
    const proxyDir = path.resolve(__dirname, '..');
    return path.resolve(proxyDir, '..', 'agent-context.md');
  })();

function readAgentContextReference(): string {
  return getWorkspaceContextEnvelope(AGENT_CONTEXT_PATH);
}

/**
 * Reads the full agent-context.md file and wraps it with the workspace context
 * envelope. This provides the model with the complete operating manual while
 * preventing path/prose extraction as authoritative runtime state.
 * The file is read once per request because it may change between requests,
 * but the content is cached in memory to avoid repeated disk I/O within
 * the same request processing cycle.
 */
let _agentContextContent: string | null = null;
function readAgentContextFull(): string | null {
  try {
    if (fs.existsSync(AGENT_CONTEXT_PATH)) {
      if (_agentContextContent === null) {
        _agentContextContent = fs.readFileSync(AGENT_CONTEXT_PATH, 'utf-8');
      }
      return wrapToolResultForContextFile(AGENT_CONTEXT_PATH, _agentContextContent);
    }
  } catch {
    // Fall through to null
  }
  return null;
}

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
  // Parse the URL to get the pathname (without query string). The dashboard's
  // own handler does the same, so we must match its routing exactly.
  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;
  // Route dashboard pages, login, static files, and API calls to the dashboard handler.
  // Anything else (e.g. /v1internal:*) is forwarded to Google's backend.
  const staticExts = ['.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
  const hasStaticExt = staticExts.some(ext => pathname.endsWith(ext));
  const isDashboardPath =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/login.html' ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/tabs/') ||
    pathname.startsWith('/js/') ||
    pathname.startsWith('/css/') ||
    pathname.startsWith('/img/') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/static/') ||
    hasStaticExt;
  if (isDashboardPath) {
    dashboardHandler(req, res);
    return;
  }
  const hostname = 'cloudcode-pa.googleapis.com';
  logger.debug('REST forward', { method: req.method, path: pathname });
  const proxyReq = https.request(
    { hostname: backendIp, port: 443, path: req.url, method: req.method, servername: hostname, rejectUnauthorized: true, headers: { ...req.headers, host: hostname } },
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
  // Inject agent-context.md content with envelope protection as the first
  // system-level instruction. This gives the model the complete operating
  // manual (tool schemas, decision tree, spawning guidelines, verification
  // requirements) without needing an extra view_file round-trip.
  // The envelope wrapping prevents path/prose extraction as state.
  const fullContent = readAgentContextFull();
  if (fullContent) {
    const adapterRef = {
      role: 'user' as const,
      parts: [{ text: fullContent }],
    };
    filtered.unshift(adapterRef);
  } else {
    // Fallback: inject the envelope reference only
    const adapterRef = {
      role: 'user' as const,
      parts: [{ text: readAgentContextReference() }],
    };
    filtered.unshift(adapterRef);
  }
  return filtered;
}

function stripSystemContext(text: string): string {
  if (!text) return '';

  // Extract workspace path from <user_information> BEFORE stripping.
  // Antigravity puts the user's project directory here:
  //   d:\AI_AGENTS\antigravitysdk -> d:/AI_AGENTS/antigravitysdk
  // Without this, the model doesn't know where its files are.
  const userInfoMatch = text.match(/<user_information>([\s\S]*?)<\/user_information>/);
  let workspacePath: string | null = null;
  if (userInfoMatch) {
    // Match Windows path: d:\path\to\project or /path/to/project
    const pathMatch = userInfoMatch[1].match(/([A-Za-z]:\\[\w\\.\-]+|\/[\w/.\-]+)/);
    if (pathMatch) {
      workspacePath = pathMatch[1];
    }
  }

  // In strip/lite modes, we completely replace the system instruction.
  // The native Antigravity system instruction is ~28k tokens containing
  // tool definitions, behavioral rules, identity, etc. Our agent-context.md
  // (or lite version) already contains all of this in a compressed form.
  // Keeping the native instruction AND adding agent-context causes duplication
  // and wastes tokens.
  //
  // We only keep the workspace path so the model knows where it is.

  if (workspacePath) {
    return `## Current Workspace\nYour current working directory is: \`${workspacePath}\`\nAll file operations (list_dir, view_file, write_to_file, run_command, etc.) should use this directory.`;
  }

  return '';
}

/**
 * Walks the contents array looking for tool-result parts whose tool call targeted
 * the agent-context.md file (or any path matching it). When found, the response
 * payload is re-framed with the documentation envelope so the LLM does not
 * extract illustrative paths/prose as authoritative runtime state.
 *
 * Antigravity may surface tool results in several shapes:
 *   - { functionResponse: { name, response: { result: <string> } } }
 *   - { functionResponse: { name, response: <string> } }
 *   - { type: 'tool-result', toolName, result: <string> }
 *   - { text: '...' }    (some frameworks dump raw text into a user-role turn)
 *
 * We match on tool name (view_file / read_file / cat / etc.) AND on the target
 * path supplied in the corresponding assistant tool call (matched by tool_call_id
 * in mapper.ts). For the simple Antigravity shape, the tool name + path often
 * appear together in the functionResponse, so we look at both.
 */
function wrapContextFileToolResults(contents: Content[], contextPath: string): void {
  if (!contents || contents.length === 0) return;
  if (process.env.WORKSPACE_CONTEXT_ENVELOPE === 'off') return;

  // Pass 1: collect tool-call targets (name -> last seen file path) from assistant turns
  const callIdToPath: Map<string, string> = new Map();
  for (const c of contents) {
    if (c.role !== 'model' && c.role !== 'assistant') continue;
    const parts = (c.parts || []) as any[];
    for (const p of parts) {
      const fc = p?.functionCall;
      if (!fc) continue;
      const toolName = (fc.name || '').toLowerCase();
      const isRead = toolName === 'view_file' || toolName === 'viewfile' || toolName === 'read_file' || toolName === 'readfile' || toolName === 'file_read' || toolName === 'cat';
      if (!isRead) continue;
      const candidatePath = fc.args?.path || fc.args?.file_path || fc.args?.filePath || fc.args?.file || fc.args?.target;
      if (typeof candidatePath === 'string') {
        // We don't have a stable call id in this shape; use toolName+path as key
        const id = `${toolName}::${candidatePath}`;
        callIdToPath.set(id, candidatePath);
      }
    }
  }

  // Pass 2: walk user-role contents, find tool responses referencing the context file
  for (const c of contents) {
    if (c.role !== 'user') continue;
    const parts = (c.parts || []) as any[];
    for (const p of parts) {
      let rawText: string | null = null;
      let isContextTarget = false;

      // functionResponse shape
      const fr = p?.functionResponse;
      if (fr) {
        const toolName = (fr.name || '').toLowerCase();
        const isRead = toolName === 'view_file' || toolName === 'viewfile' || toolName === 'read_file' || toolName === 'readfile' || toolName === 'file_read' || toolName === 'cat';
        // The functionResponse sometimes carries the target path; check it
        const target = fr.response?.path || fr.response?.file_path || fr.path;
        if (isRead && typeof target === 'string' && isWorkspaceContextFile(target, contextPath)) {
          isContextTarget = true;
        }
        // Match against assistant tool calls by tool name + the last path in args
        if (isRead && !isContextTarget) {
          for (const [id, pth] of callIdToPath) {
            if (id.startsWith(toolName + '::') && isWorkspaceContextFile(pth, contextPath)) {
              isContextTarget = true;
              break;
            }
          }
        }
        // Extract response text
        const r = fr.response;
        if (typeof r === 'string') rawText = r;
        else if (r && typeof r === 'object') {
          rawText = typeof r.result === 'string' ? r.result : JSON.stringify(r);
        }
      }

      // tool-result shape
      if (!isContextTarget && p?.type === 'tool-result') {
        const toolName = (p.toolName || '').toLowerCase();
        const isRead = toolName === 'view_file' || toolName === 'viewfile' || toolName === 'read_file' || toolName === 'readfile' || toolName === 'file_read' || toolName === 'cat';
        if (isRead) {
          for (const [id, pth] of callIdToPath) {
            if (id.startsWith(toolName + '::') && isWorkspaceContextFile(pth, contextPath)) {
              isContextTarget = true;
              break;
            }
          }
        }
        if (typeof p.result === 'string') rawText = p.result;
        else if (p.result != null) rawText = JSON.stringify(p.result);
      }

      // Sometimes the IDE puts the tool result text directly in a text part with
      // a recognizable prefix; be conservative and only wrap if we explicitly
      // matched a context-file target.
      if (isContextTarget && rawText) {
        const wrapped = wrapToolResultForContextFile(contextPath, rawText);
        // Replace the response payload
        if (fr) {
          if (typeof fr.response === 'string') fr.response = wrapped;
          else if (fr.response && typeof fr.response === 'object') {
            fr.response.result = wrapped;
            // Keep any path/metadata the IDE may have set
            if (!fr.response.path) fr.response.path = contextPath;
          }
        } else if (p.type === 'tool-result') {
          p.result = wrapped;
        }
      }
    }
  }
}

const SAFETY_RATINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', probability: 'NEGLIGIBLE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' },
];

const GROUNDING_METADATA = { groundingChunks: [], groundingSupports: [] };

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
    const err = new Error(`Request blocked: ${blockCheck.reason}`);
    (err as any).code = 'BLOCKED';
    res.end(JSON.stringify(formatErrorResponse(err)));
    return;
  }

  // Check global rate limit
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    logger.warn(`RATE LIMITED: global limit exceeded`);
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(rateCheck.retryAfter) });
    const err = new Error(`Rate limit exceeded. Retry after ${rateCheck.retryAfter}s`);
    (err as any).code = 'RATE_LIMITED';
    res.end(JSON.stringify(formatErrorResponse(err)));
    return;
  }

  // Strip massive inline context and inject agent-context.md reference
  // (unless passthrough mode is enabled — see Config tab > Context Strip Mode)
  const isPassthrough = config.contextStripMode === 'passthrough';
  const contents = isPassthrough
    ? (inner.contents || [])
    : stripInlineContext(inner.contents || []);
  // Wrap any tool result whose target file is the agent-context.md itself
  if (!isPassthrough) {
    wrapContextFileToolResults(contents, AGENT_CONTEXT_PATH);
  }
  // Antigravity sends "systemInstruction" (camelCase) — try both snake_case and camelCase
  const rawSystemText = inner.system_instruction?.parts?.[0]?.text
    || inner.systemInstruction?.parts?.[0]?.text
    || '';
  const systemInstruction = isPassthrough
    ? rawSystemText
    : stripSystemContext(rawSystemText);

  const bodyStr = body.toString('utf-8');
  logger.info(`>>> INTERCEPTED: ${req.url} model=${model}`, {
    model, contentCount: contents.length, hasTools: tools.length > 0,
    bodySnippet: bodyStr.substring(0, 200),
  });

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

  // Inject saved reasoning_content from previous round (client strips thought:true parts)
  const convId = extractConvId(request.requestId);
  injectReasoning(mapped.messages, convId);

  // Inject stored session_id for OpenCode Go context cache discounts
  const storedSessionId = getSessionId(convId);
  if (storedSessionId) {
    if (!mapped.providerOptions) mapped.providerOptions = {};
    (mapped.providerOptions as any).sessionId = storedSessionId;
    logger.info(`  Session cache hit: ${storedSessionId.substring(0, 12)}...`);
  }

  logger.info(`  Provider priority: ${config.providerPriority.join(', ')}`);

  const responseId = genGoogleId();
  const traceId = genTraceId();

  // Incoming record: log the prompt + the user-requested model.
  // resolvedModel is intentionally empty here — we don't know the resolved
  // model until the router picks a provider. The "outgoing" record below
  // sets the real resolvedModel.
  requestStore.push({
    id: responseId, timestamp: new Date().toISOString(), model, resolvedModel: '',
    direction: 'incoming', type: 'text', content: `Prompt: ${promptText.substring(0, 500)}${promptText.length > 500 ? '...' : ''}`,
    promptTokens,
  });

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    'x-goog-api-version': '2',
  });

  // AbortController: when the client disconnects (stop button, tab close),
  // the HTTP/2 stream fires 'close'/'aborted'. We propagate the abort signal
  // through to every provider fetch so they cancel immediately.
  const abortController = new AbortController();
  req.on('close', () => abortController.abort());
  req.on('aborted', () => abortController.abort());
  // Also handle HTTP/1.1 close if the connection drops
  res.on('close', () => abortController.abort());

  const genStart = Date.now();
  // B12: declared outside the try so the catch handler can read it.
  // The loop body assigns the most recently attempted provider from each
  // 'attempt' chunk; on failure the catch uses it for rate-limit accounting.
  let lastAttemptedProvider = '';
  try {
    const generator = streamResponse(mapped, model, abortController.signal);
    let fullText = '';
    let thoughtText = '';
    const toolCalls: { name: string; args: Record<string, unknown> }[] = [];

    let usedProvider = '';
    let usedModel = '';
    const failoverEvents: any[] = [];
    let capturedSessionId: string | undefined = storedSessionId;

    for await (const chunk of generator) {
      // If client disconnected mid-stream, stop iterating
      if (abortController.signal.aborted) break;
      const ctype = (chunk as any).type as string;
      if (ctype === 'attempt') {
        const ap = (chunk as any).provider as string;
        if (ap) lastAttemptedProvider = ap;
        failoverEvents.push({ provider: (chunk as any).provider, model: (chunk as any).resolvedModel, attempt: (chunk as any).attempt, status: (chunk as any).status });
        continue;
      }
      if ((chunk as any).provider) usedProvider = (chunk as any).provider;
      if ((chunk as any).resolvedModel) {
        usedModel = (chunk as any).resolvedModel;
        // Check resolved model against blocklist (catches models.json mappings)
        const resolvedCheck = checkBlocked(config.providerPriority, usedModel);
        if (resolvedCheck.blocked) {
          throw new Error(`Request blocked: ${resolvedCheck.reason}`);
        }
      }
      // Capture session_id from OpenCode Go streaming response for cache reuse
      const sid = (chunk as any).sessionId;
      if (sid && !capturedSessionId) {
        capturedSessionId = sid;
      }
      if (ctype === 'text') {
        const c = (chunk as any).content as string || '';
        fullText += c;
        // Send only the delta — Google's client concatenates text from each event
        const deltaParts: any[] = [{ text: c }];
        const outTokens = estTokens(fullText + thoughtText);
        safeWrite(res, `data: ${JSON.stringify({
          response: {
            candidates: [{
              index: 0, content: { role: 'model', parts: deltaParts },
              safetyRatings: SAFETY_RATINGS, groundingMetadata: GROUNDING_METADATA,
            }],
            usageMetadata: { promptTokenCount: promptTokens, candidatesTokenCount: outTokens, totalTokenCount: promptTokens + outTokens },
            modelVersion: `${projectPath}/publishers/${config.provider}/models/${model}`,
            responseId,
          }, traceId, metadata: {},
        })}\n\n`);
      } else if (ctype === 'thought') {
        const c = (chunk as any).content as string || '';
        thoughtText += c;
        const deltaParts: any[] = [{ thought: true, text: c }];
        safeWrite(res, `data: ${JSON.stringify({
          response: {
            candidates: [{
              index: 0, content: { role: 'model', parts: deltaParts },
              safetyRatings: SAFETY_RATINGS, groundingMetadata: GROUNDING_METADATA,
            }],
            modelVersion: `${projectPath}/publishers/${config.provider}/models/${model}`,
            responseId,
          }, traceId, metadata: {},
        })}\n\n`);
      } else if (ctype === 'tool-call') {
        toolCalls.push({ name: (chunk as any).name, args: (chunk as any).args });
      }
    }

    const duration = Date.now() - genStart;
    const outputTokens = estTokens(fullText + thoughtText);
    const cost = usedProvider ? calculateCost(usedProvider, usedModel || model, promptTokens, outputTokens) : 0;
    recordRequest(usedProvider);

    // Save reasoning_content for this conversation so it can be injected on the next request
    if (thoughtText) saveReasoning(convId, thoughtText);

    // Store session_id from OpenCode Go response for context cache on next turn
    if (capturedSessionId && capturedSessionId !== storedSessionId) {
      setSessionId(convId, capturedSessionId);
      logger.info(`  Session cached: ${capturedSessionId.substring(0, 12)}...`);
    }

    // Send final event with finishReason and metadata (no text — already streamed incrementally)
    const finalParts: any[] = [];
    if (thoughtText) finalParts.push({ thought: true, text: thoughtText });
    for (const tc of toolCalls) finalParts.push({ functionCall: { name: tc.name, args: tc.args } });
    const candidate: any = {
      index: 0, content: { role: 'model', parts: finalParts },
      safetyRatings: SAFETY_RATINGS, groundingMetadata: GROUNDING_METADATA,
      finishReason: 'STOP',
    };
    try {
      safeWrite(res, `data: ${JSON.stringify({
        response: {
          candidates: [candidate],
          usageMetadata: { promptTokenCount: promptTokens, candidatesTokenCount: outputTokens, totalTokenCount: promptTokens + outputTokens },
          modelVersion: `${projectPath}/publishers/${config.provider}/models/${model}`,
          responseId,
        }, traceId, metadata: {},
      })}\n\n`);
      res.end();
    } catch {
      // Stream already closed — nothing to do
    }

    if (toolCalls.length > 0) {
      logger.info(`<<< Completed: ${req.url} (${fullText.length} chars, ${toolCalls.length} tool calls)`, { toolCalls: toolCalls.map(tc => ({ name: tc.name, args: tc.args })) });
      requestStore.push({
        id: responseId, timestamp: new Date().toISOString(), model, resolvedModel: usedModel || model,
        provider: usedProvider, direction: 'outgoing', type: 'tool-call', content: fullText,
        toolCalls: toolCalls.map(tc => ({ name: tc.name, args: tc.args })),
        promptTokens, outputTokens, cost, duration, failoverEvents: JSON.stringify(failoverEvents),
      });
    } else {
      logger.info(`<<< Completed: ${req.url} (${fullText.length} chars, model: ${model}, provider: ${usedProvider})`);
      requestStore.push({
        id: responseId, timestamp: new Date().toISOString(), model, resolvedModel: usedModel || model,
        provider: usedProvider, direction: 'outgoing', type: 'text', content: fullText,
        promptTokens, outputTokens, cost, duration, failoverEvents: JSON.stringify(failoverEvents),
      });
    }
  } catch (err: any) {
    // If the client disconnected (user clicked stop), abort the response silently.
    // Do NOT send an error event — the UI already closed the connection.
    if (abortController.signal.aborted || err.name === 'AbortError') {
      logger.info(`<<< Aborted by client: ${req.url}`);
      if (lastAttemptedProvider) recordRequest(lastAttemptedProvider);
      requestStore.push({
        id: responseId, timestamp: new Date().toISOString(), model, resolvedModel: '',
        direction: 'outgoing', type: 'error', content: 'Aborted by client',
        error: 'client_abort', duration: Date.now() - genStart,
      });
      return; // Don't try to write to a closed stream
    }

    logger.error(`<<< Error: ${req.url}`, { error: err.message });
    // B12: account for the failed request in the rate limiter too. Without
    // this, a flood of failing requests from the same provider would never
    // trip the per-provider rate limit.
    if (lastAttemptedProvider) recordRequest(lastAttemptedProvider);
    requestStore.push({
        id: responseId, timestamp: new Date().toISOString(), model, resolvedModel: '',
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
    try {
      safeWrite(res, `data: ${errResp}\n\n`);
      res.end();
    } catch {
      // Stream already closed — nothing to do
    }
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
  // Install agent-context.md to ~/.antigravity/ for stable global access.
  // This runs every startup but the hash-based marker ensures the file is
  // only actually copied when the content changes (proxy upgrade).
  // The env var is set so downstream consumers (antigravity-context.ts,
  // workspace-context.ts) resolve to the global path.
  const installedPath = installAgentContext(AGENT_CONTEXT_PATH);
  if (installedPath) {
    AGENT_CONTEXT_PATH = installedPath;
    process.env.AGENT_CONTEXT_PATH = installedPath;
  }

  db.init();
  db.clearLogs();
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
  restServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${config.apiPort} already in use. Kill the old process or set API_PORT in .env`);
    } else if (err.code === 'EACCES') {
      logger.error(`Port ${config.apiPort} requires elevated privileges. Run with sudo (macOS/Linux) or as Administrator (Windows)`);
    } else {
      logger.error('Dashboard server error', { error: err.message });
    }
  });
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
    tlsServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${config.proxyPort} already in use. Kill the old process or set PROXY_PORT in .env`);
      } else if (err.code === 'EACCES') {
        logger.error(`Port ${config.proxyPort} requires elevated privileges.`);
        logger.error('  macOS/Linux: run with sudo, or use authbind, or set PROXY_PORT=8443 in .env');
        logger.error('  Windows: run PowerShell as Administrator');
      } else {
        logger.error('TLS server error', { error: err.message });
      }
    });
    tlsServer.listen(config.proxyPort, '0.0.0.0', () => {
      logger.info(`Port ${config.proxyPort} (HTTPS) → Intercept: [${Array.from(INTERCEPT_PATHS).join(', ')}]`);
    });
  } else {
    logger.warn('TLS certs missing — run: node scripts/gen-certs.mjs');
  }

  logger.info(`${config.provider}: ${config.baseUrl}`);

  scanLocalProviders().then(async (results) => {
    const online = results.filter(p => p.online);
    if (online.length > 0) {
      logger.info(`Local providers found: ${online.map(p => `${p.label} (${p.models.length} models)`).join(', ')}`);
      config.setLocalProviders(online);
      reloadRouter();
    } else {
      logger.info('No local providers detected');
    }
  });

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
