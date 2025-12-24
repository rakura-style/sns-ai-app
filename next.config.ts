/** @type {import('next').NextConfig} */
const nextConfig = {
  /* ビルド時の型チェックをスキップ */
  typescript: {
    ignoreBuildErrors: true,
  },
  /* ビルド時のESLintチェックをスキップ */
  eslint: {
    ignoreDuringBuilds: true,
  },
  /* サーバーサイド専用パッケージをバンドル対象から除外 */
  serverExternalPackages: ["stripe", "firebase-admin"],
};

export default nextConfig;