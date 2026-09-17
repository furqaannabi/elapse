import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @elapse/react/math is TypeScript source shared with the SDK (ADR 2026-09-17 meter math inside react SDK).
  transpilePackages: ["@elapse/react"],
};

export default nextConfig;
