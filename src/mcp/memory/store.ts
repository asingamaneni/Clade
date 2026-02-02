import Database from 'better-sqlite3';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  filePath: string;
  chunkText: string;
  chunkStart: number;
  chunkEnd: number;
  rank: number;
}

// ---------------------------------------------------------------------------
// Constants for chunking
// ---------------------------------------------------------------------------

/** Target chunk size in characters (~400 tokens). */
const CHUNK_SIZE = 1600;

/** Overlap between consecutive chunks in characters (~80 tokens). */
const CHUNK_OVERLAP = 320;

// ---------------------------------------------------------------------------
// MemoryStore — FTS5-backed full-text search over markdown memory files
// ---------------------------------------------------------------------------

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initialize();
  }

  // -------------------------------------------------------------------------
  // Schema setup
  // -------------------------------------------------------------------------

  private initialize(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        chunk_text TEXT NOT NULL,
        chunk_start INTEGER NOT NULL,
        chunk_end INTEGER NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        chunk_text,
        content=memory_chunks,
        content_rowid=id
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory_chunks BEGIN
        INSERT INTO memory_fts(rowid, chunk_text) VALUES (new.id, new.chunk_text);
      END;

      CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory_chunks BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, chunk_text) VALUES('delete', old.id, old.chunk_text);
      END;

      CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory_chunks BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, chunk_text) VALUES('delete', old.id, old.chunk_text);
        INSERT INTO memory_fts(rowid, chunk_text) VALUES (new.id, new.chunk_text);
      END;
    `);
  }

  // -------------------------------------------------------------------------
  // Indexing
  // -------------------------------------------------------------------------

  /**
   * Index a single file by splitting it into overlapping chunks and storing
   * them in the database.  Any existing chunks for this file are replaced.
   */
  indexFile(filePath: string, content: string): void {
    const deleteStmt = this.db.prepare(
      'DELETE FROM memory_chunks WHERE file_path = ?',
    );
    const insertStmt = this.db.prepare(
      'INSERT INTO memory_chunks (file_path, chunk_text, chunk_start, chunk_end) VALUES (?, ?, ?, ?)',
    );

    const transaction = this.db.transaction(() => {
      deleteStmt.run(filePath);

      if (content.length === 0) return;

      let offset = 0;
      while (offset < content.length) {
        const end = Math.min(offset + CHUNK_SIZE, content.length);
        const chunkText = content.slice(offset, end);
        insertStmt.run(filePath, chunkText, offset, end);

        // Advance by (CHUNK_SIZE - CHUNK_OVERLAP), but at least 1 char to avoid infinite loops
        const step = Math.max(CHUNK_SIZE - CHUNK_OVERLAP, 1);
        offset += step;

        // If the remaining text is smaller than the overlap, just stop
        if (offset >= content.length) break;
      }
    });

    transaction();
  }

  // -------------------------------------------------------------------------
  // Searching
  // -------------------------------------------------------------------------

  /**
   * Full-text search across all indexed chunks.
   * Returns results ordered by FTS5 relevance rank (lower = more relevant).
   */
  search(query: string, limit: number = 10): SearchResult[] {
    // Sanitize query for FTS5: wrap each token in double quotes to avoid
    // syntax errors from special characters.
    const sanitized = query
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((token) => `"${token.replace(/"/g, '""')}"`)
      .join(' ');

    if (sanitized.length === 0) return [];

    const stmt = this.db.prepare(`
      SELECT
        mc.file_path,
        mc.chunk_text,
        mc.chunk_start,
        mc.chunk_end,
        memory_fts.rank
      FROM memory_fts
      JOIN memory_chunks mc ON mc.id = memory_fts.rowid
      WHERE memory_fts MATCH ?
      ORDER BY memory_fts.rank
      LIMIT ?
    `);

    const rows = stmt.all(sanitized, limit) as Array<{
      file_path: string;
      chunk_text: string;
      chunk_start: number;
      chunk_end: number;
      rank: number;
    }>;

    return rows.map((row) => ({
      filePath: row.file_path,
      chunkText: row.chunk_text,
      chunkStart: row.chunk_start,
      chunkEnd: row.chunk_end,
      rank: row.rank,
    }));
  }

  // -------------------------------------------------------------------------
  // Bulk re-indexing
  // -------------------------------------------------------------------------

  /**
   * Recursively walk `dir`, read every `.md` file, and (re-)index it.
   * File paths stored in the DB are relative to `dir`.
   */
  reindexAll(dir: string): void {
    const files = collectMarkdownFiles(dir);
    const transaction = this.db.transaction(() => {
      for (const absPath of files) {
        const relPath = relative(dir, absPath);
        const content = readFileSync(absPath, 'utf-8');
        this.indexFile(relPath, content);
      }
    });
    transaction();
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all `.md` files under `dir`.
 */
function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      results.push(...collectMarkdownFiles(full));
    } else if (entry.endsWith('.md')) {
      results.push(full);
    }
  }

  return results;
}
