import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace TypeScript package shared with @elapse/react (ADR 2026-09-17 meter math shared package).
  transpilePackages: ["@elapse/meter-core"],
};

export default nextConfig;
