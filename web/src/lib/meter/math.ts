/**
 * The meter's money math lives in `@elapse/meter-core` (ADR 2026-09-17 meter math shared package),
 * shared with `@elapse/react`. Re-exported here so every `@/lib/meter/math` import keeps working.
 */
export * from "@elapse/meter-core";
