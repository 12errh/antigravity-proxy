import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'proxy.db');

// @ts-ignore - better-sqlite3 types conflict with ESM declaration emit
const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

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


