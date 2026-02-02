import Database from 'better-sqlite3';
import type { SessionStatus, SkillStatus } from '../agents/types.js';
import { StoreError, StoreInitError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('store');

// ---------------------------------------------------------------------------
// Row types (what SQLite returns)
// ---------------------------------------------------------------------------

export interface SessionRow {
  id: string;
  agent_id: string;
  channel: string | null;
  channel_user_id: string | null;
  chat_id: string | null;
  status: SessionStatus;
  created_at: string;
  last_active_at: string;
}

export interface UserRow {
  id: number;
  channel: string;
  channel_user_id: string;
  agent_id: string;
  display_name: string | null;
  created_at: string;
}

export interface SkillRow {
  name: string;
  status: SkillStatus;
  package: string | null;
  config: string | null;
  requested_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface CronJobRow {
  id: number;
  name: string;
  schedule: string;
  agent_id: string;
  prompt: string;
  deliver_to: string | null;
  enabled: number;
  last_run_at: string | null;
  created_at: string;
}

export interface MemoryChunkRow {
  id: number;
  agent_id: string;
  file_path: string;
  chunk_text: string;
  chunk_start: number | null;
  chunk_end: number | null;
  updated_at: string;
}

export interface MemorySearchResult {
  id: number;
  agent_id: string;
  file_path: string;
  chunk_text: string;
  chunk_start: number | null;
  chunk_end: number | null;
  rank: number;
}

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
  -- Sessions: tracks claude CLI session IDs and their lifecycle
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    channel TEXT,
    channel_user_id TEXT,
    chat_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_channel_user ON sessions(channel, channel_user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

  -- Users: maps channel identities to default agents
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    channel TEXT NOT NULL,
    channel_user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(channel, channel_user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_users_agent ON users(agent_id);

  -- Skills: MCP server packages (pending approval, active, or disabled)
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    package TEXT,
    config TEXT,
    requested_by TEXT,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Cron jobs: scheduled prompts
  CREATE TABLE IF NOT EXISTS cron_jobs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    schedule TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    deliver_to TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_cron_jobs_agent ON cron_jobs(agent_id);

  -- Memory index: chunks of memory files for FTS search
  CREATE TABLE IF NOT EXISTS memory_index (
    id INTEGER PRIMARY KEY,
    agent_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_start INTEGER,
    chunk_end INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory_index(agent_id);
  CREATE INDEX IF NOT EXISTS idx_memory_file ON memory_index(agent_id, file_path);
`;

const FTS_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    chunk_text,
    content=memory_index,
    content_rowid=id
  );
`;

const FTS_TRIGGERS_SQL = `
  -- Keep FTS index in sync with memory_index table

  CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memory_index
  BEGIN
    INSERT INTO memory_fts(rowid, chunk_text) VALUES (new.id, new.chunk_text);
  END;

  CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memory_index
  BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, chunk_text) VALUES ('delete', old.id, old.chunk_text);
  END;

  CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON memory_index
  BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, chunk_text) VALUES ('delete', old.id, old.chunk_text);
    INSERT INTO memory_fts(rowid, chunk_text) VALUES (new.id, new.chunk_text);
  END;
`;

// ---------------------------------------------------------------------------
// Store class
// ---------------------------------------------------------------------------

/**
 * SQLite persistence layer for TeamAgents.
 *
 * Uses better-sqlite3 (synchronous API). All methods are blocking by design --
 * SQLite is fast enough that async overhead would hurt more than help.
 */
export class Store {
  private readonly db: Database.Database;

  /**
   * Open (or create) the SQLite database at the given path and initialize
   * all tables and indexes.
   *
   * @param dbPath - Absolute path to the .db file.
   * @throws {StoreInitError} on initialization failure.
   */
  constructor(dbPath: string) {
    try {
      this.db = new Database(dbPath);
    } catch (err) {
      throw new StoreInitError(
        `Could not open database at ${dbPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.initialize();
    log.info('Store initialized', { path: dbPath });
  }

  /**
   * Create an in-memory Store (for testing).
   */
  static inMemory(): Store {
    // Use a private constructor bypass via Object.create + manual init
    const store = Object.create(Store.prototype) as Store;
    (store as unknown as { db: Database.Database }).db = new Database(':memory:');
    store.initialize();
    log.debug('In-memory store initialized');
    return store;
  }

  private initialize(): void {
    // Performance pragmas
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    try {
      this.db.exec(SCHEMA_SQL);
      this.db.exec(FTS_SQL);
      this.db.exec(FTS_TRIGGERS_SQL);
    } catch (err) {
      throw new StoreInitError(
        `Schema initialization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Close the database connection. Call on shutdown.
   */
  close(): void {
    this.db.close();
    log.debug('Store closed');
  }

  /**
   * Expose the underlying database for advanced queries or transactions.
   */
  get raw(): Database.Database {
    return this.db;
  }

  // =========================================================================
  // SESSIONS
  // =========================================================================

  createSession(params: {
    id: string;
    agentId: string;
    channel?: string;
    channelUserId?: string;
    chatId?: string;
  }): SessionRow {
    const stmt = this.db.prepare<[string, string, string | null, string | null, string | null]>(`
      INSERT INTO sessions (id, agent_id, channel, channel_user_id, chat_id)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      params.id,
      params.agentId,
      params.channel ?? null,
      params.channelUserId ?? null,
      params.chatId ?? null,
    );
    return this.getSession(params.id)!;
  }

  getSession(id: string): SessionRow | undefined {
    const stmt = this.db.prepare<[string], SessionRow>(`
      SELECT * FROM sessions WHERE id = ?
    `);
    return stmt.get(id);
  }

  listSessions(filters?: {
    agentId?: string;
    channel?: string;
    channelUserId?: string;
    status?: SessionStatus;
  }): SessionRow[] {
    const conditions: string[] = [];
    const params: (string | null)[] = [];

    if (filters?.agentId) {
      conditions.push('agent_id = ?');
      params.push(filters.agentId);
    }
    if (filters?.channel) {
      conditions.push('channel = ?');
      params.push(filters.channel);
    }
    if (filters?.channelUserId) {
      conditions.push('channel_user_id = ?');
      params.push(filters.channelUserId);
    }
    if (filters?.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const stmt = this.db.prepare<(string | null)[], SessionRow>(
      `SELECT * FROM sessions ${where} ORDER BY last_active_at DESC`,
    );
    return stmt.all(...params);
  }

  /**
   * Find an existing active session for a given agent + channel + user + chat.
   */
  findActiveSession(params: {
    agentId: string;
    channel: string;
    channelUserId: string;
    chatId?: string;
  }): SessionRow | undefined {
    if (params.chatId) {
      const stmt = this.db.prepare<[string, string, string, string], SessionRow>(`
        SELECT * FROM sessions
        WHERE agent_id = ? AND channel = ? AND channel_user_id = ? AND chat_id = ? AND status = 'active'
        ORDER BY last_active_at DESC LIMIT 1
      `);
      return stmt.get(params.agentId, params.channel, params.channelUserId, params.chatId);
    }
    const stmt = this.db.prepare<[string, string, string], SessionRow>(`
      SELECT * FROM sessions
      WHERE agent_id = ? AND channel = ? AND channel_user_id = ? AND chat_id IS NULL AND status = 'active'
      ORDER BY last_active_at DESC LIMIT 1
    `);
    return stmt.get(params.agentId, params.channel, params.channelUserId);
  }

  updateSessionStatus(id: string, status: SessionStatus): void {
    const stmt = this.db.prepare<[string, string]>(`
      UPDATE sessions SET status = ?, last_active_at = datetime('now') WHERE id = ?
    `);
    stmt.run(status, id);
  }

  touchSession(id: string): void {
    const stmt = this.db.prepare<[string]>(`
      UPDATE sessions SET last_active_at = datetime('now') WHERE id = ?
    `);
    stmt.run(id);
  }

  deleteSession(id: string): boolean {
    const stmt = this.db.prepare<[string]>(`DELETE FROM sessions WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // =========================================================================
  // USERS
  // =========================================================================

  upsertUser(params: {
    channel: string;
    channelUserId: string;
    agentId: string;
    displayName?: string;
  }): UserRow {
    const stmt = this.db.prepare<[string, string, string, string | null]>(`
      INSERT INTO users (channel, channel_user_id, agent_id, display_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channel, channel_user_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        display_name = COALESCE(excluded.display_name, users.display_name)
    `);
    stmt.run(
      params.channel,
      params.channelUserId,
      params.agentId,
      params.displayName ?? null,
    );
    return this.getUser(params.channel, params.channelUserId)!;
  }

  getUser(channel: string, channelUserId: string): UserRow | undefined {
    const stmt = this.db.prepare<[string, string], UserRow>(`
      SELECT * FROM users WHERE channel = ? AND channel_user_id = ?
    `);
    return stmt.get(channel, channelUserId);
  }

  getUserById(id: number): UserRow | undefined {
    const stmt = this.db.prepare<[number], UserRow>(`
      SELECT * FROM users WHERE id = ?
    `);
    return stmt.get(id);
  }

  listUsers(filters?: { channel?: string; agentId?: string }): UserRow[] {
    const conditions: string[] = [];
    const params: string[] = [];

    if (filters?.channel) {
      conditions.push('channel = ?');
      params.push(filters.channel);
    }
    if (filters?.agentId) {
      conditions.push('agent_id = ?');
      params.push(filters.agentId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const stmt = this.db.prepare<string[], UserRow>(
      `SELECT * FROM users ${where} ORDER BY created_at DESC`,
    );
    return stmt.all(...params);
  }

  deleteUser(channel: string, channelUserId: string): boolean {
    const stmt = this.db.prepare<[string, string]>(
      `DELETE FROM users WHERE channel = ? AND channel_user_id = ?`,
    );
    const result = stmt.run(channel, channelUserId);
    return result.changes > 0;
  }

  // =========================================================================
  // SKILLS
  // =========================================================================

  createSkill(params: {
    name: string;
    package?: string;
    config?: Record<string, unknown>;
    requestedBy?: string;
  }): SkillRow {
    const stmt = this.db.prepare<[string, string | null, string | null, string | null]>(`
      INSERT INTO skills (name, package, config, requested_by)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(
      params.name,
      params.package ?? null,
      params.config ? JSON.stringify(params.config) : null,
      params.requestedBy ?? null,
    );
    return this.getSkill(params.name)!;
  }

  getSkill(name: string): SkillRow | undefined {
    const stmt = this.db.prepare<[string], SkillRow>(`
      SELECT * FROM skills WHERE name = ?
    `);
    return stmt.get(name);
  }

  listSkills(status?: SkillStatus): SkillRow[] {
    if (status) {
      const stmt = this.db.prepare<[string], SkillRow>(
        `SELECT * FROM skills WHERE status = ? ORDER BY created_at DESC`,
      );
      return stmt.all(status);
    }
    const stmt = this.db.prepare<[], SkillRow>(
      `SELECT * FROM skills ORDER BY created_at DESC`,
    );
    return stmt.all();
  }

  approveSkill(name: string): void {
    const stmt = this.db.prepare<[string]>(`
      UPDATE skills SET status = 'active', approved_at = datetime('now') WHERE name = ?
    `);
    stmt.run(name);
  }

  disableSkill(name: string): void {
    const stmt = this.db.prepare<[string]>(`
      UPDATE skills SET status = 'disabled' WHERE name = ?
    `);
    stmt.run(name);
  }

  deleteSkill(name: string): boolean {
    const stmt = this.db.prepare<[string]>(`DELETE FROM skills WHERE name = ?`);
    const result = stmt.run(name);
    return result.changes > 0;
  }

  /**
   * Parse the JSON config stored in a skill row, returning `undefined` on
   * parse failure or if no config is stored.
   */
  parseSkillConfig(row: SkillRow): Record<string, unknown> | undefined {
    if (!row.config) return undefined;
    try {
      return JSON.parse(row.config) as Record<string, unknown>;
    } catch {
      log.warn('Failed to parse skill config JSON', { skill: row.name });
      return undefined;
    }
  }

  // =========================================================================
  // CRON JOBS
  // =========================================================================

  createCronJob(params: {
    name: string;
    schedule: string;
    agentId: string;
    prompt: string;
    deliverTo?: string;
  }): CronJobRow {
    const stmt = this.db.prepare<[string, string, string, string, string | null]>(`
      INSERT INTO cron_jobs (name, schedule, agent_id, prompt, deliver_to)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      params.name,
      params.schedule,
      params.agentId,
      params.prompt,
      params.deliverTo ?? null,
    );
    return this.getCronJobByName(params.name)!;
  }

  getCronJob(id: number): CronJobRow | undefined {
    const stmt = this.db.prepare<[number], CronJobRow>(`
      SELECT * FROM cron_jobs WHERE id = ?
    `);
    return stmt.get(id);
  }

  getCronJobByName(name: string): CronJobRow | undefined {
    const stmt = this.db.prepare<[string], CronJobRow>(`
      SELECT * FROM cron_jobs WHERE name = ?
    `);
    return stmt.get(name);
  }

  listCronJobs(filters?: { agentId?: string; enabled?: boolean }): CronJobRow[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters?.agentId) {
      conditions.push('agent_id = ?');
      params.push(filters.agentId);
    }
    if (filters?.enabled !== undefined) {
      conditions.push('enabled = ?');
      params.push(filters.enabled ? 1 : 0);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const stmt = this.db.prepare<(string | number)[], CronJobRow>(
      `SELECT * FROM cron_jobs ${where} ORDER BY created_at DESC`,
    );
    return stmt.all(...params);
  }

  updateCronJobLastRun(id: number): void {
    const stmt = this.db.prepare<[number]>(`
      UPDATE cron_jobs SET last_run_at = datetime('now') WHERE id = ?
    `);
    stmt.run(id);
  }

  enableCronJob(id: number): void {
    const stmt = this.db.prepare<[number]>(`
      UPDATE cron_jobs SET enabled = 1 WHERE id = ?
    `);
    stmt.run(id);
  }

  disableCronJob(id: number): void {
    const stmt = this.db.prepare<[number]>(`
      UPDATE cron_jobs SET enabled = 0 WHERE id = ?
    `);
    stmt.run(id);
  }

  deleteCronJob(id: number): boolean {
    const stmt = this.db.prepare<[number]>(`DELETE FROM cron_jobs WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  deleteCronJobByName(name: string): boolean {
    const stmt = this.db.prepare<[string]>(`DELETE FROM cron_jobs WHERE name = ?`);
    const result = stmt.run(name);
    return result.changes > 0;
  }

  // =========================================================================
  // MEMORY INDEX
  // =========================================================================

  /**
   * Index a chunk of text from a memory file. Automatically updates the FTS
   * index via triggers.
   */
  indexMemoryChunk(params: {
    agentId: string;
    filePath: string;
    chunkText: string;
    chunkStart?: number;
    chunkEnd?: number;
  }): MemoryChunkRow {
    const stmt = this.db.prepare<[string, string, string, number | null, number | null]>(`
      INSERT INTO memory_index (agent_id, file_path, chunk_text, chunk_start, chunk_end)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      params.agentId,
      params.filePath,
      params.chunkText,
      params.chunkStart ?? null,
      params.chunkEnd ?? null,
    );
    const id = Number(result.lastInsertRowid);
    return this.getMemoryChunk(id)!;
  }

  getMemoryChunk(id: number): MemoryChunkRow | undefined {
    const stmt = this.db.prepare<[number], MemoryChunkRow>(`
      SELECT * FROM memory_index WHERE id = ?
    `);
    return stmt.get(id);
  }

  /**
   * Full-text search across memory chunks for a given agent.
   * Results are ordered by FTS5 relevance (rank).
   *
   * @param agentId - Agent whose memory to search.
   * @param query - FTS5 query string (supports AND, OR, NOT, phrase matching).
   * @param limit - Max results to return (default 20).
   */
  searchMemory(agentId: string, query: string, limit: number = 20): MemorySearchResult[] {
    const stmt = this.db.prepare<[string, string, number], MemorySearchResult>(`
      SELECT
        m.id,
        m.agent_id,
        m.file_path,
        m.chunk_text,
        m.chunk_start,
        m.chunk_end,
        f.rank
      FROM memory_fts f
      JOIN memory_index m ON m.id = f.rowid
      WHERE f.memory_fts MATCH ? AND m.agent_id = ?
      ORDER BY f.rank
      LIMIT ?
    `);
    return stmt.all(query, agentId, limit);
  }

  /**
   * List all memory chunks for an agent, optionally filtered by file path.
   */
  listMemoryChunks(agentId: string, filePath?: string): MemoryChunkRow[] {
    if (filePath) {
      const stmt = this.db.prepare<[string, string], MemoryChunkRow>(`
        SELECT * FROM memory_index WHERE agent_id = ? AND file_path = ? ORDER BY chunk_start ASC
      `);
      return stmt.all(agentId, filePath);
    }
    const stmt = this.db.prepare<[string], MemoryChunkRow>(`
      SELECT * FROM memory_index WHERE agent_id = ? ORDER BY file_path, chunk_start ASC
    `);
    return stmt.all(agentId);
  }

  /**
   * Remove all indexed chunks for a specific file. Call before re-indexing
   * an updated file to avoid stale data.
   */
  clearMemoryFile(agentId: string, filePath: string): number {
    const stmt = this.db.prepare<[string, string]>(`
      DELETE FROM memory_index WHERE agent_id = ? AND file_path = ?
    `);
    const result = stmt.run(agentId, filePath);
    return result.changes;
  }

  /**
   * Remove all indexed chunks for an agent. Used when resetting memory.
   */
  clearAgentMemory(agentId: string): number {
    const stmt = this.db.prepare<[string]>(`
      DELETE FROM memory_index WHERE agent_id = ?
    `);
    const result = stmt.run(agentId);
    return result.changes;
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  /**
   * Run a function inside a database transaction. Automatically commits on
   * success and rolls back on error.
   */
  transaction<T>(fn: () => T): T {
    const wrapped = this.db.transaction(fn);
    return wrapped();
  }

  /**
   * Return basic stats about the database (row counts per table).
   */
  stats(): Record<string, number> {
    const tables = ['sessions', 'users', 'skills', 'cron_jobs', 'memory_index'];
    const result: Record<string, number> = {};
    for (const table of tables) {
      const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as
        | { count: number }
        | undefined;
      result[table] = row?.count ?? 0;
    }
    return result;
  }
}
