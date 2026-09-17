/**
 * FR-RCT-003 / BR-RCT-002: the provider takes a publishable key and refuses anything else, and a
 * secret key in the browser is called out by name.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ElapseProvider } from "../src";

describe("ElapseProvider · FR-RCT-003", () => {
  it("FR_RCT_003_renders_children_with_a_publishable_key", () => {
    render(<ElapseProvider publishableKey="pk_test_abc"><p>inside</p></ElapseProvider>);
    expect(screen.getByText("inside")).toBeTruthy();
  });

  it("FR_RCT_003_a_secret_key_throws_and_says_why", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ElapseProvider publishableKey="sk_test_abc"><p>x</p></ElapseProvider>)).toThrow("Never put a secret key in the browser.");
  });

  it("FR_RCT_003_anything_that_is_not_a_publishable_key_throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ElapseProvider publishableKey="whsec_abc"><p>x</p></ElapseProvider>)).toThrow(/publishable key/);
  });
});
