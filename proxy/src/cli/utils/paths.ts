import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// utils/ → commands/ → cli/ → src/ → proxy/
export const PROXY_DIR = path.resolve(__dirname, '..', '..', '..');
export const CLI_DIR = path.resolve(__dirname, '..');
export const LOGS_DIR = path.resolve(PROXY_DIR, 'logs');
export const ENV_PATH = path.resolve(PROXY_DIR, '.env');
export const ENV_EXAMPLE = path.resolve(PROXY_DIR, '.env.example');
