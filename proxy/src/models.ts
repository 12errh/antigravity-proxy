import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectModelCapabilities } from './model-capabilities.js';
import type { ModelCapabilities } from './model-capabilities.js';
import type { ProviderId } from './adapter.js';

export type RoutingMode = 'priority-chain' | 'per-model-per-provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_PATH = path.resolve(__dirname, '..', 'models.json');

export interface ProviderModelMap {
  [antigravityModel: string]: {
    [providerId: string]: string;
  };
}

export class ModelResolver {
  private flatMap: Record<string, string> = {};
  private providerMap: ProviderModelMap = {};
  routingMode: RoutingMode = 'priority-chain';
  globalProviderPriority: ProviderId[] = ['openrouter', 'nvidia', 'anthropic', 'google', 'zen', 'opencode-go', 'openai', 'groq', 'ollama', 'vllm', 'lmstudio'];
  titleModel: string = '';
  fallbackModel: string = '';
  defaultProvider: ProviderId | '' = '';
  defaultModel: string = '';

  constructor() {
    this.load();
  }

  load(): void {
    this.flatMap = {};
    this.providerMap = {};

    try {
      if (fs.existsSync(MODELS_PATH)) {
        const raw = fs.readFileSync(MODELS_PATH, 'utf-8');
        const file = JSON.parse(raw);
        if (file._provider_models) {
          this.providerMap = file._provider_models;
        }
        if (file._routing_mode === 'per-model-per-provider' || file._routing_mode === 'priority-chain') {
          this.routingMode = file._routing_mode;
        }
        if (Array.isArray(file._global_provider_priority)) {
          this.globalProviderPriority = file._global_provider_priority;
        }
        if (typeof file._title_model === 'string') {
          this.titleModel = file._title_model;
        }
        if (typeof file._fallback_model === 'string') {
          this.fallbackModel = file._fallback_model;
        }
        if (typeof file._default_provider === 'string') {
          this.defaultProvider = file._default_provider as ProviderId;
        }
        if (typeof file._default_model === 'string') {
          this.defaultModel = file._default_model;
        }
        for (const [k, v] of Object.entries(file)) {
          if (!k.startsWith('_')) this.flatMap[k] = String(v);
        }
      }
    } catch { /* use defaults */ }
  }

  reload(): void {
    this.load();
  }

  getDefaultModel(providerId?: string): string {
    if (providerId) {
      const fromProviderMap = this.providerMap['default']?.[providerId];
      if (fromProviderMap) return fromProviderMap;
    }
    return this.flatMap['default'] || '';
  }

  resolve(model: string, providerId?: string): string {
    if (providerId && this.providerMap[model]?.[providerId]) {
      return this.providerMap[model][providerId];
    }
    if (this.flatMap[model]) return this.flatMap[model];
    const short = model.replace(/^models\//, '');
    if (this.flatMap[short]) return this.flatMap[short];
    for (const key of Object.keys(this.flatMap)) {
      if (key === 'default') continue;
      if (short.startsWith(key) || key.startsWith(short)) return this.flatMap[key];
    }
    const primary = this.findPrimaryModel(short);
    if (primary && providerId && this.providerMap[primary]?.[providerId]) {
      return this.providerMap[primary][providerId];
    }
    return short || model;
  }

  getProvidersForModel(model: string): string[] | null {
    const exact = this.providerMap[model];
    if (exact) return Object.keys(exact);
    const short = model.replace(/^models\//, '');
    if (short !== model) {
      const exactShort = this.providerMap[short];
      if (exactShort) return Object.keys(exactShort);
    }
    const primary = this.findPrimaryModel(short);
    if (primary && primary !== short) {
      const primaryProviders = this.providerMap[primary];
      if (primaryProviders) return Object.keys(primaryProviders);
    }
    return null;
  }

  private findPrimaryModel(model: string): string | null {
    for (const key of Object.keys(this.providerMap)) {
      if (key === 'default' || key === model) continue;
      if (model.startsWith(key + '-')) return key;
    }
    const stripped = model.replace(/-thinking$/, '');
    if (stripped !== model && this.providerMap[stripped]) return stripped;
    for (const key of Object.keys(this.providerMap)) {
      if (key === 'default' || key === stripped) continue;
      if (stripped.startsWith(key + '-')) return key;
    }
    return null;
  }

  hasModel(model: string): boolean {
    const short = model.replace(/^models\//, '');
    if (this.providerMap[model] || this.providerMap[short]) return true;
    if (this.flatMap[model] || this.flatMap[short]) return true;
    for (const key of Object.keys(this.flatMap)) {
      if (key === 'default') continue;
      if (short.startsWith(key) || key.startsWith(short)) return true;
    }
    return false;
  }

  getFlatMap(): Record<string, string> {
    return { ...this.flatMap };
  }

  getProviderMap(): ProviderModelMap {
    return JSON.parse(JSON.stringify(this.providerMap));
  }

  /**
   * Detect capabilities for a model by its name.
   * Uses pattern matching on the resolved model name.
   */
  getCapabilities(modelOrResolved: string): ModelCapabilities {
    return detectModelCapabilities(modelOrResolved);
  }

  /**
   * Resolve a model name and then detect its capabilities.
   */
  resolveWithCapabilities(model: string, providerId?: string): { resolvedModel: string; capabilities: ModelCapabilities } {
    const resolvedModel = this.resolve(model, providerId);
    return {
      resolvedModel,
      capabilities: detectModelCapabilities(resolvedModel),
    };
  }
}

export const modelResolver = new ModelResolver();
