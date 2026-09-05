/**
 * Error classes (FR-SDK-011, FR-SDK-021). Every error the SDK throws extends
 * `ElapseError`, so `catch (e) { if (e instanceof ElapseError) … }` is enough.
 * Messages never contain the secret key, a webhook secret, or a payload body.
 */
export class ElapseError extends Error {
  /** HTTP status, when the error came from a response. */
  readonly status: number | undefined;
  /** The API's `error.type` (`invalid_request_error`, …), when present. */
  readonly type: string | undefined;
  readonly code: string | undefined;
  readonly param: string | undefined;
  readonly requestId: string | undefined;

  constructor(
    message: string,
    fields: { status?: number; type?: string; code?: string; param?: string; requestId?: string } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.status = fields.status;
    this.type = fields.type;
    this.code = fields.code;
    this.param = fields.param;
    this.requestId = fields.requestId;
  }
}

/** 401/403: bad, missing or revoked key. */
export class ElapseAuthenticationError extends ElapseError {}
/** 400/404/422, and client-side validation before a request is sent. */
export class ElapseInvalidRequestError extends ElapseError {}
/** 429. `retryAfter` in seconds when the API sent it. */
export class ElapseRateLimitError extends ElapseError {
  readonly retryAfter: number | undefined;
  constructor(message: string, fields: ConstructorParameters<typeof ElapseError>[1] & { retryAfter?: number } = {}) {
    super(message, fields);
    this.retryAfter = fields.retryAfter;
  }
}
/** 5xx, unparseable bodies, network failures and timeouts (`code: "timeout"`). */
export class ElapseAPIError extends ElapseError {}
/** `constructEvent` refused the payload; the reason is in the message, never the body. */
export class ElapseSignatureVerificationError extends ElapseError {}
