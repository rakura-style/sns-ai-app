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

// 削除: 記事のURLを抽出する関数（URLから自動収集は行わないため不要）
/*
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
*/

// 記事のタイトルを抽出
function extractTitle(html: string): string {
  // 1. ページ内の最初の<h1>タグを探し、そのテキストを抽出（クラス名は無視）
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const title = extractTextFromHTML(h1Match[1]);
    if (title.trim()) {
      return title.trim();
    }
  }
  
  // 2. 万が一<h1>が存在しない場合のみ、<title>タグの冒頭部分を使用
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    let title = extractTextFromHTML(titleMatch[1]);
    // セパレーター（| や -）より前の部分を取得（冒頭部分）
    const separators = [' | ', ' - ', '｜', '－', '|', '-'];
    for (const sep of separators) {
      if (title.includes(sep)) {
        title = title.split(sep)[0].trim();
        break;
      }
    }
    if (title.trim()) {
      return title.trim();
    }
  }
  
  return '';
}

// ネストされたタグを正確にマッチングする関数
function extractNestedTag(html: string, tagName: string, className?: string): string {
  if (!html) return '';
  
  let startPattern: RegExp;
  if (className) {
    // クラス名が指定されている場合
    startPattern = new RegExp(`<${tagName}[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>`, 'i');
  } else {
    // クラス名が指定されていない場合
    startPattern = new RegExp(`<${tagName}[^>]*>`, 'i');
  }
  
  const startMatch = html.match(startPattern);
  if (!startMatch || startMatch.index === undefined) return '';
  
  const startIndex = startMatch.index + startMatch[0].length;
  let depth = 1;
  let i = startIndex;
  const tagLength = tagName.length;
  
  // 対応する終了タグを探す（ネストを考慮）
  while (i < html.length && depth > 0) {
    // 開始タグを探す（<tagName または <tagName>）
    const openTagPattern = new RegExp(`<${tagName}(?:\\s|>)`, 'i');
    const openMatch = html.substring(i).match(openTagPattern);
    const openIndex = openMatch ? html.substring(i).indexOf(openMatch[0]) : -1;
    
    // 終了タグを探す（</tagName>）
    const closeTagPattern = new RegExp(`</${tagName}>`, 'i');
    const closeMatch = html.substring(i).match(closeTagPattern);
    const closeIndex = closeMatch ? html.substring(i).indexOf(closeMatch[0]) : -1;
    
    if (closeIndex === -1) break; // 終了タグが見つからない
    
    if (openIndex !== -1 && openIndex < closeIndex) {
      // 開始タグが先に見つかった（ネスト）
      depth++;
      // 開始タグの終了位置を探す
      const tagEnd = html.substring(i + openIndex).indexOf('>');
      if (tagEnd === -1) break;
      i += openIndex + tagEnd + 1;
    } else {
      // 終了タグが見つかった
      depth--;
      if (depth === 0) {
        return html.substring(startIndex, i + closeIndex);
      }
      i += closeIndex + `</${tagName}>`.length;
    }
  }
  
  return '';
}

// 記事の本文を抽出（テキスト形式、改行を保持）
function extractContent(html: string): string {
  if (!html) return '';
  
  let text = html;
  
  // 1. scriptタグとstyleタグの中身のみ削除
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // 2. ターゲット: <div class="post_content">から</div>まですべて取得
  let contentHtml = extractNestedTag(text, 'div', 'post_content');
  
  if (!contentHtml) {
    return '';
  }
  
  // 3. 画像とリンクを除外（画像は完全に削除、リンクはテキストのみ取得）
  // 画像タグを削除
  contentHtml = contentHtml.replace(/<img[^>]*>/gi, '');
  // リンクタグはテキストのみ取得（<a>タグを除去し、テキストは残す）
  contentHtml = contentHtml.replace(/<a[^>]*>/gi, '');
  contentHtml = contentHtml.replace(/<\/a>/gi, '');
  
  // 4. 処理手順:
  //    - <div class="post_content">から</div>までに含まれるすべての要素を対象
  //    - それ以外のすべてのタグ（p, h2, h3, ul, li, div, table, blockquoteなど）のテキストを、上から順にすべて結合
  //    - 最初の段落で処理を止めないで、記事末尾（SNSボタンやフッターの手前）までテキスト取得を継続
  
  // 整形: タグの区切り目には改行コードを入れ、読みやすいプレーンテキストに
  // 見出し（h1-h6）の前には空行を入れる
  contentHtml = contentHtml.replace(/(<h[1-6][^>]*>)/gi, '\n\n$1');
  
  // 改行を保持するため、各種タグの終了時に改行を追加
  contentHtml = contentHtml
    .replace(/<br\s*\/?>/gi, '\n')        // <br>を改行に
    .replace(/<\/p>/gi, '\n')             // </p>を改行に
    .replace(/<\/div>/gi, '\n')           // </div>を改行に
    .replace(/<\/h[1-6]>/gi, '\n')        // 見出しタグの終了を改行に
    .replace(/<\/li>/gi, '\n')            // リスト項目の終了を改行に
    .replace(/<\/blockquote>/gi, '\n')    // 引用の終了を改行に
    .replace(/<\/td>/gi, ' ')             // テーブルセルの終了を空白に
    .replace(/<\/th>/gi, ' ')             // テーブルヘッダーの終了を空白に
    .replace(/<\/tr>/gi, '\n')            // テーブル行の終了を改行に
    .replace(/<\/ul>/gi, '\n')            // リストの終了を改行に
    .replace(/<\/ol>/gi, '\n')            // 順序付きリストの終了を改行に
    .replace(/<\/dl>/gi, '\n')            // 定義リストの終了を改行に
    .replace(/<\/figure>/gi, '\n')       // figureタグの終了を改行に
    .replace(/<\/figcaption>/gi, '\n');   // figcaptionタグの終了を改行に
  
  // HTMLタグを除去（すべてのタグを除去）
  let textContent = contentHtml.replace(/<[^>]+>/g, '');
  
  // HTMLエンティティをデコード（文字化け対策: より包括的に）
  // 数値エンティティ（&#123;形式）を先に処理
  textContent = textContent.replace(/&#(\d+);/g, (match, dec) => {
    try {
      return String.fromCharCode(parseInt(dec, 10));
    } catch (e) {
      return match; // デコードに失敗した場合は元の文字列を返す
    }
  });
  
  // 16進数エンティティ（&#x1F;形式）を処理
  textContent = textContent.replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch (e) {
      return match; // デコードに失敗した場合は元の文字列を返す
    }
  });
  
  // 名前付きエンティティ（一般的なもの）
  textContent = textContent
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
    .replace(/&#8230;/g, '…')
    .replace(/&#160;/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&copy;/g, '©')
    .replace(/&reg;/g, '®')
    .replace(/&trade;/g, '™')
    .replace(/&yen;/g, '¥')
    .replace(/&euro;/g, '€')
    .replace(/&pound;/g, '£')
    .replace(/&cent;/g, '¢')
    .replace(/&deg;/g, '°')
    .replace(/&times;/g, '×')
    .replace(/&divide;/g, '÷')
    .replace(/&plusmn;/g, '±')
    .replace(/&frac12;/g, '½')
    .replace(/&frac14;/g, '¼')
    .replace(/&frac34;/g, '¾')
    .replace(/&lsquo;/g, '\u2018')  // 左シングルクォート
    .replace(/&rsquo;/g, '\u2019')  // 右シングルクォート
    .replace(/&ldquo;/g, '\u201C')  // 左ダブルクォート
    .replace(/&rdquo;/g, '\u201D')  // 右ダブルクォート
    .replace(/&sbquo;/g, '\u201A')  // シングル下クォート
    .replace(/&bdquo;/g, '\u201E'); // ダブル下クォート
  
  // 連続する過剰な空白や改行を整理
  // 3つ以上の連続する改行を2つに制限
  textContent = textContent.replace(/\n{3,}/g, '\n\n');
  // 行頭・行末の空白を除去
  textContent = textContent.split('\n').map(line => line.trim()).join('\n');
  // 連続する空白（改行以外）を1つに
  textContent = textContent.replace(/[ \t]+/g, ' ');
  
  return textContent.trim();
}

// 記事の投稿日を抽出
function extractDate(html: string, url?: string): string {
  // 1. <time>タグを探し、datetime属性（YYYY-MM-DD）を取得
  const timeMatches = html.matchAll(/<time[^>]*datetime=["']([^"']+)["'][^>]*>/gi);
  for (const match of timeMatches) {
    try {
      const dateStr = match[1];
      // YYYY-MM-DD形式に変換
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch (e) {
      // 日付パースエラーは無視
    }
  }
  
  // 2. 見つからない場合は、日付形式のテキスト（例: 2024.01.01）を探して変換
  // パターン1: YYYY.MM.DD
  const pattern1 = html.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (pattern1) {
    const year = pattern1[1];
    const month = pattern1[2].padStart(2, '0');
    const day = pattern1[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // パターン2: YYYY/MM/DD
  const pattern2 = html.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (pattern2) {
    const year = pattern2[1];
    const month = pattern2[2].padStart(2, '0');
    const day = pattern2[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // パターン3: YYYY年MM月DD日
  const pattern3 = html.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (pattern3) {
    const year = pattern3[1];
    const month = pattern3[2].padStart(2, '0');
    const day = pattern3[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // パターン4: YYYY-MM-DD（既に正しい形式）
  const pattern4 = html.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (pattern4) {
    return pattern4[0];
  }
  
  // 投稿日が見つからない場合は空欄を返し、エラーログを出力
  console.error('投稿日の取得に失敗しました。URL:', url || '不明');
  return '';
}

// 記事のカテゴリを抽出
function extractCategory(html: string): string {
  // カテゴリーと思われるラベルを抽出
  // パターン1: .c-categoryButtonクラス
  const categoryButtonMatch = html.match(/<[^>]*class=["'][^"']*c-categoryButton[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (categoryButtonMatch) {
    const category = extractTextFromHTML(categoryButtonMatch[1]).trim();
    if (category) {
      return category;
    }
  }
  
  // パターン2: rel="category"のリンク
  const categoryRelMatch = html.match(/<a[^>]*rel=["']category[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  if (categoryRelMatch) {
    const category = extractTextFromHTML(categoryRelMatch[1]).trim();
    if (category) {
      return category;
    }
  }
  
  // パターン3: .categoryクラス
  const categoryClassMatch = html.match(/<[^>]*class=["'][^"']*category[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (categoryClassMatch) {
    const category = extractTextFromHTML(categoryClassMatch[1]).trim();
    if (category) {
      return category;
    }
  }
  
  return '';
}

// 記事のタグを抽出（複数のタグをカンマ区切りで返す）
function extractTags(html: string): string {
  const tags: string[] = [];
  
  // タグエリア（例: .p-articleTags）にあるリンクテキストをすべて取得
  // パターン1: .p-articleTagsクラス内の<a>タグ
  const articleTagsMatch = html.match(/<[^>]*class=["'][^"']*p-articleTags[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (articleTagsMatch) {
    const tagsContent = articleTagsMatch[1];
    const tagLinks = tagsContent.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi);
    for (const match of tagLinks) {
      const tag = extractTextFromHTML(match[1]).trim();
      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }
    }
  }
  
  // パターン2: rel="tag"のリンク
  if (tags.length === 0) {
    const tagRelMatches = html.matchAll(/<a[^>]*rel=["']tag["'][^>]*>([\s\S]*?)<\/a>/gi);
    for (const match of tagRelMatches) {
      const tag = extractTextFromHTML(match[1]).trim();
      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }
    }
  }
  
  // パターン3: .tagクラス内のリンク
  if (tags.length === 0) {
    const tagClassMatch = html.match(/<[^>]*class=["'][^"']*tag[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
    if (tagClassMatch) {
      const tagsContent = tagClassMatch[1];
      const tagLinks = tagsContent.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi);
      for (const match of tagLinks) {
        const tag = extractTextFromHTML(match[1]).trim();
        if (tag && !tags.includes(tag)) {
          tags.push(tag);
        }
      }
    }
  }
  
  return tags.join(','); // カンマ区切りで返す（スペースなし）
}

// 削除: note記事のURLを収集する関数（URLから自動収集は行わないため不要）
/*
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
}*/

// 削除: 記事URLと日付のペア、記事URLを収集する関数（URLから自動収集は行わないため不要）
/*
interface ArticleUrlWithDate {
  url: string;
  date: string; // ISO形式の日付文字列（ソート用）
}

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
          const date = extractDate(html, url);
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
*/

// セキュリティ: URLの検証関数
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    // httpとhttpsのみ許可
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// セキュリティ: URLのホワイトリスト（必要に応じて制限）
const ALLOWED_DOMAINS: string[] = []; // 空の場合は全てのドメインを許可

function isAllowedDomain(urlString: string): boolean {
  if (ALLOWED_DOMAINS.length === 0) return true; // ホワイトリストが空の場合は全て許可
  
  try {
    const url = new URL(urlString);
    return ALLOWED_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    let { blogUrl, maxPosts = 50, forceRefresh = false, userId } = await request.json();
    
    // セキュリティ: maxPostsの検証（過度に大きな値を防ぐ）
    maxPosts = Math.min(Math.max(1, parseInt(String(maxPosts), 10) || 50), 100);
    
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
    
    // セキュリティ: URLの検証を強化
    if (!isValidUrl(baseUrl)) {
      return NextResponse.json(
        { error: '無効なURLです' },
        { status: 400 }
      );
    }

    // セキュリティ: ドメインホワイトリストのチェック（設定されている場合）
    if (!isAllowedDomain(baseUrl)) {
      return NextResponse.json(
        { error: '許可されていないドメインです' },
        { status: 403 }
      );
    }

    // セキュリティ: maxPostsの検証（過度に大きな値を防ぐ）
    const validatedMaxPosts = Math.min(Math.max(1, parseInt(String(maxPosts), 10) || 50), 100);
    
    // validatedMaxPostsを使用するようにmaxPostsを更新
    maxPosts = validatedMaxPosts;
    
    // キャッシュチェック（クライアント側でFirestoreから取得するため、ここではスキップ）
    // キャッシュはクライアント側で管理
    
    // ブログから記事を取得
    console.log('ブログから記事を取得中...');
    
    // 直接指定されたURLのみを処理（URLから自動収集は行わない）
    const articleUrls = [baseUrl];
    
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
            // 文字化け対策: レスポンスをArrayBufferとして取得し、適切なエンコーディングでデコード
            const arrayBuffer = await response.arrayBuffer();
            let html = '';
            
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
                  html = htmlDecoder.decode(arrayBuffer);
                } catch (e) {
                  // デコードに失敗した場合は元のデコード結果を使用
                  html = tempHtml;
                }
              } else {
                html = tempHtml;
              }
            } else {
              html = tempHtml;
            }
            
            // HTMLサイズチェック（10MB以上はスキップ）
            if (html.length > 10 * 1024 * 1024) {
              console.warn(`記事が大きすぎます（${url}）: ${(html.length / 1024 / 1024).toFixed(2)}MB`);
              return null;
            }
            
            const title = extractTitle(html);
            const content = extractContent(html); // テキスト形式で抽出（全文）
            const date = extractDate(html, url); // URLも渡して日付抽出
            const category = extractCategory(html); // カテゴリを抽出
            const tags = extractTags(html); // タグを抽出
            
            // コンテンツが空の場合はスキップ（デバッグ情報を追加）
            if (!content || !content.trim()) {
              console.warn(`記事の内容が空です（${url}）`);
              console.warn(`HTMLサイズ: ${html.length}文字, タイトル: ${title || 'なし'}`);
              return null;
            }
            
            // コンテンツが短すぎる場合も警告（50文字未満）
            if (content.trim().length < 50) {
              console.warn(`記事の内容が短すぎます（${url}）: ${content.trim().length}文字`);
            }
            
            // 本文は長くても全て読み取る（切り詰め処理を削除）
            const trimmedContent = content.trim();
            
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
    
    // CSV形式に変換（テキスト形式で保存、カテゴリ・タグを含む、改行を保持）
    const csvRows = [
      'Date,Title,Content,Category,Tags,URL',
      ...posts.map(post => {
        // すべてのフィールドをダブルクォートで囲む（一貫性と安全性のため）
        const date = `"${(post.date || '').replace(/"/g, '""')}"`;
        const title = `"${(post.title || '').replace(/"/g, '""')}"`;
        const content = `"${(post.content || '').replace(/"/g, '""')}"`; // テキスト形式、改行を保持
        const category = `"${(post.category || '').replace(/"/g, '""')}"`; // カテゴリ
        // タグは必ずダブルクォートで囲む（カンマが含まれる可能性があるため）
        const tags = `"${(post.tags || '').replace(/"/g, '""')}"`; // タグ（CSVエスケープ処理を徹底）
        const url = `"${(post.url || '').replace(/"/g, '""')}"`;
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

