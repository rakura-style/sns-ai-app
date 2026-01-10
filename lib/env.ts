/**
 * 環境変数の検証と型安全なアクセスを提供
 */

// 必須の環境変数リスト
const requiredEnvVars = {
  // Firebase クライアント側（NEXT_PUBLIC_プレフィックス）
  client: [
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
    'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    'NEXT_PUBLIC_FIREBASE_APP_ID',
  ],
  // Firebase Admin SDK（サーバー側）
  server: [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
  ],
  // Gemini API
  gemini: ['GEMINI_API_KEY', 'GOOGLE_GEMINI_API_KEY'], // どちらか一方があればOK
  // Stripe（オプション）
  stripe: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'], // オプション
};

/**
 * 環境変数の検証
 * @param env 検証する環境（'client' | 'server' | 'all'）
 * @returns 検証結果と不足している環境変数のリスト
 */
export function validateEnv(env: 'client' | 'server' | 'all' = 'all') {
  const missing: string[] = [];
  const warnings: string[] = [];

  // クライアント側の環境変数をチェック
  if (env === 'client' || env === 'all') {
    for (const key of requiredEnvVars.client) {
      if (!process.env[key]) {
        missing.push(key);
      }
    }
  }

  // サーバー側の環境変数をチェック
  if (env === 'server' || env === 'all') {
    for (const key of requiredEnvVars.server) {
      if (!process.env[key]) {
        missing.push(key);
      }
    }

    // Gemini APIキーのチェック（どちらか一方があればOK）
    const hasGeminiKey =
      process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
    if (!hasGeminiKey) {
      warnings.push('GEMINI_API_KEY または GOOGLE_GEMINI_API_KEY が設定されていません');
    }

    // Stripeのチェック（オプションなので警告のみ）
    if (!process.env.STRIPE_SECRET_KEY) {
      warnings.push('STRIPE_SECRET_KEY が設定されていません（Stripe機能は使用できません）');
    }
  }

  return {
    isValid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * 環境変数の検証を実行し、エラーがあれば例外をスロー
 * @param env 検証する環境
 * @throws 必須の環境変数が不足している場合
 */
export function requireEnv(env: 'client' | 'server' | 'all' = 'all') {
  const result = validateEnv(env);

  if (!result.isValid) {
    throw new Error(
      `Missing required environment variables: ${result.missing.join(', ')}`
    );
  }

  if (result.warnings.length > 0) {
    console.warn('Environment variable warnings:', result.warnings);
  }

  return result;
}

/**
 * 型安全な環境変数の取得
 */
export const env = {
  // Firebase クライアント側
  firebase: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
  },
  // Firebase Admin SDK
  firebaseAdmin: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    privateKey: process.env.FIREBASE_PRIVATE_KEY || '',
  },
  // Gemini API
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '',
  },
  // Stripe
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  // その他
  cronSecret: process.env.CRON_SECRET || '',
} as const;
