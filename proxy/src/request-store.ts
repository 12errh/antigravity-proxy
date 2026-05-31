import { EventEmitter } from 'events';

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
}

class RequestStore extends EventEmitter {
  private requests: RequestRecord[] = [];
  private maxSize = 500;

  push(record: RequestRecord): void {
    this.requests.unshift(record);
    if (this.requests.length > this.maxSize) this.requests.pop();
    this.emit('request', record);
  }

  getAll(): RequestRecord[] {
    return this.requests;
  }

  getStats(): { totalRequests: number; totalTokens: number; totalToolCalls: number; errors: number } {
    let totalTokens = 0;
    let totalToolCalls = 0;
    let errors = 0;
    for (const r of this.requests) {
      totalTokens += (r.promptTokens || 0) + (r.outputTokens || 0);
      totalToolCalls += r.toolCalls?.length || 0;
      if (r.type === 'error') errors++;
    }
    return { totalRequests: this.requests.length, totalTokens, totalToolCalls, errors };
  }

  clear(): void {
    this.requests = [];
    this.emit('cleared');
  }
}

export const requestStore = new RequestStore();
