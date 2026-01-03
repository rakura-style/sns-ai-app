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
        // 除外パターン（より厳密に）
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
          '.woff',
          '.woff2',
          '.ttf',
          '.eot',
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
        // ただし、baseUrl/xxx/のような階下のURLは含める
        const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        const isBaseUrl = normalizedUrl === normalizedBaseUrl;
        
        // 階下のURLであることを確認（baseUrlより長いパスを持つ）
        try {
          const urlObj = new URL(normalizedUrl);
          const baseObj = new URL(normalizedBaseUrl);
          const urlPath = urlObj.pathname;
          const basePath = baseObj.pathname;
          
          // パスがbaseUrlより長く、階下であることを確認
          const isSubPath = urlPath.startsWith(basePath) && urlPath.length > basePath.length;
          
          // 記事らしいURLかどうかを判定（数字や日付を含むパスは記事の可能性が高い）
          const hasArticleLikePattern = /\/(\d{4}|\d+|\d{4}\/\d{2}|\d{4}-\d{2})\//.test(urlPath) || 
                                        /\/(post|article|entry|blog|archives)\//.test(urlPath) ||
                                        urlPath.split('/').length >= 3; // パスが3階層以上
          
          if (!shouldExclude && !isBaseUrl && isSubPath && (hasArticleLikePattern || urlPath.length > basePath.length + 5) && !urlSet.has(normalizedUrl)) {
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

// 記事の投稿日を抽出（更新日ではなく投稿日を優先）
function extractDate(html: string): string {
  // 1. JSON-LD構造化データからdatePublishedを取得（最優先）
  const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdPattern.exec(html)) !== null) {
    try {
      const jsonData = JSON.parse(jsonLdMatch[1]);
      // 配列の場合とオブジェクトの場合の両方に対応
      const items = Array.isArray(jsonData) ? jsonData : [jsonData];
      for (const item of items) {
        if (item['@type'] === 'Article' || item['@type'] === 'BlogPosting' || item['@type'] === 'NewsArticle') {
          if (item.datePublished) {
            const date = new Date(item.datePublished);
            if (!isNaN(date.getTime())) {
              return date.toISOString().split('T')[0];
            }
          }
        }
      }
    } catch (e) {
      // JSONパースエラーは無視
    }
  }
  
  // 2. メタタグからarticle:published_timeを取得
  const metaPublishedMatch = html.match(/<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if (metaPublishedMatch) {
    try {
      const date = new Date(metaPublishedMatch[1]);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch (e) {
      // 日付パースエラーは無視
    }
  }
  
  // 3. メタタグからog:published_timeを取得
  const ogPublishedMatch = html.match(/<meta[^>]*property=["']og:published_time["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if (ogPublishedMatch) {
    try {
      const date = new Date(ogPublishedMatch[1]);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch (e) {
      // 日付パースエラーは無視
    }
  }
  
  // 4. <time>タグから取得（datetime属性にpublishedクラスがある場合を優先）
  const timePublishedMatch = html.match(/<time[^>]*class=["'][^"']*published[^"']*["'][^>]*datetime=["']([^"']+)["'][^>]*>/i);
  if (timePublishedMatch) {
    try {
      const date = new Date(timePublishedMatch[1]);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch (e) {
      // 日付パースエラーは無視
    }
  }
  
  // 5. 通常の<time>タグから取得
  const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["'][^>]*>/i);
  if (timeMatch) {
    try {
      const date = new Date(timeMatch[1]);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch (e) {
      // 日付パースエラーは無視
    }
  }
  
  // 6. その他の日付パターンを検索（フォールバック）
  const datePattern = /(\d{4}[-/]\d{2}[-/]\d{2})/;
  const dateMatch = html.match(datePattern);
  if (dateMatch) {
    try {
      const date = new Date(dateMatch[1].replace(/\//g, '-'));
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch (e) {
      // 日付パースエラーは無視
    }
  }
  
  // 投稿日が見つからない場合は現在の日付を返す（フォールバック）
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

// 記事URLと日付のペア
interface ArticleUrlWithDate {
  url: string;
  date: string; // ISO形式の日付文字列（ソート用）
}

// 記事URLを収集する関数（RSS、サイトマップ、記事一覧ページから）
async function collectArticleUrls(baseUrl: string, maxPosts: number = 50): Promise<string[]> {
  // noteのURLの場合は専用の関数を使用
  if (baseUrl.includes('note.com')) {
    return await collectNoteUrls(baseUrl, maxPosts);
  }
  
  const articleUrlsWithDates: ArticleUrlWithDate[] = [];
  const urlSet = new Set<string>(); // 重複チェック用
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
        // RSSフィードから記事URLと日付を抽出
        const items = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
        for (const itemMatch of items) {
          const itemContent = itemMatch[1];
          
          // URLを抽出
          const linkMatch = itemContent.match(/<link>([^<]+)<\/link>/i);
          if (!linkMatch) continue;
          const url = linkMatch[1].trim();
          if (!url || !url.startsWith(baseUrl) || url.includes('/feed')) continue;
          
          // 日付を抽出（pubDateまたはdc:date）
          let date = '';
          const pubDateMatch = itemContent.match(/<pubDate>([^<]+)<\/pubDate>/i);
          if (pubDateMatch) {
            try {
              const dateObj = new Date(pubDateMatch[1]);
              date = dateObj.toISOString();
            } catch (e) {
              // 日付パースエラーは無視
            }
          }
          if (!date) {
            const dcDateMatch = itemContent.match(/<dc:date>([^<]+)<\/dc:date>/i);
            if (dcDateMatch) {
              try {
                const dateObj = new Date(dcDateMatch[1]);
                date = dateObj.toISOString();
              } catch (e) {
                // 日付パースエラーは無視
              }
            }
          }
          // 日付が取得できなかった場合は、現在日時を使用（最後にソートされる）
          if (!date) {
            date = new Date(0).toISOString(); // 1970-01-01（古い順にソートされる）
          }
          
          if (!urlSet.has(url)) {
            articleUrlsWithDates.push({ url, date });
            urlSet.add(url);
          }
        }
        
        if (articleUrlsWithDates.length > 0) {
          console.log(`RSSフィードから${articleUrlsWithDates.length}件の記事URLを取得`);
          break;
        }
      }
    } catch (error) {
      console.error(`RSS取得エラー (${rssUrl}):`, error);
    }
  }
  
  // 方法2: 記事一覧ページから取得（階下も含む）
  // 指定されたURL自体が一覧ページの場合、そのページから階下の記事URLを収集
  if (articleUrlsWithDates.length < maxPosts) {
    const tempUrls = new Set<string>();
    const pagesToVisit = new Set<string>();
    
    // まず、指定されたbaseUrl自体から記事URLを収集
    pagesToVisit.add(baseUrl);
    
    // 追加の一覧ページパターンも試す
    const listPagePatterns = [
      `${baseUrl}/blog/`,
      `${baseUrl}/posts/`,
      `${baseUrl}/articles/`,
      `${baseUrl}/entry/`,
      `${baseUrl}/archives/`,
    ];
    
    for (const pattern of listPagePatterns) {
      pagesToVisit.add(pattern);
    }
    
    // ページネーションも考慮（最大20ページまで）
    for (let page = 1; page <= 20 && tempUrls.size < maxPosts * 3; page++) {
      const pageUrls = [
        `${baseUrl}/page/${page}/`,
        `${baseUrl}/blog/page/${page}/`,
        `${baseUrl}/posts/page/${page}/`,
        `${baseUrl}/articles/page/${page}/`,
        `${baseUrl}/entry/page/${page}/`,
        `${baseUrl}/archives/page/${page}/`,
      ];
      
      for (const pageUrl of pageUrls) {
        pagesToVisit.add(pageUrl);
      }
    }
    
    // 各ページを訪問して記事URLを収集
    const visitedPages = new Set<string>();
    for (const pageUrl of pagesToVisit) {
      if (visitedPages.has(pageUrl) || tempUrls.size >= maxPosts * 3) continue;
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
          const urls = extractPostUrls(html, baseUrl);
          
          const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
          let foundNewUrls = false;
          
          for (const url of urls) {
            const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
            
            if (normalizedUrl.startsWith(normalizedBaseUrl) && normalizedUrl !== normalizedBaseUrl) {
              if (!urlSet.has(normalizedUrl) && !tempUrls.has(normalizedUrl)) {
                tempUrls.add(normalizedUrl);
                urlSet.add(normalizedUrl);
                foundNewUrls = true;
              }
            }
          }
          
          console.log(`ページ ${pageUrl} から ${urls.length}件のURLを抽出（新規: ${foundNewUrls ? 'あり' : 'なし'}）`);
          
          // 記事が見つからなくなったら次のページは見ない
          if (!foundNewUrls && urls.length === 0) {
            break;
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`ページ取得エラー (${pageUrl}):`, error);
      }
    }
    
    console.log(`合計${tempUrls.size}件の記事URLを収集しました`);
    
    // 収集したURLから日付を取得（並列処理で高速化）
    const urlArray = Array.from(tempUrls);
    const datePromises = urlArray.map(async (url) => {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          signal: AbortSignal.timeout(5000), // 5秒タイムアウト
        });
        
        if (response.ok) {
          const html = await response.text();
          const date = extractDate(html);
          return { url, date: date ? new Date(date).toISOString() : new Date(0).toISOString() };
        }
      } catch (error) {
        // エラーが発生した場合は、古い日付として扱う
      }
      return { url, date: new Date(0).toISOString() };
    });
    
    // 並列処理で日付を取得（最大10件ずつ）
    const CONCURRENT_LIMIT = 10;
    const results: ArticleUrlWithDate[] = [];
    for (let i = 0; i < datePromises.length; i += CONCURRENT_LIMIT) {
      const batch = datePromises.slice(i, i + CONCURRENT_LIMIT);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
      
      // バッチ間で少し待機（レート制限対策）
      if (i + CONCURRENT_LIMIT < datePromises.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // 既存のURLと重複しないように追加
    for (const result of results) {
      if (!urlSet.has(result.url)) {
        articleUrlsWithDates.push(result);
        urlSet.add(result.url);
      }
    }
  }
  
  // 方法3: サイトマップから取得（もしあれば）
  if (articleUrlsWithDates.length < maxPosts) {
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
          // サイトマップから記事URLと日付を抽出
          const urlEntries = xml.matchAll(/<url>([\s\S]*?)<\/url>/gi);
          const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
          
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
            
            if (url && url.startsWith(normalizedBaseUrl)) {
              // カテゴリやタグページは除外
              if (url.includes('/category/') || 
                  url.includes('/tag/') || 
                  url.includes('/author/') ||
                  url.includes('/page/') ||
                  url === normalizedBaseUrl) {
                continue;
              }
              
              // 日付を抽出（lastmod）
              let date = '';
              const lastmodMatch = entryContent.match(/<lastmod>([^<]+)<\/lastmod>/i);
              if (lastmodMatch) {
                try {
                  const dateObj = new Date(lastmodMatch[1]);
                  date = dateObj.toISOString();
                } catch (e) {
                  // 日付パースエラーは無視
                }
              }
              // 日付が取得できなかった場合は、古い日付として扱う
              if (!date) {
                date = new Date(0).toISOString();
              }
              
              if (!urlSet.has(url)) {
                articleUrlsWithDates.push({ url, date });
                urlSet.add(url);
                if (articleUrlsWithDates.length >= maxPosts * 2) break;
              }
            }
          }
          
          if (articleUrlsWithDates.length > 0) {
            console.log(`サイトマップから${articleUrlsWithDates.length}件の記事URLを取得`);
            break;
          }
        }
      } catch (error) {
        console.error(`サイトマップ取得エラー (${sitemapUrl}):`, error);
      }
    }
  }
  
  // 日付順にソート（新しい順）
  articleUrlsWithDates.sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    return dateB - dateA; // 降順（新しい順）
  });
  
  // 最大数に制限
  const urls = articleUrlsWithDates.slice(0, maxPosts).map(item => item.url);
  
  console.log(`合計${urls.length}件の記事URLを収集しました（最新の記事から順に取得）`);
  
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
    
    // 各記事を取得してテキストを抽出（並列処理で高速化）
    const posts: Array<{
      title: string;
      content: string;
      date: string;
      url: string;
      category: string;
      tags: string;
    }> = [];
    
    // 記事取得関数（リトライロジック付き）
    const fetchArticle = async (url: string, retries = 2): Promise<{
      title: string;
      content: string;
      date: string;
      url: string;
      category: string;
      tags: string;
    } | null> => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            signal: AbortSignal.timeout(10000), // 10秒タイムアウト
          });
          
          if (response.ok) {
            const html = await response.text();
            
            // HTMLサイズチェック（5MB以上はスキップ）
            if (html.length > 5 * 1024 * 1024) {
              console.warn(`記事が大きすぎます（${url}）: ${(html.length / 1024 / 1024).toFixed(2)}MB`);
              return null;
            }
            
            const title = extractTitle(html);
            const content = extractContent(html); // テキスト形式で抽出
            const date = extractDate(html);
            const category = extractCategory(html); // カテゴリを抽出
            const tags = extractTags(html); // タグを抽出
            
            // コンテンツが空の場合はスキップ
            if (!content.trim()) {
              console.warn(`記事の内容が空です（${url}）`);
              return null;
            }
            
            // コンテンツが長すぎる場合は切り詰め（100k文字まで）
            let trimmedContent = content.trim();
            if (trimmedContent.length > 100000) {
              trimmedContent = trimmedContent.substring(0, 100000) + '...';
            }
            
            return {
              title: title || 'タイトルなし',
              content: trimmedContent,
              date,
              url,
              category,
              tags,
            };
          } else if (response.status === 404) {
            // 404の場合はリトライしない
            console.warn(`記事が見つかりません（${url}）: 404`);
            return null;
          } else if (attempt < retries) {
            // リトライ可能なエラーの場合、少し待ってからリトライ
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            continue;
          }
        } catch (error: any) {
          if (attempt < retries && error.name !== 'AbortError') {
            // タイムアウト以外のエラーはリトライ
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            continue;
          }
          console.error(`Failed to fetch article ${url} (attempt ${attempt + 1}/${retries + 1}):`, error.message || error);
        }
      }
      return null;
    };
    
    // 並列処理で記事を取得（最大3件ずつ）
    const CONCURRENT_LIMIT = 3;
    const DELAY_MS = 1000; // 1秒待機
    let errorCount = 0;
    const errors: string[] = [];
    
    for (let i = 0; i < articleUrls.length; i += CONCURRENT_LIMIT) {
      const batch = articleUrls.slice(i, i + CONCURRENT_LIMIT);
      const batchPromises = batch.map(url => fetchArticle(url));
      
      const batchResults = await Promise.all(batchPromises);
      
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        if (result) {
          posts.push(result);
        } else {
          errorCount++;
          errors.push(`記事の取得に失敗: ${batch[j]}`);
        }
      }
      
      // バッチ間で少し待機（レート制限対策）
      if (i + CONCURRENT_LIMIT < articleUrls.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
      
      console.log(`記事取得進捗: ${Math.min(i + CONCURRENT_LIMIT, articleUrls.length)}/${articleUrls.length} (取得済み: ${posts.length}件, エラー: ${errorCount}件)`);
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
      totalUrls: articleUrls.length,
      errorCount,
      errors: errors.slice(0, 10), // 最大10件のエラーを返す
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

