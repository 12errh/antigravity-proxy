import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

export type Provider = 'nvidia' | 'openrouter';

export const config = {
  provider: (process.env.PROVIDER || 'openrouter') as Provider,
  nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
  nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  proxyPort: parseInt(process.env.PROXY_PORT || '443', 10),
  apiPort: parseInt(process.env.API_PORT || '4000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  get isConfigured(): boolean {
    if (this.provider === 'nvidia') return this.nvidiaApiKey.length > 0;
    return this.openrouterApiKey.length > 0;
  },
  get baseUrl(): string {
    return this.provider === 'nvidia' ? this.nvidiaBaseUrl : this.openrouterBaseUrl;
  },
  get apiKey(): string {
    return this.provider === 'nvidia' ? this.nvidiaApiKey : this.openrouterApiKey;
  },
};