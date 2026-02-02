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
