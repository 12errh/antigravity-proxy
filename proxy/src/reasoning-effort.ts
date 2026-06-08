/**
 * Reasoning Effort Configuration
 *
 * Tracks per-model reasoning effort settings. Some models (DeepSeek R-series,
 * NVIDIA stepfun, certain OpenAI o-series) support a reasoning_effort parameter
 * that controls how much "thinking" the model does before answering.
 *
 * Stored in proxy/reasoning-effort.json.
 * Applied in the OpenAI adapter when building the request body.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '..', 'reasoning-effort.json');

export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high' | 'max';

export interface ReasoningEffortConfig {
  /** model id (resolved model name, not alias) → effort level */
  models: Record<string, ReasoningEffort>;
}

/**
 * Models known to support reasoning_effort.
 * Matched against BOTH the model alias AND the resolved model name (both lowercased).
 *
 * Design decision: we match on the ALIAS (what Antigravity sends) because that's
 * what you set reasoning effort for in the dashboard — the alias is stable across
 * provider changes. Resolved names are also checked as a fallback so direct
 * provider model names work too.
 *
 * Patterns are ordered most-specific first to get the best label.
 */
export const REASONING_EFFORT_PATTERNS: { pattern: RegExp; provider: string; label: string }[] = [
  // DeepSeek R-series (direct names and via gateways)
  { pattern: /deepseek[-/.]?r1/i,                     provider: 'deepseek',  label: 'DeepSeek R1' },
  { pattern: /deepseek[-/.]?r2/i,                     provider: 'deepseek',  label: 'DeepSeek R2' },
  { pattern: /deepseek[-/.]?r[0-9]/i,                 provider: 'deepseek',  label: 'DeepSeek R-series' },
  { pattern: /deepseek[-/.]?reasoner/i,               provider: 'deepseek',  label: 'DeepSeek Reasoner' },
  // OpenAI o-series (direct and via OpenRouter/Zen)
  { pattern: /^o[1-9][-\s]/i,                         provider: 'openai',    label: 'OpenAI o-series' },
  { pattern: /^o[1-9]$/i,                              provider: 'openai',    label: 'OpenAI o-series' },
  { pattern: /openai\/o[1-9]/i,                        provider: 'openai',    label: 'OpenAI o-series (OpenRouter)' },
  { pattern: /o4-mini/i,                               provider: 'openai',    label: 'OpenAI o4-mini' },
  { pattern: /o3-mini/i,                               provider: 'openai',    label: 'OpenAI o3-mini' },
  { pattern: /o1-mini/i,                               provider: 'openai',    label: 'OpenAI o1-mini' },
  // NVIDIA stepfun / step models
  { pattern: /stepfun/i,                              provider: 'nvidia',    label: 'NVIDIA stepfun' },
  { pattern: /step-[0-9]/i,                            provider: 'nvidia',    label: 'NVIDIA stepfun' },
  // Qwen thinking variants
  { pattern: /qwen.*think/i,                           provider: 'qwen',      label: 'Qwen Thinking' },
  { pattern: /qwq/i,                                   provider: 'qwen',      label: 'QwQ (Qwen reasoning)' },
  // GLM thinking
  { pattern: /glm.*think/i,                            provider: 'zhipu',     label: 'GLM Thinking' },
  // Kimi thinking
  { pattern: /kimi.*think/i,                           provider: 'moonshot',  label: 'Kimi Thinking' },
  // Generic thinking/reasoning suffix patterns
  { pattern: /-thinking$/i,                            provider: 'generic',   label: 'Thinking model' },
  { pattern: /[-/]thinking[-/]/i,                      provider: 'generic',   label: 'Thinking model' },
  { pattern: /[-/]reasoner/i,                          provider: 'generic',   label: 'Reasoning model' },
];

/** Returns true if a resolved model name is known to support reasoning_effort */
export function supportsReasoningEffort(resolvedModel: string): boolean {
  const lower = resolvedModel.toLowerCase();
  return REASONING_EFFORT_PATTERNS.some(p => p.pattern.test(lower));
}

/** Returns a human label for a model's reasoning support, or null */
export function getReasoningLabel(resolvedModel: string): string | null {
  const lower = resolvedModel.toLowerCase();
  const match = REASONING_EFFORT_PATTERNS.find(p => p.pattern.test(lower));
  return match ? match.label : null;
}

// ---- Persistence ----

let _config: ReasoningEffortConfig = { models: {} };

function loadFromDisk(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      _config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as ReasoningEffortConfig;
      if (!_config.models) _config.models = {};
    }
  } catch (e: any) {
    logger.warn('[reasoning-effort] Failed to load config: ' + e.message);
    _config = { models: {} };
  }
}

function saveToDisk(): boolean {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(_config, null, 2), 'utf-8');
    return true;
  } catch (e: any) {
    logger.error('[reasoning-effort] Failed to save config: ' + e.message);
    return false;
  }
}

loadFromDisk();

export function getReasoningEffortConfig(): ReasoningEffortConfig {
  return _config;
}

export function setModelReasoningEffort(model: string, effort: ReasoningEffort | null): boolean {
  if (!effort || effort === 'default') {
    delete _config.models[model];
  } else {
    _config.models[model] = effort;
  }
  return saveToDisk();
}

export function getEffortForModel(resolvedModel: string): ReasoningEffort | null {
  return _config.models[resolvedModel] || null;
}

export function reload(): void {
  loadFromDisk();
}
