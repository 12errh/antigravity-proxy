/**
 * Provider Plugin System
 *
 * Defines the interface for provider plugins and capability metadata.
 * Any provider can be registered dynamically via the ProviderRegistry,
 * enabling the proxy to support new LLM providers without code changes.
 *
 * ## Adding a New Provider
 *
 * ```ts
 * class MyProviderPlugin implements IProviderPlugin {
 *   id = 'my-provider';
 *   name = 'My Provider';
 *   getAdapter(cfg) { return new MyAdapter(cfg.baseUrl, cfg.apiKey); }
 *   getCapabilities() { return { ... }; }
 *   validateConfig(cfg) { return cfg.apiKey ? null : 'Missing API key'; }
 * }
 * registry.register(new MyProviderPlugin());
 * ```
 */

import type { ModelAdapter } from './adapters/types.js';
import type { ProviderConfig } from './adapter.js';

/**
 * Capability metadata for a provider plugin.
 * Used by the router to decide which provider to try first,
 * and by the engine to enable/disable provider-specific features.
 */
export interface ProviderCapabilities {
  /** Human-readable name (e.g. "NVIDIA NIM", "OpenRouter") */
  label?: string;

  /** Max parallel requests this provider supports */
  maxConcurrency?: number;

  /** Whether this provider supports streaming responses */
  supportsStreaming: boolean;

  /** Whether this provider supports function/tool calling */
  supportsTools: boolean;

  /** Whether this provider supports reasoning/thinking output */
  supportsReasoning: boolean;

  /** Whether this provider supports image inputs */
  supportsImages: boolean;

  /** Whether this provider supports system messages */
  supportsSystemMessages: boolean;

  /** Rate limit strategy to use */
  rateLimitStrategy: 'global' | 'per-provider' | 'none';

  /** Authentication method */
  authMethod: 'header' | 'query' | 'none';
}

/** Default capabilities — all true, header auth */
export const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsTools: true,
  supportsReasoning: false,
  supportsImages: true,
  supportsSystemMessages: true,
  rateLimitStrategy: 'per-provider',
  authMethod: 'header',
};

/**
 * Provider Plugin Interface
 *
 * Implement this interface to add a new LLM provider to Antigravity.
 * Once registered with the ProviderRegistry, the provider will be
 * available for routing, model resolution, and tool execution.
 */
export interface IProviderPlugin {
  /** Unique provider identifier (e.g. "openai", "anthropic", "my-provider") */
  readonly id: string;

  /** Human-readable provider name */
  readonly name: string;

  /**
   * Create an adapter instance for this provider.
   * Called once per provider configuration by the factory.
   */
  getAdapter(config: ProviderConfig): ModelAdapter;

  /**
   * Return the capabilities of this provider plugin.
   * Used by the router and engine to optimize behavior.
   */
  getCapabilities(): ProviderCapabilities;

  /**
   * Validate a provider configuration.
   * Returns null if valid, or an error message string if invalid.
   */
  validateConfig(config: Record<string, unknown>): string | null;
}
