import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

/**
 * クライアント（ブラウザ）側で使用するFirebase設定です。
 * 環境変数は .env.local または Vercel の Settings で設定してください。
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// アプリの初期化（二重初期化を防止）
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// 他のファイルから利用できるようにエクスポート
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;