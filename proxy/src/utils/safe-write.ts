import { ServerResponse } from 'http';
import { logger } from '../logger.js';

export function safeWrite(res: ServerResponse, data: string): boolean {
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
