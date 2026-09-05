import type { ContentfulStatusCode } from "hono/utils/http-status";

/** FR-API-082 error types. `not_found` is used for ids in another mode or merchant too, never 403. */
export type ErrorType =
  | "api_error"
  | "authentication_error"
  | "invalid_request_error"
  | "rate_limit_error"
  | "idempotency_error"
  | "not_found";

export interface ApiErrorBody {
  error: { type: ErrorType; message: string; code?: string; param?: string };
}

/** Thrown from handlers and middleware; `app.onError` turns it into the wire shape. */
export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly type: ErrorType,
    message: string,
    public readonly param?: string,
    public readonly code?: string,
  ) {
    super(message);
  }

  toBody(): ApiErrorBody {
    const error: ApiErrorBody["error"] = { type: this.type, message: this.message };
    if (this.code) error.code = this.code;
    if (this.param) error.param = this.param;
    return { error };
  }
}

export const unauthorized = (message = "Invalid API key provided.") =>
  new ApiError(401, "authentication_error", message);
export const notFound = (what: string, id?: string) =>
  new ApiError(404, "not_found", id ? `No such ${what}: '${id}'` : `No such ${what}`);
export const invalid = (message: string, param?: string) =>
  new ApiError(400, "invalid_request_error", message, param);
