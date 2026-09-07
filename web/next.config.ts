import type { NextConfig } from "next";
import path from "node:path";

const apiOrigin = process.env.HEALTH_API_ORIGIN ?? "http://127.0.0.1:4310";
const config: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: path.resolve(process.cwd()) },
  async rewrites() { return [{ source: "/api/v1/:path*", destination: `${apiOrigin}/api/v1/:path*` }]; },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Frame-Options", value: "DENY" }] }];
  },
};
export default config;
