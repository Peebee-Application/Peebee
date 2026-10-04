import type { NextConfig } from "next";
// Plain .mjs shared by all three apps — see that file for what the policy
// does and doesn't cover.
import { securityHeaderRules } from "../../packages/shared/security-headers.mjs";

const nextConfig: NextConfig = {
  // Limit build workers on small deployment machines without slowing CI.
  experimental: {
    cpus: process.env.PEEBEE_BUILD_CPUS ? Math.max(1, Number.parseInt(process.env.PEEBEE_BUILD_CPUS, 10) || 1) : undefined,
  },
  output: "standalone",
  transpilePackages: ["@peebee/shared"],
  images: {
    unoptimized: true,
  },
  async headers() {
    return securityHeaderRules({
      apiUrl: process.env.NEXT_PUBLIC_API_URL,
      dev: process.env.NODE_ENV === "development",
    });
  },
  webpack(config) {
    // @peebee/shared uses explicit ".js" extensions on relative imports (required by
    // its NodeNext consumer, apps/api) even though the files are ".ts" — teach
    // webpack to resolve those the way Node's ESM loader does.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
