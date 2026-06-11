import type { ModelAdapter, StreamChunk } from './adapters/types.js';
import { OpenAICompatAdapter } from './adapters/openai.js';
import { AnthropicAdapter } from './adapters/anthropic.js';
import { GoogleAdapter } from './adapters/google.js';
import { providerRegistry } from './provider-registry.js';
import type { OpenAIMessage } from './mapper.js';

export type ProviderId = 'nvidia' | 'openrouter' | 'openai' | 'groq' | 'anthropic' | 'google' | 'zen' | 'ollama' | 'vllm' | 'lmstudio' | (string & {});

export interface ProviderConfig {
  id: ProviderId;
  priority: number;
  apiKey?: string;
  baseUrl?: string;
  models?: Record<string, string>;
  enabled: boolean;
}

/**
 * Legacy default provider configs — kept for backward compatibility.
 * New code should use the plugin system (providerRegistry) instead.
 */
export const DEFAULT_PROVIDER_CONFIGS: Record<string, { baseUrl: string; adapterType: 'openai' | 'anthropic' | 'google'; envKey: string }> = {
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

/**
 * Legacy adapter factory — creates an adapter for a provider.
 *
 * First tries the plugin registry; falls back to the hardcoded defaults
 * for backward compatibility with code that hasn't migrated to plugins yet.
 *
 * After full migration, this function will delegate entirely to the plugin system.
 */
export function createAdapter(cfg: ProviderConfig): ModelAdapter {
  // Prefer plugin-registered adapter
  if (providerRegistry.hasProvider(cfg.id)) {
    try {
      return providerRegistry.getAdapter(cfg);
    } catch {
      // Plugin adapter failed — fall through to legacy path
    }
  }

  // Legacy fallback for providers not yet registered as plugins
  const defaults = DEFAULT_PROVIDER_CONFIGS[cfg.id];
  if (!defaults) {
    throw new Error(`Unknown provider: ${cfg.id}. Register a plugin first.`);
  }
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

// Re-export types for backward compatibility
export type { ModelAdapter, StreamChunk };
export type { OpenAIMessage };
