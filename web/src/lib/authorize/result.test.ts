/**
 * FR-CHK-038 / FR-API-140(d): where the Elapse popup may send its result, and what it sends.
 */
import { describe, expect, it, vi } from "vitest";
import { postResult, resultTargetOrigin } from "./result";

describe("resultTargetOrigin", () => {
  it("FR_CHK_038_is_the_origin_of_the_sessions_success_url", () => {
    expect(resultTargetOrigin("https://shop.example/console?x=1")).toBe("https://shop.example");
  });

  it("FR_API_140_accepts_plain_http_only_for_localhost", () => {
    // Session creation already refuses non-https success URLs in live mode, so http here is always a test session.
    expect(resultTargetOrigin("http://localhost:3000/console")).toBe("http://localhost:3000");
    expect(resultTargetOrigin("http://127.0.0.1:3000/console")).toBe("http://127.0.0.1:3000");
    expect(resultTargetOrigin("http://shop.example/ok")).toBeNull();
    expect(resultTargetOrigin("javascript:alert(1)")).toBeNull();
    expect(resultTargetOrigin("not a url")).toBeNull();
  });
});

describe("postResult", () => {
  const result = { step: "authorised" as const, subscription: "sub_1", txHash: "0xabc", nonce: "n1" };

  it("FR_CHK_038_posts_only_the_step_subscription_hash_and_nonce_to_the_success_url_origin", () => {
    const opener = { postMessage: vi.fn() };
    expect(postResult({ opener, successUrl: "https://shop.example/ok", ...result })).toBe(true);
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: "elapse:result", step: "authorised", subscription: "sub_1", txHash: "0xabc", nonce: "n1" },
      "https://shop.example",
    );
  });

  it("FR_CHK_038_posts_nothing_without_an_opener_or_a_trusted_origin", () => {
    expect(postResult({ opener: null, successUrl: "https://shop.example/ok", ...result })).toBe(false);
    const opener = { postMessage: vi.fn() };
    expect(postResult({ opener, successUrl: "http://shop.example/ok", ...result })).toBe(false);
    expect(opener.postMessage).not.toHaveBeenCalled();
  });
});
