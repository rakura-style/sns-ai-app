import { NextRequest, NextResponse } from 'next/server';

// キャッシュの有効期限（1年）- 表示用のみ（自動更新はしない）
const CACHE_DURATION_MS = 365 * 24 * 60 * 60 * 1000; // 1年

// HTMLからテキストを抽出する関数（WordPressのブロックコメントやHTMLタグを除去）
function extractTextFromHTML(html: string): string {
  if (!html) return '';
  
  let text = html;
  
  // WordPressのブロックコメントを除去（<!-- wp:xxx --> や <!-- /wp:xxx -->）
  text = text.replace(/<!--\s*\/?wp:[^>]+-->/g, '');
  
  // HTMLタグを除去
  text = text.replace(/<[^>]+>/g, '');
  
  // HTMLエンティティをデコード
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8230;/g, '…');
  
  // 連続する空白や改行を整理
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/\n\s*\n/g, '\n');
  
  return text;
}

// 記事のURLを抽出する関数（階下も含む）
function extractPostUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const urlSet = new Set<string>(); // 重複チェック用
  
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
        // 相対パス（例: google/3158/ や google/3158）
        try {
          const base = new URL(baseUrl);
          // baseUrlのパスを取得（末尾のスラッシュを統一）
          let basePath = base.pathname;
          if (!basePath.endsWith('/')) {
            basePath = basePath + '/';
          }
          // 相対パスを結合
          const fullPath = basePath + url;
          // パスの正規化（連続するスラッシュを1つに、末尾のスラッシュを除去）
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
        // 除外パターン
        const excludePatterns = [
          '/category/',
          '/tag/',
          '/author/',
          '/page/',
          '/feed',
          '/wp-admin',
          '/wp-content',
          '/wp-includes',
          '/search',
          '/?',
          '#',
          'mailto:',
          'tel:',
          '.jpg',
          '.jpeg',
          '.png',
          '.gif',
          '.pdf',
          '.zip',
          '.css',
          '.js',
          '.svg',
          '.ico',
          '.woff',
          '.woff2',
          '.ttf',
          '.eot',
        ];
        
        const shouldExclude = excludePatterns.some(pattern => url.toLowerCase().includes(pattern));
        
        // baseUrl自体やbaseUrl/は除外（一覧ページ自体は記事ではない）
        // ただし、baseUrl/xxx/のような階下のURLは含める
        const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const isBaseUrl = url === normalizedBaseUrl || url === normalizedBaseUrl + '/';
        const isArticleUrl = !isBaseUrl && url.length > normalizedBaseUrl.length;
        
        // 階下のURLであることを確認（baseUrlより長いパスを持つ）
        const urlPath = new URL(url).pathname;
        const basePath = new URL(normalizedBaseUrl).pathname;
        const isSubPath = urlPath.startsWith(basePath) && urlPath.length > basePath.length;
        
        if (!shouldExclude && isArticleUrl && isSubPath && !urlSet.has(url)) {
          urls.push(url);
          urlSet.add(url);
        }
      }
    }
  }
  
  return urls;
}

// 記事のタイトルを抽出
function extractTitle(html: string): string {
  // <title>タグから取得
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    return extractTextFromHTML(titleMatch[1]);
  }
  
  // <h1>タグから取得
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) {
    return extractTextFromHTML(h1Match[1]);
  }
  
  return '';
}

// 記事の本文を抽出（テキスト形式）
function extractContent(html: string): string {
  // note記事の場合
  if (html.includes('note.com')) {
    // note記事の本文は通常 .note-article-body または .note-content に含まれる
    const noteContentMatch = html.match(/<div[^>]*class=["'][^"']*note-article-body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (noteContentMatch) {
      const content = extractTextFromHTML(noteContentMatch[1]);
      if (content.trim()) return content;
    }
    
    const noteContentMatch2 = html.match(/<div[^>]*class=["'][^"']*note-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (noteContentMatch2) {
      const content = extractTextFromHTML(noteContentMatch2[1]);
      if (content.trim()) return content;
    }
  }
  
  // WordPressの場合、記事本文は通常 <article> または .entry-content に含まれる
  let content = '';
  
  // <article>タグから取得
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    content = extractTextFromHTML(articleMatch[1]);
    if (content.trim()) return content;
  }
  
  // .entry-content クラスから取得
  const contentMatch = html.match(/<div[^>]*class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (contentMatch) {
    content = extractTextFromHTML(contentMatch[1]);
    if (content.trim()) return content;
  }
  
  // .post-content クラスから取得
  const postContentMatch = html.match(/<div[^>]*class=["'][^"']*post-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (postContentMatch) {
    content = extractTextFromHTML(postContentMatch[1]);
    if (content.trim()) return content;
  }
  
  // <main>タグから取得
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) {
    content = extractTextFromHTML(mainMatch[1]);
    if (content.trim()) return content;
  }
  
  // フォールバック: <body>内のテキストを取得（ただし、ナビゲーションなどは除外）
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    // ナビゲーションやフッターを除外
    let bodyContent = bodyMatch[1];
    bodyContent = bodyContent.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
    bodyContent = bodyContent.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
    bodyContent = bodyContent.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
    content = extractTextFromHTML(bodyContent);
    if (content.trim()) return content;
  }
  
  return extractTextFromHTML(html);
}

// 記事の投稿日を抽出
function extractDate(html: string): string {
  // <time>タグから取得
  const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["'][^>]*>/i);
  if (timeMatch) {
    return timeMatch[1].split('T')[0]; // 日付部分のみ
  }
  
  // その他の日付パターンを検索
  const datePattern = /(\d{4}[-/]\d{2}[-/]\d{2})/;
  const dateMatch = html.match(datePattern);
  if (dateMatch) {
    return dateMatch[1].replace(/\//g, '-');
  }
  
  return new Date().toISOString().split('T')[0];
}

// 記事のカテゴリを抽出
function extractCategory(html: string): string {
  // WordPressの場合
  // パターン1: <a rel="category tag">タグから取得
  const categoryMatch1 = html.match(/<a[^>]*rel=["']category[\s]*tag["'][^>]*>([^<]+)<\/a>/i);
  if (categoryMatch1) {
    return extractTextFromHTML(categoryMatch1[1]);
  }
  
  // パターン2: .category クラスから取得
  const categoryMatch2 = html.match(/<span[^>]*class=["'][^"']*category[^"']*["'][^>]*>([^<]+)<\/span>/i);
  if (categoryMatch2) {
    return extractTextFromHTML(categoryMatch2[1]);
  }
  
  // パターン3: .post-category クラスから取得
  const categoryMatch3 = html.match(/<div[^>]*class=["'][^"']*post-category[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (categoryMatch3) {
    return extractTextFromHTML(categoryMatch3[1]);
  }
  
  // パターン4: JSON-LD構造化データから取得
  const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const json = JSON.parse(jsonLdMatch[1]);
      if (json.articleSection) {
        return String(json.articleSection);
      }
      if (Array.isArray(json) && json[0]?.articleSection) {
        return String(json[0].articleSection);
      }
    } catch (e) {
      // JSONパースエラーは無視
    }
  }
  
  // パターン5: メタタグから取得
  const metaCategoryMatch = html.match(/<meta[^>]*property=["']article:section["'][^>]*content=["']([^"']+)["']/i);
  if (metaCategoryMatch) {
    return metaCategoryMatch[1];
  }
  
  return '';
}

// 記事のタグを抽出（複数のタグをカンマ区切りで返す）
function extractTags(html: string): string {
  const tags: string[] = [];
  
  // WordPressの場合
  // パターン1: <a rel="tag">タグから取得（複数）
  const tagMatches1 = html.matchAll(/<a[^>]*rel=["']tag["'][^>]*>([^<]+)<\/a>/gi);
  for (const match of tagMatches1) {
    const tag = extractTextFromHTML(match[1]).trim();
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  
  // パターン2: .tag クラスから取得
  const tagMatches2 = html.matchAll(/<span[^>]*class=["'][^"']*tag[^"']*["'][^>]*>([^<]+)<\/span>/gi);
  for (const match of tagMatches2) {
    const tag = extractTextFromHTML(match[1]).trim();
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  
  // パターン3: .post-tags クラスから取得
  const tagsMatch3 = html.match(/<div[^>]*class=["'][^"']*post-tags[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (tagsMatch3) {
    const tagsHtml = tagsMatch3[1];
    const tagLinks = tagsHtml.matchAll(/<a[^>]*>([^<]+)<\/a>/gi);
    for (const match of tagLinks) {
      const tag = extractTextFromHTML(match[1]).trim();
      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }
    }
  }
  
  // パターン4: JSON-LD構造化データから取得
  const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const json = JSON.parse(jsonLdMatch[1]);
      if (json.keywords) {
        const keywords = Array.isArray(json.keywords) ? json.keywords : [json.keywords];
        keywords.forEach((keyword: string) => {
          const tag = String(keyword).trim();
          if (tag && !tags.includes(tag)) {
            tags.push(tag);
          }
        });
      }
      if (Array.isArray(json) && json[0]?.keywords) {
        const keywords = Array.isArray(json[0].keywords) ? json[0].keywords : [json[0].keywords];
        keywords.forEach((keyword: string) => {
          const tag = String(keyword).trim();
          if (tag && !tags.includes(tag)) {
            tags.push(tag);
          }
        });
      }
    } catch (e) {
      // JSONパースエラーは無視
    }
  }
  
  // パターン5: メタタグから取得
  const metaTagsMatch = html.match(/<meta[^>]*property=["']article:tag["'][^>]*content=["']([^"']+)["']/i);
  if (metaTagsMatch) {
    const tag = metaTagsMatch[1].trim();
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  
  // 複数のメタタグを取得
  const metaTagsMatches = html.matchAll(/<meta[^>]*property=["']article:tag["'][^>]*content=["']([^"']+)["']/gi);
  for (const match of metaTagsMatches) {
    const tag = match[1].trim();
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  
  return tags.join(', '); // カンマ区切りで返す
}

// note記事のURLを収集する関数
async function collectNoteUrls(noteUrl: string, maxPosts: number = 50): Promise<string[]> {
  const articleUrls = new Set<string>();
  
  try {
    // noteのURLパターンを解析
    // https://note.com/username または https://note.com/username/n/nnnnnnnnnnnn
    const noteMatch = noteUrl.match(/https?:\/\/note\.com\/([^\/]+)/);
    if (!noteMatch) return [];
    
    const username = noteMatch[1];
    const profileUrl = `https://note.com/${username}`;
    
    // プロフィールページから記事URLを取得
    const response = await fetch(profileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (response.ok) {
      const html = await response.text();
      // note記事のURLパターン: /username/n/nnnnnnnnnnnn
      const noteUrlPattern = new RegExp(`/${username}/n/([a-zA-Z0-9]+)`, 'g');
      const matches = html.matchAll(noteUrlPattern);
      
      for (const match of matches) {
        const articleId = match[1];
        const fullUrl = `https://note.com/${username}/n/${articleId}`;
        articleUrls.add(fullUrl);
        if (articleUrls.size >= maxPosts) break;
      }
    }
  } catch (error) {
    console.error('Note URL収集エラー:', error);
  }
  
  return Array.from(articleUrls);
}

// 記事URLを収集する関数（RSS、サイトマップ、記事一覧ページから）
async function collectArticleUrls(baseUrl: string, maxPosts: number = 50): Promise<string[]> {
  // noteのURLの場合は専用の関数を使用
  if (baseUrl.includes('note.com')) {
    return await collectNoteUrls(baseUrl, maxPosts);
  }
  
  const articleUrls = new Set<string>();
  const visitedUrls = new Set<string>();
  
  // 方法1: RSSフィードから取得（WordPressの場合）
  const rssUrls = [
    `${baseUrl}/feed/`,
    `${baseUrl}/feed/rss/`,
    `${baseUrl}/?feed=rss2`,
  ];
  
  for (const rssUrl of rssUrls) {
    try {
      const response = await fetch(rssUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      
      if (response.ok) {
        const xml = await response.text();
        // RSSフィードから記事URLを抽出
        const urlMatches = xml.matchAll(/<link>([^<]+)<\/link>/g);
        for (const match of urlMatches) {
          const url = match[1].trim();
          if (url && url.startsWith(baseUrl) && !url.includes('/feed')) {
            articleUrls.add(url);
          }
        }
        
        if (articleUrls.size > 0) {
          console.log(`RSSフィードから${articleUrls.size}件の記事URLを取得`);
          break;
        }
      }
    } catch (error) {
      console.error(`RSS取得エラー (${rssUrl}):`, error);
    }
  }
  
  // 方法2: 記事一覧ページから取得（階下も含む）
  // 指定されたURL自体が一覧ページの場合、そのページから階下の記事URLを収集
  if (articleUrls.size < maxPosts) {
    // まず、指定されたbaseUrl自体から記事URLを収集
    try {
      const response = await fetch(baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      
      if (response.ok) {
        const html = await response.text();
        const urls = extractPostUrls(html, baseUrl);
        
        const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        for (const url of urls) {
          const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
          
          if (normalizedUrl.startsWith(normalizedBaseUrl) && normalizedUrl !== normalizedBaseUrl) {
            articleUrls.add(normalizedUrl);
            if (articleUrls.size >= maxPosts) break;
          }
        }
        
        console.log(`一覧ページから${urls.length}件の記事URLを取得（合計: ${articleUrls.size}件）`);
      }
    } catch (error) {
      console.error(`一覧ページ取得エラー (${baseUrl}):`, error);
    }
    
    // 追加の一覧ページパターンも試す
    const listPages = [
      `${baseUrl}/blog/`,
      `${baseUrl}/posts/`,
      `${baseUrl}/articles/`,
    ];
    
    // ページネーションも考慮（最大5ページまで）
    for (let page = 1; page <= 5 && articleUrls.size < maxPosts; page++) {
      const pageUrls = [
        `${baseUrl}/page/${page}/`,
        `${baseUrl}/blog/page/${page}/`,
        `${baseUrl}/posts/page/${page}/`,
      ];
      
      for (const listUrl of pageUrls) {
        if (visitedUrls.has(listUrl) || articleUrls.size >= maxPosts) continue;
        visitedUrls.add(listUrl);
        
        try {
          const response = await fetch(listUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
          
          if (response.ok) {
            const html = await response.text();
            const urls = extractPostUrls(html, baseUrl);
            
            const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
            for (const url of urls) {
              const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
              
              if (normalizedUrl.startsWith(normalizedBaseUrl) && normalizedUrl !== normalizedBaseUrl) {
                articleUrls.add(normalizedUrl);
                if (articleUrls.size >= maxPosts) break;
              }
            }
            
            // 記事が見つからなくなったら次のページは見ない
            if (urls.length === 0) {
              break;
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error) {
          console.error(`ページ取得エラー (${listUrl}):`, error);
        }
      }
      
      // 十分な記事が見つかったら終了
      if (articleUrls.size >= maxPosts) {
        break;
      }
    }
  }
  
  // 方法3: サイトマップから取得（もしあれば）
  if (articleUrls.size < maxPosts) {
    const sitemapUrls = [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap_index.xml`,
      `${baseUrl}/wp-sitemap.xml`, // WordPress 5.5+
    ];
    
    for (const sitemapUrl of sitemapUrls) {
      try {
        const response = await fetch(sitemapUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        
        if (response.ok) {
          const xml = await response.text();
          // サイトマップから記事URLを抽出
          const urlMatches = xml.matchAll(/<loc>([^<]+)<\/loc>/g);
          const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
          for (const match of urlMatches) {
            let url = match[1].trim();
            if (!url) continue;
            
            // URLの正規化（末尾のスラッシュを統一）
            if (url.endsWith('/')) {
              url = url.slice(0, -1);
            }
            
            if (url && url.startsWith(normalizedBaseUrl)) {
              // カテゴリやタグページは除外
              if (!url.includes('/category/') && 
                  !url.includes('/tag/') && 
                  !url.includes('/author/') &&
                  !url.includes('/page/') &&
                  url !== normalizedBaseUrl) {
                articleUrls.add(url);
                if (articleUrls.size >= maxPosts) break;
              }
            }
          }
          
          if (articleUrls.size > 0) {
            console.log(`サイトマップから${articleUrls.size}件の記事URLを取得`);
            break;
          }
        }
      } catch (error) {
        console.error(`サイトマップ取得エラー (${sitemapUrl}):`, error);
      }
    }
  }
  
  // 配列に変換して最大数に制限
  const urls = Array.from(articleUrls).slice(0, maxPosts);
  
  console.log(`合計${urls.length}件の記事URLを収集しました`);
  
  return urls;
}

export async function POST(request: NextRequest) {
  try {
    const { blogUrl, maxPosts = 50, forceRefresh = false, userId } = await request.json();
    
    if (!blogUrl || !userId) {
      return NextResponse.json(
        { error: 'ブログURLとユーザーIDが必要です' },
        { status: 400 }
      );
    }
    
    // ベースURLを正規化
    let baseUrl = blogUrl.trim();
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    
    // URLの検証
    try {
      new URL(baseUrl);
    } catch (e) {
      return NextResponse.json(
        { error: '無効なURLです' },
        { status: 400 }
      );
    }
    
    // キャッシュチェック（クライアント側でFirestoreから取得するため、ここではスキップ）
    // キャッシュはクライアント側で管理
    
    // ブログから記事を取得
    console.log('ブログから記事を取得中...');
    
    // 記事URLを収集
    const articleUrls = await collectArticleUrls(baseUrl, maxPosts);
    
    if (articleUrls.length === 0) {
      // 記事URLが見つからない場合、直接指定されたURLを記事として扱う
      articleUrls.push(baseUrl);
    }
    
    // 各記事を取得してテキストを抽出
    const posts: Array<{
      title: string;
      content: string;
      date: string;
      url: string;
      category: string;
      tags: string;
    }> = [];
    
    for (let i = 0; i < articleUrls.length; i++) {
      const url = articleUrls[i];
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        
        if (response.ok) {
          const html = await response.text();
          const title = extractTitle(html);
          const content = extractContent(html); // テキスト形式で抽出
          const date = extractDate(html);
          const category = extractCategory(html); // カテゴリを抽出
          const tags = extractTags(html); // タグを抽出
          
          if (content.trim()) {
            posts.push({
              title: title || 'タイトルなし',
              content: content.trim(), // テキスト形式
              date,
              url,
              category, // カテゴリを追加
              tags, // タグを追加
            });
          }
        }
        
        // レート制限を避けるため、少し待機
        if (i < articleUrls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Failed to fetch article ${url}:`, error);
      }
    }
    
    // CSV形式に変換（テキスト形式で保存、カテゴリ・タグを含む）
    const csvRows = [
      'Date,Title,Content,Category,Tags,URL',
      ...posts.map(post => {
        const date = post.date;
        const title = `"${post.title.replace(/"/g, '""')}"`;
        const content = `"${post.content.replace(/"/g, '""').replace(/\n/g, ' ')}"`; // テキスト形式
        const category = `"${post.category.replace(/"/g, '""')}"`; // カテゴリ
        const tags = `"${post.tags.replace(/"/g, '""')}"`; // タグ
        const url = `"${post.url}"`;
        return `${date},${title},${content},${category},${tags},${url}`;
      }),
    ];
    
    const csv = csvRows.join('\n');
    
    return NextResponse.json({
      success: true,
      csv,
      postCount: posts.length,
      fromCache: false,
      cachedAt: Date.now(),
    });
  } catch (error: any) {
    console.error('Blog import error:', error);
    return NextResponse.json(
      { error: error.message || 'ブログの取り込みに失敗しました' },
      { status: 500 }
    );
  }
}

