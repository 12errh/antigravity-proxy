import type { Content, Part, Tool, GenerationConfig } from './types.js';
import { DEFAULT_MODEL_MAP, type ModelMap } from './types.js';
import { logger } from './logger.js';

export interface CoreMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | CoreContentPart[];
}

export interface CoreContentPart {
  type: 'text' | 'tool-call' | 'tool-result';
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  output?: { type: 'text'; value: string } | { type: 'json'; value: unknown };
}

export interface CoreTool {
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface MappedRequest {
  system?: string;
  messages: CoreMessage[];
  tools?: Record<string, CoreTool>;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  providerOptions?: { openai?: { reasoningEffort?: string } };
}

export interface MappedResponse {
  text: string;
  finishReason: string | null;
  toolCalls?: { name: string; args: Record<string, unknown> }[];
}

export function mapModelName(model: string, modelMap: ModelMap = DEFAULT_MODEL_MAP): string {
  // Direct match
  if (modelMap[model]) return modelMap[model];
  // Strip prefix like "models/"
  const short = model.replace(/^models\//, '');
  if (modelMap[short]) return modelMap[short];
  // Try prefix matching: "claude-sonnet-4-6-thinking" → check for "claude-sonnet-4-6"
  for (const key of Object.keys(modelMap)) {
    if (short.startsWith(key) || key.startsWith(short)) return modelMap[key];
  }
  // Fallback
  return modelMap['default'] || model;
}

export function mapContentsToMessages(contents: Content[], systemInstruction?: string): MappedRequest {
  const messages: CoreMessage[] = [];

  for (const content of contents) {
    const role = content.role === 'model' ? 'assistant' : content.role as CoreMessage['role'];

    // Support both Google format (content.parts[]) and Vercel SDK format (content.content[])
    const parts = content.parts || (Array.isArray(content.content) ? content.content : []);
    if (parts.length === 0 && content.content && typeof content.content === 'string') {
      // Already a plain string
      messages.push({ role, content: content.content });
      continue;
    }

    // Extract text parts (both Google format: {text: "..."} and Vercel SDK format: {type: "text", text: "..."})
    const textParts = parts
      .filter((p: any) => p.text || (p.type === 'text' && p.text))
      .map((p: any) => p.text || '')
      .join('');

    // Google format function calls: {functionCall: {name, args}}
    const googleToolCalls = parts.filter((p: any) => p.functionCall);
    // Google format tool results: {functionResponse: {name, response}}
    const googleToolResults = parts.filter((p: any) => p.functionResponse);
    // Vercel SDK format tool calls: {type: "tool-call", toolName, args}
    const sdkToolCalls = googleToolCalls.length === 0 ? parts.filter((p: any) => p.type === 'tool-call') : [];
    // Vercel SDK format tool results: {type: "tool-result", toolName, result}
    const sdkToolResults = googleToolResults.length === 0 ? parts.filter((p: any) => p.type === 'tool-result') : [];

    // Convert ALL tool calls to text (SDK v6 doesn't accept tool-call parts in input)
    const allToolCalls = googleToolCalls.length > 0 ? googleToolCalls : sdkToolCalls;
    if (allToolCalls.length > 0) {
      const toolCallsText = allToolCalls.map((p: any) => {
        const fc = p.functionCall || {};
        const name = fc.name || p.toolName || 'unknown';
        const args = parseJSONArgs(fc.args || p.args);
        return `[Calling tool "${name}" with args ${JSON.stringify(args)}]`;
      }).join('\n');
      const combined = textParts ? textParts + '\n' + toolCallsText : toolCallsText;
      messages.push({ role, content: combined });
    } else if (googleToolResults.length > 0 || sdkToolResults.length > 0) {
      // Use structured tool-result parts (SDK v6 uses 'output' with discriminated type)
      const results = googleToolResults.length > 0 ? googleToolResults : sdkToolResults;
      const content = results.map((p: any) => {
        const fr = p.functionResponse || {};
        const name = fr.name || p.toolName || 'unknown';
        const resultObj = fr.response || p.result || {};
        const parsed = typeof resultObj === 'string' ? resultObj : parseJSONArgs(resultObj);
        return {
          type: 'tool-result' as const,
          toolCallId: name,
          toolName: name,
          output: typeof resultObj === 'string'
            ? { type: 'text' as const, value: resultObj }
            : { type: 'json' as const, value: parsed },
        };
      });
      messages.push({ role: 'tool', content });
    } else {
      messages.push({ role, content: textParts });
    }
  }

  return {
    system: systemInstruction,
    messages,
  };
}

export function mapExternalMessagesToCore(messages: any[]): MappedRequest {
  const coreMessages: CoreMessage[] = [];

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

export interface MappedConfig {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  providerOptions?: { openai?: { reasoningEffort?: string } };
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

  // Find ANY <invoke name="X">... pattern, closed by </invoke>, </function_calls>, or end of text
  const invokeRegex = /<invoke\s+name="([^"]+)"?>([\s\S]*?)(?:<\/invoke>|<\/function_calls>|$)/gi;
  let match;
  while ((match = invokeRegex.exec(text)) !== null) {
    const name = match[1].trim();
    let body = match[2].trim();

    // Try JSON format: {"key":"value"}
    try {
      const args = JSON.parse(body);
      toolCalls.push({ name, args });
      continue;
    } catch { /* not JSON */ }

    // Try <parameter name="KEY">VALUE</parameter> format
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

  // Also try <tool_call><function=NAME>...</function></tool_call> format
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

function parseJSONArgs(args: Buffer | string | undefined): Record<string, unknown> {
  if (!args) return {};
  try {
    const str = Buffer.isBuffer(args) ? args.toString('utf-8') : args;
    return JSON.parse(str);
  } catch {
    return {};
  }
}
