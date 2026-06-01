import { logger } from '../logger.js';
import type { OpenAIMessage } from '../mapper.js';
import type { StreamChunk, ModelAdapter } from './types.js';
import { poolFetch } from '../http-pool.js';

export class GoogleAdapter implements ModelAdapter {
  provider = 'google';
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  async *stream(
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const body = this.buildRequest(model, messages, tools, config);
    const url = `${this.baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
    const response = await this.fetchResponse(url, body, signal);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          let chunk: any;
          try { chunk = JSON.parse(data); } catch { continue; }
          const candidate = chunk.candidates?.[0];
          if (!candidate) continue;
          const parts = candidate.content?.parts || [];
          for (const part of parts) {
            if (part.thought) {
              if (part.text) yield { type: 'thought', content: part.text };
            } else if (part.text) {
              yield { type: 'text', content: part.text };
            }
            if (part.functionCall) {
              const args = typeof part.functionCall.args === 'string'
                ? this.parseToolArgs(part.functionCall.args)
                : (part.functionCall.args || {});
              yield { type: 'tool-call', name: part.functionCall.name, args };
            }
          }
          if (candidate.finishReason) {
            yield { type: 'done', finishReason: candidate.finishReason };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private buildRequest(
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contents: this.convertMessages(messages),
      generationConfig: {},
    };
    if (tools && Object.keys(tools).length > 0) {
      (body as any).tools = [{
        functionDeclarations: Object.entries(tools).map(([name, tool]: [string, any]) => ({
          name,
          description: tool.description || '',
          parameters: tool.parameters || { type: 'object', properties: {} },
        })),
      }];
    }
    const gc = body.generationConfig as any;
    if (config?.maxTokens) gc.maxOutputTokens = config.maxTokens;
    if (config?.temperature != null) gc.temperature = config.temperature;
    if (config?.topP != null) gc.topP = config.topP;
    if ((config as any)?.stopSequences?.length) gc.stopSequences = (config as any).stopSequences;
    if (Object.keys(gc).length === 0) delete body.generationConfig;
    return body;
  }

  private convertMessages(messages: OpenAIMessage[]): any[] {
    const result: any[] = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        result.push({
          role: 'function',
          parts: [{ functionResponse: { name: m.tool_call_id || 'unknown', response: { content: m.content || '' } } }],
        });
        continue;
      }
      const parts: any[] = [];
      if (m.content) parts.push({ text: m.content });
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          parts.push({
            functionCall: { name: tc.function.name, args: this.parseToolArgs(tc.function.arguments) },
          });
        }
      }
      result.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
    }
    return result;
  }

  private async fetchResponse(url: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const response = await poolFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const err = await response.text().catch(() => 'unknown');
      throw new Error(`[google] API error ${response.status}: ${err}`);
    }
    return response;
  }

  private parseToolArgs(raw: string): Record<string, unknown> {
    try { return JSON.parse(raw); } catch { return {}; }
  }
}
