import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // eslintブロックは完全に削除してください
  typescript: {
    ignoreBuildErrors: true,
  },
  // CORS設定: APIエンドポイントへのアクセスを制限
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization',
          },
          // XSS保護
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ];
  },
};

export default nextConfig;