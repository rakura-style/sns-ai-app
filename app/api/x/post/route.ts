import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';
import { TwitterApi } from 'twitter-api-v2';

// X API v2を使って投稿する（OAuth 1.0a認証）
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];

    if (!token || !adminAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;

    const { content, apiKey, apiKeySecret, accessToken, accessTokenSecret } = await req.json();

    if (!content) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
      return NextResponse.json({ error: 'All X API credentials are required' }, { status: 400 });
    }

    // Twitter API v2クライアントを作成（OAuth 1.0a認証）
    const client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiKeySecret,
      accessToken: accessToken,
      accessSecret: accessTokenSecret,
    });

    // ツイートを投稿
    const tweet = await client.v2.tweet(content);

    return NextResponse.json({ 
      success: true, 
      tweetId: tweet.data.id,
      message: 'Xへの投稿が完了しました'
    });
  } catch (error: any) {
    console.error('X post error:', error);
    // セキュリティ: 詳細なエラー情報をクライアントに返さない
    // 認証エラーの場合は詳細を返す
    if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
      return NextResponse.json({ 
        error: '認証エラーが発生しました。再度ログインしてください。'
      }, { status: 401 });
    }
    // その他のエラーは汎用的なメッセージを返す
    return NextResponse.json({ 
      error: 'Xへの投稿に失敗しました'
    }, { status: 500 });
  }
}

