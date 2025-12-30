import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { TwitterApi } from 'twitter-api-v2';
import * as admin from 'firebase-admin';

// Vercel Cron Jobsの設定
export const config = {
  runtime: 'nodejs',
};

// 予約投稿のチェックと実行（サーバー側で定期実行）
// Vercel Cron Jobsから呼び出される
export async function GET(req: Request) {
  try {
    // Vercel Cron Jobsからのリクエストを認証
    // Vercel Cron Jobsは自動的に`x-vercel-cron`ヘッダーを送信する
    const cronHeader = req.headers.get('x-vercel-cron');
    const cronSecret = process.env.CRON_SECRET;
    
    // 環境変数CRON_SECRETが設定されている場合はそれを使用、なければx-vercel-cronヘッダーをチェック
    if (cronSecret) {
      const authHeader = req.headers.get('authorization');
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else if (!cronHeader) {
      // CRON_SECRETが設定されていない場合、x-vercel-cronヘッダーのみで認証
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!adminDb || typeof adminDb.collection !== 'function') {
      return NextResponse.json({ error: 'Database not initialized' }, { status: 503 });
    }

    const now = admin.firestore.Timestamp.now();
    const nowDate = new Date();
    
    // 実行時刻が来た予約投稿を取得（全ユーザー）
    // 注意: 大量のユーザーがいる場合は、バッチ処理やインデックス最適化が必要
    const usersRef = adminDb.collection('users');
    const usersSnapshot = await usersRef.get();
    
    let totalProcessed = 0;
    const results: any[] = [];
    
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      
      // ユーザーのX API認証情報を取得
      const userData = userDoc.data();
      
      if (!userData?.xApiKey || !userData?.xApiKeySecret || 
          !userData?.xAccessToken || !userData?.xAccessTokenSecret) {
        // X API認証情報がないユーザーはスキップ
        continue;
      }

      // 実行時刻が来た予約投稿を取得
      const scheduledPostsRef = adminDb.collection('users').doc(userId).collection('scheduledPosts');
      const postsSnapshot = await scheduledPostsRef
        .where('posted', '==', false)
        .where('scheduledAt', '<=', now)
        .get();
      
      if (postsSnapshot.empty) {
        continue;
      }

      // X APIクライアントを作成
      const twitterClient = new TwitterApi({
        appKey: userData.xApiKey,
        appSecret: userData.xApiKeySecret,
        accessToken: userData.xAccessToken,
        accessSecret: userData.xAccessTokenSecret,
      });
      
      for (const postDoc of postsSnapshot.docs) {
        const post = postDoc.data();
        const destinations = post.destinations || ['x'];
        
        for (const destination of destinations) {
          if (destination === 'x') {
            try {
              // X APIで投稿
              const tweet = await twitterClient.v2.tweet(post.content);
              
              // 投稿済みフラグを更新
              await postDoc.ref.update({ 
                posted: true,
                postedAt: admin.firestore.FieldValue.serverTimestamp(),
                tweetId: tweet.data.id
              });
              
              totalProcessed++;
              results.push({ 
                userId, 
                postId: postDoc.id, 
                success: true, 
                tweetId: tweet.data.id 
              });
              
              console.log(`予約投稿成功: userId=${userId}, postId=${postDoc.id}, tweetId=${tweet.data.id}`);
            } catch (error: any) {
              console.error(`予約投稿エラー (userId=${userId}, postId=${postDoc.id}):`, error);
              results.push({ 
                userId, 
                postId: postDoc.id, 
                success: false, 
                error: error.message 
              });
            }
          }
        }
      }
    }

    return NextResponse.json({ 
      success: true,
      timestamp: nowDate.toISOString(),
      postsProcessed: totalProcessed,
      results 
    });
  } catch (error: any) {
    console.error('Check scheduled posts error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

