import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

// HTMLからタイトルを抽出する関数
function extractTitle(html: string): string {
  // 1. ページ内の最初の<h1>タグを探し、そのテキストを抽出
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const title = h1Match[1]
      .replace(/<[^>]+>/g, '') // HTMLタグを除去
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (title) {
      return title;
    }
  }
  
  // 2. <title>タグから取得（セパレーターより前の部分）
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    let title = titleMatch[1]
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    
    // セパレーター（| や -）より前の部分を取得
    const separators = [' | ', ' - ', '｜', '－', '|', '-'];
    for (const sep of separators) {
      if (title.includes(sep)) {
        title = title.split(sep)[0].trim();
        break;
      }
    }
    if (title) {
      return title;
    }
  }
  
  // 3. og:titleメタタグから取得
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitleMatch) {
    return ogTitleMatch[1].trim();
  }
  
  return '';
}

// 複数のURLからタイトルを一括取得
export async function POST(request: NextRequest) {
  try {
    const { urls } = await request.json();
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: 'URLの配列が必要です' },
        { status: 400 }
      );
    }
    
    // 最大100件まで処理
    const urlsToProcess = urls.slice(0, 100);
    const results: Array<{ url: string; title: string }> = [];
    
    // 並列処理でタイトルを取得（最大5件ずつ）
    const CONCURRENT_LIMIT = 5;
    for (let i = 0; i < urlsToProcess.length; i += CONCURRENT_LIMIT) {
      const batch = urlsToProcess.slice(i, i + CONCURRENT_LIMIT);
      const batchPromises = batch.map(async (url: string) => {
        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            signal: AbortSignal.timeout(10000), // 10秒タイムアウト
          });
          
          if (response.ok) {
            const html = await response.text();
            const title = extractTitle(html);
            return { url, title: title || url }; // タイトルが取得できない場合はURLを返す
          }
        } catch (error) {
          // エラーが発生した場合はURLを返す
          console.error(`タイトル取得エラー (${url}):`, error);
        }
        return { url, title: url };
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // バッチ間で少し待機（レート制限対策）
      if (i + CONCURRENT_LIMIT < urlsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    return NextResponse.json({
      success: true,
      titles: results,
    });
  } catch (error: any) {
    console.error('Title fetch error:', error);
    return NextResponse.json(
      { error: error.message || 'タイトルの取得に失敗しました' },
      { status: 500 }
    );
  }
}
