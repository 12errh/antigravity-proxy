/**
 * Hop-by-hop headers (RFC 9110 §7.6.1) are per-connection and must never be
 * copied across a proxy hop. This matters most on the TLS side, where the
 * server is HTTP/2: forwarding an HTTP/1 `transfer-encoding: chunked` into an
 * Http2ServerResponse makes `writeHead` throw ERR_HTTP2_INVALID_CONNECTION_HEADERS
 * synchronously inside the upstream-response callback — an uncaught exception
 * that killed the whole proxy whenever Google replied with a chunked body.
 */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
]);

/**
 * Copy headers for forwarding, dropping HTTP/2 pseudo-headers (`:status`…),
 * hop-by-hop headers, and empty values. Array values are joined with ", "
 * (the HTTP/1 wire format) to match the previous hand-rolled copies.
 * Exported for regression tests.
 */
export function sanitizeForwardHeaders(
  headers: Record<string, string | string[] | number | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    if (key.startsWith(':')) continue;
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}
