import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* ビルド時の型チェックをスキップ */
  typescript: {
    ignoreBuildErrors: true,
  },
  /* ビルド時のESLintチェックをスキップ */
  eslint: {
    ignoreDuringBuilds: true,
  },
  /* StripeやFirebase Adminなど、
     サーバーサイド専用のパッケージをバンドル対象から除外してビルドを安定させます
  */
  serverExternalPackages: ["stripe", "firebase-admin"],
};

export default nextConfig;