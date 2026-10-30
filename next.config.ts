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
};

export default nextConfig;
