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


