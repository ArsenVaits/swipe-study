import type { ErrorRequestHandler } from "express";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "NOT_FOUND"
  | "SESSION_LIMIT_REACHED"
  | "AI_NOT_CONFIGURED"
  | "INSUFFICIENT_SOURCE"
  | "LESSON_REFUSED"
  | "LESSON_GENERATION_FAILED"
  | "INTERNAL_ERROR";

/** An error whose code and message are safe to show to the frontend. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly jobId?: string;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    extra: { details?: unknown; jobId?: string } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = extra.details;
    this.jobId = extra.jobId;
  }
}

/** Never leaks stack traces or upstream error bodies to the client. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? null },
      jobId: err.jobId ?? null,
    });
    return;
  }
  // body-parser errors (malformed JSON / body too large)
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large.", details: null }, jobId: null });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Body must be valid JSON.", details: null }, jobId: null });
    return;
  }
  console.error("[unhandled]", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error.", details: null }, jobId: null });
};
