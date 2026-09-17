/**
 * The meter's money math lives in `@elapse/react` (ADR 2026-09-17 meter math inside react SDK), shared
 * with every merchant's meter. Re-exported here so every `@/lib/meter/math` import keeps working.
 */
export * from "@elapse/react/math";
