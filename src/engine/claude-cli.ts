import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import stripAnsi from 'strip-ansi';

export interface ClaudeOptions {
  prompt: string;
  resumeSessionId?: string;
  systemPrompt?: string;
  mcpConfigPath?: string;
  allowedTools?: string[];
  maxTurns?: number;
  model?: string;
  workingDirectory?: string;
  verbose?: boolean;
  timeout?: number;
}

export interface ClaudeResult {
  text: string;
  sessionId: string;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
}

export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  [key: string]: unknown;
}

export interface ClaudeCliEvents {
  data: [event: ClaudeStreamEvent];
  text: [chunk: string];
  error: [error: Error];
  done: [result: ClaudeResult];
}

export class ClaudeCliRunner extends EventEmitter {
  private abortController: AbortController | null = null;

  override emit<K extends keyof ClaudeCliEvents>(
    event: K,
    ...args: ClaudeCliEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof ClaudeCliEvents>(
    event: K,
    listener: (...args: ClaudeCliEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override once<K extends keyof ClaudeCliEvents>(
    event: K,
    listener: (...args: ClaudeCliEvents[K]) => void,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  abort(): void {
    this.abortController?.abort();
  }

  async run(options: ClaudeOptions): Promise<ClaudeResult> {
    const args = this.buildArgs(options);
    const startTime = Date.now();

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    return new Promise<ClaudeResult>((resolve, reject) => {
      let proc: ReturnType<typeof spawn>;

      try {
        proc = spawn('claude', args, {
          cwd: options.workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
          signal,
        });
      } catch (err: unknown) {
        const spawnErr =
          err instanceof Error ? err : new Error(String(err));
        if (
          'code' in spawnErr &&
          (spawnErr as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          const notFound = new Error(
            'claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-cli',
          );
          this.emit('error', notFound);
          reject(notFound);
          return;
        }
        this.emit('error', spawnErr);
        reject(spawnErr);
        return;
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (options.timeout && options.timeout > 0) {
        timeoutId = setTimeout(() => {
          proc.kill('SIGTERM');
          const timeoutErr = new Error(
            `claude process timed out after ${options.timeout}ms`,
          );
          this.emit('error', timeoutErr);
          reject(timeoutErr);
        }, options.timeout);
      }

      let stdout = '';
      let stderr = '';
      let resultEvent: ClaudeStreamEvent | null = null;
      let resultText = '';
      let sessionId = '';
      let usage: { inputTokens: number; outputTokens: number } | undefined;

      // NDJSON parsing with partial-line buffering
      let buffer = '';

      const processLine = (raw: string): void => {
        const trimmed = raw.trim();
        if (!trimmed) return;

        const cleaned = stripAnsi(trimmed);

        try {
          const event = JSON.parse(cleaned) as ClaudeStreamEvent;
          this.emit('data', event);

          if (event.type === 'assistant' && typeof event.content === 'string') {
            this.emit('text', event.content);
          }

          if (
            event.type === 'assistant' &&
            event.subtype === 'text' &&
            typeof event.text === 'string'
          ) {
            this.emit('text', event.text);
          }

          if (event.type === 'content_block_delta') {
            const delta = event.delta as Record<string, unknown> | undefined;
            if (delta && typeof delta.text === 'string') {
              this.emit('text', delta.text);
            }
          }

          if (event.type === 'result') {
            resultEvent = event;
            if (typeof event.result === 'string') {
              resultText = event.result;
            }
            if (typeof event.session_id === 'string') {
              sessionId = event.session_id;
            }
            if (event.usage && typeof event.usage === 'object') {
              const u = event.usage as Record<string, unknown>;
              if (
                typeof u.input_tokens === 'number' &&
                typeof u.output_tokens === 'number'
              ) {
                usage = {
                  inputTokens: u.input_tokens,
                  outputTokens: u.output_tokens,
                };
              }
            }
          }
        } catch {
          // Not valid JSON -- treat as raw text output
          this.emit('text', cleaned);
        }
      };

      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        buffer += text;

        const lines = buffer.split('\n');
        // The last element may be a partial line; keep it in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          processLine(line);
        }
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err: Error) => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);

        if (
          'code' in err &&
          (err as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          const notFoundErr = new Error(
            'claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-cli',
          );
          this.emit('error', notFoundErr);
          reject(notFoundErr);
          return;
        }

        if (
          'code' in err &&
          (err as NodeJS.ErrnoException).code === 'ABORT_ERR'
        ) {
          const abortErr = new Error('claude process was aborted');
          this.emit('error', abortErr);
          reject(abortErr);
          return;
        }

        this.emit('error', err);
        reject(err);
      });

      proc.on('close', (code: number | null) => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);

        // Process any remaining buffer content
        if (buffer.trim()) {
          processLine(buffer);
          buffer = '';
        }

        const durationMs = Date.now() - startTime;

        // Check for error in result event
        if (resultEvent && resultEvent.subtype === 'error') {
          const errMsg =
            typeof resultEvent.error === 'string'
              ? resultEvent.error
              : typeof resultEvent.result === 'string'
                ? resultEvent.result
                : `claude exited with error`;
          const resultErr = new Error(errMsg);
          this.emit('error', resultErr);
          reject(resultErr);
          return;
        }

        // Non-zero exit without a result event
        if (code !== null && code !== 0 && !resultEvent) {
          const cleanStderr = stderr.trim()
            ? stripAnsi(stderr.trim())
            : `exit code ${code}`;
          const exitErr = new Error(`claude process failed: ${cleanStderr}`);
          this.emit('error', exitErr);
          reject(exitErr);
          return;
        }

        const result: ClaudeResult = {
          text: resultText,
          sessionId,
          usage,
          durationMs,
        };

        this.emit('done', result);
        resolve(result);
      });
    });
  }

  private buildArgs(options: ClaudeOptions): string[] {
    const args = ['-p', options.prompt, '--output-format', 'stream-json'];

    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    }

    if (options.systemPrompt) {
      args.push('--append-system-prompt', options.systemPrompt);
    }

    if (options.mcpConfigPath) {
      args.push('--mcp-config', options.mcpConfigPath);
    }

    if (options.allowedTools && options.allowedTools.length > 0) {
      args.push('--allowedTools', options.allowedTools.join(','));
    }

    if (options.maxTurns !== undefined && options.maxTurns > 0) {
      args.push('--max-turns', String(options.maxTurns));
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.verbose) {
      args.push('--verbose');
    }

    return args;
  }
}

/**
 * Convenience function for one-off claude invocations.
 */
export async function runClaude(options: ClaudeOptions): Promise<ClaudeResult> {
  const runner = new ClaudeCliRunner();
  return runner.run(options);
}
