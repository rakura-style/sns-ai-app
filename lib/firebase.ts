import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// Vercelの環境変数から取得
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// --- デバッグ用チェック ---
if (typeof window === "undefined") {
  // ビルド時（サーバー側）にキーがない場合にログを出す
  if (!firebaseConfig.apiKey) {
    console.warn("⚠️ Warning: NEXT_PUBLIC_FIREBASE_API_KEY が設定されていません。");
  }
}

// 初期化。APIキーがない場合はnullを返すようにしてビルドエラーを防ぐ
let app;
if (firebaseConfig.apiKey) {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export const auth = app ? getAuth(app) : null;
export default app;