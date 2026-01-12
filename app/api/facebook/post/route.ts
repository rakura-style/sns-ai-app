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

    // セキュリティ: 入力値の検証
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    // セキュリティ: コンテンツの長さ制限（Facebookの投稿制限: 63,206文字）
    if (content.length > 63206) {
      return NextResponse.json({ error: 'Content exceeds maximum length' }, { status: 400 });
    }

    // セキュリティ: 空文字列のチェック
    if (content.trim().length === 0) {
      return NextResponse.json({ error: 'Content cannot be empty' }, { status: 400 });
    }

    if (!accessToken || typeof accessToken !== 'string') {
      return NextResponse.json({ error: 'AccessToken is required' }, { status: 400 });
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
      // セキュリティ: 詳細なエラー情報をクライアントに返さない
      // ユーザー向けの汎用的なメッセージのみを返す
      return NextResponse.json({ 
        error: 'Facebookへの投稿に失敗しました'
      }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      postId: data.id,
      message: 'Facebookへの投稿が完了しました'
    });
  } catch (error: any) {
    console.error('Facebook post error:', error);
    // セキュリティ: 詳細なエラー情報をクライアントに返さない
    // 認証エラーの場合は詳細を返す
    if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
      return NextResponse.json({ 
        error: '認証エラーが発生しました。再度ログインしてください。'
      }, { status: 401 });
    }
    // その他のエラーは汎用的なメッセージを返す
    return NextResponse.json({ 
      error: 'Facebookへの投稿に失敗しました'
    }, { status: 500 });
  }
}


