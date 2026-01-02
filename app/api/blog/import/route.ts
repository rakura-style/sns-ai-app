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
  const urlPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  const matches = html.matchAll(urlPattern);
  
  for (const match of matches) {
    let url = match[1];
    
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
      ];
      
      const shouldExclude = excludePatterns.some(pattern => url.includes(pattern));
      
      if (!shouldExclude && 
          url !== baseUrl && 
          url !== baseUrl + '/' &&
          !urls.includes(url)) {
        urls.push(url);
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
  if (articleUrls.size < maxPosts) {
    const listPages = [
      `${baseUrl}/`,
      `${baseUrl}/blog/`,
      `${baseUrl}/posts/`,
      `${baseUrl}/articles/`,
    ];
    
    // ページネーションも考慮（最大5ページまで）
    for (let page = 1; page <= 5; page++) {
      const pageUrls = [
        `${baseUrl}/page/${page}/`,
        `${baseUrl}/blog/page/${page}/`,
        `${baseUrl}/posts/page/${page}/`,
      ];
      
      for (const listUrl of pageUrls) {
        if (visitedUrls.has(listUrl)) continue;
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
            
            for (const url of urls) {
              if (url.startsWith(baseUrl)) {
                articleUrls.add(url);
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
          for (const match of urlMatches) {
            const url = match[1].trim();
            if (url && url.startsWith(baseUrl)) {
              // カテゴリやタグページは除外
              if (!url.includes('/category/') && 
                  !url.includes('/tag/') && 
                  !url.includes('/author/') &&
                  !url.includes('/page/') &&
                  url !== baseUrl &&
                  url !== baseUrl + '/') {
                articleUrls.add(url);
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
          
          if (content.trim()) {
            posts.push({
              title: title || 'タイトルなし',
              content: content.trim(), // テキスト形式
              date,
              url,
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
    
    // CSV形式に変換（テキスト形式で保存）
    const csvRows = [
      'Date,Title,Content,URL',
      ...posts.map(post => {
        const date = post.date;
        const title = `"${post.title.replace(/"/g, '""')}"`;
        const content = `"${post.content.replace(/"/g, '""').replace(/\n/g, ' ')}"`; // テキスト形式
        const url = `"${post.url}"`;
        return `${date},${title},${content},${url}`;
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

