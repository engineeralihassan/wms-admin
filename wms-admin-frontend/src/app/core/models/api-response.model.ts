/**
 * Standard success envelope returned by the WMS backend.
 * Every controller responds with `{ message, data }`.
 */
export interface ApiResponse<T> {
  message: string;
  data: T;
  /** Present on paginated list responses. */
  meta?: unknown;
}

/**
 * Standard error envelope returned by the backend error handler middleware.
 * Shape: `{ code, message, stack? }`.
 */
export interface ApiError {
  code: number;
  message: string;
  stack?: string;
}
