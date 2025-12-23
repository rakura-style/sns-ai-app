import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
// 🔥 修正: 相対パスではなく、推奨されるエイリアス(@/)を使用
import { adminDb } from '@/lib/firebaseAdmin'; 
import * as admin from 'firebase-admin';

// Gemini APIの初期化
// 環境変数名が GEMINI_API_KEY で設定されている前提です
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY!);

export async function POST(req: Request) {
  try {
    // ---------------------------------------------------------
    // 1. 入館証（トークン）の確認
    // ---------------------------------------------------------
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];

    if (!token) {
      return new NextResponse(JSON.stringify({ error: 'Unauthorized: No token' }), { status: 401 });
    }

    // IDトークンの検証
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;


    // ---------------------------------------------------------
    // 2. リクエスト情報の取得
    // ---------------------------------------------------------
    const { prompt, actionType } = await req.json(); // actionType: 'post' | 'theme'


    // ---------------------------------------------------------
    // 3. ユーザー情報の取得 & 月次リセット判定
    // ---------------------------------------------------------
    // 🔥 エラー回避: DB接続が確立されていない場合は処理を中断
    if (!adminDb || typeof adminDb.collection !== 'function') {
       console.error('Firebase Admin DB not initialized. Check FIREBASE_PRIVATE_KEY.');
       return new NextResponse(JSON.stringify({ error: 'Service Unavailable: Database connection failed' }), { status: 503 });
    }

    const userDocRef = adminDb.collection('users').doc(userId);
    const userDoc = await userDocRef.get();
    const userData = userDoc.exists ? userDoc.data() : {};
    
    const isSubscribed = userData?.isSubscribed === true; // 有料会員か？

    // 月が変わっていたらリセットするロジック
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${now.getMonth() + 1}`; // 例: "2023-12"
    const lastUsageMonth = userData?.lastUsageMonth || "";

    let usageCount = userData?.usageCount || 0;

    // もし月が変わっていたら、カウントを0とみなす
    if (lastUsageMonth !== currentMonth) {
      usageCount = 0;
    }


    // ---------------------------------------------------------
    // 4. 利用制限のチェック (投稿作成の時のみ)
    // ---------------------------------------------------------
    // ※ クライアント側(page.tsx)でも1日100回制限を入れていますが、
    //    サーバー側では「月5回制限（無料会員）」というビジネスロジックが優先されます。
    if (actionType === 'post' && !isSubscribed && usageCount >= 5) {
      return new NextResponse(
        JSON.stringify({ error: 'Free limit reached' }), 
        { status: 403 }
      );
    }


    // ---------------------------------------------------------
    // 5. AI生成の実行 (エラーハンドリング強化)
    // ---------------------------------------------------------
    // 使用モデルを Gemini 2.5 Flash Lite に設定
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' }); 
    
    let text = '';

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        text = response.text();
    } catch (apiError: any) {
        console.error('Gemini API Error:', apiError);
        
        // 🔥 レート制限(429)やQuota不足のエラーをクライアントに正しく伝える
        if (apiError.status === 429 || apiError.message?.includes('429') || apiError.message?.includes('Quota')) {
            return new NextResponse(
                JSON.stringify({ error: 'Too Many Requests', details: apiError.message }),
                { status: 429 }
            );
        }
        throw apiError; // その他のエラーは外側のcatchへ
    }


    // ---------------------------------------------------------
    // 6. 回数の記録 (投稿作成の時のみ)
    // ---------------------------------------------------------
    if (actionType === 'post' && !isSubscribed) {
      // 月が変わっていた場合: カウントを1にリセットし、月を更新
      if (lastUsageMonth !== currentMonth) {
        await userDocRef.set({
          usageCount: 1,
          lastUsageMonth: currentMonth
        }, { merge: true });
      } 
      // 同じ月の場合: カウントを+1する
      else {
        await userDocRef.set({
          usageCount: admin.firestore.FieldValue.increment(1)
        }, { merge: true });
      }
    }

    return NextResponse.json({ text });

  } catch (error: any) {
    console.error('API Error:', error);
    // エラー内容をJSONで返すように統一
    return new NextResponse(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}