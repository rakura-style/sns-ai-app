import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

// noteプロフィールページから記事URL一覧を取得
export async function POST(request: NextRequest) {
  try {
    const { noteUrl } = await request.json();
    
    if (!noteUrl) {
      return NextResponse.json(
        { error: 'note URLが必要です' },
        { status: 400 }
      );
    }
    
    // URLの検証
    let normalizedUrl = noteUrl.trim();
    if (normalizedUrl.endsWith('/')) {
      normalizedUrl = normalizedUrl.slice(0, -1);
    }
    
    try {
      new URL(normalizedUrl);
    } catch (e) {
      return NextResponse.json(
        { error: '無効なURLです' },
        { status: 400 }
      );
    }
    
    // noteのURLパターンを解析
    // https://note.com/username または https://note.com/username/n/nnnnnnnnnnnn
    const noteMatch = normalizedUrl.match(/https?:\/\/note\.com\/([^\/]+)/);
    if (!noteMatch) {
      return NextResponse.json(
        { error: 'noteのURL形式が正しくありません。プロフィールURL（例: https://note.com/username）を入力してください' },
        { status: 400 }
      );
    }
    
    const username = noteMatch[1];
    const profileUrl = `https://note.com/${username}`;
    
    const articleUrls: Array<{ url: string; date: string; title?: string }> = [];
    const urlSet = new Set<string>(); // 重複チェック用
    
    try {
      // プロフィールページから記事URLを取得
      const response = await fetch(profileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(30000), // 30秒タイムアウト
      });
      
      if (!response.ok) {
        return NextResponse.json(
          { error: `プロフィールページの取得に失敗しました: ${response.status}` },
          { status: response.status }
        );
      }
      
      const html = await response.text();
      
      // note記事のURLパターン: /username/n/nnnnnnnnnnnn
      const noteUrlPattern = new RegExp(`/${username}/n/([a-zA-Z0-9]+)`, 'g');
      const matches = html.matchAll(noteUrlPattern);
      
      for (const match of matches) {
        const articleId = match[1];
        const fullUrl = `https://note.com/${username}/n/${articleId}`;
        
        if (!urlSet.has(fullUrl)) {
          urlSet.add(fullUrl);
          
          // 記事のタイトルと日付を取得（オプション、パフォーマンス考慮で後で取得）
          articleUrls.push({
            url: fullUrl,
            date: '', // 後で取得する場合は記事ページから取得
            title: '', // 後で取得する場合は記事ページから取得
          });
          
          // 最大100件まで取得（Firestoreのドキュメントサイズ制限のため）
          if (articleUrls.length >= 100) {
            break;
          }
        }
      }
      
      // 記事が見つからない場合
      if (articleUrls.length === 0) {
        return NextResponse.json(
          { error: '記事が見つかりませんでした。プロフィールURLが正しいか確認してください' },
          { status: 404 }
        );
      }
      
      // 日付順にソート（新しい順）- 日付が取得できていない場合はURL順
      articleUrls.sort((a, b) => {
        if (a.date && b.date) {
          const dateA = new Date(a.date).getTime();
          const dateB = new Date(b.date).getTime();
          return dateB - dateA;
        }
        return 0;
      });
      
      return NextResponse.json({
        success: true,
        urls: articleUrls,
      });
    } catch (error: any) {
      console.error('Note URL収集エラー:', error);
      return NextResponse.json(
        { error: error.message || 'note記事の取得に失敗しました' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Note fetch error:', error);
    return NextResponse.json(
      { error: error.message || 'note記事の取得に失敗しました' },
      { status: 500 }
    );
  }
}
