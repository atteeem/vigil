import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Playwright suite builds into its own dir (see playwright.config.ts) so
  // its server never fights the normal dev server for .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
