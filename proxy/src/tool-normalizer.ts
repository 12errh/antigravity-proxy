/**
 * Tool Normalizer
 *
 * Validates and fixes tool calls from external LLMs before forwarding them
 * to Antigravity. Handles:
 *
 * 1. **Name normalization** — `manageTask` → `manage_task`, aliases → canonical
 * 2. **Missing required params** — fills with defaults (e.g. Action → "list")
 * 3. **Type coercion** — string "true" → boolean true, "123" → 123
 * 4. **Param alias resolution** — `command` → `CommandLine`, `file` → `TargetFile`
 * 5. **Unknown param stripping** — removes params not in the tool's schema
 * 6. **Warning collection** — surfaces what was fixed for logging/debugging
 */

import { logger } from './logger.js';
import { toolCapabilityRegistry } from './tool-capabilities.js';
import type { NormalizedToolCall } from './tool-capabilities.js';

// ─── Type coercion ─────────────────────────────────────────────────────

/**
 * Coerce a value to the target type.
 * Handles common model mistakes like string booleans and string numbers.
 */
function coerceValue(value: unknown, targetType: string): unknown {
  if (value === null || value === undefined) return value;

  switch (targetType) {
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const lower = value.toLowerCase().trim();
        if (['true', '1', 'yes', 'on'].includes(lower)) return true;
        if (['false', '0', 'no', 'off'].includes(lower)) return false;
      }
      if (typeof value === 'number') return value !== 0;
      return value;
    }
    case 'number':
    case 'integer': {
      if (typeof value === 'number') return targetType === 'integer' ? Math.floor(value) : value;
      if (typeof value === 'string') {
        const num = Number(value);
        if (!Number.isNaN(num)) {
          return targetType === 'integer' ? Math.floor(num) : num;
        }
      }
      return value;
    }
    case 'array': {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        // Try JSON array parse first
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) return parsed;
        } catch { /* not JSON */ }
        // Comma-separated → split into array
        if (value.includes(',')) {
          return value.split(',').map(s => s.trim()).filter(Boolean);
        }
        // Single value → wrap in array
        return [value];
      }
      return value;
    }
    case 'object': {
      if (typeof value === 'object' && !Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
        } catch { /* not JSON */ }
      }
      return value;
    }
    case 'string': {
      // Numbers → string (e.g. schedule DurationSeconds: 60 → "60")
      if (typeof value === 'number') return String(value);
      if (typeof value === 'boolean') return String(value);
      return typeof value === 'string' ? value : String(value);
    }
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

// ─── Param alias resolution ───────────────────────────────────────────

/** Levenshtein edit distance — used for fuzzy param matching */
function levenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp: number[][] = Array.from({ length: al + 1 }, () => Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) dp[i][0] = i;
  for (let j = 0; j <= bl; j++) dp[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[al][bl];
}

/**
 * Try to resolve a param name to its canonical form for a given tool.
 * For dynamic tools (MCP tools), only exact and case-insensitive matching
 * is used — no fuzzy substring matching, since MCP tool param names are
 * defined by the server and the model is given those exact names.
 */
function resolveParamName(toolName: string, paramName: string): string {
  const schema = toolCapabilityRegistry.getSchema(toolName);
  if (!schema) return paramName;

  // Direct match
  if (schema.params[paramName]) return paramName;

  const lower = paramName.toLowerCase();

  // Check if this is a dynamic tool (MCP tools). If so, only do exact
  // case-insensitive matching — no fuzzy substring matching.
  if (toolCapabilityRegistry.isDynamicTool(toolName)) {
    for (const [canonical] of Object.entries(schema.params)) {
      if (canonical.toLowerCase() === lower) return canonical;
    }
    return paramName;
  }

  // Check aliases in the schema (well-known tools)
  for (const [canonical, def] of Object.entries(schema.params)) {
    if (canonical.toLowerCase() === lower) return canonical;
    for (const alias of def.aliases || []) {
      if (alias.toLowerCase() === lower) return canonical;
    }
  }

  // Fuzzy match: check if any param name contains or is contained
  for (const canonical of Object.keys(schema.params)) {
    const cl = canonical.toLowerCase();
    if (lower.includes(cl) || cl.includes(lower)) return canonical;
  }

  // Levenshtein fuzzy match — for close misspellings (max 2 edits, min 4 chars)
  if (paramName.length >= 4) {
    let bestMatch: string | null = null;
    let bestDist = Infinity;
    for (const canonical of Object.keys(schema.params)) {
      if (canonical.length < 4) continue;
      const dist = levenshtein(lower, canonical.toLowerCase());
      if (dist <= 2 && dist < bestDist) {
        bestDist = dist;
        bestMatch = canonical;
      }
    }
    if (bestMatch) return bestMatch;
  }

  return paramName; // Unknown — pass through
}

// ─── Normalizer ────────────────────────────────────────────────────────

/**
 * Normalize a tool call from an external LLM.
 *
 * Returns the normalized name, args, and any warnings.
 * If the tool is unknown, returns the input unchanged.
 */
export function normalizeToolCall(
  name: string,
  args: Record<string, unknown>,
): NormalizedToolCall {
  // Guard against null/undefined args (can happen with malformed LLM output)
  if (!args || typeof args !== 'object') {
    args = {};
  }

  const warnings: string[] = [];
  let fixed = false;

  // Step 1: Resolve tool name
  const canonicalName = toolCapabilityRegistry.resolveName(name);
  if (canonicalName !== name) {
    warnings.push(`Tool name "${name}" → "${canonicalName}"`);
    fixed = true;
  }

  // Get schema
  const schema = toolCapabilityRegistry.getSchema(canonicalName);
  if (!schema) {
    // Unknown tool — pass through without modification
    return { name: canonicalName, args };
  }

  // Step 2: Resolve param aliases and coerce types
  const normalizedArgs: Record<string, unknown> = {};
  const seenParams = new Set<string>();

  for (const [rawKey, rawValue] of Object.entries(args)) {
    const canonicalKey = resolveParamName(canonicalName, rawKey);
    const paramDef = schema.params[canonicalKey];

    if (!paramDef) {
      // Unknown param — skip it (but log warning)
      warnings.push(`Unknown param "${rawKey}" for ${canonicalName} — stripped`);
      fixed = true;
      continue;
    }

    // Track if param name was resolved via fuzzy/alias matching
    if (canonicalKey !== rawKey) {
      warnings.push(`Param "${rawKey}" → "${canonicalKey}"`);
      fixed = true;
    }

    // Type coercion
    const coerced = coerceValue(rawValue, paramDef.type);
    if (coerced !== rawValue) {
      warnings.push(`Coerced "${rawKey}" from ${typeof rawValue} to ${paramDef.type}`);
      fixed = true;
    }

    normalizedArgs[canonicalKey] = coerced;
    seenParams.add(canonicalKey);
  }

  // Step 3: Fill missing params with defaults (required AND optional with defaults)
  // Skip Antigravity internal params (toolAction, toolSummary) — they are stripped
  // by engine.ts before normalization and never sent by the model.
  const INTERNAL_PARAMS = new Set(['toolAction', 'toolSummary', 'ToolAction', 'ToolSummary']);
  for (const [paramName, paramDef] of Object.entries(schema.params)) {
    if (INTERNAL_PARAMS.has(paramName)) continue;
    if (!seenParams.has(paramName) && paramDef.default !== undefined) {
      normalizedArgs[paramName] = paramDef.default;
      if (paramDef.required) {
        warnings.push(`Missing required "${paramName}" → default: ${JSON.stringify(paramDef.default)}`);
      }
      fixed = true;
    } else if (paramDef.required && !seenParams.has(paramName)) {
      warnings.push(`Missing required "${paramName}" — no default available`);
    }
  }

  // Step 4: Handle special case — manage_task with TaskId but no Action
  if (canonicalName === 'manage_task' && normalizedArgs['TaskId'] && !normalizedArgs['Action'] && seenParams.has('TaskId')) {
    // We already set Action default above, but double-check
    if (!seenParams.has('Action')) {
      // The missing Action was already handled by the default above
    }
  }

  // Step 5: Post-process — wrap single objects in arrays for tools that expect arrays
  // Models sometimes pass {TypeName:"x",Role:"y",Prompt:"z"} instead of [{...}]
  // Note: coerceValue already wraps objects in arrays for array types, but we
  // also need to handle the case where the value was already an array from coerceValue
  // and check for the specific tools.
  if (canonicalName === 'invoke_subagent' && normalizedArgs.Subagents) {
    if (!Array.isArray(normalizedArgs.Subagents)) {
      normalizedArgs.Subagents = [normalizedArgs.Subagents];
      warnings.push('Wrapped single SubagentConfig in array');
      fixed = true;
    }
  }
  if (canonicalName === 'ask_question' && normalizedArgs.questions) {
    if (!Array.isArray(normalizedArgs.questions)) {
      normalizedArgs.questions = [normalizedArgs.questions];
      warnings.push('Wrapped single question in array');
      fixed = true;
    }
  }

  return {
    name: canonicalName,
    args: normalizedArgs,
    warnings: warnings.length > 0 ? warnings : undefined,
    fixed,
  };
}

/**
 * Normalize all tool calls from a stream response.
 * Applies normalizeToolCall to each tool call chunk.
 */
export function normalizeToolCalls(
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
): Array<{ name: string; args: Record<string, unknown>; warnings?: string[] }> {
  return toolCalls.map(tc => normalizeToolCall(tc.name, tc.args));
}
