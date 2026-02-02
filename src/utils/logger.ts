// ---------------------------------------------------------------------------
// Structured logger with color terminal output
//
// Usage:
//   import { createLogger } from '../utils/logger.js';
//   const log = createLogger('engine');
//   log.info('Session started', { sessionId: 'abc' });
// ---------------------------------------------------------------------------

/** Supported log levels, in ascending severity order. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ---------------------------------------------------------------------------
// ANSI color codes (works on virtually all modern terminals)
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',  // cyan
  info: '\x1b[32m',   // green
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
};

const MODULE_COLOR = '\x1b[35m'; // magenta

// ---------------------------------------------------------------------------
// Global minimum level (can be changed at runtime)
// ---------------------------------------------------------------------------

let globalMinLevel: LogLevel = (process.env['CLADE_LOG_LEVEL'] as LogLevel | undefined) ?? 'info';

/**
 * Set the minimum log level globally. Messages below this level are silently
 * discarded.
 */
export function setLogLevel(level: LogLevel): void {
  globalMinLevel = level;
}

/**
 * Get the current global minimum log level.
 */
export function getLogLevel(): LogLevel {
  return globalMinLevel;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatTimestamp(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function formatLevel(level: LogLevel): string {
  return level.toUpperCase().padEnd(5);
}

function formatExtra(extra?: Record<string, unknown>): string {
  if (!extra || Object.keys(extra).length === 0) {
    return '';
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue;
    const formatted = typeof value === 'string' ? value : JSON.stringify(value);
    parts.push(`${key}=${formatted}`);
  }
  return parts.length > 0 ? ` ${DIM}(${parts.join(', ')})${RESET}` : '';
}

// ---------------------------------------------------------------------------
// Logger interface
// ---------------------------------------------------------------------------

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
  child(subModule: string): Logger;
}

// ---------------------------------------------------------------------------
// Logger implementation
// ---------------------------------------------------------------------------

function writeLog(
  level: LogLevel,
  moduleName: string,
  message: string,
  extra?: Record<string, unknown>,
): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[globalMinLevel]) {
    return;
  }

  const useColor = process.stderr.isTTY !== false;

  let line: string;
  if (useColor) {
    const ts = `${DIM}${formatTimestamp()}${RESET}`;
    const lvl = `${COLORS[level]}${BOLD}${formatLevel(level)}${RESET}`;
    const mod = `${MODULE_COLOR}[${moduleName}]${RESET}`;
    const ext = formatExtra(extra);
    line = `${ts} ${lvl} ${mod} ${message}${ext}`;
  } else {
    // Plain text for piped / file output
    const ts = formatTimestamp();
    const lvl = formatLevel(level);
    const ext = extra && Object.keys(extra).length > 0
      ? ` (${Object.entries(extra).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')})`
      : '';
    line = `${ts} ${lvl} [${moduleName}] ${message}${ext}`;
  }

  // Errors go to stderr; everything else also goes to stderr to keep
  // stdout clean for structured output (stream-json from claude CLI).
  process.stderr.write(line + '\n');
}

function createLoggerImpl(moduleName: string): Logger {
  return {
    debug(message: string, extra?: Record<string, unknown>) {
      writeLog('debug', moduleName, message, extra);
    },
    info(message: string, extra?: Record<string, unknown>) {
      writeLog('info', moduleName, message, extra);
    },
    warn(message: string, extra?: Record<string, unknown>) {
      writeLog('warn', moduleName, message, extra);
    },
    error(message: string, extra?: Record<string, unknown>) {
      writeLog('error', moduleName, message, extra);
    },
    child(subModule: string): Logger {
      return createLoggerImpl(`${moduleName}:${subModule}`);
    },
  };
}

/**
 * Create a logger scoped to a module name.
 *
 * @param moduleName - Short label shown in brackets, e.g. "engine", "router"
 * @returns A `Logger` instance with debug/info/warn/error methods.
 *
 * @example
 * ```ts
 * const log = createLogger('gateway');
 * log.info('Server started', { port: 7890 });
 * // Output: 14:32:01.456 INFO  [gateway] Server started (port=7890)
 * ```
 */
export function createLogger(moduleName: string): Logger {
  return createLoggerImpl(moduleName);
}
