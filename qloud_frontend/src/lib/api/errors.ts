/** Unified backend error body (qloud_docs/api.md): `{ error: { code, message, details } }`. */
export interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

export class ApiError extends Error {
  readonly status: number;
  /** Stable code to map to an i18n message, e.g. `quota_exceeded`. */
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: unknown) {
    const parsed = isApiErrorBody(body) ? body.error : undefined;
    super(parsed?.message ?? `Request failed with status ${String(status)}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = parsed?.code ?? 'error';
    this.details = parsed?.details ?? {};
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

/** Return `data` from an openapi-fetch result or throw an {@link ApiError}. */
export function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (result.response.ok && result.data !== undefined) return result.data;
  throw new ApiError(result.response.status, result.error);
}
