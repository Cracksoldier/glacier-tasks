// Local JSON-lines log with size-based rotation (spec §12, threat model T13).
// Callers log operations, error codes and technical details — never task descriptions,
// titles or attachment contents.

import { appendFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  maxBytes?: number;
  maxFiles?: number;
  now?: () => Date;
  /** Mirror entries to the console (dev and smoke runs). */
  echo?: boolean;
}

const FILE_NAME = 'main.log';

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export function createLogger(logDir: string, options: LoggerOptions = {}): Logger {
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const maxFiles = options.maxFiles ?? 3;
  const now = options.now ?? (() => new Date());
  const file = join(logDir, FILE_NAME);

  function rotateIfNeeded(): void {
    if (!existsSync(file) || statSync(file).size < maxBytes) return;
    rmSync(join(logDir, `${FILE_NAME}.${maxFiles - 1}`), { force: true });
    for (let index = maxFiles - 2; index >= 1; index--) {
      const from = join(logDir, `${FILE_NAME}.${index}`);
      if (existsSync(from)) renameSync(from, join(logDir, `${FILE_NAME}.${index + 1}`));
    }
    renameSync(file, join(logDir, `${FILE_NAME}.1`));
  }

  function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const entry: Record<string, unknown> = { ts: now().toISOString(), level, message };
    if (meta) {
      for (const [key, value] of Object.entries(meta)) entry[key] = serialize(value);
    }
    const line = `${JSON.stringify(entry)}\n`;
    try {
      rotateIfNeeded();
      appendFileSync(file, line, 'utf-8');
    } catch {
      // Logging must never break the app.
    }
    if (options.echo) {
      (level === 'error' ? console.error : console.log)(line.trimEnd());
    }
  }

  return {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
