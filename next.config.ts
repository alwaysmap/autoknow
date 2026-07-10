import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This project is a git worktree nested inside the main checkout, so two
  // package-lock.json files exist (here and in the parent). Without pinning the
  // root, Turbopack walks up, picks the PARENT as the workspace root, and resolves
  // modules from the parent's node_modules — which lacks this worktree's deps
  // (next-auth, @google/genai). Pin the root to this directory.
  turbopack: {
    root: __dirname,
  },
  // The Playwright suite boots its own server (port 3100, test database) while the dev
  // server may be running on :3000 — a separate build dir keeps them from corrupting
  // each other's .next output.
  distDir: process.env.NEXT_DIST_DIR || undefined,
};

export default nextConfig;
