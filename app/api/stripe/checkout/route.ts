import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminAuth } from '@/lib/firebaseAdmin';

// Stripe の初期化
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16' as any,
});

export async function POST(req: Request) {
  try {
    // 1. ヘッダーから認証トークンを取得
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];

    if (!token || !adminAuth) {
      return NextResponse.json(
        { error: '認証トークンが見つからないか、Firebase Admin が未設定です' },
        { status: 401 }
      );
    }

    // 2. Firebase Admin でトークンを検証し、ユーザーIDを取得
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;
    const userEmail = decodedToken.email;

    // 3. Stripe Checkout セッションを作成
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          // ⚠️ ここに Stripe ダッシュボードで取得した「価格ID（price_...）」を貼り付けてください
          price: 'price_1SeuU8CF3PejR9RoqC1V1RJz', 
          quantity: 1,
        },
      ],
      mode: 'subscription', // サブスクリプションモード
      // 決済完了後とキャンセル後の戻り先 URL (origin は自動で Vercel の URL になります)
      success_url: `${req.headers.get('origin')}/?success=true`,
      cancel_url: `${req.headers.get('origin')}/`,
      customer_email: userEmail,
      client_reference_id: userId, // Webhook でユーザーを特定するために必須の項目
      metadata: {
        userId: userId,
      },
    });

    // 生成された決済ページの URL をクライアントに返す
    return NextResponse.json({ url: session.url });

  } catch (error: any) {
    console.error('Stripe Checkout Error:', error);
    return NextResponse.json(
      { error: error.message || '内部サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}