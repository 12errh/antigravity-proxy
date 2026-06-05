import type { OpenAIMessage } from '../mapper.js';

export interface StreamChunk {
  type: 'text' | 'tool-call' | 'error' | 'done' | 'thought' | 'attempt';
  content?: string;
  name?: string;
  args?: Record<string, unknown>;
  finishReason?: string;
  attempt?: number;
  status?: 'trying' | 'retrying' | 'failover' | 'failed';
  fallback?: boolean;
}

export interface ModelAdapter {
  provider: string;
  stream(
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk>;
}
