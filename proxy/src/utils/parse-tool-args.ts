export function parseToolArgs(raw: string | object | null | undefined): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
