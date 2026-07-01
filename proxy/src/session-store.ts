/**
 * Session store for OpenCode Go context caching.
 * Maps conversation IDs to session IDs returned by the API.
 * The proxy captures the session_id from the first response
 * and sends it back on follow-up requests for cache discounts.
 */

interface SessionEntry {
  sessionId: string;
  timestamp: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_MAX_SIZE = 10000;

const sessionStore = new Map<string, SessionEntry>();

export function cleanupSessionStore(): void {
  const now = Date.now();
  for (const [key, entry] of sessionStore) {
    if (now - entry.timestamp > SESSION_TTL_MS) {
      sessionStore.delete(key);
    }
  }

  // Enforce max size (delete oldest)
  if (sessionStore.size > SESSION_MAX_SIZE) {
    const entries = Array.from(sessionStore.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - SESSION_MAX_SIZE);
    for (const [key] of toDelete) {
      sessionStore.delete(key);
    }
  }
}

export function setSessionId(convId: string, sessionId: string): void {
  sessionStore.set(convId, { sessionId, timestamp: Date.now() });
}

export function getSessionId(convId: string): string | undefined {
  return sessionStore.get(convId)?.sessionId;
}

export function clearSessionId(convId: string): void {
  sessionStore.delete(convId);
}

// Auto-cleanup every hour
setInterval(cleanupSessionStore, 60 * 60 * 1000).unref();
