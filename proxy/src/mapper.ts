import type { Content, Part, Tool, GenerationConfig } from './types.js';
import { DEFAULT_MODEL_MAP, type ModelMap } from './types.js';
import { logger } from './logger.js';

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
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

export function mapModelName(model: string, modelMap: ModelMap = DEFAULT_MODEL_MAP): string {
  if (modelMap[model]) return modelMap[model];
  const short = model.replace(/^models\//, '');
  if (modelMap[short]) return modelMap[short];
  for (const key of Object.keys(modelMap)) {
    if (short.startsWith(key) || key.startsWith(short)) return modelMap[key];
  }
  return modelMap['default'] || model;
}

function callId(name: string, idx: number): string {
  return `call_${name}_${idx}`;
}

export function mapContentsToMessages(contents: Content[], systemInstruction?: string): MappedRequest {
  const messages: OpenAIMessage[] = [];
  let callIndex = 0;
  const recentCallIds: Map<string, string> = new Map();

  for (const content of contents) {
    const role = content.role === 'model' ? 'assistant' : content.role as OpenAIMessage['role'];
    const parts = content.parts || (Array.isArray(content.content) ? content.content : []);

    if (parts.length === 0 && content.content && typeof content.content === 'string') {
      messages.push({ role, content: content.content });
      continue;
    }

    const textParts = parts
      .filter((p: any) => p.text || (p.type === 'text' && p.text))
      .map((p: any) => p.text || '')
      .join('');

    const googleToolCalls = parts.filter((p: any) => p.functionCall);
    const googleToolResults = parts.filter((p: any) => p.functionResponse);
    const sdkToolCalls = googleToolCalls.length === 0 ? parts.filter((p: any) => p.type === 'tool-call') : [];
    const sdkToolResults = googleToolResults.length === 0 ? parts.filter((p: any) => p.type === 'tool-result') : [];

    if (googleToolCalls.length > 0 || sdkToolCalls.length > 0) {
      const toolParts = googleToolCalls.length > 0 ? googleToolCalls : sdkToolCalls;
      const toolCalls = toolParts.map((p: any) => {
        const fc = p.functionCall || {};
        const name = fc.name || p.toolName || 'unknown';
        const args = parseJSONArgs(fc.args || p.args);
        const id = callId(name, callIndex++);
        recentCallIds.set(name, id);
        return { id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } };
      });
      messages.push({ role: 'assistant', content: textParts || null, tool_calls: toolCalls });
    } else if (googleToolResults.length > 0 || sdkToolResults.length > 0) {
      const results = googleToolResults.length > 0 ? googleToolResults : sdkToolResults;
      for (const p of results) {
        const fr = p.functionResponse || {};
        const name = fr.name || p.toolName || 'unknown';
        const resultObj = fr.response || p.result || {};
        const content = typeof resultObj === 'string' ? resultObj : JSON.stringify(parseJSONArgs(resultObj));
        const id = recentCallIds.get(name) || callId(name, callIndex++);
        messages.push({ role: 'tool', tool_call_id: id, content });
      }
    } else {
      messages.push({ role, content: textParts });
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

export function extractToolCalls(text: string): { name: string; args: Record<string, unknown> }[] {
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  if (!text) return toolCalls;

  const invokeRegex = /<invoke\s+name="([^"]+)"?>([\s\S]*?)(?:<\/invoke>|<\/function_calls>|$)/gi;
  let match;
  while ((match = invokeRegex.exec(text)) !== null) {
    const name = match[1].trim();
    let body = match[2].trim();

    try {
      const args = JSON.parse(body);
      toolCalls.push({ name, args });
      continue;
    } catch { /* not JSON */ }

    const paramRegex = /<parameter\s+name="([^"]+)"?>([\s\S]*?)<\/parameter>/gi;
    const args: Record<string, unknown> = {};
    let pm;
    while ((pm = paramRegex.exec(body)) !== null) {
      args[pm[1]] = pm[2].trim();
    }
    if (Object.keys(args).length > 0) {
      toolCalls.push({ name, args });
    }
  }

  const funcRegex = /<function=(\w+)>([\s\S]*?)<\/function>/gi;
  while ((match = funcRegex.exec(text)) !== null) {
    const name = match[1];
    if (toolCalls.some(tc => tc.name === name)) continue;
    const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/gi;
    const args: Record<string, unknown> = {};
    let pm;
    while ((pm = paramRegex.exec(match[2])) !== null) {
      args[pm[1]] = pm[2].trim();
    }
    if (Object.keys(args).length > 0) {
      toolCalls.push({ name, args });
    }
  }

  return toolCalls;
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
