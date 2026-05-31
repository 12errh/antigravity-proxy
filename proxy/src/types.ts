import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_PATH = path.resolve(__dirname, '..', 'models.json');

export interface Content {
  parts?: Part[];
  content?: any;
  role: string;
}

export interface Part {
  text?: string;
  functionCall?: FunctionCall;
  functionResponse?: FunctionResponse;
  inlineData?: { mimeType: string; data: string };
}

export interface FunctionCall {
  name: string;
  args: Buffer | string;
}

export interface FunctionResponse {
  name: string;
  response: Buffer | string;
}

export interface Tool {
  functionDeclarations?: FunctionDeclaration[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: Schema | null;
}

export interface Schema {
  type: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: string[];
}

export interface GenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  thinkingConfig?: { includeThoughts?: boolean; thinkingBudget?: number };
}

export interface ExternalChatMessage {
  role: string;
  parts: ExternalContentPart[];
  toolCallId?: string;
  name?: string;
}

export interface ExternalContentPart {
  text?: string;
  mimeType?: string;
  data?: Buffer;
  functionCall?: { name: string; arguments: Buffer };
  functionResponse?: { name: string; response: Buffer };
}

export interface ExternalFunctionDeclaration {
  name: string;
  description: string;
  parameters: Buffer;
}

export interface ModelMap {
  [antigravityModel: string]: string;
}

let cachedModelMap: ModelMap | null = null;

function loadModelMap(): ModelMap {
  const defaults: ModelMap = {
    "gemini-3.5-flash": "google/gemma-4-31b-it",
    "gemini-3.5-flash-low": "google/gemma-4-31b-it",
    "gemini-3.5-flash-medium": "stepfun-ai/step-3.5-flash",
    "gemini-3.5-flash-high": "stepfun-ai/step-3.5-flash",
    "gemini-3-flash-agent": "stepfun-ai/step-3.5-flash",
    "gemini-3.1-flash-lite": "minimaxai/minimax-m2.7",
    "gemini-3.1-flash": "minimaxai/minimax-m2.7",
    "gemini-3.1-pro": "minimaxai/minimax-m2.7",
    "gemini-3.1-pro-low": "minimaxai/minimax-m2.7",
    "gemini-3.1-pro-high": "stepfun-ai/step-3.5-flash",
    "claude-sonnet-4-6": "moonshotai/kimi-k2.6",
    "claude-sonnet-4-6-thinking": "moonshotai/kimi-k2.6",
    "claude-opus-4-6": "deepseek-ai/deepseek-v4-flash",
    "claude-opus-4-6-thinking": "qwen/qwen3-32b",
    "gpt-oss-120b": "deepseek-ai/deepseek-v4-flash",
    "gpt-oss-120b-medium": "openai/gpt-oss-120b",
    "qwen3-32b": "qwen/qwen3-32b",
    "qwen3-32b-fast": "qwen/qwen3-32b",
    "openai/gpt-oss-120b": "openai/gpt-oss-120b",
    default: "deepseek-ai/deepseek-v4-flash",
  };

  try {
    if (fs.existsSync(MODELS_PATH)) {
      const raw = fs.readFileSync(MODELS_PATH, 'utf-8');
      const file = JSON.parse(raw);
      for (const [k, v] of Object.entries(file)) {
        if (!k.startsWith('_')) defaults[k] = String(v);
      }
    }
  } catch { /* use defaults */ }

  return defaults;
}

export const DEFAULT_MODEL_MAP: ModelMap = loadModelMap();
