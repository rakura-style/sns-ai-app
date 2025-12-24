import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// 変数の初期値をダミーで設定（ビルド落ち防止）
let app;
let auth;
let db;

// APIキーが存在する場合のみ初期化を実行する
if (typeof window !== 'undefined' && firebaseConfig.apiKey) {
  // クライアントサイド（ブラウザ）かつキーがある場合
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
  db = getFirestore(app);
} else {
  // サーバーサイド（ビルド中）またはキーがない場合
  // エラーにならないよう、一旦ダミーのオブジェクトを入れておく
  // ※型エラー回避のため as any を使用
  app = {} as any;
  auth = {} as any;
  db = {} as any;
}

export { auth, db };
export default app;