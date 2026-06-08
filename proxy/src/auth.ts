import { config } from './config.js';
import { logger } from './logger.js';
import { DEFAULT_PROVIDER_CONFIGS } from './adapter.js';

function getMissingApiKeyVars(): string[] {
  const missing: string[] = [];
  for (const [id, def] of Object.entries(DEFAULT_PROVIDER_CONFIGS)) {
    if (id === 'ollama' || id === 'vllm' || id === 'lmstudio') continue;
    if (!def.envKey) continue;
    const cfg = config.providers.find(p => p.id === id);
    const hasKey = !!(cfg && cfg.apiKey) || !!process.env[def.envKey];
    if (!hasKey) missing.push(def.envKey);
  }
  return missing;
}

export function validateApiKey(): boolean {
  if (config.isConfigured) return true;
  const missing = getMissingApiKeyVars();
  if (missing.length === 0) {
    logger.error('No provider is configured. Add at least one API key in .env or via the dashboard.');
  } else {
    const shown = missing.slice(0, 3).join(', ');
    const more = missing.length > 3 ? ` (and ${missing.length - 3} more)` : '';
    logger.error(`No provider API key configured. Set one of: ${shown}${more}`);
  }
  return false;
}