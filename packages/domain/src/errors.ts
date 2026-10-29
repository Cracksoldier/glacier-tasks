// Structured error contract for every IPC call (spec §6, ADR 0004).
// Messages are safe to show to the user: no file system paths, no stack traces.

export const ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'CONFLICT',
  'IO',
  'BACKUP_INVALID',
  'MIGRATION_REQUIRED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppErrorInfo {
  code: ErrorCode;
  /** Translation key or plain English fallback; never contains paths or stack traces. */
  message: string;
  /** Optional structured details, e.g. field-level validation issues. */
  details?: Record<string, unknown>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppErrorInfo };

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  toInfo(): AppErrorInfo {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(error: AppErrorInfo): Result<T> {
  return { ok: false, error };
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Rejections from `window.glacierTasks` are plain AppErrorInfo objects (ADR 0004). */
export function isAppErrorInfo(value: unknown): value is AppErrorInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AppErrorInfo).message === 'string' &&
    (ERROR_CODES as ReadonlyArray<unknown>).includes((value as AppErrorInfo).code)
  );
}
