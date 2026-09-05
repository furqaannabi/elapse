import { OpenAPIHono } from "@hono/zod-openapi";
import { ApiError } from "./errors";

/**
 * Every router is an `OpenAPIHono` with the same validation hook, so a Zod
 * failure becomes the FR-API-082 shape with `param` set to the offending
 * field (first issue wins, like Stripe).
 */
export function router<E extends { Variables: object } = { Variables: {} }>() {
  return new OpenAPIHono<E>({
    defaultHook: (result, c) => {
      if (result.success) return;
      const issue = result.error.issues[0];
      const param = issue?.path.map(String).join(".") || undefined;
      const message = issue
        ? param
          ? `Invalid ${param}: ${issue.message}`
          : issue.message
        : "Invalid request.";
      const err = new ApiError(400, "invalid_request_error", message, param);
      return c.json(err.toBody(), 400);
    },
  });
}
