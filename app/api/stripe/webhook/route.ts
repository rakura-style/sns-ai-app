import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebaseAdmin'; // 作成した管理者ツールを読み込み

// Stripeの初期化
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // TypeScriptの型定義エラーが出る場合があるため、as anyで回避します
  apiVersion: '2024-12-18.acacia' as any, 
});

// Stripeダッシュボードから取得したWebhookの秘密鍵
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: Request) {
  // 1. 通知の受け取り（生データをテキストとして取得）
  const body = await req.text();

  // 【修正ポイント】Next.js 15以降では headers() に await が必要です
  const headersList = await headers();
  const signature = headersList.get('stripe-signature') as string;

  let event: Stripe.Event;

  try {
    // 2. 署名の確認（Stripeからの正規のアクセスかチェック）
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // 3. 内容の確認: 「支払いが完了した」イベントか？
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    // 4. ユーザーの特定
    // ※Stripeの購入ページを作るときに、metadataにuserIdを入れておく必要があります
    const userId = session.metadata?.userId;

    if (userId) {
      console.log(`Payment success for user: ${userId}`);
      
      // 5. 台帳の更新 (Firebase Admin SDKを使用)
      await adminDb.collection('users').doc(userId).set({
        isSubscribed: true,      // 課金状態をON
        plan: 'pro',             // プラン名
        updatedAt: new Date(),   // 更新日時
        usageCount: 0            // 必要なら回数リセットなどの処理もここで行えます
      }, { merge: true });       // merge: true にすると、既存のデータを消さずに上書きします
    }
  }

  // 6. 完了報告 (Stripeに200 OKを返す)
  return NextResponse.json({ received: true });
}