import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // eslintブロックは完全に削除してください
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;