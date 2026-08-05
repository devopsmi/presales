/**
 * Structured logger with level filtering, request tracing, and context support.
 *
 * - stdout: colorized human-readable output
 * - File:   plain-text human-readable output (log/session-{timestamp}.log)
 * - Filter by LOG_LEVEL env var (debug < info < warn < error)
 * - Use `logger.child(ctx)` to create contextual sub-loggers
 */
 
let writeToFile: (line: string) => void = () => { };

// Server-only: initialize file logging using Node.js fs module.
// Guarded with typeof window to avoid bundling node:fs into client bundles.
if (typeof window === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs: typeof import("node:fs") = require("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath: typeof import("node:path") = require("node:path");

  const logsDir = nodePath.resolve(process.cwd(), "log");
  if (!nodeFs.existsSync(logsDir)) {
    nodeFs.mkdirSync(logsDir, { recursive: true });
  }

  const sessionTimestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+/, "");
  const filePath = nodePath.join(logsDir, `session-${sessionTimestamp}.log`);

  const fileStream = nodeFs.createWriteStream(filePath, { flags: "a" });
  fileStream.on("error", (err) => {
    process.stderr.write(`[logger] Failed to write to ${filePath}: ${err.message}\n`);
  });

  writeToFile = (line: string) => {
    fileStream.write(line + "\n");
  };

  // Graceful shutdown: flush and close the file stream on process exit so
  // buffered writes are not lost when the process is killed (e.g. PM2 restart).
  const cleanup = () => {
    try {
      fileStream.end();
    } catch {
      /* ignore */
    }
  };
  process.on("exit", cleanup);
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
}

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
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function isLevelEnabled(level: LogLevel, threshold: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[threshold];
}

// ---------------------------------------------------------------------------
// ANSI color codes
// ---------------------------------------------------------------------------

const C = {
  reset:   "\x1b[0m",
  dim:     "\x1b[2m",
  gray:    "\x1b[90m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  cyan:    "\x1b[36m",
  magenta: "\x1b[35m",
} as const;

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: C.cyan,
  info:  C.green,
  warn:  C.yellow,
  error: C.red,
};

// ---------------------------------------------------------------------------
// Pretty formatting
// ---------------------------------------------------------------------------

/**
 * Format a data object as indented key:value pairs.
 * Nested objects up to 80 chars are inlined; larger ones get pretty-printed.
 */
function formatDataField(data: Record<string, unknown>): string {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "";

  let result = "";
  for (const [key, value] of entries) {
    if (value === null) {
      result += `\n    ${key}: null`;
    } else if (typeof value === "object") {
      const json = JSON.stringify(value);
      if (json.length <= 80) {
        result += `\n    ${key}: ${json}`;
      } else {
        const indented = JSON.stringify(value, null, 2)
          .split("\n")
          .map((ln) => `    ${ln}`)
          .join("\n");
        result += `\n    ${key}:`;
        result += `\n${indented}`;
      }
    } else {
      result += `\n    ${key}: ${String(value)}`;
    }
  }
  return result;
}

/**
 * Render a single log entry as human-readable text.
 * @param colorize  append ANSI escape codes for terminal output
 */
function formatEntry(entry: LogEntry, colorize: boolean): string {
  const ts = entry.timestamp.slice(11, 23);            // HH:mm:ss.SSS
  const levelTag = entry.level.toUpperCase().padEnd(5);
  const ctx = `[${entry.context}]`;
  const rid = entry.requestId ? ` #${entry.requestId.slice(-6)}` : "";
  const dataStr = entry.data ? formatDataField(entry.data) : "";

  if (!colorize) {
    let line = `${ts} ${levelTag} ${ctx}${rid} ${entry.message}${dataStr}`;
    if (entry.error) {
      line += `\n  ╰ ${entry.error}`;
      if (entry.stack) {
        const stackLines = entry.stack.split("\n").slice(1, 5);
        for (const s of stackLines) {
          line += `\n    ${s.trim()}`;
        }
      }
    }
    return line;
  }

  // Colorized terminal output
  const lc = LEVEL_COLORS[entry.level];
  let line = `${C.dim}${ts}${C.reset} ${lc}${levelTag}${C.reset} ${C.dim}${ctx}${C.reset}${C.magenta}${rid}${C.reset} ${entry.message}`;

  if (dataStr) {
    line += `${C.dim}${dataStr}${C.reset}`;
  }

  if (entry.error) {
    line += `\n  ╰ ${C.red}${entry.error}${C.reset}`;
    if (entry.stack) {
      const stackLines = entry.stack.split("\n").slice(1, 5);
      for (const s of stackLines) {
        line += `\n    ${C.gray}${s.trim()}${C.reset}`;
      }
    }
  }

  return line;
}

// ---------------------------------------------------------------------------
// Core writer
// ---------------------------------------------------------------------------

function createInternalLogger(context: string, requestId?: string): Logger {
  const threshold = resolveLogLevel();

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
      data: data && Object.keys(data).length > 0 ? data : undefined,
      error: error?.message,
      stack: error?.stack,
    };
  }

  function emit(entry: LogEntry): void {
    process.stdout.write(formatEntry(entry, true) + "\n");
    writeToFile(formatEntry(entry, false));
  }

  const self: Logger = {
    debug: (msg, data) => {
      if (isLevelEnabled("debug", threshold)) emit(buildEntry("debug", msg, data));
    },
    info: (msg, data) => {
      if (isLevelEnabled("info", threshold)) emit(buildEntry("info", msg, data));
    },
    warn: (msg, data) => {
      if (isLevelEnabled("warn", threshold)) emit(buildEntry("warn", msg, data));
    },
    error: (msg, data) => {
      if (!isLevelEnabled("error", threshold)) return;
      // Extract Error object from conventional { error: err } payload
      const errorObj = data?.error instanceof Error ? data.error : undefined;
      const cleanData = data ? { ...data } : undefined;
      if (errorObj && cleanData) {
        delete (cleanData as Record<string, unknown>).error;
      }
      emit(buildEntry("error", msg, cleanData, errorObj));
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
