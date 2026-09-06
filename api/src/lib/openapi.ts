import { OpenAPIHono } from "@hono/zod-openapi";
import { ApiError } from "./errors";

/**
 * Every router is an `OpenAPIHono` with the same validation hook, so a Zod
 * failure becomes the FR-API-082 shape with `param` set to the offending
 * field (first issue wins, like Stripe).
 */
/**
 * FR-API-085: spread into a `createRoute` config to mark an operation as part of
 * the public reference (the frozen SDK surface). Everything unmarked stays in
 * the live `/openapi.json` but never reaches `api/openapi.json` or the docs.
 */
export const PUBLIC = { "x-public": true } as const;

export function router<E extends { Variables: object } = { Variables: {} }>() {
  return new OpenAPIHono<E>({
    defaultHook: (result, c) => {
      if (result.success) return;
      const issue = result.error.issues[0];
      // An unknown field names itself in `keys`, so `param` can point at it
      // (this is how an immutable `rate_usd_per_second` on update is reported).
      const unknownKey = issue && issue.code === "unrecognized_keys" ? (issue as { keys?: string[] }).keys?.[0] : undefined;
      const param = [...(issue?.path ?? []).map(String), ...(unknownKey ? [unknownKey] : [])].join(".") || undefined;
      const message = issue
        ? unknownKey
          ? `Received unknown parameter: ${param}`
          : param
            ? `Invalid ${param}: ${issue.message}`
            : issue.message
        : "Invalid request.";
      const err = new ApiError(400, "invalid_request_error", message, param);
      return c.json(err.toBody(), 400);
    },
  });
}
