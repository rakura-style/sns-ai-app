/* eslint-disable */
// @ts-nocheck

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ビルド時のESLintチェックを無視
  eslint: {
    ignoreDuringBuilds: true,
  },
  // TypeScriptのエラーを無視
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;