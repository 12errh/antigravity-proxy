import { logger } from '../logger.js';

interface WritableResponse {
  destroyed?: boolean;
  write(data: string, encoding?: string): boolean;
}

export function safeWrite(res: WritableResponse, data: string): boolean {
  if (res.destroyed) {
    logger.debug('Attempted to write to destroyed response');
    return false;
  }

  try {
    return res.write(data, 'utf-8');
  } catch (err: any) {
    logger.debug('Failed to write to response', { error: err.message });
    return false;
  }
}
