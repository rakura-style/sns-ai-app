import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";

// Vercelの環境変数から取得
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// サーバーサイドでの初期化を完全に回避
let app: FirebaseApp | null = null;
let auth: Auth | null = null;

if (typeof window !== "undefined") {
  // クライアントサイドでのみ初期化
  if (!firebaseConfig.apiKey) {
    console.error("❌ Firebase API Key が設定されていません");
  } else {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
  }
} else {
  // サーバーサイド（ビルド時）では警告のみ
  if (!firebaseConfig.apiKey) {
    console.warn("⚠️ ビルド時: Firebase環境変数が未設定です（Vercelの環境変数を確認してください）");
  }
}

export { auth };
export default app;