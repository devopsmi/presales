/**
 * Structured logger with level filtering, request tracing, and context support.
 *
 * - Development: colorized pretty output to stdout
 * - Production: newline-delimited JSON to stdout
 * - Filter by LOG_LEVEL env var (debug < info < warn < error)
 * - Use `logger.child(ctx)` to create contextual sub-loggers
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  requestId?: string;
  message: string;
  data?: Record<string, unknown>;
  error?: string;
  stack?: string;
}

export type LogFn = (message: string, data?: Record<string, unknown>) => void;

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  /** Create a child logger with merged context */
  child: (ctx: Record<string, string>) => Logger;
  /** Create a child logger scoped to a request ID */
  withRequestId: (requestId: string) => Logger;
}

// ---------------------------------------------------------------------------
// Level precedence
// ---------------------------------------------------------------------------

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function resolveLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw && raw in LEVEL_PRIORITY) return raw as LogLevel;
  // Default: info in production, debug in development
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function isLevelEnabled(level: LogLevel, threshold: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[threshold];
}

// ---------------------------------------------------------------------------
// Pretty formatting (development)
// ---------------------------------------------------------------------------

const COLOR_RESET = "\x1b[0m";
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m",  // green
  warn: "\x1b[33m",  // yellow
  error: "\x1b[31m", // red
};

function formatPretty(entry: LogEntry): string {
  const ts = entry.timestamp.slice(11); // HH:mm:ss.SSS
  const levelColor = LEVEL_COLORS[entry.level];
  const levelTag = `${levelColor}${entry.level.toUpperCase().padEnd(5)}${COLOR_RESET}`;
  const ctx = `\x1b[90m[${entry.context}]\x1b[0m`;
  const rid = entry.requestId ? ` \x1b[35m#${entry.requestId.slice(-6)}\x1b[0m` : "";
  let line = `${ts} ${levelTag} ${ctx}${rid} ${entry.message}`;
  if (entry.data && Object.keys(entry.data).length > 0) {
    line += ` ${JSON.stringify(entry.data)}`;
  }
  if (entry.error) {
    line += `\n  error: ${entry.error}`;
    if (entry.stack) {
      const stackLines = entry.stack.split("\n").slice(1, 4);
      for (const s of stackLines) {
        line += `\n    ${s.trim()}`;
      }
    }
  }
  return line;
}

// ---------------------------------------------------------------------------
// JSON formatting (production)
// ---------------------------------------------------------------------------

function formatJson(entry: LogEntry): string {
  const output: Record<string, unknown> = {
    ts: entry.timestamp,
    lvl: entry.level,
    ctx: entry.context,
    msg: entry.message,
  };
  if (entry.requestId) output.rid = entry.requestId;
  if (entry.data && Object.keys(entry.data).length > 0) output.data = entry.data;
  if (entry.error) {
    output.err = entry.error;
    if (entry.stack) output.stack = entry.stack;
  }
  return JSON.stringify(output);
}

// ---------------------------------------------------------------------------
// Core writer
// ---------------------------------------------------------------------------

function createInternalLogger(context: string, requestId?: string): Logger {
  const threshold = resolveLogLevel();
  const isProd = process.env.NODE_ENV === "production";
  const formatter = isProd ? formatJson : formatPretty;
  const writer = isProd ? process.stdout : process.stdout;

  function buildEntry(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: Error,
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      context,
      requestId,
      message,
      data,
      error: error?.message,
      stack: error?.stack,
    };
  }

  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!isLevelEnabled(level, threshold)) return;
    const entry = buildEntry(level, message, data);
    writer.write(formatter(entry) + "\n");
  }

  const self: Logger = {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => {
      // Extract Error from data if present for structured error logging
      const errorObj = data?.error instanceof Error ? data.error : undefined;
      const cleanData = data ? { ...data } : undefined;
      if (errorObj && cleanData) delete (cleanData as Record<string, unknown>).error;
      if (!isLevelEnabled("error", threshold)) return;
      const entry = buildEntry("error", msg, cleanData, errorObj);
      writer.write(formatter(entry) + "\n");
    },
    child: (ctx: Record<string, string>) => {
      const merged = Object.entries(ctx)
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
      return createInternalLogger(
        context ? `${context}:${merged}` : merged,
        requestId,
      );
    },
    withRequestId: (rid: string) => createInternalLogger(context, rid),
  };

  return self;
}

// ---------------------------------------------------------------------------
// Root logger
// ---------------------------------------------------------------------------

/** Root-level logger. Use `.child()` for contextual sub-loggers. */
const log = createInternalLogger("app");

export default log;
