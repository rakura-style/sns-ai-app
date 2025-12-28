import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';

// Facebook Graph APIを使って投稿する
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];

    if (!token || !adminAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;

    const { content, accessToken } = await req.json();

    if (!content || !accessToken) {
      return NextResponse.json({ error: 'Content and accessToken are required' }, { status: 400 });
    }

    // Facebook Graph APIを使って投稿
    // 注意: Facebook Graph API v18以降、テキストのみの投稿にはページのアクセストークンが必要
    // ユーザーのアクセストークンでは、URLを含む投稿のみ可能
    const response = await fetch(`https://graph.facebook.com/v18.0/me/feed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: content,
        access_token: accessToken,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Facebook API Error:', data);
      return NextResponse.json({ 
        error: data.error?.message || 'Facebookへの投稿に失敗しました',
        errorDetails: data.error
      }, { status: response.status });
    }

    return NextResponse.json({ 
      success: true, 
      postId: data.id,
      message: 'Facebookへの投稿が完了しました'
    });
  } catch (error: any) {
    console.error('Facebook post error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

