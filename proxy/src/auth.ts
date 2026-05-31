import { config } from './config.js';
import { logger } from './logger.js';

export function getAuthHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
}

export function validateApiKey(): boolean {
  if (!config.isConfigured) {
    const varName = config.provider === 'nvidia' ? 'NVIDIA_API_KEY' : 'OPENROUTER_API_KEY';
    logger.error(`${config.provider} API key not configured. Set ${varName} in .env`);
    return false;
  }
  return true;
}