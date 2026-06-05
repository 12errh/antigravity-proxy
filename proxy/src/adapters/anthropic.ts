import { logger } from '../logger.js';
import type { OpenAIMessage } from '../mapper.js';
import type { StreamChunk, ModelAdapter } from './types.js';
import { poolFetch } from '../http-pool.js';

export class AnthropicAdapter implements ModelAdapter {
  provider = 'anthropic';
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
    const response = await this.fetchResponse(body, signal);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentContent = '';
    let toolName = '';
    let toolArgs = '';
    let hasToolUse = false;
    let isThinking = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event: ')) continue;
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6).trim();
          if (data === '[DONE]') { yield { type: 'done' }; return; }
          let event: any;
          try { event = JSON.parse(data); } catch { continue; }

          if (event.type === 'content_block_start') {
            if (event.content_block?.type === 'thinking') {
              isThinking = true;
              if (event.content_block.thinking) {
                yield { type: 'thought', content: event.content_block.thinking };
              }
            }
            if (event.content_block?.type === 'tool_use') {
              hasToolUse = true;
              toolName = event.content_block.name || '';
              toolArgs = '';
            }
          }
          if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'thinking' && event.delta.thinking) {
              yield { type: 'thought', content: event.delta.thinking };
            }
            if (event.delta?.text) {
              currentContent += event.delta.text;
              yield { type: 'text', content: event.delta.text };
            }
            if (event.delta?.partial_json) {
              toolArgs += event.delta.partial_json;
            }
          }
          if (event.type === 'content_block_stop') {
            if (isThinking) {
              isThinking = false;
            }
            if (hasToolUse) {
              yield { type: 'tool-call', name: toolName, args: this.parseToolArgs(toolArgs) };
              hasToolUse = false;
              toolName = '';
              toolArgs = '';
            }
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
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model,
      max_tokens: (config?.maxTokens as number) || 4096,
      stream: true,
      messages: this.convertMessages(nonSystemMessages),
    };
    if (systemMessages.length > 0) {
      body.system = systemMessages.map(m => m.content).join('\n');
    }
    if (tools && Object.keys(tools).length > 0) {
      (body as any).tools = Object.entries(tools).map(([name, tool]: [string, any]) => ({
        name,
        description: tool.description || '',
        input_schema: tool.parameters || { type: 'object', properties: {} },
      }));
    }
    if (config?.temperature != null) body.temperature = config.temperature;
    if (config?.topP != null) body.top_p = config.topP;
    if ((config as any)?.stopSequences?.length) body.stop_sequences = (config as any).stopSequences;
    return body;
  }

  private convertMessages(messages: OpenAIMessage[]): any[] {
    const result: any[] = [];
    for (const m of messages) {
      if (m.role === 'tool') {
        result.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.tool_call_id || '', content: typeof m.content === 'string' ? m.content : '' }],
        });
      } else if (m.tool_calls && m.tool_calls.length > 0) {
        const content: any[] = [];
        if (m.content) content.push({ type: 'text', text: typeof m.content === 'string' ? m.content : '' });
        for (const tc of m.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: this.parseToolArgs(tc.function.arguments),
          });
        }
        result.push({ role: 'assistant', content });
      } else {
        if (Array.isArray(m.content)) {
          const blocks: any[] = [];
          for (const p of m.content) {
            if (p.type === 'image_url' && p.image_url?.url) {
              const url = p.image_url.url;
              const m2 = url.match(/^data:([^;]+);base64,(.+)$/);
              if (m2) {
                blocks.push({ type: 'image', source: { type: 'base64', media_type: m2[1], data: m2[2] } });
              } else {
                blocks.push({ type: 'image', source: { type: 'url', url } });
              }
            } else if (typeof p === 'string') {
              blocks.push({ type: 'text', text: p });
            }
          }
          if (blocks.length > 0) { result.push({ role: m.role as string, content: blocks }); continue; }
        }
        result.push({ role: m.role as string, content: typeof m.content === 'string' ? m.content : '' });
      }
    }
    return result;
  }

  private async fetchResponse(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const response = await poolFetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const err = await response.text().catch(() => 'unknown');
      throw new Error(`[anthropic] API error ${response.status}: ${err}`);
    }
    return response;
  }

  private parseToolArgs(raw: string): Record<string, unknown> {
    try { return JSON.parse(raw); } catch { return {}; }
  }
}
