import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const config: NextConfig = {
  // Optional isolated output for a second local preview; production uses Next's default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Uploaded images live on the API server; serve them from this site's origin too.
  async rewrites() {
    return [{ source: "/uploads/:file", destination: `${apiUrl}/uploads/:file` }];
  },
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  poweredByHeader: false,
  // Hardening for every page: no framing (clickjacking), no content sniffing, no plugins,
  // only https once a browser has seen the site over https, and no camera/mic/location access.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
};

export default config;
