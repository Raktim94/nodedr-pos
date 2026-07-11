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

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
