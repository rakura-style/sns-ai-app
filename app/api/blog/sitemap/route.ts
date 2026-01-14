import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

// HTMLから記事URLを抽出する関数
function extractArticleUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const urlSet = new Set<string>();
  
  // 複数のパターンでURLを抽出
  // パターン1: <a>タグのhref属性
  const urlPattern1 = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  // パターン2: data-href属性
  const urlPattern2 = /data-href=["']([^"']+)["']/gi;
  // パターン3: JSON-LD構造化データ内のURL
  const urlPattern3 = /"url":\s*["']([^"']+)["']/gi;
  
  const patterns = [urlPattern1, urlPattern2, urlPattern3];
  
  for (const pattern of patterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      let url = match[1];
      
      // URLの正規化
      url = url.trim();
      if (!url || url === '#' || url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('tel:')) {
        continue;
      }
      
      // 相対URLを絶対URLに変換
      if (url.startsWith('/')) {
        try {
          const urlObj = new URL(baseUrl);
          url = `${urlObj.protocol}//${urlObj.host}${url}`;
        } catch (e) {
          continue;
        }
      } else if (url.startsWith('./') || url.startsWith('../')) {
        try {
          const base = new URL(baseUrl);
          url = new URL(url, base).href;
        } catch (e) {
          continue;
        }
      } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
        // 相対パスの場合
        try {
          const base = new URL(baseUrl);
          let basePath = base.pathname;
          if (!basePath.endsWith('/')) {
            basePath = basePath + '/';
          }
          const fullPath = basePath + url;
          let normalizedPath = fullPath.replace(/\/+/g, '/');
          if (normalizedPath.endsWith('/') && normalizedPath !== '/') {
            normalizedPath = normalizedPath.slice(0, -1);
          }
          url = `${base.protocol}//${base.host}${normalizedPath}`;
        } catch (e) {
          continue;
        }
      }
      
      // URLの正規化（末尾のスラッシュを統一）
      if (url.endsWith('/')) {
        url = url.slice(0, -1);
      }
      
      // baseUrlで始まるURLのみを対象（階下も含む）
      if (url && url.startsWith(baseUrl)) {
        // 除外パターン（/page/を含むURLは記事ではないので除外）
        const excludePatterns = [
          '/category/',
          '/tag/',
          '/tags/',
          '/author/',
          '/authors/',
          '/page/',
          '/pages/',
          '/feed',
          '/feeds/',
          '/rss',
          '/atom',
          '/wp-admin',
          '/wp-content',
          '/wp-includes',
          '/wp-json',
          '/search',
          '/?',
          '#',
          'mailto:',
          'tel:',
          '.jpg',
          '.jpeg',
          '.png',
          '.gif',
          '.webp',
          '.pdf',
          '.zip',
          '.css',
          '.js',
          '.svg',
          '.ico',
          '/login',
          '/logout',
          '/register',
          '/signup',
          '/signin',
          '/admin',
        ];
        
        const urlLower = url.toLowerCase();
        const shouldExclude = excludePatterns.some(pattern => urlLower.includes(pattern));
        
        // baseUrl自体やbaseUrl/は除外（一覧ページ自体は記事ではない）
        const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        const isBaseUrl = normalizedUrl === normalizedBaseUrl;
        
        // 階下のURLであることを確認
        try {
          const urlObj = new URL(normalizedUrl);
          const baseObj = new URL(normalizedBaseUrl);
          const urlPath = urlObj.pathname;
          const basePath = baseObj.pathname;
          
          // パスがbaseUrlより長く、階下であることを確認
          const isSubPath = urlPath.startsWith(basePath) && urlPath.length > basePath.length;
          
          // 階層の深さを計算（basePathから1階層まで）
          const basePathDepth = basePath.split('/').filter(p => p).length;
          const urlPathDepth = urlPath.split('/').filter(p => p).length;
          const depthDiff = urlPathDepth - basePathDepth;
          
          // 1階層まで（basePathから見て1階層下まで）のみ許可
          const isWithinOneLevel = depthDiff === 1;
          
          // 記事らしいURLかどうかを判定
          const hasArticleLikePattern = /\/(\d{4}|\d+|\d{4}\/\d{2}|\d{4}-\d{2})\//.test(urlPath) || 
                                        /\/(post|article|entry|blog|archives)\//.test(urlPath);
          
          if (!shouldExclude && !isBaseUrl && isSubPath && isWithinOneLevel && (hasArticleLikePattern || urlPath.length > basePath.length + 5) && !urlSet.has(normalizedUrl)) {
            urls.push(normalizedUrl);
            urlSet.add(normalizedUrl);
          }
        } catch (e) {
          // URLパースエラーは無視
        }
      }
    }
  }
  
  return urls;
}

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
    
    // サイトマップURLかどうかを判定
    const isSitemapUrl = normalizedUrl.endsWith('.xml') || normalizedUrl.includes('sitemap');
    
    if (!isSitemapUrl) {
      // サイトマップURLでない場合、一覧ページから記事URLを収集
      const urls: Array<{ url: string; date: string; title?: string }> = [];
      const urlSet = new Set<string>();
      const visitedPages = new Set<string>();
      
      // ベースURLを取得
      const urlObj = new URL(normalizedUrl);
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      const basePath = urlObj.pathname;
      
      // 一覧ページのパターン（/entry, /blog, /posts など）
      const listPagePatterns = [
        normalizedUrl,
        `${baseUrl}/entry`,
        `${baseUrl}/blog`,
        `${baseUrl}/posts`,
        `${baseUrl}/articles`,
        `${baseUrl}/archives`,
      ];
      
      // ページネーションも考慮（最大10ページまで）
      for (let page = 1; page <= 10; page++) {
        const pageUrls = [
          `${normalizedUrl}/page/${page}/`,
          `${normalizedUrl}/page/${page}`,
          `${baseUrl}/entry/page/${page}/`,
          `${baseUrl}/entry/page/${page}`,
          `${baseUrl}/blog/page/${page}/`,
          `${baseUrl}/blog/page/${page}`,
          `${baseUrl}/posts/page/${page}/`,
          `${baseUrl}/posts/page/${page}`,
        ];
        
        for (const pageUrl of pageUrls) {
          listPagePatterns.push(pageUrl);
        }
      }
      
      // 各ページを訪問して記事URLを収集
      for (const pageUrl of listPagePatterns) {
        if (visitedPages.has(pageUrl) || urls.length >= 100) break;
        visitedPages.add(pageUrl);
        
        try {
          const response = await fetch(pageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            signal: AbortSignal.timeout(10000), // 10秒タイムアウト
          });
          
          if (response.ok) {
            const html = await response.text();
            const extractedUrls = extractArticleUrls(html, baseUrl);
            
            let foundNewUrls = false;
            for (const url of extractedUrls) {
              if (!urlSet.has(url)) {
                urlSet.add(url);
                urls.push({
                  url,
                  date: '', // 後で取得
                  title: '', // 後で取得
                });
                foundNewUrls = true;
                
                // 最大100件まで
                if (urls.length >= 100) break;
              }
            }
            
            // 記事が見つからなくなったら次のページは見ない（最初のページ以外）
            const currentPageIndex = listPagePatterns.indexOf(pageUrl);
            if (!foundNewUrls && extractedUrls.length === 0 && currentPageIndex > 0) {
              break;
            }
          }
          
          // レート制限対策
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error) {
          console.error(`ページ取得エラー (${pageUrl}):`, error);
          // エラーが続く場合は中断（最初のページ以外）
          const currentPageIndex = listPagePatterns.indexOf(pageUrl);
          if (currentPageIndex > 0) break;
        }
      }
      
      // 日付順にソート（新しい順）- 日付が取得できていない場合はURL順
      urls.sort((a, b) => {
        if (a.date && b.date) {
          const dateA = new Date(a.date).getTime();
          const dateB = new Date(b.date).getTime();
          return dateB - dateA;
        }
        return 0;
      });
      
      return NextResponse.json({
        success: true,
        urls: urls.slice(0, 100), // 最大100件
      });
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

