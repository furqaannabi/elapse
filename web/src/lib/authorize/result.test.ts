/**
 * FR-CHK-038 / FR-API-140(d): where the Elapse popup may send its result, and what it sends.
 */
import { describe, expect, it, vi } from "vitest";
import { postResult, resultTargetOrigin } from "./result";

describe("resultTargetOrigin", () => {
  it("FR_CHK_038_is_the_origin_of_the_sessions_success_url", () => {
    expect(resultTargetOrigin("https://shop.example/console?x=1", { livemode: true })).toBe("https://shop.example");
  });

  it("FR_API_140_refuses_plain_http_except_localhost_in_test_mode", () => {
    expect(resultTargetOrigin("http://shop.example/ok", { livemode: false })).toBeNull();
    expect(resultTargetOrigin("http://localhost:3000/console", { livemode: false })).toBe("http://localhost:3000");
    expect(resultTargetOrigin("http://localhost:3000/console", { livemode: true })).toBeNull();
    expect(resultTargetOrigin("not a url", { livemode: false })).toBeNull();
  });
});

describe("postResult", () => {
  const result = { step: "authorised" as const, subscription: "sub_1", txHash: "0xabc", nonce: "n1" };

  it("FR_CHK_038_posts_only_the_step_subscription_hash_and_nonce_to_the_success_url_origin", () => {
    const opener = { postMessage: vi.fn() };
    expect(postResult({ opener, successUrl: "https://shop.example/ok", livemode: true, ...result })).toBe(true);
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: "elapse:result", step: "authorised", subscription: "sub_1", txHash: "0xabc", nonce: "n1" },
      "https://shop.example",
    );
  });

  it("FR_CHK_038_posts_nothing_without_an_opener_or_a_trusted_origin", () => {
    expect(postResult({ opener: null, successUrl: "https://shop.example/ok", livemode: true, ...result })).toBe(false);
    const opener = { postMessage: vi.fn() };
    expect(postResult({ opener, successUrl: "http://shop.example/ok", livemode: true, ...result })).toBe(false);
    expect(opener.postMessage).not.toHaveBeenCalled();
  });
});
