import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ProviderConfig, ProviderId } from './adapter.js';
import type { LocalProviderInfo } from './local-discovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '.env');

dotenv.config({ path: ENV_PATH });

export type Provider = 'nvidia' | 'openrouter';

function parsePriority(): ProviderId[] {
  const raw = (process.env.PROVIDER_PRIORITY || 'openrouter,nvidia').split(',').map(s => s.trim().toLowerCase() as ProviderId);
  return raw.length > 0 ? raw : ['openrouter', 'nvidia'];
}

function buildProviders(priority: ProviderId[], localConfigs?: ProviderConfig[]): ProviderConfig[] {
  const fromPriority: ProviderConfig[] = priority.map((id, idx) => {
    const envKey = id.toUpperCase();
    return {
      id,
      priority: idx,
      apiKey: process.env[`${envKey}_API_KEY`] || undefined,
      baseUrl: process.env[`${envKey}_BASE_URL`] || undefined,
      enabled: true,
    };
  });
  if (!localConfigs || localConfigs.length === 0) return fromPriority;
  const localIds = new Set(localConfigs.map(c => c.id));
  const merged = fromPriority.filter(c => !localIds.has(c.id));
  const startPriority = merged.length;
  merged.push(...localConfigs.map((c, i) => ({ ...c, priority: startPriority + i })));
  return merged;
}

function parseEnvFile(): void {
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf-8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.+)/);
      if (m) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
}

function createConfig() {
  let localProviders: ProviderConfig[] = [];

  return {
    legacyProvider: (process.env.PROVIDER || 'openrouter') as Provider,
    nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
    nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    proxyPort: parseInt(process.env.PROXY_PORT || '443', 10),
    apiPort: parseInt(process.env.API_PORT || '4000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
    retries: parseInt(process.env.PROXY_RETRIES || '10', 10),
    backoffMs: parseInt(process.env.PROXY_BACKOFF_MS || '1000', 10),
    rateLimitGlobal: parseInt(process.env.RATE_LIMIT_GLOBAL || '60', 10),
    rateLimitProvider: parseInt(process.env.RATE_LIMIT_PROVIDER || '30', 10),
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    providerPriority: parsePriority(),
    providers: buildProviders(parsePriority()),
    get localProviders(): ProviderConfig[] { return localProviders; },
    setLocalProviders(discovered: LocalProviderInfo[]): void {
      localProviders = discovered.filter(p => p.online).map(p => ({
        id: p.id,
        priority: 999,
        apiKey: '',
        baseUrl: p.baseUrl,
        enabled: true,
        models: p.models.reduce((acc, m) => { acc[m] = m; return acc; }, {} as Record<string, string>),
      } as ProviderConfig));
      this.providers = buildProviders(this.providerPriority, localProviders);
    },
    get isConfigured(): boolean {
      return this.providers.some((p: ProviderConfig) => !!p.apiKey);
    },
    get provider(): string {
      return this.legacyProvider;
    },
    get baseUrl(): string {
      return this.legacyProvider === 'nvidia' ? this.nvidiaBaseUrl : this.openrouterBaseUrl;
    },
    get apiKey(): string {
      return this.legacyProvider === 'nvidia' ? this.nvidiaApiKey : this.openrouterApiKey;
    },
    reload(): void {
      parseEnvFile();
      this.legacyProvider = (process.env.PROVIDER || 'openrouter') as Provider;
      this.nvidiaApiKey = process.env.NVIDIA_API_KEY || '';
      this.nvidiaBaseUrl = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
      this.openrouterApiKey = process.env.OPENROUTER_API_KEY || '';
      this.openrouterBaseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
      this.proxyPort = parseInt(process.env.PROXY_PORT || '443', 10);
      this.apiPort = parseInt(process.env.API_PORT || '4000', 10);
      this.logLevel = process.env.LOG_LEVEL || 'info';
      this.retries = parseInt(process.env.PROXY_RETRIES || '10', 10);
      this.backoffMs = parseInt(process.env.PROXY_BACKOFF_MS || '1000', 10);
      this.rateLimitGlobal = parseInt(process.env.RATE_LIMIT_GLOBAL || '60', 10);
      this.rateLimitProvider = parseInt(process.env.RATE_LIMIT_PROVIDER || '30', 10);
      this.rateLimitWindow = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
      this.providerPriority = parsePriority();
      this.providers = buildProviders(this.providerPriority, localProviders);
    },
  };
}

export const config = createConfig();
