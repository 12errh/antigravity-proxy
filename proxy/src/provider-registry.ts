/**
 * Provider Registry
 *
 * Central registry for provider plugins. Maintains the set of available
 * providers, creates adapter instances on demand, and exposes capability
 * metadata for the router and engine.
 *
 * Usage:
 *   import { providerRegistry } from './provider-registry.js';
 *   providerRegistry.register(new MyProviderPlugin());
 *   const adapter = providerRegistry.getAdapter('my-provider', config);
 */

import { logger } from './logger.js';
import type { ProviderConfig } from './adapter.js';
import type { IProviderPlugin, ProviderCapabilities } from './provider-plugin.js';
import type { ModelAdapter } from './adapters/types.js';

export class ProviderRegistry {
  /** Registered plugin instances, keyed by provider id */
  private plugins = new Map<string, IProviderPlugin>();

  /** Cached adapter instances, keyed by provider id */
  private adapters = new Map<string, ModelAdapter>();

  /**
   * Register a provider plugin.
   * Replaces any existing plugin with the same id.
   */
  register(plugin: IProviderPlugin): void {
    if (!plugin.id || typeof plugin.id !== 'string') {
      logger.warn(`[registry] Attempted to register plugin without valid id`, { plugin });
      return;
    }
    this.plugins.set(plugin.id, plugin);
    // Clear any cached adapter so it's re-created with fresh config
    this.adapters.delete(plugin.id);
    logger.info(`[registry] Registered provider: ${plugin.id} (${plugin.name || plugin.id})`);
  }

  /**
   * Unregister a provider plugin and remove its cached adapter.
   */
  unregister(id: string): void {
    this.plugins.delete(id);
    this.adapters.delete(id);
    logger.info(`[registry] Unregistered provider: ${id}`);
  }

  /**
   * Check if a provider is registered.
   */
  hasProvider(id: string): boolean {
    return this.plugins.has(id);
  }

  /**
   * Get a registered plugin by id.
   */
  getProvider(id: string): IProviderPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Get the capabilities of a registered provider.
   * Returns undefined if the provider is not registered.
   */
  getCapabilities(id: string): ProviderCapabilities | undefined {
    return this.plugins.get(id)?.getCapabilities();
  }

  /**
   * Get (or create) an adapter for the given provider configuration.
   * Adapters are cached per provider id.
   */
  getAdapter(config: ProviderConfig): ModelAdapter {
    const cached = this.adapters.get(config.id);
    if (cached) return cached;

    const plugin = this.plugins.get(config.id);
    if (!plugin) {
      throw new Error(`[registry] No plugin registered for provider: ${config.id}`);
    }

    const validationError = plugin.validateConfig({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      ...config.models,
    });
    if (validationError) {
      throw new Error(`[registry] Invalid config for ${config.id}: ${validationError}`);
    }

    const adapter = plugin.getAdapter(config);
    this.adapters.set(config.id, adapter);
    logger.info(`[registry] Created adapter for: ${config.id}`);
    return adapter;
  }

  /**
   * Get all registered provider ids.
   */
  getAvailableProviderIds(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Get all registered plugins.
   */
  getAvailableProviders(): IProviderPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Clear all cached adapters (e.g. after config reload).
   * Plugins themselves are preserved — only their adapter instances are cleared.
   */
  clearAdapterCache(): void {
    this.adapters.clear();
    logger.info('[registry] Adapter cache cleared');
  }

  /**
   * Remove all registered plugins and adapters.
   */
  reset(): void {
    this.plugins.clear();
    this.adapters.clear();
    logger.info('[registry] Full reset');
  }
}

/** Singleton registry instance */
export const providerRegistry = new ProviderRegistry();
