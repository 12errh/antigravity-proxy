import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try to load better-sqlite3. If the native module isn't compiled
// (e.g. CI with --ignore-scripts on Windows), all DB functions become
// no-ops so the rest of the app can still load without crashing.
let db: any = null;
try {
  const dbDir = path.resolve(__dirname, '..', 'data');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'proxy.db');
  // @ts-ignore - better-sqlite3 types conflict with ESM declaration emit
  const _require = createRequire(import.meta.url);
  const Database = _require('better-sqlite3');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
} catch {
  // Native module not available — provide a safe no-op stub so callers
  // can import db.ts without crashing (important for CI tests).
  // NOTE: Cannot use logger here — logger.ts imports db.ts, creating a circular dependency.
  const noop = { run: () => ({}), get: () => null, all: () => [], lastInsertRowid: 0 };
  db = { exec: () => {}, prepare: () => noop, pragma: () => {} };
}

export function init(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      request_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      timestamp TEXT NOT NULL,
      model TEXT,
      resolved_model TEXT,
      provider TEXT,
      direction TEXT,
      type TEXT,
      content TEXT,
      prompt_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      tool_calls TEXT,
      error TEXT,
      duration_ms INTEGER,
      attempts INTEGER DEFAULT 1,
      cost REAL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
    CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      msg TEXT NOT NULL,
      meta TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
  `);

  // Migration: add failover_events column if missing
  try { db.exec("ALTER TABLE requests ADD COLUMN failover_events TEXT"); } catch { /* already exists */ }
}

export function insertRequest(r: {
  id: string; sessionId?: string; timestamp: string; model: string;
  resolvedModel: string; provider: string; direction: string;
  type: string; content: string; promptTokens?: number;
  outputTokens?: number; toolCalls?: string; error?: string;
  durationMs?: number; attempts?: number; cost?: number; failoverEvents?: string;
}): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO requests (id, session_id, timestamp, model, resolved_model, provider, direction, type, content, prompt_tokens, output_tokens, tool_calls, error, duration_ms, attempts, cost, failover_events)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(r.id, r.sessionId || null, r.timestamp, r.model, r.resolvedModel, r.provider, r.direction, r.type, r.content, r.promptTokens || 0, r.outputTokens || 0, r.toolCalls || null, r.error || null, r.durationMs || null, r.attempts || 1, r.cost || 0, r.failoverEvents || null);
}

export function getAllRequests(limit = 500, offset = 0): any[] {
  return db.prepare('SELECT * FROM requests ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(limit, offset);
}

export function getRequestsByDate(date: string): any[] {
  return db.prepare("SELECT * FROM requests WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp DESC").all(date + 'T00:00:00', date + 'T23:59:59');
}

export function searchRequests(q: string, limit = 50, offset = 0): { rows: any[]; total: number } {
  const pattern = `%${q}%`;
  const countRow = db.prepare("SELECT COUNT(*) as total FROM requests WHERE model LIKE ? OR resolved_model LIKE ? OR provider LIKE ? OR type LIKE ? OR content LIKE ?").get(pattern, pattern, pattern, pattern, pattern) as any;
  const rows = db.prepare("SELECT * FROM requests WHERE model LIKE ? OR resolved_model LIKE ? OR provider LIKE ? OR type LIKE ? OR content LIKE ? ORDER BY timestamp DESC LIMIT ? OFFSET ?").all(pattern, pattern, pattern, pattern, pattern, limit, offset);
  return { rows, total: countRow.total };
}

export function searchSessions(q: string, limit = 50, offset = 0): { rows: any[]; total: number } {
  const pattern = `%${q}%`;
  const countRow = db.prepare("SELECT COUNT(*) as total FROM sessions WHERE id LIKE ?").get(pattern) as any;
  const rows = db.prepare("SELECT * FROM sessions WHERE id LIKE ? ORDER BY started_at DESC LIMIT ? OFFSET ?").all(pattern, limit, offset);
  return { rows, total: countRow.total };
}

export function searchLogs(q: string, limit = 50, offset = 0): { rows: any[]; total: number } {
  const pattern = `%${q}%`;
  const countRow = db.prepare("SELECT COUNT(*) as total FROM logs WHERE msg LIKE ? OR meta LIKE ?").get(pattern, pattern) as any;
  const rows = db.prepare("SELECT * FROM logs WHERE msg LIKE ? OR meta LIKE ? ORDER BY timestamp DESC LIMIT ? OFFSET ?").all(pattern, pattern, limit, offset);
  return { rows, total: countRow.total };
}

export function clearRequests(): void {
  db.exec('DELETE FROM requests');
}

export function getRequestDates(): { date: string; count: number }[] {
  return db.prepare("SELECT substr(timestamp,1,10) as date, COUNT(*) as count FROM requests GROUP BY date ORDER BY date DESC").all() as any[];
}

export function insertLog(entry: { timestamp: string; level: string; msg: string; meta?: string }): number {
  const stmt = db.prepare('INSERT INTO logs (timestamp, level, msg, meta) VALUES (?, ?, ?, ?)');
  return stmt.run(entry.timestamp, entry.level, entry.msg, entry.meta || null).lastInsertRowid as number;
}

export function getRecentLogs(count = 200): any[] {
  return db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(count);
}

export function clearLogs(): void {
  db.exec('DELETE FROM logs');
}

export function upsertSession(id: string, data: { startedAt?: string; endedAt?: string; requestCount?: number }): void {
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
  if (existing) {
    const updates: string[] = [];
    const params: any[] = [];
    if (data.endedAt) { updates.push('ended_at = ?'); params.push(data.endedAt); }
    if (data.requestCount !== undefined) { updates.push('request_count = ?'); params.push(data.requestCount); }
    if (updates.length > 0) {
      params.push(id);
      db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
  } else {
    db.prepare('INSERT OR IGNORE INTO sessions (id, started_at, ended_at, request_count) VALUES (?, ?, ?, ?)').run(id, data.startedAt || new Date().toISOString(), data.endedAt || null, data.requestCount || 0);
  }
}

export function getSessionDates(): { date: string; count: number }[] {
  return db.prepare("SELECT substr(started_at,1,10) as date, COUNT(*) as count FROM sessions GROUP BY date ORDER BY date DESC").all() as any[];
}

export function getSessionsForDate(date: string): any[] {
  return db.prepare("SELECT * FROM sessions WHERE started_at >= ? AND started_at < ? ORDER BY started_at DESC").all(date + 'T00:00:00', date + 'T23:59:59');
}

export function getSessionContent(sessionId: string): any[] {
  return db.prepare('SELECT * FROM requests WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
}

export function getRequestsByTimeRange(startTime: string, endTime?: string): any[] {
  if (endTime) {
    return db.prepare('SELECT * FROM requests WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC').all(startTime, endTime);
  }
  return db.prepare('SELECT * FROM requests WHERE timestamp >= ? ORDER BY timestamp ASC').all(startTime);
}

export function deleteSession(sessionId: string): void {
  db.prepare('DELETE FROM requests WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function getCostAggregation(period: 'day' | 'model' | 'provider', todayOnly?: boolean): any[] {
  const groupBy = period === 'day' ? "substr(timestamp,1,10)" : period === 'model' ? 'model' : 'provider';
  const dateFilter = todayOnly ? " AND date(timestamp) = date('now')" : '';
  return db.prepare(`SELECT ${groupBy} as key, COUNT(*) as requests, SUM(prompt_tokens) as prompt_tokens, SUM(output_tokens) as output_tokens, SUM(cost) as total_cost FROM requests WHERE cost IS NOT NULL${dateFilter} GROUP BY ${groupBy} ORDER BY total_cost DESC`).all();
}

export function getCostForDate(date: string): { requests: number; totalTokens: number; prompt_tokens: number; output_tokens: number; total_cost: number; errors: number } {
  const start = date + 'T00:00:00';
  const end = date + 'T23:59:59.999';
  const row = db.prepare(`
    SELECT COUNT(*) as requests,
           COALESCE(SUM(prompt_tokens + output_tokens),0) as totalTokens,
           COALESCE(SUM(prompt_tokens),0) as prompt_tokens,
           COALESCE(SUM(output_tokens),0) as output_tokens,
           COALESCE(SUM(CASE WHEN type = 'error' THEN 1 ELSE 0 END),0) as errors,
           COALESCE(SUM(cost),0) as total_cost
    FROM requests
    WHERE timestamp >= ? AND timestamp <= ?
  `).get(start, end) as any;
  return row;
}

export function getCostByProviderForDate(date: string): any[] {
  const start = date + 'T00:00:00';
  const end = date + 'T23:59:59.999';
  return db.prepare(`
    SELECT provider as key, COUNT(*) as requests, SUM(prompt_tokens) as prompt_tokens, SUM(output_tokens) as output_tokens, SUM(cost) as total_cost
    FROM requests
    WHERE timestamp >= ? AND timestamp <= ?
    GROUP BY provider
    ORDER BY total_cost DESC
  `).all(start, end);
}

export function getCostByModelForDate(date: string): any[] {
  const start = date + 'T00:00:00';
  const end = date + 'T23:59:59.999';
  return db.prepare(`
    SELECT model as key, COUNT(*) as requests, SUM(prompt_tokens) as prompt_tokens, SUM(output_tokens) as output_tokens, SUM(cost) as total_cost
    FROM requests
    WHERE timestamp >= ? AND timestamp <= ?
    GROUP BY model
    ORDER BY total_cost DESC
  `).all(start, end);
}

export function getCostByDay(limit = 90): any[] {
  return db.prepare(`
    SELECT substr(timestamp,1,10) as key, COUNT(*) as requests, SUM(prompt_tokens) as prompt_tokens, SUM(output_tokens) as output_tokens, SUM(cost) as total_cost
    FROM requests
    GROUP BY key
    ORDER BY key DESC
    LIMIT ?
  `).all(limit);
}

export function getStats(todayOnly?: boolean): { totalRequests: number; totalTokens: number; totalToolCalls: number; errors: number; total_cost: number; prompt_tokens: number; output_tokens: number; requests: number } {
  const dateFilter = todayOnly ? " WHERE date(timestamp) = date('now')" : '';
  const row = db.prepare(`
    SELECT COUNT(*) as totalRequests,
           COALESCE(SUM(prompt_tokens + output_tokens),0) as totalTokens,
           COALESCE(SUM(prompt_tokens),0) as prompt_tokens,
           COALESCE(SUM(output_tokens),0) as output_tokens,
           COALESCE(SUM(CASE WHEN tool_calls IS NOT NULL AND tool_calls != '' THEN 1 ELSE 0 END),0) as totalToolCalls,
           COALESCE(SUM(CASE WHEN type = 'error' THEN 1 ELSE 0 END),0) as errors,
           COALESCE(SUM(cost),0) as total_cost
    FROM requests${dateFilter}
  `).get() as any;
  row.requests = row.totalRequests;
  return row;
}

/**
 * Title-generation detection. Antigravity typically calls a small/fast model
 * to generate a short title at the start of each conversation. We detect this
 * by aggregating per-model request stats and flagging models whose requests
 * consistently show:
 *   - low output_tokens (< 100) — titles are short
 *   - low cost (median < $0.001) — small/cheap model
 *   - low prompt_tokens median (< 1500) — short prompt
 *   - no tool calls
 *   - enough sample size (>= 3) to avoid false positives
 *
 * Returns a map keyed by model name with stats + `likelyTitleGen` boolean.
 * The user can also pin/unpin a model via the dashboard; pinned models always
 * return `pinned: true` regardless of stats.
 */
export interface ModelFlagInfo {
  model: string;
  requests: number;
  median_output: number;
  median_prompt: number;
  median_cost: number;
  has_tool_calls: boolean;
  likelyTitleGen: boolean;
  pinned: boolean;
  reason: string;
}

const SMALL_MODEL_TOKENS = new Set(['mini', 'flash', 'lite', 'haiku', 'nano', 'small', 'tiny', 'air']);

function isSmallModelName(name: string): boolean {
  const lower = name.toLowerCase();
  for (const t of SMALL_MODEL_TOKENS) if (lower.includes(t)) return true;
  return false;
}

export function getModelFlags(): ModelFlagInfo[] {
  // Pinned flags live in a small KV table
  try { db.exec(`CREATE TABLE IF NOT EXISTS model_flags (model TEXT PRIMARY KEY, pinned INTEGER NOT NULL, note TEXT, updated_at TEXT)`); } catch {}

  // Aggregate per-model stats
  const rows = db.prepare(`
    SELECT model,
           COUNT(*) as requests,
           COALESCE(AVG(output_tokens), 0) as avg_output,
           COALESCE(AVG(prompt_tokens), 0) as avg_prompt,
           COALESCE(AVG(cost), 0) as avg_cost,
           COALESCE(SUM(CASE WHEN tool_calls IS NOT NULL AND tool_calls != '' THEN 1 ELSE 0 END), 0) as tool_call_count
    FROM requests
    WHERE direction = 'outgoing' AND model IS NOT NULL AND model != ''
    GROUP BY model
  `).all() as any[];

  const pinned = new Map<string, { pinned: boolean; note: string }>();
  try {
    for (const p of db.prepare(`SELECT model, pinned, note FROM model_flags`).all() as any[]) {
      pinned.set(p.model, { pinned: !!p.pinned, note: p.note || '' });
    }
  } catch {}

  return rows.map(r => {
    const requests = Number(r.requests) || 0;
    const avgOutput = Number(r.avg_output) || 0;
    const avgPrompt = Number(r.avg_prompt) || 0;
    const avgCost = Number(r.avg_cost) || 0;
    const hasToolCalls = (Number(r.tool_call_count) || 0) > 0;
    const smallName = isSmallModelName(r.model);

    // Heuristic: short outputs, cheap, small-model name, no tool calls
    const likelyTitleGen = requests >= 3
      && avgOutput > 0 && avgOutput < 100
      && avgCost < 0.001
      && avgPrompt < 1500
      && !hasToolCalls
      && smallName;

    const pin = pinned.get(r.model);
    const pinnedFlag = pin ? pin.pinned : false;
    let reason = '';
    if (pinnedFlag) reason = 'Pinned by user';
    else if (likelyTitleGen) reason = `Auto: avg ${Math.round(avgOutput)} tok out, ~$${avgCost.toFixed(5)}/req, no tools`;
    else if (smallName && hasToolCalls) reason = 'Small model but uses tools';
    else reason = 'Not detected';

    return {
      model: r.model,
      requests,
      median_output: Math.round(avgOutput),
      median_prompt: Math.round(avgPrompt),
      median_cost: avgCost,
      has_tool_calls: hasToolCalls,
      likelyTitleGen: pinnedFlag || likelyTitleGen,
      pinned: pinnedFlag,
      reason,
    };
  }).sort((a, b) => b.requests - a.requests);
}

export function setModelFlag(model: string, pinned: boolean, note = ''): void {
  try { db.exec(`CREATE TABLE IF NOT EXISTS model_flags (model TEXT PRIMARY KEY, pinned INTEGER NOT NULL, note TEXT, updated_at TEXT)`); } catch {}
  db.prepare(`INSERT OR REPLACE INTO model_flags (model, pinned, note, updated_at) VALUES (?, ?, ?, ?)`)
    .run(model, pinned ? 1 : 0, note, new Date().toISOString());
}


