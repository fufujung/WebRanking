import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const config: NextConfig = {
  // Uploaded images live on the API server; serve them from this site's origin too.
  async rewrites() {
    return [{ source: "/uploads/:file", destination: `${apiUrl}/uploads/:file` }];
  },
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default config;
