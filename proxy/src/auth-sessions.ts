import crypto from 'crypto';
import { config } from './config.js';

export interface Session {
  token: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSIONS = new Map<string, Session>();

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function isAuthEnabled(): boolean {
  return !!(config.dashboardUser && config.dashboardPassword);
}

export function verifyCredentials(username: string, password: string): boolean {
  if (!isAuthEnabled()) return true; // no creds set ⇒ open access
  if (!username || !password) return false;
  return timingSafeEqual(username, config.dashboardUser) && timingSafeEqual(password, config.dashboardPassword);
}

export function createSession(username: string): Session {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const sess: Session = {
    token,
    username,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  SESSIONS.set(token, sess);
  return sess;
}

export function getSession(token: string | null | undefined): Session | null {
  if (!token) return null;
  const sess = SESSIONS.get(token);
  if (!sess) return null;
  if (Date.now() > sess.expiresAt) {
    SESSIONS.delete(token);
    return null;
  }
  return sess;
}

export function destroySession(token: string | null | undefined): void {
  if (!token) return;
  SESSIONS.delete(token);
}

export function purgeExpired(): void {
  const now = Date.now();
  for (const [k, v] of SESSIONS) {
    if (now > v.expiresAt) SESSIONS.delete(k);
  }
}

export function getSessionTtlMs(): number {
  return SESSION_TTL_MS;
}

// Purge expired sessions every 30 minutes to prevent unbounded Map growth.
// The interval is unref'd so it doesn't keep the process alive.
setInterval(purgeExpired, 30 * 60 * 1000).unref();

/**
 * Parse a Cookie header and return the value for the given name.
 * Handles quoted values and trims whitespace.
 */
export function getCookie(req: { headers: { cookie?: string } }, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const parts = raw.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    let v = part.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try {
      v = decodeURIComponent(v);
    } catch { /* keep raw */ }
    return v;
  }
  return null;
}

/**
 * Build a Set-Cookie value for the session token (HttpOnly, SameSite=Lax).
 * `secure` should be true when serving over HTTPS.
 */
export function buildSessionCookie(token: string, secure: boolean): string {
  const parts = [
    `ag_session=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookie(secure: boolean): string {
  const parts = [
    'ag_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
