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
  /* サーバーサイド専用パッケージをバンドル対象から除外。
    これによりビルド時のハングアップや依存関係のエラーを防止します。
  */
  serverExternalPackages: ["stripe", "firebase-admin"],
};

export default nextConfig;