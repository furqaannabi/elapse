import { defineConfig } from "vitest/config";

// The listen tests open real sockets; on a cold CI runner the first stream can take seconds.
export default defineConfig({ test: { testTimeout: 30_000 } });
