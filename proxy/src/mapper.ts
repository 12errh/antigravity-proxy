import type { Content, Part, Tool, GenerationConfig } from './types.js';
import { logger } from './logger.js';

export interface OpenAIImagePart {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIImagePart[] | null;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface CoreTool {
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface MappedRequest {
  system?: string;
  messages: OpenAIMessage[];
  tools?: Record<string, CoreTool>;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  providerOptions?: { openai?: { reasoningEffort?: string } };
}

export interface MappedConfig {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  providerOptions?: { openai?: { reasoningEffort?: string } };
}

function callId(name: string, idx: number): string {
  const safeName = (name || 'tool')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 48);
  return `call_${safeName}_${idx}`;
}

function partToOpenAIPart(p: any): string | OpenAIImagePart | null {
  if (!p) return null;
  if (p.text) return p.text;
  if (p.type === 'text' && p.text) return p.text;
  if (p.type === 'image' || p.type === 'image_url') {
    const url = p.image_url?.url || p.url;
    if (typeof url === 'string') return { type: 'image_url', image_url: { url } };
  }
  if (p.inlineData?.data && p.inlineData?.mimeType) {
    const mime = p.inlineData.mimeType || 'image/png';
    return { type: 'image_url', image_url: { url: `data:${mime};base64,${p.inlineData.data}` } };
  }
  if (typeof p.image === 'string') {
    return { type: 'image_url', image_url: { url: p.image.startsWith('data:') ? p.image : `data:image/png;base64,${p.image}` } };
  }
  if (p.fileData?.fileUri && p.fileData?.mimeType) {
    const uri = p.fileData.fileUri;
    // Only forward as URL if the provider can actually fetch it (http/https/data/file).
    // Google-style `files/abc123` or `gs://` references are NOT fetchable by OpenAI-compat
    // providers — drop them to avoid 400 errors like "URL must be HTTP, data or file URL".
    if (/^(https?:|data:|file:)/i.test(uri)) {
      return { type: 'image_url', image_url: { url: uri } };
    }
    // Drop silently — Gemini/Antigravity-specific file references don't translate
    return null;
  }
  return null;
}

export function mapContentsToMessages(contents: Content[], systemInstruction?: string): MappedRequest {
  const messages: OpenAIMessage[] = [];
  let callIndex = 0;
  const recentCallIds: Map<string, string[]> = new Map();

  for (const content of contents) {
    const role = content.role === 'model' ? 'assistant' : content.role as OpenAIMessage['role'];
    const parts = content.parts || (Array.isArray(content.content) ? content.content : []);

    if (parts.length === 0 && content.content && typeof content.content === 'string') {
      messages.push({ role, content: content.content });
      continue;
    }



    const thoughtParts = parts
      .filter((p: any) => p.thought && p.text)
      .map((p: any) => p.text)
      .join('');

    const textParts = parts
      .filter((p: any) => (p.text || (p.type === 'text' && p.text)) && !p.thought)
      .map((p: any) => p.text || '')
      .join('');

    const imageParts: OpenAIImagePart[] = [];
    for (const p of parts) {
      const ip = partToOpenAIPart(p);
      if (ip && typeof ip === 'object') imageParts.push(ip);
    }

    const googleToolCalls = parts.filter((p: any) => p.functionCall);
    const googleToolResults = parts.filter((p: any) => p.functionResponse);
    const sdkToolCalls = googleToolResults.length === 0 ? parts.filter((p: any) => p.type === 'tool-call') : [];
    const sdkToolResults = googleToolResults.length === 0 ? parts.filter((p: any) => p.type === 'tool-result') : [];

    if (googleToolCalls.length > 0 || sdkToolCalls.length > 0) {
      const toolParts = googleToolCalls.length > 0 ? googleToolCalls : sdkToolCalls;
      const toolCalls = toolParts.map((p: any) => {
        const fc = p.functionCall || {};
        const name = fc.name || p.toolName || 'unknown';
        const args = parseJSONArgs(fc.args || p.args);
        const id = callId(name, callIndex++);
        const ids = recentCallIds.get(name) || [];
        ids.push(id);
        recentCallIds.set(name, ids);
        return { id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } };
      });
      messages.push({ role: 'assistant', content: textParts || null, reasoning_content: thoughtParts || undefined, tool_calls: toolCalls });
    } else if (googleToolResults.length > 0 || sdkToolResults.length > 0) {
      const results = googleToolResults.length > 0 ? googleToolResults : sdkToolResults;
      for (const p of results) {
        const fr = p.functionResponse || {};
        const name = fr.name || p.toolName || 'unknown';
        const resultObj = fr.response || p.result || {};
        const contentStr = typeof resultObj === 'string' ? resultObj : JSON.stringify(parseJSONArgs(resultObj));
        const ids = recentCallIds.get(name) || [];
        const id = ids.shift() || callId(name, callIndex++);
        messages.push({ role: 'tool', tool_call_id: id, content: contentStr });
      }
    } else if (imageParts.length > 0) {
      const content: OpenAIImagePart[] = textParts
        ? [{ type: 'image_url' as const, image_url: { url: textParts } } as any, ...imageParts]
        : imageParts;
      messages.push({ role, content: content.length === 1 && content[0].image_url.url === textParts ? textParts : content });
    } else {
      messages.push({ role, content: textParts, reasoning_content: thoughtParts || undefined });
    }
  }

  return { system: systemInstruction, messages };
}

export function mapExternalMessagesToCore(messages: any[]): MappedRequest {
  const coreMessages: OpenAIMessage[] = [];

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'assistant'
      : msg.role === 'system' ? 'system'
      : msg.role === 'tool' ? 'tool'
      : 'user';

    if (msg.parts && Array.isArray(msg.parts)) {
      const text = msg.parts.map((p: any) => p.text || '').join('');
      coreMessages.push({ role, content: text });
    } else if (msg.content) {
      coreMessages.push({ role, content: msg.content });
    }
  }

  return { messages: coreMessages };
}

export function mapTools(tools: Tool[] | undefined): Record<string, CoreTool> | undefined {
  if (!tools || tools.length === 0) return undefined;

  const result: Record<string, CoreTool> = {};
  for (const tool of tools) {
    if (tool.functionDeclarations) {
      for (const fd of tool.functionDeclarations) {
        result[fd.name] = {
          description: fd.description || '',
          parameters: fd.parameters ? mapSchema(fd.parameters) : undefined,
        };
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

const TYPE_MAP: Record<string, string> = {
  STRING: 'string',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
  OBJECT: 'object',
  NUMBER: 'number',
};

function mapSchema(schema: any): Record<string, unknown> {
  const result: Record<string, unknown> = { type: TYPE_MAP[schema.type] || schema.type || 'object' };
  if (schema.description) result.description = schema.description;
  if (schema.properties) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, val]: [string, any]) => [key, mapSchema(val)])
    );
  }
  if (schema.required) result.required = schema.required;
  if (schema.enum) result.enum = schema.enum;
  if (schema.items) result.items = mapSchema(schema.items);
  return result;
}

export function mapGenerationConfig(config: GenerationConfig | null | undefined): MappedConfig {
  if (!config) return {};
  const result: MappedConfig = {
    maxTokens: config.maxOutputTokens,
    temperature: config.temperature,
    topP: config.topP,
    topK: config.topK,
    stopSequences: config.stopSequences,
  };
  if (config.thinkingConfig?.includeThoughts) {
    result.providerOptions = {
      openai: { reasoningEffort: 'medium' },
    };
  }
  return result;
}

export function constructToolCallText(name: string, args: Record<string, unknown>): string {
  return `<function_calls><invoke name="${name}">${JSON.stringify(args)}</invoke></function_calls>`;
}

function parseJSONArgs(args: Buffer | string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'object' && !Buffer.isBuffer(args)) return args as Record<string, unknown>;
  try {
    const str = Buffer.isBuffer(args) ? args.toString('utf-8') : args;
    return JSON.parse(str);
  } catch {
    return {};
  }
}
