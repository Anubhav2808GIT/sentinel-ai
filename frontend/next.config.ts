import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: bundles only required files — optimal for Docker/Railway/Render
  output: "standalone",

  // Disable source maps in production for smaller bundle + no code exposure
  productionBrowserSourceMaps: false,

  // Allow images from external placeholder hosts (update with your CDN in production)
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "via.placeholder.com" },
    ],
  },

  // Expose environment variables to the browser bundle
  // NEXT_PUBLIC_* vars are automatically included; listing them here for clarity
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002",
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8003/ws",
    NEXT_PUBLIC_DEPLOYMENT_ENV: process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? "development",
    NEXT_PUBLIC_IS_PUBLIC_DEMO: process.env.NEXT_PUBLIC_IS_PUBLIC_DEMO ?? "false",
  },
};

export default nextConfig;
