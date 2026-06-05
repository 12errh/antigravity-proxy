import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

  constructor() {
    this.load();
  }

  load(): void {
    const defaults: Record<string, string> = {
      "gemini-3.5-flash": "deepseek-ai/deepseek-v4-flash",
      "gemini-3.5-flash-low": "deepseek-ai/deepseek-v4-flash",
      "gemini-3.5-flash-medium": "deepseek-ai/deepseek-v4-flash",
      "gemini-3.5-flash-high": "deepseek-ai/deepseek-v4-flash",
      "gemini-3-flash-agent": "deepseek-ai/deepseek-v4-flash",
      "gemini-3.1-flash-lite": "deepseek-ai/deepseek-v4-flash",
      "gemini-3.1-flash": "deepseek-ai/deepseek-v4-flash",
      "gemini-3.1-pro": "deepseek-ai/deepseek-v4-flash",
      "gemini-3.1-pro-low": "deepseek-ai/deepseek-v4-flash",
      "gemini-3.1-pro-high": "deepseek-ai/deepseek-v4-flash",
      "claude-sonnet-4-6": "deepseek-ai/deepseek-v4-flash",
      "claude-sonnet-4-6-thinking": "deepseek-ai/deepseek-v4-flash",
      "claude-opus-4-6": "deepseek-ai/deepseek-v4-flash",
      "claude-opus-4-6-thinking": "deepseek-ai/deepseek-v4-flash",
      "gpt-oss-120b": "deepseek-ai/deepseek-v4-flash",
      "gpt-oss-120b-medium": "deepseek-ai/deepseek-v4-flash",
      "qwen3-32b": "deepseek-ai/deepseek-v4-flash",
      "qwen3-32b-fast": "deepseek-ai/deepseek-v4-flash",
      "openai/gpt-oss-120b": "openai/gpt-oss-120b",
      default: "deepseek-ai/deepseek-v4-flash",
    };

    this.flatMap = { ...defaults };
    this.providerMap = {};

    try {
      if (fs.existsSync(MODELS_PATH)) {
        const raw = fs.readFileSync(MODELS_PATH, 'utf-8');
        const file = JSON.parse(raw);
        if (file._provider_models) {
          this.providerMap = file._provider_models;
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
    return this.flatMap['default'] || 'openai/gpt-oss-120b';
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
    return this.getDefaultModel(providerId);
  }

  getProvidersForModel(model: string): string[] | null {
    const providers = this.providerMap[model];
    if (providers) return Object.keys(providers);
    const short = model.replace(/^models\//, '');
    if (short !== model && this.providerMap[short]) return Object.keys(this.providerMap[short]);
    for (const key of Object.keys(this.providerMap)) {
      if (short.startsWith(key) || key.startsWith(short)) return Object.keys(this.providerMap[key]);
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
}

export const modelResolver = new ModelResolver();
