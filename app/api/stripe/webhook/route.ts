import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
// パス解決エラーを防ぐため相対パスを使用
import { adminDb } from '../../../../lib/firebaseAdmin'; 

// Stripeの初期化
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // ユーザー様ご指定の最新バージョン
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
    console.error(`Webhook Signature Error: ${err.message}`);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // 3. イベント処理
  const session = event.data.object as Stripe.Checkout.Session;
  const subscription = event.data.object as Stripe.Subscription;

  try {
    // ✅ 決済完了時（有料プラン開始）
    if (event.type === 'checkout.session.completed') {
      // client_reference_id または metadata.userId のどちらかがある方を使う
      const userId = session.client_reference_id || session.metadata?.userId;

      if (userId) {
        console.log(`Payment success for user: ${userId}`);
        
        // 5. 台帳の更新 (Firebase Admin SDKを使用)
        await adminDb.collection('users').doc(userId).set({
          isSubscribed: true,        // 課金状態をON
          plan: 'pro',               // プラン名
          stripeCustomerId: session.customer, // 顧客ID（重要）
          stripeSubscriptionId: session.subscription, // サブスクID（解約時に必要）
          updatedAt: new Date(),     // 更新日時
          usageCount: 0              // 制限回数をリセット
        }, { merge: true });
      } else {
        console.error('User ID missing in session');
      }
    }

    // ❌ サブスクリプション削除時（解約・支払い失敗による強制終了）
    if (event.type === 'customer.subscription.deleted') {
      // サブスクIDを使ってユーザーを特定
      const usersSnap = await adminDb.collection('users')
        .where('stripeSubscriptionId', '==', subscription.id)
        .get();

      if (!usersSnap.empty) {
        // 該当するユーザーを無料会員に戻す
        const batch = adminDb.batch();
        usersSnap.forEach((doc) => {
          batch.update(doc.ref, { 
            isSubscribed: false,
            plan: 'free',
            updatedAt: new Date()
          });
          console.log(`Unsubscribing user: ${doc.id}`);
        });
        await batch.commit();
      } else {
        console.log('No user found for deleted subscription');
      }
    }

  } catch (err: any) {
    console.error(`Database Update Error: ${err.message}`);
    return new NextResponse('Internal Server Error', { status: 500 });
  }

  // 6. 完了報告 (Stripeに200 OKを返す)
  return NextResponse.json({ received: true });
}