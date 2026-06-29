import { config } from './config.js';
import { logger } from './logger.js';
import { Router } from './router.js';
import { modelResolver } from './models.js';
import { ANTIGRAVITY_CONTEXT } from './antigravity-context.js';
import { registerBuiltinPlugins } from './plugins/builtin-plugins.js';
import { toolCapabilityRegistry } from './tool-capabilities.js';
import { normalizeToolCall } from './tool-normalizer.js';
import { injectContext } from './context-injector.js';
import type { MappedRequest } from './mapper.js';
import type { OpenAIMessage } from './mapper.js';

// Ensure built-in plugins are registered at module load time
registerBuiltinPlugins();

export function extractConvId(requestId: string): string {
  const parts = requestId?.split('/') || [];
  return parts.length >= 2 ? parts.slice(0, 2).join('/') : requestId;
}

interface ReasoningEntry {
  data: string[];
  timestamp: number;
}

const REASONING_TTL_MS = 30 * 60 * 1000; // 30 minutes
const REASONING_MAX_SIZE = 1000;

export const reasoningStore = new Map<string, ReasoningEntry>();

export function cleanupReasoningStore(): void {
  const now = Date.now();
  for (const [key, entry] of reasoningStore) {
    if (now - entry.timestamp > REASONING_TTL_MS) {
      reasoningStore.delete(key);
    }
  }

  // Enforce max size (delete oldest)
  if (reasoningStore.size > REASONING_MAX_SIZE) {
    const entries = Array.from(reasoningStore.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - REASONING_MAX_SIZE);
    for (const [key] of toDelete) {
      reasoningStore.delete(key);
    }
  }
}

export function saveReasoning(convId: string, thoughtText: string): void {
  cleanupReasoningStore();
  const existing = reasoningStore.get(convId);
  if (existing) {
    existing.data.push(thoughtText);
    existing.timestamp = Date.now();
  } else {
    reasoningStore.set(convId, { data: [thoughtText], timestamp: Date.now() });
  }
}

export function injectReasoning(messages: OpenAIMessage[], convId: string): void {
  const entry = reasoningStore.get(convId);
  if (!entry) {
    // Ensure all assistant messages have reasoning_content even when no store
    for (const msg of messages) {
      if (msg.role === 'assistant' && !msg.reasoning_content) {
        const c = msg.content;
        msg.reasoning_content = typeof c === 'string' ? c : ' ';
      }
    }
    return;
  }
  // Collect assistant message indices in chronological order
  const asstIdxs: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'assistant') asstIdxs.push(i);
  }
  // Inject store entries into the LAST N assistant messages
  // The reasoning store grows in response order (oldest first).
  // Assistant messages in the request are also chronological.
  // Each response adds one assistant message, so store[N] corresponds
  // to the (asstCount - storeLen + N)-th assistant message from the end.
  const injectCount = Math.min(entry.data.length, asstIdxs.length);
  const msgOffset = asstIdxs.length - injectCount;
  const storeOffset = entry.data.length - injectCount;
  for (let i = 0; i < injectCount; i++) {
    const msg = messages[asstIdxs[msgOffset + i]];
    msg.reasoning_content = entry.data[storeOffset + i];
  }
  // Old assistant messages (before this session) need a fallback
  for (let i = 0; i < msgOffset; i++) {
    const msg = messages[asstIdxs[i]];
    if (!msg.reasoning_content) {
      const c = msg.content;
      msg.reasoning_content = typeof c === 'string' ? c : ' ';
    }
  }
}

let router: Router;

function getRouter(): Router {
  if (!router) {
    router = new Router(config.providers, modelResolver, { retries: config.retries, backoffMs: config.backoffMs });
  }
  return router;
}

export function reloadRouter(): void {
  config.reload();
  if (router) {
    router.updateProviders(config.providers, { retries: config.retries, backoffMs: config.backoffMs });
  }
  modelResolver.reload();
  logger.info('[engine] Router, config, and model maps reloaded');
}

/**
 * Normalize a tool call from an external LLM.
 * Uses the ToolNormalizer to fix names, params, types, and defaults.
 * Falls back to simple internal-param stripping if normalizer doesn't apply.
 */
const ANTIGRAVITY_INTERNAL_ONLY = new Set([
  'toolAction', 'toolSummary', 'ToolAction', 'ToolSummary',
]);

function normalizeToolArgs(args: Record<string, unknown>, toolName: string): Record<string, unknown> {
  // First: strip Antigravity internal params (these are injected by the runtime)
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!ANTIGRAVITY_INTERNAL_ONLY.has(key)) cleaned[key] = value;
  }
  if (Object.keys(cleaned).length === 0) return args;

  // Second: run through the tool normalizer for schema-aware fixes
  const result = normalizeToolCall(toolName, cleaned);
  if (result.warnings) {
    logger.info(`[normalizer] ${result.warnings.join('; ')}`);
  }
  return result.args;
}

export type StreamResponseChunk =
  | { type: 'text'; content: string; provider?: string; resolvedModel?: string; sessionId?: string }
  | { type: 'thought'; content: string; provider?: string; resolvedModel?: string; sessionId?: string }
  | { type: 'tool-call'; name: string; args: Record<string, unknown>; provider?: string; resolvedModel?: string }
  | { type: 'attempt'; provider: string; resolvedModel: string; attempt: number; status: string; fallback?: boolean };

export async function* streamResponse(
  mapped: MappedRequest,
  modelId?: string,
  abortSignal?: AbortSignal,
): AsyncGenerator<StreamResponseChunk> {
  const model = modelId || 'default';
  const r = getRouter();
  const providerIds = config.providerPriority;

    logger.info(`Intercept: ${model}`, {
      messageCount: mapped.messages.length,
      hasTools: !!mapped.tools && Object.keys(mapped.tools).length > 0,
      hasSystem: !!mapped.system,
      contextStripMode: config.contextStripMode,
    });

  try {
    // Sync per-request tools into the capability registry for normalization
    toolCapabilityRegistry.setDynamicTools(mapped.tools);

    const gen = r.execute(providerIds, model, mapped.messages, mapped.tools as any, {
      maxTokens: mapped.maxTokens,
      temperature: mapped.temperature,
      topP: mapped.topP,
      stopSequences: mapped.stopSequences,
      providerOptions: mapped.providerOptions,
    }, abortSignal, mapped.system);

    for await (const chunk of gen) {
      const prov = (chunk as any).provider;
      const rmodel = (chunk as any).resolvedModel;
      const sid = (chunk as any).sessionId as string | undefined;
      if (chunk.type === 'text') {
        yield { type: 'text', content: chunk.content || '', provider: prov, resolvedModel: rmodel, sessionId: sid };
      } else if (chunk.type === 'thought') {
        yield { type: 'thought', content: chunk.content || '', provider: prov, resolvedModel: rmodel, sessionId: sid };
      } else if (chunk.type === 'tool-call') {
        const toolName = chunk.name || 'unknown';
        yield { type: 'tool-call', name: toolName, args: normalizeToolArgs(chunk.args || {}, toolName), provider: prov, resolvedModel: rmodel };
      } else if (chunk.type === 'attempt') {
        // A4: surface router's attempt events to the dashboard so failover
        // telemetry is visible. The downstream consumer in index.ts already
        // handles 'attempt' chunks — it was just never receiving them.
        yield {
          type: 'attempt',
          provider: prov || '',
          resolvedModel: rmodel || '',
          attempt: (chunk as any).attempt ?? 1,
          status: (chunk as any).status || 'trying',
          fallback: (chunk as any).fallback,
        };
      } else if (chunk.type === 'error') {
        throw new Error(chunk.content || 'router error');
      }
    }
  } catch (err: any) {
    logger.error(`[engine] stream error`, { error: err.message });
    throw err;
  }
}

export async function generateResponse(
  mapped: MappedRequest,
  modelId?: string,
): Promise<{ text: string; finishReason: string | null }> {
  const model = modelId || 'default';
  const r = getRouter();
  const providerIds = config.providerPriority;

  try {
    const gen = r.execute(providerIds, model, mapped.messages, mapped.tools as any, {
      maxTokens: mapped.maxTokens,
      temperature: mapped.temperature,
      topP: mapped.topP,
      stopSequences: mapped.stopSequences,
      providerOptions: mapped.providerOptions,
    }, undefined, mapped.system);

    let text = '';
    for await (const chunk of gen) {
      if (chunk.type === 'text') text += chunk.content || '';
      if (chunk.type === 'error') throw new Error(chunk.content);
    }
    return { text, finishReason: 'STOP' };
  } catch (err: any) {
    logger.error(`[engine] generate error`, { error: err.message });
    return { text: `Error: ${err.message}`, finishReason: 'ERROR' };
  }
}

// Auto-cleanup every 5 minutes
setInterval(cleanupReasoningStore, 5 * 60 * 1000).unref();
