// ---------------------------------------------------------------------------
// Tests: Claude CLI Wrapper
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeCliRunner } from '../../src/engine/claude-cli.js';
import type { ClaudeOptions, ClaudeStreamEvent, ClaudeResult } from '../../src/engine/claude-cli.js';
import { EventEmitter } from 'node:events';

// Mock child_process.spawn
vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn(),
  };
});

// Mock strip-ansi (it's ESM and can be tricky)
vi.mock('strip-ansi', () => {
  return {
    default: (str: string) => str,
  };
});

import { spawn } from 'node:child_process';
const mockSpawn = vi.mocked(spawn);

/**
 * Create a mock child process that emits stdout/stderr/close events.
 */
function createMockProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

describe('ClaudeCliRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildArgs (via run)', () => {
    it('should build basic CLI arguments', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const runner = new ClaudeCliRunner();
      const runPromise = runner.run({ prompt: 'Hello world' });

      // Emit a result event then close
      const resultLine = JSON.stringify({
        type: 'result',
        result: 'Hello back',
        session_id: 'sess-123',
      });
      proc.stdout.emit('data', Buffer.from(resultLine + '\n'));
      proc.emit('close', 0);

      await runPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', 'Hello world', '--output-format', 'stream-json']),
        expect.any(Object),
      );
    });

    it('should include --resume flag when resumeSessionId is provided', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const runner = new ClaudeCliRunner();
      const runPromise = runner.run({
        prompt: 'Continue',
        resumeSessionId: 'sess-abc',
      });

      proc.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ type: 'result', result: 'ok', session_id: 'sess-abc' }) + '\n'),
      );
      proc.emit('close', 0);

      await runPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--resume', 'sess-abc']),
        expect.any(Object),
      );
    });

    it('should include --model flag', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const runner = new ClaudeCliRunner();
      const runPromise = runner.run({
        prompt: 'test',
        model: 'opus',
      });

      proc.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ type: 'result', result: 'ok', session_id: '' }) + '\n'),
      );
      proc.emit('close', 0);

      await runPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--model', 'opus']),
        expect.any(Object),
      );
    });

    it('should include --allowedTools flag', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const runner = new ClaudeCliRunner();
      const runPromise = runner.run({
        prompt: 'test',
        allowedTools: ['Read', 'Edit', 'Bash'],
      });

      proc.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ type: 'result', result: 'done', session_id: '' }) + '\n'),
      );
      proc.emit('close', 0);

      await runPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--allowedTools', 'Read,Edit,Bash']),
        expect.any(Object),
      );
    });

    it('should include --max-turns flag', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const runner = new ClaudeCliRunner();
      const runPromise = runner.run({
        prompt: 'test',
        maxTurns: 10,
      });

      proc.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ type: 'result', result: 'done', session_id: '' }) + '\n'),
      );
      proc.emit('close', 0);

      await runPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--max-turns', '10']),
        expect.any(Object),
      );
    });

    it('should include --append-system-prompt flag', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const runner = new ClaudeCliRunner();
      const runPromise = runner.run({
        prompt: 'test',
        systemPrompt: 'You are a helpful assistant',
      });

      proc.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ type: 'result', result: 'ok', session_id: '' }) + '\n'),
      );
      proc.emit('close', 0);

      await runPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--append-system-prompt', 'You are a helpful assistant']),
        expect.any(Object),
      );
    });
  });

  describe('stream-json parsing', () => {
    it('should parse result event and extract text + sessionId', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const runner = new ClaudeCliRunner();
      const runPromise = runner.run({ prompt: 'test' });

      const resultEvent = {
        type: 'result',
        result: 'The answer is 42',
        session_id: 'sess-xyz',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      proc.stdout.emit('data', Buffer.from(JSON.stringify(resultEvent) + '\n'));
      proc.emit('close', 0);

      const result = await runPromise;
      expect(result.text).toBe('The answer is 42');
      expect(result.sessionId).toBe('sess-xyz');
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it('should handle multiple NDJSON lines', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const events: ClaudeStreamEvent[] = [];
      const runner = new ClaudeCliRunner();
      runner.on('data', (event) => events.push(event));

      const runPromise = runner.run({ prompt: 'test' });

      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({ type: 'assistant', subtype: 'text', text: 'Hello' }),
        JSON.stringify({ type: 'result', result: 'Hello world', session_id: 'sess-1' }),
      ].join('\n') + '\n';

      proc.stdout.emit('data', Buffer.from(lines));
      proc.emit('close', 0);

      const result = await runPromise;

      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(result.text).toBe('Hello world');
    });

    it('should handle partial lines across chunks', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const runner = new ClaudeCliRunner();
      const runPromise = runner.run({ prompt: 'test' });

      const fullLine = JSON.stringify({
        type: 'result',
        result: 'split result',
        session_id: 'sess-split',
      });

      // Split the line across two chunks
      const mid = Math.floor(fullLine.length / 2);
      proc.stdout.emit('data', Buffer.from(fullLine.slice(0, mid)));
      proc.stdout.emit('data', Buffer.from(fullLine.slice(mid) + '\n'));
      proc.emit('close', 0);

      const result = await runPromise;
      expect(result.text).toBe('split result');
      expect(result.sessionId).toBe('sess-split');
    });
  });

  describe('error handling', () => {
    it('should reject when process exits with non-zero code', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const runner = new ClaudeCliRunner();
      // Attach error listener to prevent unhandled EventEmitter error
      runner.on('error', () => {});
      const runPromise = runner.run({ prompt: 'test' });

      proc.stderr.emit('data', Buffer.from('Something went wrong'));
      proc.emit('close', 1);

      await expect(runPromise).rejects.toThrow('claude process failed');
    });

    it('should reject when spawn throws ENOENT (claude not found)', async () => {
      const enoentErr = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      enoentErr.code = 'ENOENT';

      mockSpawn.mockImplementation(() => {
        throw enoentErr;
      });

      const runner = new ClaudeCliRunner();
      await expect(runner.run({ prompt: 'test' })).rejects.toThrow('claude CLI not found');
    });

    it('should reject when result event indicates error', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const runner = new ClaudeCliRunner();
      // Attach error listener to prevent unhandled EventEmitter error
      runner.on('error', () => {});
      const runPromise = runner.run({ prompt: 'test' });

      const errorResult = {
        type: 'result',
        subtype: 'error',
        error: 'Authentication failed',
        session_id: '',
      };

      proc.stdout.emit('data', Buffer.from(JSON.stringify(errorResult) + '\n'));
      proc.emit('close', 0);

      await expect(runPromise).rejects.toThrow('Authentication failed');
    });

    it('should handle process error event with ENOENT', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const runner = new ClaudeCliRunner();
      // Attach error listener to prevent unhandled EventEmitter error
      runner.on('error', () => {});
      const runPromise = runner.run({ prompt: 'test' });

      const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      proc.emit('error', err);

      await expect(runPromise).rejects.toThrow('claude CLI not found');
    });
  });

  describe('abort', () => {
    it('should support aborting a running process', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const runner = new ClaudeCliRunner();
      // Attach error listener to prevent unhandled EventEmitter error
      runner.on('error', () => {});
      const runPromise = runner.run({ prompt: 'long task' });

      // Abort immediately
      runner.abort();

      // Process gets abort signal and emits error
      const abortErr = new Error('aborted') as NodeJS.ErrnoException;
      abortErr.code = 'ABORT_ERR';
      proc.emit('error', abortErr);

      await expect(runPromise).rejects.toThrow('aborted');
    });
  });

  describe('event emission', () => {
    it('should emit text events for assistant content', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const texts: string[] = [];
      const runner = new ClaudeCliRunner();
      runner.on('text', (chunk) => texts.push(chunk));

      const runPromise = runner.run({ prompt: 'test' });

      proc.stdout.emit(
        'data',
        Buffer.from(
          [
            JSON.stringify({ type: 'assistant', subtype: 'text', text: 'Hello ' }),
            JSON.stringify({ type: 'assistant', subtype: 'text', text: 'world' }),
            JSON.stringify({ type: 'result', result: 'Hello world', session_id: '' }),
          ].join('\n') + '\n',
        ),
      );
      proc.emit('close', 0);

      await runPromise;
      expect(texts).toContain('Hello ');
      expect(texts).toContain('world');
    });

    it('should emit done event with result', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      let doneResult: ClaudeResult | null = null;
      const runner = new ClaudeCliRunner();
      runner.on('done', (result) => {
        doneResult = result;
      });

      const runPromise = runner.run({ prompt: 'test' });

      proc.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ type: 'result', result: 'final', session_id: 'sess-done' }) + '\n'),
      );
      proc.emit('close', 0);

      await runPromise;
      expect(doneResult).not.toBeNull();
      expect(doneResult!.text).toBe('final');
      expect(doneResult!.sessionId).toBe('sess-done');
    });
  });
});
