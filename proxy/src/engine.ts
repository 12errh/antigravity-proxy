import { config } from './config.js';
import { logger } from './logger.js';
import { Router } from './router.js';
import { modelResolver } from './models.js';
import type { MappedRequest } from './mapper.js';

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

export async function* streamResponse(
  mapped: MappedRequest,
  modelId?: string,
  abortSignal?: AbortSignal,
): AsyncGenerator<{ type: 'text'; content: string; provider?: string; resolvedModel?: string } | { type: 'thought'; content: string; provider?: string; resolvedModel?: string } | { type: 'tool-call'; name: string; args: Record<string, unknown>; provider?: string; resolvedModel?: string }> {
  const model = modelId || 'default';
  const r = getRouter();
  const providerIds = config.providerPriority;

  logger.info(`Intercept: ${model}`, {
    messageCount: mapped.messages.length,
    hasTools: !!mapped.tools && Object.keys(mapped.tools).length > 0,
    hasSystem: !!mapped.system,
  });

  try {
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
