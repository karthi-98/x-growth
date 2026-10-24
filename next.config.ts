import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
