import type { NextConfig } from "next";

const backend = new URL(process.env.SCROLLED_API_ORIGIN || "http://127.0.0.1:3001").origin;
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: backend + "/api/:path*" },
      { source: "/demo/:path*", destination: backend + "/demo/:path*" },
    ];
  },
};
export default config;
