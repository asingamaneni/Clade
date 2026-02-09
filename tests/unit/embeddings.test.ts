// ---------------------------------------------------------------------------
// Tests: Embedding provider (mocked — no real model loading)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import type { EmbeddingProvider } from '../../src/mcp/memory/embeddings.js';

// ---------------------------------------------------------------------------
// MockEmbeddingProvider — deterministic vectors based on text hash
// ---------------------------------------------------------------------------

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 384;
  readonly ready = true;

  /**
   * Generate a deterministic Float32Array from the text.
   * Uses a simple hash-seeded approach for reproducibility.
   */
  async embed(text: string): Promise<Float32Array> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return new Float32Array(this.dimension);
    }
    return this.hashToVector(trimmed);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  /**
   * Simple deterministic hash -> float array.
   * Uses a basic string hash to seed a pseudo-random sequence.
   */
  private hashToVector(text: string): Float32Array {
    const vec = new Float32Array(this.dimension);
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    // Use the hash to seed pseudo-random values between -1 and 1
    let seed = Math.abs(hash);
    for (let i = 0; i < this.dimension; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      vec[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    // Normalize to unit vector
    let norm = 0;
    for (let i = 0; i < this.dimension; i++) {
      norm += vec[i]! * vec[i]!;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) {
        vec[i] = vec[i]! / norm;
      }
    }
    return vec;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbeddingProvider (MockEmbeddingProvider)', () => {
  const provider = new MockEmbeddingProvider();

  // -------------------------------------------------------------------------
  // embed()
  // -------------------------------------------------------------------------

  describe('embed()', () => {
    it('should return a Float32Array of correct dimension (384)', async () => {
      const result = await provider.embed('Hello world');
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(384);
    });

    it('should return zero vector for empty string', async () => {
      const result = await provider.embed('');
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(384);

      // Every element should be 0
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBe(0);
      }
    });

    it('should return zero vector for whitespace-only string', async () => {
      const result = await provider.embed('   \n\t  ');
      expect(result).toBeInstanceOf(Float32Array);
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBe(0);
      }
    });

    it('should return deterministic results for the same input', async () => {
      const r1 = await provider.embed('Deterministic test');
      const r2 = await provider.embed('Deterministic test');

      expect(r1.length).toBe(r2.length);
      for (let i = 0; i < r1.length; i++) {
        expect(r1[i]).toBe(r2[i]);
      }
    });

    it('should return different vectors for different input', async () => {
      const r1 = await provider.embed('Hello');
      const r2 = await provider.embed('World');

      let allSame = true;
      for (let i = 0; i < r1.length; i++) {
        if (r1[i] !== r2[i]) {
          allSame = false;
          break;
        }
      }
      expect(allSame).toBe(false);
    });

    it('should return a normalized vector (unit length)', async () => {
      const result = await provider.embed('Normalization test');
      let norm = 0;
      for (let i = 0; i < result.length; i++) {
        norm += result[i]! * result[i]!;
      }
      expect(Math.sqrt(norm)).toBeCloseTo(1.0, 4);
    });
  });

  // -------------------------------------------------------------------------
  // embedBatch()
  // -------------------------------------------------------------------------

  describe('embedBatch()', () => {
    it('should return correct number of results', async () => {
      const texts = ['Hello', 'World', 'Test'];
      const results = await provider.embedBatch(texts);
      expect(results).toHaveLength(3);
    });

    it('should return empty array for empty input', async () => {
      const results = await provider.embedBatch([]);
      expect(results).toHaveLength(0);
    });

    it('should return Float32Arrays of correct dimension', async () => {
      const results = await provider.embedBatch(['A', 'B']);
      for (const vec of results) {
        expect(vec).toBeInstanceOf(Float32Array);
        expect(vec.length).toBe(384);
      }
    });

    it('should handle mix of empty and non-empty texts', async () => {
      const results = await provider.embedBatch(['Hello', '', 'World']);
      expect(results).toHaveLength(3);

      // First and third should be non-zero
      let firstHasNonZero = false;
      for (let i = 0; i < results[0]!.length; i++) {
        if (results[0]![i] !== 0) { firstHasNonZero = true; break; }
      }
      expect(firstHasNonZero).toBe(true);

      // Second (empty) should be all zeros
      for (let i = 0; i < results[1]!.length; i++) {
        expect(results[1]![i]).toBe(0);
      }
    });

    it('should produce same results as individual embed() calls', async () => {
      const texts = ['Alpha', 'Bravo', 'Charlie'];
      const batchResults = await provider.embedBatch(texts);
      const individualResults = await Promise.all(texts.map((t) => provider.embed(t)));

      for (let t = 0; t < texts.length; t++) {
        for (let i = 0; i < 384; i++) {
          expect(batchResults[t]![i]).toBe(individualResults[t]![i]);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------

  describe('properties', () => {
    it('should have dimension of 384', () => {
      expect(provider.dimension).toBe(384);
    });

    it('should report ready as true', () => {
      expect(provider.ready).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // isEmbeddingAvailable() logic test
  // -------------------------------------------------------------------------

  describe('isEmbeddingAvailable pattern', () => {
    it('should return true when embed succeeds', async () => {
      // Simulating the isEmbeddingAvailable() pattern
      let available: boolean;
      try {
        await provider.embed('test');
        available = true;
      } catch {
        available = false;
      }
      expect(available).toBe(true);
    });

    it('should return false when embed throws', async () => {
      // Create a provider that always throws
      const failingProvider: EmbeddingProvider = {
        dimension: 384,
        ready: false,
        async embed(): Promise<Float32Array> {
          throw new Error('Model not available');
        },
        async embedBatch(): Promise<Float32Array[]> {
          throw new Error('Model not available');
        },
      };

      let available: boolean;
      try {
        await failingProvider.embed('test');
        available = true;
      } catch {
        available = false;
      }
      expect(available).toBe(false);
    });
  });
});
