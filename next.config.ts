import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for containerized deploys (Cloud Run): .next/standalone
  // ships only the traced runtime deps + server.js, keeping the image small.
  output: 'standalone',
  // Trace up from this worktree (it's nested in a parent checkout); without it,
  // standalone tracing can miss/mis-root modules.
  outputFileTracingRoot: __dirname,
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
  // Programs are the entity; detail pages moved from /projects/[id] to /programs/[id].
  // Old bookmarks and externally shared links keep working.
  async redirects() {
    return [
      { source: '/projects/:path*', destination: '/programs/:path*', permanent: true },
    ];
  },
  // The app is served publicly through a Tailscale Funnel — baseline security
  // headers are non-negotiable. CSP notes: Next's bootstrap + React inline styles
  // need 'unsafe-inline'; dev additionally needs 'unsafe-eval' (react-refresh).
  // No third-party origins are loaded — everything else is 'self'.
  async headers() {
    const dev = process.env.NODE_ENV !== 'production';
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default nextConfig;
