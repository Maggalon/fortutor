import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  devIndicators: false,
  poweredByHeader: false,
  serverExternalPackages: ["pg", "bullmq", "ioredis"],
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*", "./.env*", "./tests/**/*"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};
export default config;
