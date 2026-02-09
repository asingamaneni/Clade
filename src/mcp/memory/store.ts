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
  similarity?: number; // cosine similarity score (0-1)
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

      CREATE TABLE IF NOT EXISTS memory_embeddings (
        chunk_id INTEGER PRIMARY KEY REFERENCES memory_chunks(id) ON DELETE CASCADE,
        embedding BLOB NOT NULL,
        model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    // Enable foreign keys so CASCADE deletes work for memory_embeddings
    this.db.pragma('foreign_keys = ON');
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
  // Vector embeddings
  // -------------------------------------------------------------------------

  /**
   * Store a vector embedding for a chunk. Uses INSERT OR REPLACE so
   * re-indexing the same chunk overwrites the old embedding.
   */
  storeEmbedding(chunkId: number, embedding: Float32Array): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO memory_embeddings (chunk_id, embedding) VALUES (?, ?)',
    ).run(chunkId, Buffer.from(embedding.buffer));
  }

  /**
   * Retrieve the stored embedding for a chunk, or null if none exists.
   */
  getEmbedding(chunkId: number): Float32Array | null {
    const row = this.db.prepare(
      'SELECT embedding FROM memory_embeddings WHERE chunk_id = ?',
    ).get(chunkId) as { embedding: Buffer } | undefined;
    if (!row) return null;
    return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
  }

  /**
   * Quick check whether any embeddings have been stored (used to determine
   * if semantic search is available).
   */
  hasEmbeddings(): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM memory_embeddings LIMIT 1',
    ).get();
    return row !== undefined;
  }

  /**
   * Return chunk IDs that do not yet have embeddings (for incremental
   * embedding generation).
   */
  getChunkIdsWithoutEmbeddings(): number[] {
    const rows = this.db.prepare(`
      SELECT mc.id FROM memory_chunks mc
      LEFT JOIN memory_embeddings me ON me.chunk_id = mc.id
      WHERE me.chunk_id IS NULL
    `).all() as Array<{ id: number }>;
    return rows.map((r) => r.id);
  }

  /**
   * Return chunks that do not yet have embeddings, including their text.
   * Used for incremental embedding generation.
   */
  getChunksWithoutEmbeddings(): Array<{ id: number; chunkText: string }> {
    const rows = this.db.prepare(`
      SELECT mc.id, mc.chunk_text FROM memory_chunks mc
      LEFT JOIN memory_embeddings me ON me.chunk_id = mc.id
      WHERE me.chunk_id IS NULL
    `).all() as Array<{ id: number; chunk_text: string }>;
    return rows.map((r) => ({ id: r.id, chunkText: r.chunk_text }));
  }

  /**
   * Pure vector similarity search. Loads all embeddings, computes cosine
   * similarity against `queryEmbedding`, and returns the top `limit` results.
   * The `rank` field is set to `-similarity` so that lower = more relevant,
   * consistent with FTS5 rank semantics.
   */
  vectorSearch(queryEmbedding: Float32Array, limit: number = 10): SearchResult[] {
    const rows = this.db.prepare(`
      SELECT
        me.chunk_id,
        me.embedding,
        mc.file_path,
        mc.chunk_text,
        mc.chunk_start,
        mc.chunk_end
      FROM memory_embeddings me
      JOIN memory_chunks mc ON mc.id = me.chunk_id
    `).all() as Array<{
      chunk_id: number;
      embedding: Buffer;
      file_path: string;
      chunk_text: string;
      chunk_start: number;
      chunk_end: number;
    }>;

    const scored = rows.map((row) => {
      const emb = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      const sim = this.cosineSimilarity(queryEmbedding, emb);
      return {
        filePath: row.file_path,
        chunkText: row.chunk_text,
        chunkStart: row.chunk_start,
        chunkEnd: row.chunk_end,
        rank: -sim, // lower = more relevant, consistent with FTS5
        similarity: sim,
      } satisfies SearchResult;
    });

    scored.sort((a, b) => a.rank - b.rank);
    return scored.slice(0, limit);
  }

  /**
   * Hybrid search combining FTS5 full-text and vector similarity results
   * using Reciprocal Rank Fusion (RRF). Returns the top `limit` merged results.
   */
  hybridSearch(query: string, queryEmbedding: Float32Array, limit: number = 10): SearchResult[] {
    const k = 60; // standard RRF constant
    const poolSize = limit * 2;

    const ftsResults = this.search(query, poolSize);
    const vecResults = this.vectorSearch(queryEmbedding, poolSize);

    // Build a unique key for each result (file + start offset)
    const key = (r: SearchResult) => `${r.filePath}:${r.chunkStart}`;

    // Map from key -> { result, rrf score }
    const merged = new Map<string, { result: SearchResult; rrfScore: number }>();

    for (const [i, r] of ftsResults.entries()) {
      const k_ = key(r);
      const existing = merged.get(k_);
      if (existing) {
        existing.rrfScore += 1 / (k + i + 1);
      } else {
        merged.set(k_, { result: r, rrfScore: 1 / (k + i + 1) });
      }
    }

    for (const [i, r] of vecResults.entries()) {
      const k_ = key(r);
      const existing = merged.get(k_);
      if (existing) {
        existing.rrfScore += 1 / (k + i + 1);
        // Preserve the similarity score from vector results
        existing.result.similarity = r.similarity;
      } else {
        merged.set(k_, { result: r, rrfScore: 1 / (k + i + 1) });
      }
    }

    const sorted = [...merged.values()].sort((a, b) => b.rrfScore - a.rrfScore);
    return sorted.slice(0, limit).map((entry) => ({
      ...entry.result,
      rank: -entry.rrfScore, // negate so lower = better
    }));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i]!;
      const bi = b[i]!;
      dot += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // -------------------------------------------------------------------------
  // File mtime tracking for incremental indexing
  // -------------------------------------------------------------------------

  /**
   * Get the last indexed timestamp for a file.
   */
  private getIndexedMtime(filePath: string): number | null {
    const row = this.db.prepare(
      'SELECT updated_at FROM memory_chunks WHERE file_path = ? LIMIT 1',
    ).get(filePath) as { updated_at: string } | undefined;
    if (!row) return null;
    return new Date(row.updated_at).getTime();
  }

  /**
   * Remove all chunks for a given file path.
   */
  removeFile(filePath: string): void {
    this.db.prepare('DELETE FROM memory_chunks WHERE file_path = ?').run(filePath);
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

  /**
   * Incrementally re-index only files that have changed since last indexed.
   * Compares file mtimes against stored updated_at timestamps.
   * Also removes chunks for files that no longer exist.
   */
  reindexChanged(dir: string): void {
    const files = collectMarkdownFiles(dir);
    const fileSet = new Set<string>();

    const transaction = this.db.transaction(() => {
      for (const absPath of files) {
        const relPath = relative(dir, absPath);
        fileSet.add(relPath);

        let fileMtime: number;
        try {
          fileMtime = statSync(absPath).mtimeMs;
        } catch {
          continue;
        }

        const indexedMtime = this.getIndexedMtime(relPath);
        // Skip if file hasn't changed since last index
        if (indexedMtime !== null && fileMtime <= indexedMtime) continue;

        const content = readFileSync(absPath, 'utf-8');
        this.indexFile(relPath, content);
      }

      // Remove chunks for files that no longer exist on disk
      const indexed = this.db.prepare(
        'SELECT DISTINCT file_path FROM memory_chunks',
      ).all() as Array<{ file_path: string }>;
      for (const row of indexed) {
        if (!fileSet.has(row.file_path)) {
          this.removeFile(row.file_path);
        }
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
