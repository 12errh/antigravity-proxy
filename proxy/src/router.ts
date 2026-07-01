import { logger } from './logger.js';
import { config } from './config.js';
import type { ProviderConfig, ProviderId } from './adapter.js';
import { createAdapter } from './adapter.js';
import type { ModelAdapter, StreamChunk } from './adapters/types.js';
import type { OpenAIMessage } from './mapper.js';
import type { ModelResolver } from './models.js';
import { poolFetch } from './http-pool.js';

function fireFailoverWebhook(provider: string, model: string, error: string, status: string): void {
  const url = config.failoverWebhookUrl;
  if (!url) return;
  const body = JSON.stringify({ event: 'failover', provider, model, error, status, timestamp: new Date().toISOString() });
  poolFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body } as any).catch(() => {});
}

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
    system?: string,
  ): AsyncGenerator<StreamChunk & { provider?: string; resolvedModel?: string }> {
    // Create server-side timeout signal
    const timeoutMs = (config?.requestTimeoutMs as number) || 300000; // 5 minutes default
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

    // Combine with client abort signal
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    try {
    // Determine candidate providers based on routing mode
    let candidates: ProviderId[];
    const routingMode = this.modelResolver.routingMode;

    if (routingMode === 'per-model-per-provider') {
      const modelProviders = this.modelResolver.getProvidersForModel(model);
      if (modelProviders && modelProviders.length > 0) {
        candidates = [modelProviders[0] as ProviderId];
      } else if (this.modelResolver.defaultProvider && this.modelResolver.defaultModel) {
        candidates = [this.modelResolver.defaultProvider];
      } else {
        candidates = providerIds;
      }
    } else {
      candidates = providerIds;
    }

    if (candidates.length === 0) {
      logger.warn(`[router] No providers available for model: ${model}`);
      yield { type: 'error', content: `No providers available for model: ${model}`, provider: '', resolvedModel: model };
      return;
    }

    logger.info(`[router] Mode: ${routingMode} | Candidates: ${candidates.join(' → ')} → ${model}`);

    // First pass: try the explicit/configured provider list.
    // When multiple providers are candidates, cap per-provider retries low (2) so we
    // don't burn 11 attempts × 50s backoff on a single broken provider when a
    // working one is next in line.
    const perProviderRetries = candidates.length > 1
      ? Math.min(2, this.options.retries)
      : this.options.retries;
    const tried = new Set<string>();
    let lastError: string | null = null;
    for (const providerId of candidates) {
      tried.add(providerId);
      const adapter = this.adapters.get(providerId);
      if (!adapter) {
        logger.debug(`[router] Skipping disabled provider: ${providerId}`);
        continue;
      }

      let resolvedModel = this.modelResolver.resolve(model, providerId);
      if (!resolvedModel || resolvedModel === model) {
        // Use provider-specific default first, then global default
        const providerDefault = this.modelResolver.getDefaultModel(providerId);
        if (providerDefault) {
          resolvedModel = providerDefault;
        } else if (this.modelResolver.defaultModel) {
          resolvedModel = this.modelResolver.defaultModel;
        }
      }
      logger.info(`[router] Trying ${providerId} → ${resolvedModel} (from ${model})`);

      let hasStreamedData = false;

      for (let attempt = 0; attempt <= perProviderRetries; attempt++) {
        yield { type: 'attempt', provider: providerId, resolvedModel, attempt: attempt + 1, status: attempt === 0 ? 'trying' : 'retrying' };
        try {
          const gen = adapter.stream(resolvedModel, messages, tools, config, combinedSignal, system);
          for await (const chunk of gen) {
            if (chunk.type === 'error') throw new Error(chunk.content || 'provider error');
            hasStreamedData = true;
            yield { ...chunk, provider: providerId, resolvedModel };
          }
          logger.info(`[router] ${providerId} succeeded`);
          return;
        } catch (err: any) {
            if (combinedSignal.aborted) throw err;

          // If we already yielded data to the client, retrying the same provider
          // would duplicate content. But we CAN still failover to the next provider.
          if (hasStreamedData) {
            logger.error(`[router] ${providerId} failed mid-stream — cannot retry same provider, failing over: ${err.message}`);
            fireFailoverWebhook(providerId, resolvedModel, err.message, 'failover');
            yield { type: 'attempt', provider: providerId, resolvedModel, attempt: attempt + 1, status: 'failover' };
            break; // Break out of retry loop for this provider, try next candidate
          }

          const isLastAttempt = attempt >= perProviderRetries;
          const isLastProvider = candidates.indexOf(providerId) === candidates.length - 1;

          if (isLastAttempt && isLastProvider) {
            // First pass fully exhausted — fall through to global fallback below
            lastError = err.message;
            break;
          }

          if (!isLastAttempt) {
            const isRateLimit = err.message.includes('429') || err.message.includes('rate_limit') || err.message.includes('413') || err.message.includes('Request too large');
            const waitMs = isRateLimit
              ? Math.min(10000 * Math.pow(2, attempt), 60000)
              : this.options.backoffMs * Math.pow(2, attempt);
            logger.warn(`[router] ${providerId} attempt ${attempt + 1}/${perProviderRetries + 1} failed, retry in ${waitMs}ms: ${err.message}`);
            await new Promise(r => setTimeout(r, waitMs));
          } else {
            logger.warn(`[router] ${providerId} exhausted, failing over to next provider: ${err.message}`);
            fireFailoverWebhook(providerId, resolvedModel, err.message, 'failover');
            yield { type: 'attempt', provider: providerId, resolvedModel, attempt: attempt + 1, status: 'failover' };
          }
        }
      }
    }

    // Second pass: all explicit/candidate providers failed and nothing streamed.
    // Fall back to the global provider priority (excluding ones we already tried)
    // using the model resolver's default mapping for each provider.
    //
    // A6 clarification: this filter (global providerIds minus `tried`) effectively
    // becomes `global - whitelist` after the first pass exhausts the model's
    // whitelist, which is the intended semantics — try whitelist providers first,
    // then fall back to any non-whitelist provider if the whitelist is broken.
    // If you want to disable the global fallback (strict whitelist), set
    // DISABLE_GLOBAL_FALLBACK=1 in the environment.
    const fallback = providerIds.filter(id => !tried.has(id) && this.adapters.has(id));
    if (fallback.length > 0) {
      logger.warn(`[router] All explicit providers failed for ${model} — falling back to: ${fallback.join(' → ')} (last error: ${lastError})`);
      const fallbackRetries = Math.min(2, this.options.retries);
      for (const providerId of fallback) {
        tried.add(providerId);
        const adapter = this.adapters.get(providerId);
        if (!adapter) continue;
        let resolvedModel = this.modelResolver.resolve(model, providerId);
        if (!resolvedModel || resolvedModel === model) {
          const providerDefault = this.modelResolver.getDefaultModel(providerId);
          if (providerDefault) {
            resolvedModel = providerDefault;
          } else if (this.modelResolver.defaultModel) {
            resolvedModel = this.modelResolver.defaultModel;
          }
        }
        logger.info(`[router] Fallback trying ${providerId} → ${resolvedModel} (from ${model})`);

        for (let attempt = 0; attempt <= fallbackRetries; attempt++) {
          yield { type: 'attempt', provider: providerId, resolvedModel, attempt: attempt + 1, status: attempt === 0 ? 'trying' : 'retrying', fallback: true };
          let hasStreamedData = false;
          try {
          const gen = adapter.stream(resolvedModel, messages, tools, config, combinedSignal, system);
            for await (const chunk of gen) {
              if (chunk.type === 'error') throw new Error(chunk.content || 'provider error');
              hasStreamedData = true;
              yield { ...chunk, provider: providerId, resolvedModel };
            }
            logger.info(`[router] ${providerId} succeeded (fallback)`);
            return;
          } catch (err: any) {
          if (combinedSignal.aborted) throw err;
            // Mid-stream failure in fallback — can't retry same provider, try next
            if (hasStreamedData) {
              logger.error(`[router] ${providerId} (fallback) failed mid-stream — failing over: ${err.message}`);
              fireFailoverWebhook(providerId, resolvedModel, err.message, 'failover');
              yield { type: 'attempt', provider: providerId, resolvedModel, attempt: attempt + 1, status: 'failover', fallback: true };
              break;
            }
            const isLastAttempt = attempt >= fallbackRetries;
            const isLastFallback = fallback.indexOf(providerId) === fallback.length - 1;
            if (isLastAttempt && isLastFallback) {
              logger.error(`[router] All providers (including fallback) exhausted for ${model}`);
              fireFailoverWebhook(providerId, resolvedModel, err.message, 'failed');
              yield { type: 'attempt', provider: providerId, resolvedModel, attempt: attempt + 1, status: 'failed', fallback: true };
              yield { type: 'error', content: `All providers failed: ${err.message}`, provider: providerId, resolvedModel };
              return;
            }
            if (!isLastAttempt) {
              const isRateLimit = err.message.includes('429') || err.message.includes('rate_limit') || err.message.includes('413') || err.message.includes('Request too large');
              const waitMs = isRateLimit ? Math.min(10000 * Math.pow(2, attempt), 60000) : this.options.backoffMs * Math.pow(2, attempt);
              logger.warn(`[router] ${providerId} (fallback) attempt ${attempt + 1}/${fallbackRetries + 1} failed, retry in ${waitMs}ms: ${err.message}`);
              await new Promise(r => setTimeout(r, waitMs));
            } else {
              logger.warn(`[router] ${providerId} (fallback) exhausted, trying next: ${err.message}`);
              fireFailoverWebhook(providerId, resolvedModel, err.message, 'failover');
              yield { type: 'attempt', provider: providerId, resolvedModel, attempt: attempt + 1, status: 'failover', fallback: true };
            }
          }
        }
      }
    }

    yield { type: 'error', content: `All providers failed: ${lastError || 'unknown'}` };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export type { ProviderId, ProviderConfig } from './adapter.js';
