// ---------------------------------------------------------------------------
// Embedding generation using @huggingface/transformers (local inference)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  /** Generate embedding for a single text */
  embed(text: string): Promise<Float32Array>;
  /** Generate embeddings for multiple texts (batched for efficiency) */
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  /** Embedding vector dimension */
  readonly dimension: number;
  /** Whether the model is loaded and ready */
  readonly ready: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const DIMENSION = 384;

/** Max characters to send to the model (~256 tokens). */
const MAX_TEXT_LENGTH = 512;

/** Batch size for embedBatch to avoid OOM. */
const BATCH_SIZE = 32;

// ---------------------------------------------------------------------------
// TransformersEmbeddingProvider
// ---------------------------------------------------------------------------

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = DIMENSION;
  private pipeline: any = null;
  private initPromise: Promise<void> | null = null;

  get ready(): boolean {
    return this.pipeline !== null;
  }

  // -------------------------------------------------------------------------
  // Lazy model loading
  // -------------------------------------------------------------------------

  private async ensureReady(): Promise<void> {
    if (this.pipeline) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const { pipeline } = await import('@huggingface/transformers');
        this.pipeline = await pipeline(
          'feature-extraction',
          MODEL_NAME,
          { dtype: 'fp32' },
        );
      } catch (err) {
        this.initPromise = null;
        throw new Error(
          'Embedding model not available. Ensure internet access for first-time model download.',
        );
      }
    })();

    return this.initPromise;
  }

  // -------------------------------------------------------------------------
  // Single embedding
  // -------------------------------------------------------------------------

  async embed(text: string): Promise<Float32Array> {
    const prepared = prepareText(text);
    if (prepared.length === 0) {
      return new Float32Array(DIMENSION);
    }

    await this.ensureReady();

    const output = await this.pipeline(prepared, {
      pooling: 'mean',
      normalize: true,
    });

    return new Float32Array(output.data);
  }

  // -------------------------------------------------------------------------
  // Batch embedding
  // -------------------------------------------------------------------------

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    await this.ensureReady();

    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const prepared = batch.map(prepareText);

      // Process each text in the batch individually to avoid shape issues
      for (const text of prepared) {
        if (text.length === 0) {
          results.push(new Float32Array(DIMENSION));
          continue;
        }

        const output = await this.pipeline(text, {
          pooling: 'mean',
          normalize: true,
        });

        results.push(new Float32Array(output.data));
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Text preprocessing
// ---------------------------------------------------------------------------

function prepareText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length <= MAX_TEXT_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_TEXT_LENGTH);
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

export const embeddingProvider = new TransformersEmbeddingProvider();

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Check if embeddings are available (model downloadable/already cached) */
export async function isEmbeddingAvailable(): Promise<boolean> {
  try {
    await embeddingProvider.embed('test');
    return true;
  } catch {
    return false;
  }
}
