import type { OpenAIMessage } from '../mapper.js';
import type { StreamChunk, ModelAdapter } from './types.js';
import { poolFetch } from '../http-pool.js';

export class OpenAICompatAdapter implements ModelAdapter {
  provider: string;
  private baseUrl: string;
  private apiKey: string;
  private supportsImages: boolean;

  constructor(provider: string, baseUrl: string, apiKey: string) {
    this.provider = provider;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.supportsImages = true;
  }

  async *stream(
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const body = this.buildRequest(model, messages, tools, config);
    const response = await this.fetchWithRetry(body, signal);

    if (!this.isStreaming(response)) {
      const data = await response.json() as any;
      const choice = data.choices?.[0];
      if (choice?.message?.content) {
        yield { type: 'text', content: choice.message.content };
      }
      if (choice?.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          const args = this.parseToolArgs(tc.function.arguments);
          yield { type: 'tool-call', name: tc.function.name, args };
        }
      }
      return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCallBuffers = new Map<number, { id?: string; name?: string; arguments: string }>();

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
          if (data === '[DONE]') return;
          let chunk: any;
          try { chunk = JSON.parse(data); } catch { continue; }
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta || {};
          if (delta.content) {
            yield { type: 'text', content: delta.content };
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallBuffers.has(idx)) toolCallBuffers.set(idx, { arguments: '' });
              const buf = toolCallBuffers.get(idx)!;
              if (tc.id) buf.id = tc.id;
              if (tc.function?.name) buf.name = tc.function.name;
              if (tc.function?.arguments) buf.arguments += tc.function.arguments;
            }
          }
          if (choice.finish_reason === 'tool_calls') {
            for (const [, buf] of toolCallBuffers) {
              yield { type: 'tool-call', name: buf.name || 'unknown', args: this.parseToolArgs(buf.arguments) };
            }
            toolCallBuffers.clear();
          }
        }
      }
      if (toolCallBuffers.size > 0) {
        for (const [, buf] of toolCallBuffers) {
          yield { type: 'tool-call', name: buf.name || 'unknown', args: this.parseToolArgs(buf.arguments) };
        }
        toolCallBuffers.clear();
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Providers that support OpenAI-specific params like reasoning_effort
  private static REASONING_PROVIDERS = new Set(['openai']);

  private buildRequest(
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = { model, messages: this.serializeMessages(messages), stream: true };
    if (tools && Object.keys(tools).length > 0) {
      body.tools = Object.entries(tools).map(([name, tool]: [string, any]) => ({
        type: 'function',
        function: { name, description: tool.description || '', parameters: tool.parameters || {} },
      }));
    }
    if (config?.maxTokens) body.max_tokens = config.maxTokens;
    if (config?.temperature != null) body.temperature = config.temperature;
    if (config?.topP != null) body.top_p = config.topP;
    if ((config as any)?.stopSequences?.length) body.stop = (config as any).stopSequences;
    // Only send OpenAI-specific params to OpenAI provider
    if (this.provider === 'openai') {
      const effort = (config as any)?.providerOptions?.openai?.reasoningEffort;
      if (effort) body.reasoning_effort = effort;
    }
    return body;
  }

  private serializeMessages(messages: OpenAIMessage[]): any[] {
    return messages.map(m => {
      if (Array.isArray(m.content)) {
        // Validate image parts — strip non-fetchable URLs that some providers reject
        const cleaned = m.content.map((part: any) => {
          if (part && part.type === 'image_url' && part.image_url && part.image_url.url) {
            const u = part.image_url.url;
            if (!/^(https?:|data:|file:)/i.test(u)) return null;
          }
          return part;
        }).filter(Boolean);
        if (cleaned.length === 0) {
          return { role: m.role, content: '', tool_calls: m.tool_calls, tool_call_id: m.tool_call_id };
        }
        return { role: m.role, content: cleaned, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id };
      }
      return { role: m.role, content: m.content, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id };
    });
  }

  private async fetchWithRetry(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const response = await poolFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const err = await response.text().catch(() => 'unknown');
      throw new Error(`[${this.provider}] API error ${response.status}: ${err}`);
    }
    return response;
  }

  private isStreaming(res: Response): boolean {
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    return ct.includes('text/event-stream') || ct.includes('application/x-ndjson');
  }

  private parseToolArgs(raw: string): Record<string, unknown> {
    try { return JSON.parse(raw); } catch { return {}; }
  }
}
