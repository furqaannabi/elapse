import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("FR-EXM-002 npm start without a key", () => {
  it("exits 1 and prints the sentence naming the variable", () => {
    // DOTENV_CONFIG_PATH points at nothing, so a developer's own .env cannot leak into the test.
    const r = spawnSync("node", ["--import", "tsx", "src/index.ts"], { env: { PATH: process.env.PATH, ELAPSE_API_URL: "http://localhost:1", DOTENV_CONFIG_PATH: "/dev/null" }, encoding: "utf8", timeout: 20_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ELAPSE_SECRET_KEY is missing. Dashboard → Developers → API keys → Create.");
  });
});
