import type { NextConfig } from "next";

// The browser only ever talks to the Next.js origin. All /api/* requests are
// proxied server-side to the backend, so:
//   - cookies are first-party (no cross-origin/SameSite fragility),
//   - there is no CORS to configure,
//   - the app works from ANY device that can reach the frontend (a counter
//     tablet, a phone), not just the machine running the containers.
//
// BACKEND_URL is a *server-side* env var (never shipped to the browser).
// In Docker it's the backend service DNS name; for local dev it defaults to
// localhost:4000.
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";

// The Windows Store build runs from a read-only install folder, where Next's
// image optimizer cannot create its on-disk cache (.next/cache). Serve the few
// local images as-is there. Docker/CasaOS/dev builds keep optimisation.
const STORE_BUILD = process.env.NODEDR_STORE_BUILD === "1";

const nextConfig: NextConfig = {
  output: "standalone",
  ...(STORE_BUILD ? { images: { unoptimized: true } } : {}),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
      // MCP endpoint for AI agents / storefront automation (API-key auth).
      { source: "/mcp", destination: `${BACKEND_URL}/mcp` },
    ];
  },
};

export default nextConfig;
