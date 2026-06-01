import { EventEmitter } from 'events';
import * as db from './db.js';

export interface RequestRecord {
  id: string;
  timestamp: string;
  model: string;
  resolvedModel: string;
  direction: 'incoming' | 'outgoing';
  type: 'text' | 'tool-call' | 'error';
  content: string;
  toolCalls?: { name: string; args: any }[];
  promptTokens?: number;
  outputTokens?: number;
  duration?: number;
  status?: number;
  error?: string;
  sessionId?: string;
  provider?: string;
  cost?: number;
  attempts?: number;
  failoverEvents?: string;
}

class RequestStore extends EventEmitter {
  push(record: RequestRecord): void {
    db.insertRequest({
      id: record.id,
      sessionId: record.sessionId,
      timestamp: record.timestamp,
      model: record.model,
      resolvedModel: record.resolvedModel,
      provider: record.provider || '',
      direction: record.direction,
      type: record.type,
      content: record.content,
      promptTokens: record.promptTokens,
      outputTokens: record.outputTokens,
      toolCalls: record.toolCalls ? JSON.stringify(record.toolCalls) : undefined,
      error: record.error,
      durationMs: record.duration,
      attempts: record.attempts,
      cost: record.cost,
      failoverEvents: record.failoverEvents,
    });
    this.emit('request', record);
  }

  getAll(): RequestRecord[] {
    return db.getAllRequests() as RequestRecord[];
  }

  getDates(): { date: string; count: number }[] {
    return db.getRequestDates();
  }

  getByDate(date: string): RequestRecord[] {
    return db.getRequestsByDate(date) as RequestRecord[];
  }

  search(q: string, page: number = 1, perPage: number = 50): { rows: RequestRecord[]; total: number } {
    const offset = (page - 1) * perPage;
    return db.searchRequests(q, perPage, offset) as any;
  }

  searchAll(q: string, page: number = 1, perPage: number = 50): { requests: { rows: RequestRecord[]; total: number }; sessions: { rows: any[]; total: number }; logs: { rows: any[]; total: number } } {
    const offset = (page - 1) * perPage;
    return {
      requests: db.searchRequests(q, perPage, offset) as any,
      sessions: db.searchSessions(q, perPage, offset) as any,
      logs: db.searchLogs(q, perPage, offset) as any,
    };
  }

  getStats(): { totalRequests: number; totalTokens: number; totalToolCalls: number; errors: number } {
    return db.getStats();
  }

  clear(): void {
    db.clearRequests();
    this.emit('cleared');
  }
}

export const requestStore = new RequestStore();
