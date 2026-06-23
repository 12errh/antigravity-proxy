import { poolFetch } from './http-pool.js';
import { logger } from './logger.js';
import { DEFAULT_PROVIDER_CONFIGS } from './adapter.js';

interface CachedModels {
  models: string[];
  fetchedAt: number;
  error?: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CachedModels>();

const PROVIDER_META: Record<string, { baseUrl: string; envKey: string }> = {
  nvidia:    { baseUrl: 'https://integrate.api.nvidia.com/v1',         envKey: 'NVIDIA_API_KEY' },
  openrouter:{ baseUrl: 'https://openrouter.ai/api/v1',                envKey: 'OPENROUTER_API_KEY' },
  openai:    { baseUrl: 'https://api.openai.com/v1',                   envKey: 'OPENAI_API_KEY' },
  groq:      { baseUrl: 'https://api.groq.com/openai/v1',             envKey: 'GROQ_API_KEY' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1',                envKey: 'ANTHROPIC_API_KEY' },
  google:    { baseUrl: 'https://generativelanguage.googleapis.com',    envKey: 'GOOGLE_API_KEY' },
  zen:       { baseUrl: 'https://opencode.ai/zen/v1',                  envKey: 'OPENCODE_API_KEY' },
  'opencode-go': { baseUrl: 'https://opencode.ai/zen/go/v1',         envKey: 'OPENCODE_GO_API_KEY' },
  ollama:    { baseUrl: 'http://localhost:11434',                      envKey: '' },
  vllm:      { baseUrl: 'http://localhost:8000',                       envKey: '' },
  lmstudio:  { baseUrl: 'http://localhost:1234',                       envKey: '' },
};

function getMeta(provider: string) {
  return PROVIDER_META[provider] || DEFAULT_PROVIDER_CONFIGS[provider as keyof typeof DEFAULT_PROVIDER_CONFIGS];
}

export async function fetchProviderModels(provider: string, apiKey?: string, force = false): Promise<CachedModels> {
  const meta = getMeta(provider);
  if (!meta) return { models: [], fetchedAt: Date.now(), error: 'Unknown provider' };

  const now = Date.now();
  const existing = cache.get(provider);
  if (!force && existing && (now - existing.fetchedAt) < CACHE_TTL_MS) return existing;

  const key = apiKey || (meta.envKey ? process.env[meta.envKey] : '') || '';
  if (meta.envKey && !key) {
    return { models: [], fetchedAt: Date.now(), error: `No API key configured — set ${meta.envKey} in .env` };
  }
  let models: string[] = [];
  let error: string | undefined;

  try {
    if (provider === 'google') {
      // SECURITY: API key goes in x-goog-api-key header, never in URL.
      const u = `${meta.baseUrl}/v1/models`;
      const r = await poolFetch(u, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      models = (d.models || []).map((m: any) => m.name.replace(/^models\//, ''));
    } else if (provider === 'ollama') {
      const r = await poolFetch(`${meta.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      models = (d.models || []).map((m: any) => m.name);
    } else {
      const headers: Record<string, string> = {};
      if (provider === 'anthropic') { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
      else if (key) headers['Authorization'] = `Bearer ${key}`;
      const r = await poolFetch(`${meta.baseUrl}/models`, { headers, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      models = (d.data || []).map((m: any) => m.id);
    }
  } catch (err: any) {
    error = err.message || String(err);
    logger.warn(`[provider-cache] Failed to fetch ${provider} models: ${error}`);
  }

  const result: CachedModels = { models: models.sort(), fetchedAt: now, error };
  cache.set(provider, result);
  return result;
}

export function getCachedProviderModels(provider: string): CachedModels | null {
  return cache.get(provider) || null;
}

export function clearProviderCache(provider?: string): void {
  if (provider) cache.delete(provider);
  else cache.clear();
}

export async function warmProviderCache(): Promise<void> {
  const providers = Object.keys(PROVIDER_META);
  await Promise.allSettled(providers.map(p => fetchProviderModels(p).catch(() => null)));
}
