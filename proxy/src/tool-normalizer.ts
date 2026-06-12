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
      return value; // Can't coerce, return as-is
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
    case 'array':
      // Arrays should pass through as-is — don't JSON.stringify them
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return [value]; }
      }
      return value;
    default:
      // For object types that aren't arrays, pass through unchanged
      if (typeof value === 'object' && !Array.isArray(value)) return value;
      // For string-like types, convert to string
      return typeof value === 'string' ? value : String(value);
  }
}

// ─── Param alias resolution ───────────────────────────────────────────

/**
 * Map of common parameter aliases across all well-known tools.
 * Maps alias → canonical param name.
 */
function buildAliasReverseMap(): Map<string, string> {
  const map = new Map<string, string>();
  const schema = toolCapabilityRegistry.getSchema;
  // We can't iterate over all schemas easily, so use a static map
  // Populated from known patterns
  return map;
}

/**
 * Try to resolve a param name to its canonical form for a given tool.
 */
function resolveParamName(toolName: string, paramName: string): string {
  const schema = toolCapabilityRegistry.getSchema(toolName);
  if (!schema) return paramName;

  // Direct match
  if (schema.params[paramName]) return paramName;

  const lower = paramName.toLowerCase();

  // Check aliases in the schema
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

    // Type coercion
    const coerced = coerceValue(rawValue, paramDef.type);
    if (coerced !== rawValue) {
      warnings.push(`Coerced "${rawKey}" from ${typeof rawValue} to ${paramDef.type}`);
      fixed = true;
    }

    normalizedArgs[canonicalKey] = coerced;
    seenParams.add(canonicalKey);
  }

  // Step 3: Fill missing required params with defaults
  for (const [paramName, paramDef] of Object.entries(schema.params)) {
    if (paramDef.required && !seenParams.has(paramName)) {
      if (paramDef.default !== undefined) {
        normalizedArgs[paramName] = paramDef.default;
        warnings.push(`Missing required "${paramName}" → default: ${JSON.stringify(paramDef.default)}`);
        fixed = true;
      } else {
        // Required param with no default — log warning
        // Don't add it — let Antigravity return the error
        warnings.push(`Missing required "${paramName}" — no default available`);
      }
    }
  }

  // Step 4: Handle special case — manage_task with TaskId but no Action
  if (canonicalName === 'manage_task' && normalizedArgs['TaskId'] && !normalizedArgs['Action'] && seenParams.has('TaskId')) {
    // We already set Action default above, but double-check
    if (!seenParams.has('Action')) {
      // The missing Action was already handled by the default above
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
