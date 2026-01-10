import { NextResponse } from 'next/server';
import Stripe from 'stripe';
// パス解決エラーを防ぐため相対パスを使用
import { adminAuth, adminDb } from '../../../../lib/firebaseAdmin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia' as any,
});

export async function POST(req: Request) {
  try {
    // 1. 認証チェック
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];

    if (!token || !adminAuth) {
      return NextResponse.json({ error: '認証エラー' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;

    // 2. FirestoreからStripe顧客IDを取得
    const userDoc = await adminDb.collection('users').doc(userId).get();
    const userData = userDoc.data();

    if (!userData || !userData.stripeCustomerId) {
      return NextResponse.json({ error: '有料会員情報が見つかりません' }, { status: 404 });
    }

    // 3. カスタマーポータルセッションの作成
    // ユーザーをStripeの管理画面へ一時的に招待します
    const session = await stripe.billingPortal.sessions.create({
      customer: userData.stripeCustomerId,
      return_url: `${req.headers.get('origin')}/`, // 管理画面から戻ってくるURL
    });

    return NextResponse.json({ url: session.url });

  } catch (error: any) {
    console.error('Portal Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}