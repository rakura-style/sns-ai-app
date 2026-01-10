import * as admin from 'firebase-admin';
import { validateEnv } from './env';

// アプリがまだ初期化されておらず、かつ環境変数がある場合のみ初期化
if (!admin.apps.length) {
  // 環境変数の検証（サーバー側のみ）
  const envCheck = validateEnv('server');
  
  if (envCheck.isValid && 
      process.env.FIREBASE_PROJECT_ID && 
      process.env.FIREBASE_CLIENT_EMAIL && 
      process.env.FIREBASE_PRIVATE_KEY) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Vercel上で改行コードを正しく読み込むための処理
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    } catch (error) {
      console.error('Firebase Admin initialization error:', error);
    }
  } else if (!envCheck.isValid) {
    console.warn('Firebase Admin SDK: Missing required environment variables:', envCheck.missing);
  }
}

// 初期化に失敗している場合（ビルド時など）はダミーを返すか、undefinedにする
// これにより、ビルド中に強制終了するのを防ぎます
const adminDb = admin.apps.length ? admin.firestore() : {} as FirebaseFirestore.Firestore;
const adminAuth = admin.apps.length ? admin.auth() : {} as admin.auth.Auth;

export { adminDb, adminAuth };