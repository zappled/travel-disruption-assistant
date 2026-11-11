import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Hide the dev-only "N" route indicator (it covered the Log out link).
  // Compile/runtime errors are still shown.
  devIndicators: false,
  // Shared constants (e.g. TIME_WINDOWS) are imported from the API package's TS source.
  transpilePackages: ["@tda/api"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Proxy /api/* to the Express backend so the browser never needs CORS.
  rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
