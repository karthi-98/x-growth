import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Self-contained server (.next/standalone/server.js) for the per-OS release
  // bundles that `xstats start` runs (docs/ARCHITECTURE.md section 9).
  output: "standalone",
  // Releases are public: never trace user data or built bundles into the
  // server, even when a runtime path looks static (lib/runtime lists
  // data/backups). install/pack.ts checks this again before archiving.
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./dist/**/*"],
  },
  // The trace keeps Next's page runtimes but drops the route-handler one, so
  // /favicon.ico and route handlers fail in a bundle (a source checkout
  // hides this: Node falls back to the repo's full node_modules).
  outputFileTracingIncludes: {
    "/*": ["./node_modules/next/dist/compiled/next-server/app-route-turbo*.runtime.prod.js"],
  },
  // libSQL ships a native binary; load it from node_modules at runtime.
  serverExternalPackages: ["@libsql/client", "libsql"],
  cacheComponents: true,
  // Keep the dev badge clear of the sidebar footer (theme button).
  devIndicators: { position: "bottom-right" },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default nextConfig
