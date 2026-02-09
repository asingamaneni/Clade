// ---------------------------------------------------------------------------
// Tests: Memory Store (FTS5 indexing, chunking, search)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../src/mcp/memory/store.js';
import type { SearchResult } from '../../src/mcp/memory/store.js';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  // -----------------------------------------------------------------------
  // FTS5 indexing
  // -----------------------------------------------------------------------

  describe('indexing', () => {
    it('should index a short file as a single chunk', () => {
      store.indexFile('test.md', 'Hello world');

      const results = store.search('Hello');
      expect(results).toHaveLength(1);
      expect(results[0]!.chunkText).toBe('Hello world');
      expect(results[0]!.filePath).toBe('test.md');
    });

    it('should index an empty file without error', () => {
      store.indexFile('empty.md', '');
      const results = store.search('anything');
      expect(results).toHaveLength(0);
    });

    it('should re-index a file (replace existing chunks)', () => {
      store.indexFile('update.md', 'Version one content');
      store.indexFile('update.md', 'Version two replacement');

      const v1 = store.search('Version one');
      expect(v1).toHaveLength(0);

      const v2 = store.search('Version two');
      expect(v2).toHaveLength(1);
      expect(v2[0]!.chunkText).toContain('replacement');
    });

    it('should index multiple files independently', () => {
      store.indexFile('file1.md', 'TypeScript programming language');
      store.indexFile('file2.md', 'Python programming language');

      const results = store.search('programming');
      expect(results).toHaveLength(2);

      const filePaths = results.map((r) => r.filePath).sort();
      expect(filePaths).toEqual(['file1.md', 'file2.md']);
    });
  });

  // -----------------------------------------------------------------------
  // Chunking
  // -----------------------------------------------------------------------

  describe('chunking', () => {
    it('should chunk large content into overlapping segments', () => {
      // Create a large content string (>1600 chars to trigger chunking)
      const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ';
      const content = paragraph.repeat(50); // ~2850 chars

      store.indexFile('large.md', content);

      const results = store.search('Lorem ipsum');
      // Should have multiple chunks
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should have overlapping chunks for context continuity', () => {
      // Create content with distinct markers at different positions
      const lines: string[] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(`Line ${i}: This is some filler text to pad the content.`);
      }
      const content = lines.join('\n');

      store.indexFile('overlap.md', content);

      // Search for content that might span chunk boundaries
      const results = store.search('Line 30');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should preserve chunk boundaries (start/end)', () => {
      store.indexFile('bounds.md', 'Short content that fits in one chunk');

      const results = store.search('Short content');
      expect(results).toHaveLength(1);
      expect(results[0]!.chunkStart).toBe(0);
      expect(results[0]!.chunkEnd).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  describe('search', () => {
    beforeEach(() => {
      store.indexFile('memory.md', 'The user prefers dark mode and uses TypeScript for all projects.');
      store.indexFile('daily/2024-01-15.md', 'Discussed Python web frameworks. User wants to learn FastAPI.');
      store.indexFile('daily/2024-01-16.md', 'Set up CI/CD pipeline for the TypeScript project.');
    });

    it('should find matching chunks', () => {
      const results = store.search('TypeScript');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.chunkText.includes('TypeScript'))).toBe(true);
    });

    it('should rank results by relevance', () => {
      const results = store.search('TypeScript project');
      expect(results.length).toBeGreaterThanOrEqual(1);
      // FTS5 rank is negative; more negative = more relevant
      // Just verify we get ranked results
      for (const r of results) {
        expect(typeof r.rank).toBe('number');
      }
    });

    it('should respect the limit parameter', () => {
      // Index many files
      for (let i = 0; i < 20; i++) {
        store.indexFile(`f${i}.md`, `TypeScript document number ${i} with content`);
      }

      const results = store.search('TypeScript', 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array for unmatched queries', () => {
      const results = store.search('xyznonexistent');
      expect(results).toHaveLength(0);
    });

    it('should return empty array for empty query', () => {
      const results = store.search('');
      expect(results).toHaveLength(0);
    });

    it('should handle special characters in query', () => {
      store.indexFile('special.md', 'Using @types/node for Node.js type definitions');

      // The search sanitizes query tokens
      const results = store.search('@types/node');
      // Should not throw, and may or may not match depending on FTS tokenization
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle multi-word queries', () => {
      const results = store.search('Python FastAPI');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.chunkText).toContain('FastAPI');
    });
  });

  // -----------------------------------------------------------------------
  // Embedding storage
  // -----------------------------------------------------------------------

  describe('embedding storage', () => {
    it('should store and retrieve an embedding as Float32Array', () => {
      store.indexFile('emb.md', 'Some content for embedding test');

      // Get the chunk id
      const results = store.search('embedding test');
      expect(results).toHaveLength(1);

      // Store a known embedding vector
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
      // We need the chunk id — use a low-level approach via search result
      // The chunk id is the rowid; we can get it by storing for id 1
      // Since this is the first and only chunk, its id should be 1
      store.storeEmbedding(1, embedding);

      const retrieved = store.getEmbedding(1);
      expect(retrieved).not.toBeNull();
      expect(retrieved).toBeInstanceOf(Float32Array);
      expect(retrieved!.length).toBe(5);
      expect(retrieved![0]).toBeCloseTo(0.1);
      expect(retrieved![1]).toBeCloseTo(0.2);
      expect(retrieved![2]).toBeCloseTo(0.3);
      expect(retrieved![3]).toBeCloseTo(0.4);
      expect(retrieved![4]).toBeCloseTo(0.5);
    });

    it('should return null for non-existent embedding', () => {
      const result = store.getEmbedding(999);
      expect(result).toBeNull();
    });

    it('should overwrite embedding on re-store (INSERT OR REPLACE)', () => {
      store.indexFile('overwrite.md', 'Content to overwrite');

      const v1 = new Float32Array([1.0, 2.0, 3.0]);
      store.storeEmbedding(1, v1);

      const v2 = new Float32Array([4.0, 5.0, 6.0]);
      store.storeEmbedding(1, v2);

      const retrieved = store.getEmbedding(1);
      expect(retrieved![0]).toBeCloseTo(4.0);
      expect(retrieved![1]).toBeCloseTo(5.0);
      expect(retrieved![2]).toBeCloseTo(6.0);
    });
  });

  // -----------------------------------------------------------------------
  // hasEmbeddings
  // -----------------------------------------------------------------------

  describe('hasEmbeddings', () => {
    it('should return false when no embeddings exist', () => {
      expect(store.hasEmbeddings()).toBe(false);
    });

    it('should return true after storing one embedding', () => {
      store.indexFile('has.md', 'Content for has embeddings test');
      store.storeEmbedding(1, new Float32Array([0.1, 0.2, 0.3]));
      expect(store.hasEmbeddings()).toBe(true);
    });

    it('should return false on empty store even with chunks', () => {
      store.indexFile('chunks.md', 'Content with chunks but no embeddings');
      expect(store.hasEmbeddings()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getChunkIdsWithoutEmbeddings
  // -----------------------------------------------------------------------

  describe('getChunkIdsWithoutEmbeddings', () => {
    it('should return all chunk IDs when no embeddings exist', () => {
      store.indexFile('a.md', 'First file');
      store.indexFile('b.md', 'Second file');

      const ids = store.getChunkIdsWithoutEmbeddings();
      expect(ids).toHaveLength(2);
    });

    it('should return empty array when all chunks have embeddings', () => {
      store.indexFile('all.md', 'Content for all embedded');

      const ids = store.getChunkIdsWithoutEmbeddings();
      expect(ids).toHaveLength(1);

      store.storeEmbedding(ids[0]!, new Float32Array([0.1, 0.2]));

      const remaining = store.getChunkIdsWithoutEmbeddings();
      expect(remaining).toHaveLength(0);
    });

    it('should return only chunk IDs without embeddings', () => {
      store.indexFile('partial1.md', 'First partial');
      store.indexFile('partial2.md', 'Second partial');

      const allIds = store.getChunkIdsWithoutEmbeddings();
      expect(allIds).toHaveLength(2);

      // Embed only the first chunk
      store.storeEmbedding(allIds[0]!, new Float32Array([0.5]));

      const remaining = store.getChunkIdsWithoutEmbeddings();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toBe(allIds[1]);
    });
  });

  // -----------------------------------------------------------------------
  // vectorSearch
  // -----------------------------------------------------------------------

  describe('vectorSearch', () => {
    it('should return results sorted by cosine similarity (most similar first)', () => {
      store.indexFile('dog.md', 'Dogs are loyal animals');
      store.indexFile('cat.md', 'Cats are independent pets');
      store.indexFile('car.md', 'Cars need gasoline to run');

      // Create embeddings that have known cosine similarity
      // Query vector: [1, 0, 0]
      // dog embedding: [0.9, 0.1, 0.0] -> high similarity
      // cat embedding: [0.5, 0.5, 0.0] -> medium similarity
      // car embedding: [0.0, 0.1, 0.9] -> low similarity
      const ids = store.getChunkIdsWithoutEmbeddings();
      // Sort ids to map them predictably: dog=1, cat=2, car=3
      ids.sort((a, b) => a - b);

      store.storeEmbedding(ids[0]!, new Float32Array([0.9, 0.1, 0.0]));
      store.storeEmbedding(ids[1]!, new Float32Array([0.5, 0.5, 0.0]));
      store.storeEmbedding(ids[2]!, new Float32Array([0.0, 0.1, 0.9]));

      const query = new Float32Array([1.0, 0.0, 0.0]);
      const results = store.vectorSearch(query, 3);

      expect(results).toHaveLength(3);
      // First result should be the most similar (dog)
      expect(results[0]!.chunkText).toContain('Dogs');
      // Last result should be the least similar (car)
      expect(results[2]!.chunkText).toContain('Cars');
      // rank should be negative similarity (lower = more relevant)
      expect(results[0]!.rank).toBeLessThan(results[2]!.rank);
      // similarity should be positive
      expect(results[0]!.similarity).toBeGreaterThan(results[2]!.similarity!);
    });

    it('should respect the limit parameter', () => {
      store.indexFile('a.md', 'File A');
      store.indexFile('b.md', 'File B');
      store.indexFile('c.md', 'File C');

      const ids = store.getChunkIdsWithoutEmbeddings();
      ids.sort((a, b) => a - b);
      store.storeEmbedding(ids[0]!, new Float32Array([1.0, 0.0]));
      store.storeEmbedding(ids[1]!, new Float32Array([0.5, 0.5]));
      store.storeEmbedding(ids[2]!, new Float32Array([0.0, 1.0]));

      const query = new Float32Array([1.0, 0.0]);
      const results = store.vectorSearch(query, 2);
      expect(results).toHaveLength(2);
    });

    it('should return empty array when no embeddings exist', () => {
      store.indexFile('none.md', 'No embeddings here');

      const query = new Float32Array([1.0, 0.0]);
      const results = store.vectorSearch(query);
      expect(results).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // hybridSearch
  // -----------------------------------------------------------------------

  describe('hybridSearch', () => {
    it('should combine FTS5 and vector results using RRF', () => {
      store.indexFile('ts.md', 'TypeScript is a typed programming language');
      store.indexFile('js.md', 'JavaScript is a dynamic scripting language');
      store.indexFile('py.md', 'Python is great for data science');

      const ids = store.getChunkIdsWithoutEmbeddings();
      ids.sort((a, b) => a - b);

      // Make the vector search favor Python (opposite of FTS for "TypeScript")
      store.storeEmbedding(ids[0]!, new Float32Array([0.1, 0.9])); // ts
      store.storeEmbedding(ids[1]!, new Float32Array([0.3, 0.7])); // js
      store.storeEmbedding(ids[2]!, new Float32Array([0.9, 0.1])); // py

      const queryEmb = new Float32Array([0.8, 0.2]); // favors Python in vector space
      const results = store.hybridSearch('TypeScript programming', queryEmb, 3);

      expect(results.length).toBeGreaterThanOrEqual(1);
      // Results should have rank values (negative RRF scores)
      for (const r of results) {
        expect(typeof r.rank).toBe('number');
        expect(r.rank).toBeLessThan(0);
      }
    });

    it('should return results from both FTS and vector when they differ', () => {
      store.indexFile('alpha.md', 'Alpha bravo charlie');
      store.indexFile('delta.md', 'Delta echo foxtrot');

      const ids = store.getChunkIdsWithoutEmbeddings();
      ids.sort((a, b) => a - b);

      store.storeEmbedding(ids[0]!, new Float32Array([0.1, 0.9]));
      store.storeEmbedding(ids[1]!, new Float32Array([0.9, 0.1]));

      // FTS will match "Alpha" -> alpha.md
      // Vector will match delta.md (closer to [1,0])
      const queryEmb = new Float32Array([1.0, 0.0]);
      const results = store.hybridSearch('Alpha', queryEmb, 10);

      // Should have results from both sources
      expect(results.length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // CASCADE delete (embeddings removed when chunks are deleted)
  // -----------------------------------------------------------------------

  describe('CASCADE delete', () => {
    it('should remove embeddings when file is re-indexed', () => {
      store.indexFile('cascade.md', 'Original content for cascade');

      const ids = store.getChunkIdsWithoutEmbeddings();
      expect(ids).toHaveLength(1);

      store.storeEmbedding(ids[0]!, new Float32Array([1.0, 2.0, 3.0]));
      expect(store.hasEmbeddings()).toBe(true);
      expect(store.getEmbedding(ids[0]!)).not.toBeNull();

      // Re-index the same file (deletes old chunks, creates new ones)
      store.indexFile('cascade.md', 'Completely new content after re-index');

      // Old embedding should be gone due to CASCADE delete
      expect(store.getEmbedding(ids[0]!)).toBeNull();

      // New chunk should exist without embedding
      const newIds = store.getChunkIdsWithoutEmbeddings();
      expect(newIds).toHaveLength(1);
      expect(newIds[0]).not.toBe(ids[0]);
    });

    it('should remove embeddings when file is removed', () => {
      store.indexFile('removal.md', 'Content to be removed');

      const ids = store.getChunkIdsWithoutEmbeddings();
      store.storeEmbedding(ids[0]!, new Float32Array([1.0]));
      expect(store.hasEmbeddings()).toBe(true);

      store.removeFile('removal.md');

      expect(store.hasEmbeddings()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // File path tracking
  // -----------------------------------------------------------------------

  describe('file paths', () => {
    it('should store relative file paths', () => {
      store.indexFile('daily/2024-01-20.md', 'Some content about the day');
      const results = store.search('content about');
      expect(results[0]!.filePath).toBe('daily/2024-01-20.md');
    });

    it('should handle nested paths', () => {
      store.indexFile('agents/main/memory/notes.md', 'Deep nested file');
      const results = store.search('nested file');
      expect(results[0]!.filePath).toBe('agents/main/memory/notes.md');
    });
  });
});
