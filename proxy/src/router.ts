import { logger } from './logger.js';
import type { ProviderConfig, ProviderId } from './adapter.js';
import { createAdapter } from './adapter.js';
import type { ModelAdapter, StreamChunk } from './adapters/types.js';
import type { OpenAIMessage } from './mapper.js';
import type { ModelResolver } from './models.js';

export interface RouterOptions {
  retries: number;
  backoffMs: number;
}

const DEFAULT_OPTIONS: RouterOptions = { retries: 10, backoffMs: 1000 };

export class Router {
  private adapters = new Map<string, ModelAdapter>();
  private options: RouterOptions;
  private modelResolver: ModelResolver;

  constructor(providers: ProviderConfig[], modelResolver: ModelResolver, options?: Partial<RouterOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.modelResolver = modelResolver;
    this.addProviders(providers);
  }

  private addProviders(providers: ProviderConfig[]): void {
    for (const cfg of providers) {
      if (cfg.enabled) {
        this.adapters.set(cfg.id, createAdapter(cfg));
      }
    }
  }

  updateProviders(providers: ProviderConfig[], options?: Partial<RouterOptions>): void {
    this.adapters.clear();
    this.addProviders(providers);
    if (options) this.options = { ...this.options, ...options };
  }

  async *execute(
    providerIds: ProviderId[],
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk & { provider?: string; resolvedModel?: string }> {
    // Check if the model has explicit per-provider mappings
    const modelProviders = this.modelResolver.getProvidersForModel(model);
    const candidates = modelProviders
      ? providerIds.filter(id => modelProviders.includes(id))
      : providerIds;

    if (candidates.length === 0) {
      logger.warn(`[router] No providers available for model: ${model}${modelProviders ? ` (explicit: ${modelProviders.join(', ')})` : ''}`);
      yield { type: 'error', content: `No providers available for model: ${model}`, provider: '', resolvedModel: model };
      return;
    }

    logger.info(`[router] Candidates: ${candidates.join(' → ')} → ${model}`);

    for (const providerId of candidates) {
      const adapter = this.adapters.get(providerId);
      if (!adapter) {
        logger.debug(`[router] Skipping disabled provider: ${providerId}`);
        continue;
      }

      const resolvedModel = this.modelResolver.resolve(model, providerId);
      logger.info(`[router] Trying ${providerId} → ${resolvedModel} (from ${model})`);

      for (let attempt = 0; attempt <= this.options.retries; attempt++) {
        yield { type: 'attempt', provider: providerId, resolvedModel, attempt: attempt + 1, status: attempt === 0 ? 'trying' : 'retrying' };
        try {
          const gen = adapter.stream(resolvedModel, messages, tools, config, signal);
          for await (const chunk of gen) {
            yield { ...chunk, provider: providerId, resolvedModel };
            if (chunk.type === 'error') throw new Error(chunk.content || 'provider error');
          }
          logger.info(`[router] ${providerId} succeeded`);
          return;
        } catch (err: any) {
          if (signal?.aborted) throw err;
          const isLastAttempt = attempt >= this.options.retries;
          const isLastProvider = candidates.indexOf(providerId) === candidates.length - 1;

          if (isLastAttempt && isLastProvider) {
            logger.error(`[router] All providers exhausted for ${model}`);
            yield { type: 'attempt', provider: providerId, resolvedModel, attempt: attempt + 1, status: 'failed' };
            yield { type: 'error', content: `All providers failed: ${err.message}`, provider: providerId, resolvedModel };
            return;
          }

          if (!isLastAttempt) {
            const isRateLimit = err.message.includes('429') || err.message.includes('rate_limit') || err.message.includes('413') || err.message.includes('Request too large');
            const waitMs = isRateLimit
              ? Math.min(10000 * Math.pow(2, attempt), 60000)
              : this.options.backoffMs * Math.pow(2, attempt);
            logger.warn(`[router] ${providerId} attempt ${attempt + 1}/${this.options.retries + 1} failed, retry in ${waitMs}ms: ${err.message}`);
            await new Promise(r => setTimeout(r, waitMs));
          } else {
            logger.warn(`[router] ${providerId} exhausted, failing over to next provider: ${err.message}`);
            yield { type: 'attempt', provider: providerId, resolvedModel, attempt: attempt + 1, status: 'failover' };
          }
        }
      }
    }

    yield { type: 'error', content: 'No providers available' };
  }
}

export type { ProviderId, ProviderConfig } from './adapter.js';
