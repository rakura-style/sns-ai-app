import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

// サイトマップからURL一覧を取得
export async function POST(request: NextRequest) {
  try {
    const { sitemapUrl } = await request.json();
    
    if (!sitemapUrl) {
      return NextResponse.json(
        { error: 'サイトマップURLが必要です' },
        { status: 400 }
      );
    }
    
    // URLの検証
    let normalizedUrl = sitemapUrl.trim();
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
    
    // サイトマップを取得
    const response = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(30000), // 30秒タイムアウト
    });
    
    if (!response.ok) {
      return NextResponse.json(
        { error: `サイトマップの取得に失敗しました: ${response.status}` },
        { status: response.status }
      );
    }
    
    const xml = await response.text();
    
    // サイトマップインデックスの場合（複数のサイトマップを参照している場合）
    const sitemapIndexMatch = xml.match(/<sitemapindex/i);
    if (sitemapIndexMatch) {
      // サイトマップインデックスから個別のサイトマップURLを取得
      const sitemapUrls: string[] = [];
      const sitemapMatches = xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi);
      
      for (const match of sitemapMatches) {
        const locMatch = match[1].match(/<loc>([^<]+)<\/loc>/i);
        if (locMatch) {
          sitemapUrls.push(locMatch[1].trim());
        }
      }
      
      // 最初の5つのサイトマップのみを取得（パフォーマンス考慮）
      const urls: Array<{ url: string; date: string; title?: string }> = [];
      for (const sitemapUrl of sitemapUrls.slice(0, 5)) {
        try {
          const subResponse = await fetch(sitemapUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            signal: AbortSignal.timeout(10000),
          });
          
          if (subResponse.ok) {
            const subXml = await subResponse.text();
            const urlEntries = subXml.matchAll(/<url>([\s\S]*?)<\/url>/gi);
            
            for (const entryMatch of urlEntries) {
              const entryContent = entryMatch[1];
              const locMatch = entryContent.match(/<loc>([^<]+)<\/loc>/i);
              if (locMatch) {
                let url = locMatch[1].trim();
                if (url.endsWith('/')) {
                  url = url.slice(0, -1);
                }
                
                // 日付を抽出
                let date = '';
                const lastmodMatch = entryContent.match(/<lastmod>([^<]+)<\/lastmod>/i);
                if (lastmodMatch) {
                  try {
                    const dateObj = new Date(lastmodMatch[1]);
                    date = dateObj.toISOString().split('T')[0];
                  } catch (e) {
                    // 日付パースエラーは無視
                  }
                }
                
                // タイトルを抽出（もしあれば）
                let title = '';
                const titleMatch = entryContent.match(/<image:title>([^<]+)<\/image:title>/i);
                if (titleMatch) {
                  title = titleMatch[1].trim();
                }
                
                urls.push({ url, date, title });
              }
            }
          }
        } catch (error) {
          console.error(`サブサイトマップ取得エラー (${sitemapUrl}):`, error);
        }
      }
      
      return NextResponse.json({
        success: true,
        urls: urls.slice(0, 100), // 最大100件（Firestoreのドキュメントサイズ制限のため）
      });
    }
    
    // 通常のサイトマップの場合
    const urls: Array<{ url: string; date: string; title?: string }> = [];
    const urlEntries = xml.matchAll(/<url>([\s\S]*?)<\/url>/gi);
    
    for (const entryMatch of urlEntries) {
      const entryContent = entryMatch[1];
      
      // URLを抽出
      const locMatch = entryContent.match(/<loc>([^<]+)<\/loc>/i);
      if (!locMatch) continue;
      let url = locMatch[1].trim();
      if (!url) continue;
      
      // URLの正規化（末尾のスラッシュを統一）
      if (url.endsWith('/')) {
        url = url.slice(0, -1);
      }
      
      // 除外パターン
      if (url.includes('/category/') || 
          url.includes('/tag/') || 
          url.includes('/author/') ||
          url.includes('/page/') ||
          url.includes('/wp-admin') ||
          url.includes('/wp-content') ||
          url.includes('/wp-includes')) {
        continue;
      }
      
      // 日付を抽出（lastmod）
      let date = '';
      const lastmodMatch = entryContent.match(/<lastmod>([^<]+)<\/lastmod>/i);
      if (lastmodMatch) {
        try {
          const dateObj = new Date(lastmodMatch[1]);
          date = dateObj.toISOString().split('T')[0];
        } catch (e) {
          // 日付パースエラーは無視
        }
      }
      
      // タイトルを抽出（もしあれば）
      let title = '';
      const titleMatch = entryContent.match(/<image:title>([^<]+)<\/image:title>/i);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }
      
      urls.push({ url, date, title });
    }
    
    // 日付順にソート（新しい順）
    urls.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });
    
    return NextResponse.json({
      success: true,
      urls: urls.slice(0, 100), // 最大100件（Firestoreのドキュメントサイズ制限のため）
    });
  } catch (error: any) {
    console.error('Sitemap fetch error:', error);
    return NextResponse.json(
      { error: error.message || 'サイトマップの取得に失敗しました' },
      { status: 500 }
    );
  }
}

