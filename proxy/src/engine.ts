import { config } from './config.js';
import { logger } from './logger.js';
import { Router } from './router.js';
import { modelResolver } from './models.js';
import { ANTIGRAVITY_CONTEXT } from './antigravity-context.js';
import type { MappedRequest } from './mapper.js';
import type { OpenAIMessage } from './mapper.js';

export function extractConvId(requestId: string): string {
  const parts = requestId?.split('/') || [];
  return parts.length >= 2 ? parts.slice(0, 2).join('/') : requestId;
}

export const reasoningStore = new Map<string, string[]>();

export function saveReasoning(convId: string, thoughtText: string): void {
  if (!reasoningStore.has(convId)) reasoningStore.set(convId, []);
  reasoningStore.get(convId)!.push(thoughtText);
}

export function injectReasoning(messages: OpenAIMessage[], convId: string): void {
  const rcs = reasoningStore.get(convId);
  if (!rcs) {
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
  const injectCount = Math.min(rcs.length, asstIdxs.length);
  const msgOffset = asstIdxs.length - injectCount;
  const storeOffset = rcs.length - injectCount;
  for (let i = 0; i < injectCount; i++) {
    const msg = messages[asstIdxs[msgOffset + i]];
    msg.reasoning_content = rcs[storeOffset + i];
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

const ANTIGRAVITY_INTERNAL_PARAMS = new Set([
  'toolAction', 'toolSummary', 'Summary', 'Action', 'ToolAction', 'ToolSummary',
  'Action', 'Summary',
]);

function stripUnknownArgs(args: Record<string, unknown>, _toolName: string, _tools: Record<string, any> | undefined): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!ANTIGRAVITY_INTERNAL_PARAMS.has(key)) cleaned[key] = value;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : args;
}

export type StreamResponseChunk =
  | { type: 'text'; content: string; provider?: string; resolvedModel?: string }
  | { type: 'thought'; content: string; provider?: string; resolvedModel?: string }
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
  });

  try {
    // Inject the Antigravity runtime identity as a system message so external
    // models receive the tool-discipline rules, file-structure map, and
    // translation notes. Previously this prompt was defined but never sent,
    // which caused downstream models to hallucinate file paths and produce
    // tool calls that did not match the real codebase.
    if (ANTIGRAVITY_CONTEXT.enabled) {
      const ctx = ANTIGRAVITY_CONTEXT.prompt;
      const existing = mapped.system;
      mapped.system = existing ? `${ctx}\n\n${existing}` : ctx;
    }

    const gen = r.execute(providerIds, model, mapped.messages, mapped.tools as any, {
      maxTokens: mapped.maxTokens,
      temperature: mapped.temperature,
      topP: mapped.topP,
      stopSequences: mapped.stopSequences,
      providerOptions: mapped.providerOptions,
    }, abortSignal);

    for await (const chunk of gen) {
      const prov = (chunk as any).provider;
      const rmodel = (chunk as any).resolvedModel;
      if (chunk.type === 'text') {
        yield { type: 'text', content: chunk.content || '', provider: prov, resolvedModel: rmodel };
      } else if (chunk.type === 'thought') {
        yield { type: 'thought', content: chunk.content || '', provider: prov, resolvedModel: rmodel };
      } else if (chunk.type === 'tool-call') {
        yield { type: 'tool-call', name: chunk.name || 'unknown', args: stripUnknownArgs(chunk.args || {}, chunk.name || 'unknown', mapped.tools), provider: prov, resolvedModel: rmodel };
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
    if (ANTIGRAVITY_CONTEXT.enabled) {
      const ctx = ANTIGRAVITY_CONTEXT.prompt;
      const existing = mapped.system;
      mapped.system = existing ? `${ctx}\n\n${existing}` : ctx;
    }

    const gen = r.execute(providerIds, model, mapped.messages, mapped.tools as any, {
      maxTokens: mapped.maxTokens,
      temperature: mapped.temperature,
      topP: mapped.topP,
      stopSequences: mapped.stopSequences,
      providerOptions: mapped.providerOptions,
    });

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
