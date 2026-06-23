/**
 * Built-in Provider Plugins
 *
 * Registers all the default Antigravity providers as plugins.
 * Each provider is a separate IProviderPlugin that knows its own
 * defaults, adapter type, and capabilities.
 *
 * Extend by adding a new plugin registration in registerBuiltinPlugins().
 */

import { logger } from '../logger.js';
import { providerRegistry } from '../provider-registry.js';
import type { IProviderPlugin, ProviderCapabilities } from '../provider-plugin.js';
import type { ProviderConfig } from '../adapter.js';
import type { ModelAdapter } from '../adapters/types.js';
import { OpenAICompatAdapter } from '../adapters/openai.js';
import { AnthropicAdapter } from '../adapters/anthropic.js';
import { GoogleAdapter } from '../adapters/google.js';
import { GroqAdapter } from '../adapters/groq.js';
import { ZenAdapter } from '../adapters/zen.js';
import { OpencodeGoAdapter } from '../adapters/opencode-go.js';
import { NvidiaAdapter } from '../adapters/nvidia.js';
import { DEFAULT_CAPABILITIES } from '../provider-plugin.js';

// ─── Provider definitions ──────────────────────────────────────────────

interface ProviderDef {
  id: string;
  name: string;
  envKey: string;
  baseUrl: string;
  adapterType: 'openai' | 'anthropic' | 'google';
  capabilities?: Partial<ProviderCapabilities>;
}

const BUILTIN_PROVIDERS: ProviderDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    adapterType: 'openai',
    capabilities: { supportsReasoning: true, supportsImages: true, supportsSystemMessages: true },
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com/v1',
    adapterType: 'anthropic',
    capabilities: { supportsReasoning: true, supportsImages: true, supportsSystemMessages: true },
  },
  {
    id: 'google',
    name: 'Google Gemini',
    envKey: 'GOOGLE_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com',
    adapterType: 'google',
    capabilities: { supportsReasoning: false, supportsImages: true, supportsSystemMessages: true },
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    envKey: 'NVIDIA_API_KEY',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    adapterType: 'openai',
    capabilities: { supportsReasoning: true, supportsImages: true },
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    adapterType: 'openai',
    capabilities: { supportsReasoning: true, supportsImages: true },
  },
  {
    id: 'groq',
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    adapterType: 'openai',
    capabilities: { supportsReasoning: false, supportsImages: false },
  },
  {
    id: 'zen',
    name: 'Zen (OpenCode)',
    envKey: 'OPENCODE_API_KEY',
    baseUrl: 'https://opencode.ai/zen/v1',
    adapterType: 'openai',
    capabilities: { supportsReasoning: true, supportsImages: false },
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    envKey: 'OPENCODE_GO_API_KEY',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    adapterType: 'openai',
    capabilities: { supportsReasoning: true, supportsImages: false },
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    envKey: '',
    baseUrl: 'http://localhost:11434',
    adapterType: 'openai',
    capabilities: { supportsReasoning: false, supportsImages: true },
  },
  {
    id: 'vllm',
    name: 'vLLM (Local)',
    envKey: '',
    baseUrl: 'http://localhost:8000',
    adapterType: 'openai',
    capabilities: { supportsReasoning: false, supportsImages: true },
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    envKey: '',
    baseUrl: 'http://localhost:1234',
    adapterType: 'openai',
    capabilities: { supportsReasoning: false, supportsImages: true },
  },
];

// ─── Plugin factory ────────────────────────────────────────────────────

function createAdapterForType(type: 'openai' | 'anthropic' | 'google', cfg: ProviderConfig): ModelAdapter {
  // Use provider-specific adapters for optimized behavior
  switch (cfg.id) {
    case 'groq':
      return new GroqAdapter(cfg.id, cfg.baseUrl || BUILTIN_PROVIDERS.find(p => p.id === cfg.id)?.baseUrl || '', cfg.apiKey || '');
    case 'zen':
      return new ZenAdapter(cfg.id, cfg.baseUrl || BUILTIN_PROVIDERS.find(p => p.id === cfg.id)?.baseUrl || '', cfg.apiKey || '');
    case 'opencode-go':
      return new OpencodeGoAdapter(cfg.id, cfg.baseUrl || BUILTIN_PROVIDERS.find(p => p.id === cfg.id)?.baseUrl || '', cfg.apiKey || '');
    case 'nvidia':
      return new NvidiaAdapter(cfg.id, cfg.baseUrl || BUILTIN_PROVIDERS.find(p => p.id === cfg.id)?.baseUrl || '', cfg.apiKey || '');
  }
  switch (type) {
    case 'openai':
      return new OpenAICompatAdapter(cfg.id, cfg.baseUrl || BUILTIN_PROVIDERS.find(p => p.id === cfg.id)?.baseUrl || '', cfg.apiKey || '');
    case 'anthropic':
      return new AnthropicAdapter(cfg.baseUrl || '', cfg.apiKey || '');
    case 'google':
      return new GoogleAdapter(cfg.baseUrl || '', cfg.apiKey || '');
  }
}

/**
 * Create an IProviderPlugin for a built-in provider definition.
 */
function buildPlugin(def: ProviderDef): IProviderPlugin {
  const capabilities: ProviderCapabilities = {
    ...DEFAULT_CAPABILITIES,
    label: def.name,
    ...(def.capabilities || {}),
  };

  return {
    id: def.id,
    name: def.name,

    getAdapter(config: ProviderConfig): ModelAdapter {
      return createAdapterForType(def.adapterType, {
        ...config,
        id: def.id,
        baseUrl: config.baseUrl || def.baseUrl,
        apiKey: config.apiKey || '',
      });
    },

    getCapabilities(): ProviderCapabilities {
      return capabilities;
    },

    validateConfig(config: Record<string, unknown>): string | null {
      // Local providers (ollama, vllm, lmstudio) don't need API keys
      if (!def.envKey) return null;
      if (!config.apiKey && !process.env[def.envKey]) {
        return `Missing API key — set ${def.envKey} in .env or provide it in config`;
      }
      return null;
    },
  };
}

// ─── Registration ──────────────────────────────────────────────────────

/**
 * Register all built-in provider plugins with the global registry.
 * Called once at startup.
 */
export function registerBuiltinPlugins(): void {
  let count = 0;
  for (const def of BUILTIN_PROVIDERS) {
    const plugin = buildPlugin(def);
    providerRegistry.register(plugin);
    count++;
  }
  logger.info(`[plugins] Registered ${count} built-in providers`);
}
