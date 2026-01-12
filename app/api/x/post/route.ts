import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';
import { TwitterApi } from 'twitter-api-v2';

// セキュリティ: CORS設定
const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// OPTIONSリクエストのハンドリング（CORSプリフライト）
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

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

    // セキュリティ: 入力値の検証
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    // セキュリティ: コンテンツの長さ制限（Xの投稿制限: 280文字）
    if (content.length > 280) {
      return NextResponse.json({ error: 'Content exceeds maximum length (280 characters)' }, { status: 400 });
    }

    // セキュリティ: 空文字列のチェック
    if (content.trim().length === 0) {
      return NextResponse.json({ error: 'Content cannot be empty' }, { status: 400 });
    }

    // セキュリティ: 認証情報の検証
    if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
      return NextResponse.json({ error: 'All X API credentials are required' }, { status: 400 });
    }

    // セキュリティ: 認証情報の形式検証（基本的な形式チェック）
    if (typeof apiKey !== 'string' || typeof apiKeySecret !== 'string' || 
        typeof accessToken !== 'string' || typeof accessTokenSecret !== 'string') {
      return NextResponse.json({ error: 'Invalid credential format' }, { status: 400 });
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
    }, {
      headers: corsHeaders,
    });
  } catch (error: any) {
    console.error('X post error:', error);
    // セキュリティ: 詳細なエラー情報をクライアントに返さない
    // 認証エラーの場合は詳細を返す
    if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
      return NextResponse.json({ 
        error: '認証エラーが発生しました。再度ログインしてください。'
      }, { 
        status: 401,
        headers: corsHeaders,
      });
    }
    // その他のエラーは汎用的なメッセージを返す（セキュリティ: 詳細なエラー情報を返さない）
    return NextResponse.json({ 
      error: 'Xへの投稿に失敗しました'
    }, { 
      status: 500,
      headers: corsHeaders,
    });
  }
}

