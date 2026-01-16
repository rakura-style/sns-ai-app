import { NextRequest, NextResponse } from 'next/server';

// エントリー一覧ページから記事URLを抽出する関数
function extractEntryUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const urlSet = new Set<string>(); // 重複チェック用
  
  try {
    const baseUrlObj = new URL(baseUrl);
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    
    // はてなブログのエントリー一覧ページから記事URLを抽出
    // パターン1: .entry-title-linkクラスの<a>タグ
    const entryTitleLinkPattern = /<a[^>]*class=["'][^"']*entry-title-link[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
    const entryTitleLinkMatches = html.matchAll(entryTitleLinkPattern);
    for (const match of entryTitleLinkMatches) {
      let url = match[1].trim();
      if (!url || url === '#' || url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('tel:')) {
        continue;
      }
      
      // 相対URLを絶対URLに変換
      if (url.startsWith('/')) {
        url = `${baseUrlObj.protocol}//${baseUrlObj.host}${url}`;
      } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = new URL(url, baseUrl).href;
      }
      
      // URLの正規化（末尾のスラッシュを統一）
      if (url.endsWith('/')) {
        url = url.slice(0, -1);
      }
      
      // baseUrlで始まるURLのみを対象
      if (url && url.startsWith(normalizedBaseUrl) && !urlSet.has(url)) {
        // エントリー記事のURLかどうかを判定（/entry/を含む）
        if (url.includes('/entry/')) {
          urls.push(url);
          urlSet.add(url);
        }
      }
    }
    
    // パターン2: 一般的な記事リンクパターン（/entry/を含むURL）
    if (urls.length === 0) {
      const entryUrlPattern = /href=["']([^"']*\/entry\/[^"']+)["']/gi;
      const entryUrlMatches = html.matchAll(entryUrlPattern);
      for (const match of entryUrlMatches) {
        let url = match[1].trim();
        if (!url || url === '#' || url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('tel:')) {
          continue;
        }
        
        // 相対URLを絶対URLに変換
        if (url.startsWith('/')) {
          url = `${baseUrlObj.protocol}//${baseUrlObj.host}${url}`;
        } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = new URL(url, baseUrl).href;
        }
        
        // URLの正規化（末尾のスラッシュを統一）
        if (url.endsWith('/')) {
          url = url.slice(0, -1);
        }
        
        // /entry/を含むURLを対象
        if (url && url.includes('/entry/') && !urlSet.has(url)) {
          // カテゴリーやタグページを除外
          if (!url.includes('/category/') && !url.includes('/tag/') && !url.includes('/archive/')) {
            urls.push(url);
            urlSet.add(url);
          }
        }
      }
    }
    
    // パターン3: archiveページの記事リンク（.archive-entry-headerなど）
    if (urls.length === 0) {
      // archiveページの形式でリンクを探す
      const archiveLinkPattern = /href=["']([^"']+)["'][^>]*>[\s\S]*?<[^>]*class=["'][^"']*(?:entry-title|archive-entry)[^"']*["']/gi;
      const archiveLinkMatches = html.matchAll(archiveLinkPattern);
      for (const match of archiveLinkMatches) {
        let url = match[1].trim();
        if (!url || url === '#' || url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('tel:')) {
          continue;
        }
        
        // 相対URLを絶対URLに変換
        if (url.startsWith('/')) {
          url = `${baseUrlObj.protocol}//${baseUrlObj.host}${url}`;
        } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = new URL(url, baseUrl).href;
        }
        
        // URLの正規化
        if (url.endsWith('/')) {
          url = url.slice(0, -1);
        }
        
        if (url && url.includes('/entry/') && !urlSet.has(url)) {
          urls.push(url);
          urlSet.add(url);
        }
      }
    }
    
    // パターン4: 最後の手段 - すべてのhrefから/entry/を含むURLを抽出
    if (urls.length === 0) {
      const allHrefPattern = /href=["']([^"']+)["']/gi;
      const allHrefMatches = html.matchAll(allHrefPattern);
      for (const match of allHrefMatches) {
        let url = match[1].trim();
        if (!url || url === '#' || url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('tel:')) {
          continue;
        }
        
        // /entry/を含まないURLはスキップ
        if (!url.includes('/entry/')) {
          continue;
        }
        
        // 相対URLを絶対URLに変換
        if (url.startsWith('/')) {
          url = `${baseUrlObj.protocol}//${baseUrlObj.host}${url}`;
        } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
          try {
            url = new URL(url, baseUrl).href;
          } catch (e) {
            continue;
          }
        }
        
        // URLの正規化
        if (url.endsWith('/')) {
          url = url.slice(0, -1);
        }
        
        // カテゴリーやタグページ、アーカイブ自体を除外
        if (url.includes('/category/') || url.includes('/tag/') || url.includes('/archive/')) {
          continue;
        }
        
        // 同じドメインのURLのみ
        try {
          const urlObj = new URL(url);
          if (urlObj.host === baseUrlObj.host && !urlSet.has(url)) {
            urls.push(url);
            urlSet.add(url);
          }
        } catch (e) {
          continue;
        }
      }
    }
  } catch (error) {
    console.error('URL抽出エラー:', error);
  }
  
  return urls;
}

export async function POST(request: NextRequest) {
  try {
    const { entryListUrl } = await request.json();
    
    if (!entryListUrl) {
      return NextResponse.json(
        { error: 'エントリー一覧URLが必要です' },
        { status: 400 }
      );
    }
    
    // URLの検証
    let normalizedUrl = entryListUrl.trim();
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
    
    // エントリー一覧ページを取得
    const response = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000), // 10秒タイムアウト
    });
    
    if (!response.ok) {
      return NextResponse.json(
        { error: `ページの取得に失敗しました: ${response.status}` },
        { status: response.status }
      );
    }
    
    // 文字化け対策: レスポンスをArrayBufferとして取得し、適切なエンコーディングでデコード
    const arrayBuffer = await response.arrayBuffer();
    
    // Content-Typeヘッダーからcharsetを取得
    const contentType = response.headers.get('content-type') || '';
    const charsetMatch = contentType.match(/charset=([^;]+)/i);
    const charset = charsetMatch ? charsetMatch[1].trim().toLowerCase() : 'utf-8';
    
    // HTMLのmetaタグからcharsetを取得（より正確）
    const decoder = new TextDecoder(charset === 'utf-8' ? 'utf-8' : charset);
    let tempHtml = decoder.decode(arrayBuffer);
    
    // HTMLのmetaタグからcharsetを確認
    const metaCharsetMatch = tempHtml.match(/<meta[^>]*charset=["']?([^"'\s>]+)["']?/i);
    if (metaCharsetMatch) {
      const htmlCharset = metaCharsetMatch[1].toLowerCase();
      if (htmlCharset !== charset) {
        // HTMLで指定されたcharsetが異なる場合は再デコード
        try {
          const htmlDecoder = new TextDecoder(htmlCharset);
          tempHtml = htmlDecoder.decode(arrayBuffer);
        } catch (e) {
          // デコードに失敗した場合は元のデコード結果を使用
        }
      }
    }
    
    const html = tempHtml;
    
    // エントリー一覧ページから記事URLを抽出
    const articleUrls = extractEntryUrls(html, normalizedUrl);
    
    if (articleUrls.length === 0) {
      return NextResponse.json(
        { error: '記事URLが見つかりませんでした' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      urls: articleUrls,
      count: articleUrls.length,
    });
  } catch (error: any) {
    console.error('Entry list fetch error:', error);
    return NextResponse.json(
      { error: error.message || 'エントリー一覧の取得に失敗しました' },
      { status: 500 }
    );
  }
}
