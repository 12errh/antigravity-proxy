import type { ModelAdapter, StreamChunk } from './adapters/types.js';
import { OpenAICompatAdapter } from './adapters/openai.js';
import { AnthropicAdapter } from './adapters/anthropic.js';
import { GoogleAdapter } from './adapters/google.js';
import type { OpenAIMessage } from './mapper.js';

export type ProviderId = 'nvidia' | 'openrouter' | 'openai' | 'groq' | 'anthropic' | 'google' | 'zen' | 'ollama' | 'vllm' | 'lmstudio';

export interface ProviderConfig {
  id: ProviderId;
  priority: number;
  apiKey?: string;
  baseUrl?: string;
  models?: Record<string, string>;
  enabled: boolean;
}

export const DEFAULT_PROVIDER_CONFIGS: Record<ProviderId, { baseUrl: string; adapterType: 'openai' | 'anthropic' | 'google'; envKey: string }> = {
  nvidia:    { baseUrl: 'https://integrate.api.nvidia.com/v1',         adapterType: 'openai',    envKey: 'NVIDIA_API_KEY' },
  openrouter:{ baseUrl: 'https://openrouter.ai/api/v1',                adapterType: 'openai',    envKey: 'OPENROUTER_API_KEY' },
  openai:    { baseUrl: 'https://api.openai.com/v1',                   adapterType: 'openai',    envKey: 'OPENAI_API_KEY' },
  groq:      { baseUrl: 'https://api.groq.com/openai/v1',             adapterType: 'openai',    envKey: 'GROQ_API_KEY' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1',                adapterType: 'anthropic', envKey: 'ANTHROPIC_API_KEY' },
  google:    { baseUrl: 'https://generativelanguage.googleapis.com',    adapterType: 'google',    envKey: 'GOOGLE_API_KEY' },
  zen:       { baseUrl: 'https://opencode.ai/zen/v1',                  adapterType: 'openai',    envKey: 'OPENCODE_API_KEY' },
  ollama:    { baseUrl: 'http://localhost:11434',                      adapterType: 'openai',    envKey: '' },
  vllm:      { baseUrl: 'http://localhost:8000',                       adapterType: 'openai',    envKey: '' },
  lmstudio:  { baseUrl: 'http://localhost:1234',                       adapterType: 'openai',    envKey: '' },
};

export function createAdapter(cfg: ProviderConfig): ModelAdapter {
  const defaults = DEFAULT_PROVIDER_CONFIGS[cfg.id];
  const baseUrl = cfg.baseUrl || defaults.baseUrl;
  const apiKey = cfg.apiKey || '';
  switch (defaults.adapterType) {
    case 'openai':
      return new OpenAICompatAdapter(cfg.id, baseUrl, apiKey);
    case 'anthropic':
      return new AnthropicAdapter(baseUrl, apiKey);
    case 'google':
      return new GoogleAdapter(baseUrl, apiKey);
  }
}
