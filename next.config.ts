import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PostHog reverse proxy (see src/instrumentation-client.ts).
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ];
  },
  skipTrailingSlashRedirect: true,
  // A lockfile in a parent folder (e.g. ~/package-lock.json) otherwise makes Turbopack pick the wrong root in dev.
  turbopack: { root: __dirname },
  // The depth 5 bot (local/neural) reads its weights from disk at run time.
  outputFileTracingIncludes: {
    "/api/cron/tick": ["./src/lib/neural/depth5.nnue"],
    "/api/games/start": ["./src/lib/neural/depth5.nnue"],
    "/api/games/[id]/move": ["./src/lib/neural/depth5.nnue"],
  },
};

export default nextConfig;
