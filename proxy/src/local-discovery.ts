import { poolFetch } from './http-pool.js';
import { logger } from './logger.js';

export interface LocalProviderInfo {
  id: 'ollama' | 'vllm' | 'lmstudio';
  label: string;
  baseUrl: string;
  online: boolean;
  models: string[];
  error?: string;
}

const LOCAL_PROVIDERS: { id: LocalProviderInfo['id']; label: string; baseUrl: string; modelEndpoint: string; parser: (data: any) => string[] }[] = [
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434', modelEndpoint: '/api/tags', parser: (data) => (data.models || []).map((m: any) => m.name) },
  { id: 'vllm', label: 'vLLM', baseUrl: 'http://localhost:8000', modelEndpoint: '/v1/models', parser: (data) => (data.data || []).map((m: any) => m.id) },
  { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234', modelEndpoint: '/v1/models', parser: (data) => (data.data || []).map((m: any) => m.id) },
];

let cachedResults: LocalProviderInfo[] = [];
let lastScan = 0;

function isProviderOnline(info: LocalProviderInfo): boolean {
  return info.online && info.models.length > 0;
}

export async function scanLocalProviders(): Promise<LocalProviderInfo[]> {
  const results: LocalProviderInfo[] = [];

  for (const def of LOCAL_PROVIDERS) {
    const info: LocalProviderInfo = { id: def.id, label: def.label, baseUrl: def.baseUrl, online: false, models: [] };
    try {
      const url = `${def.baseUrl}${def.modelEndpoint}`;
      const resp = await poolFetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const data = await resp.json();
        info.models = def.parser(data);
        info.online = true;
        logger.info(`[local-discovery] ${def.label} found at ${def.baseUrl} (${info.models.length} models)`);
      } else {
        info.error = `HTTP ${resp.status}`;
      }
    } catch (err: any) {
      info.error = err.name === 'TimeoutError' ? 'timeout' : err.message;
    }
    results.push(info);
  }

  cachedResults = results;
  lastScan = Date.now();
  return results;
}

export function getCachedLocalProviders(): LocalProviderInfo[] {
  return cachedResults;
}
