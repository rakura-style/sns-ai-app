import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';

// X API v2を使って投稿する
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];

    if (!token || !adminAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;

    const { content, accessToken, apiKey, apiSecret } = await req.json();

    if (!content) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    // X API v2を使って投稿
    // OAuth 2.0のアクセストークンを使用
    const response = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        text: content,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('X API Error:', data);
      return NextResponse.json({ 
        error: data.detail || data.title || 'Xへの投稿に失敗しました',
        errorDetails: data
      }, { status: response.status });
    }

    return NextResponse.json({ 
      success: true, 
      tweetId: data.data?.id,
      message: 'Xへの投稿が完了しました'
    });
  } catch (error: any) {
    console.error('X post error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

