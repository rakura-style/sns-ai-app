'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  TrendingUp, BarChart3, RefreshCcw, Send, Copy, Check, Sparkles, Zap,
  Loader2, Settings, Pencil, ChevronRight, Lightbulb, Upload,
  ChevronDown, User as UserIcon, MessageCircle, Smile, ExternalLink, AlignLeft, Mail, Lock, CreditCard, LogOut,
  X as XIcon, Trash2, BookOpen, Menu, HelpCircle, Download
} from 'lucide-react';

// 🔥 Firebase認証・DB読み込み
// 相対パスで確実に lib/firebase.ts を読み込む
import { auth, db } from '../lib/firebase';

import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

// グローバル定数: アプリID
const getAppId = () => {
  if (typeof window !== 'undefined' && (window as any).__app_id) {
    return (window as any).__app_id;
  }
  return 'default-app-id';
};

const appId = getAppId();

// 元データの場所
const ORIGINAL_DATA_PATH = 'C:\\Users\\mail\\Documents\\OriginalApp\\AI_postsupport';

// 投稿先の種類とURL生成関数
type PostDestination = 'x';

const getPostUrl = (destination: PostDestination, content: string): string => {
  const encodedText = encodeURIComponent(content);
  
  switch (destination) {
    case 'x':
      return `https://twitter.com/intent/tweet?text=${encodedText}`;
    default:
      return `https://twitter.com/intent/tweet?text=${encodedText}`;
  }
};

const getDestinationLabel = (destination: PostDestination): string => {
  switch (destination) {
    case 'x':
      return 'X';
    default:
      return 'X';
  }
};

// Xの文字数制限（280文字）
const X_CHARACTER_LIMIT = 280;

// Xの文字数を計算（全角文字は2文字としてカウント）
const calculateXCharacterCount = (text: string): number => {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    // 全角文字（日本語、全角英数字、全角記号など）は2文字としてカウント
    if (char.match(/[^\x00-\x7F]/) || char.match(/[！-～]/)) {
      count += 2;
    } else {
      count += 1;
    }
  }
  return count;
};

// --- Logic Functions (サーバー経由版) ---

const callSecureApi = async (prompt: string, token: string, actionType: 'post' | 'theme', userId: string) => {
  // 🔥 1. 利用回数制限のチェック (1日100回)
  // 注意: クライアント側でのチェックは参考程度。サーバー側での制限が優先されます。
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const usageRef = doc(db, 'artifacts', appId, 'users', userId, 'daily_usage', today);
  
  let currentCount = 0;
  try {
    const usageSnap = await getDoc(usageRef);
    if (usageSnap.exists()) {
      currentCount = usageSnap.data().count || 0;
    }
  } catch (error: any) {
    // 権限エラーの場合は、サーバー側でチェックされるため続行
    if (error.code === 'permission-denied' || error.message?.includes('permission')) {
      console.warn("Usage check permission denied (server-side check will be performed):", error);
    } else {
    console.error("Usage check failed:", error);
    }
    // エラーが発生しても続行（サーバー側で制限チェックされる）
  }

  // クライアント側でのチェック（参考程度）
  if (currentCount >= 100) {
    throw new Error("本日の利用上限に達しました。\n明日以降ご利用ください。");
  }

  // 🔥 2. API呼び出し
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ prompt, actionType }),
  });

  if (response.status === 403) throw new Error("無料枠の上限に達しました。");
  
  if (!response.ok) {
    let errorBody = "";
    let errorData: any = null;
    try {
      errorBody = await response.text();
      try {
        errorData = JSON.parse(errorBody);
      } catch (e) {
        // JSONパースに失敗した場合は、errorBodyをそのまま使用
      }
    } catch (e) {
      errorBody = "Failed to read error body";
    }
    console.error("API Error Detail:", errorBody);

    if (response.status === 429) {
        throw new Error("アクセスが集中しており制限がかかりました。\nしばらく時間を置いてから再試行してください。");
    }

    // 地域制限エラーの検出
    if (response.status === 400 && (
        errorBody.includes('User location is not supported') ||
        errorBody.includes('location is not supported') ||
        errorData?.error === '地域制限エラー'
    )) {
        throw new Error("お使いの地域ではGemini APIが利用できません。\n\nVPNを使用するか、サポートされている地域からアクセスしてください。");
    }

    // エラーメッセージを改善（JSONから詳細を取得）
    const errorMessage = errorData?.details || errorData?.error || errorBody;
    throw new Error(`API Error: ${response.status} - ${errorMessage}`);
  }
  
  // 🔥 3. 成功時に利用回数を更新
  try {
    await setDoc(usageRef, { count: currentCount + 1 }, { merge: true });
  } catch (error) {
    console.error("Failed to update usage count:", error);
  }
  
  const data = await response.json();
  return data.text;
};

// CSVデータをサンプリングして分析用に最適化する関数
const sampleCsvForAnalysis = (csvData: string, maxRows: number = 100): string => {
  if (!csvData) return '';
  
  const lines = csvData.split('\n');
  if (lines.length <= 1) return csvData; // ヘッダーのみまたは空
  
  const header = lines[0];
  const dataLines = lines.slice(1).filter(line => line.trim());
  
  // データが少ない場合はそのまま返す
  if (dataLines.length <= maxRows) {
    return csvData;
  }
  
  // データが多い場合は、ランダムにサンプリング（Fisher-Yatesシャッフル）
  const shuffled = [...dataLines];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  // ランダムにサンプリングされた行を取得
  const sampledLines = shuffled.slice(0, maxRows);
  
  return [header, ...sampledLines].join('\n');
};

const analyzeCsvAndGenerateThemes = async (csvData: string, token: string, userId: string, parseCsvToPostsFn?: (csv: string) => any[], blogData?: string, analysisDataSource: 'x' | 'blog' | 'all' = 'all', deletedPostIdentifiers?: Set<string>) => {
  // デフォルトのサンプルデータを定義
  const defaultCsv = 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200';
  
  // データの存在チェック
  const isCsvDataDefault = csvData === defaultCsv || !csvData || csvData.trim() === '';
  const hasBlogData = blogData && blogData.trim() && blogData.split('\n').length > 1;
  
  // データソースに応じてデータを選択
  let combinedCsv = '';
  
  if (analysisDataSource === 'x') {
    // Xのデータのみを使用
    if (isCsvDataDefault) {
      throw new Error('分析するデータがありません。\n\nXのCSVデータを取り込んでください。');
    }
    combinedCsv = csvData;
  } else if (analysisDataSource === 'blog') {
    // ブログデータのみを使用
    if (!hasBlogData) {
      throw new Error('分析するデータがありません。\n\nブログデータを取り込んでください。');
    }
    combinedCsv = blogData || '';
  } else {
    // 両方のデータを使用
    if (isCsvDataDefault && !hasBlogData) {
      throw new Error('分析するデータがありません。\n\nXのCSVデータまたはブログデータを取り込んでください。');
    }
    
    // XのCSVデータとブログデータの両方を結合
    if (isCsvDataDefault && hasBlogData) {
      combinedCsv = blogData || '';
    } else if (blogData && blogData.trim()) {
      const csvLines = csvData.split('\n');
      const blogLines = blogData.split('\n');
      if (csvLines.length > 0 && blogLines.length > 1) {
        // ヘッダーが異なる可能性があるため、両方のヘッダーを確認
        const csvHeader = csvLines[0];
        const blogHeader = blogLines[0];
        
        // データ行を取得（空行を除外）
        const csvDataLines = csvLines.slice(1).filter(line => line.trim());
        const blogDataLines = blogLines.slice(1).filter(line => line.trim());
        
        // データ行が存在する場合のみ結合
        if (csvDataLines.length > 0 || blogDataLines.length > 0) {
          // ヘッダーが同じ場合は結合、異なる場合は両方を含める
          if (csvHeader === blogHeader) {
            combinedCsv = csvHeader + '\n' + [...csvDataLines, ...blogDataLines].join('\n');
          } else {
            // ヘッダーが異なる場合は、両方のデータを含める（ブログデータを追加）
            combinedCsv = csvHeader + '\n' + [...csvDataLines, ...blogDataLines].join('\n');
          }
        } else {
          // データ行が存在しない場合は、ブログデータのみを使用
          combinedCsv = blogData;
        }
      }
    } else {
      combinedCsv = csvData;
    }
  }
  
  // 結合後のデータが空でないことを確認（空行を除外してチェック）
  const combinedLines = combinedCsv.split('\n').filter(line => line.trim());
  if (!combinedCsv || combinedCsv.trim() === '' || combinedLines.length <= 1) {
    throw new Error('提供されたCSVデータはヘッダー行のみで、投稿内容が一切含まれていないため、分析を行うことができません。X投稿もしくはブログをご選択ください');
  }
  
  // パース関数が提供されている場合は、エンゲージメントの高い投稿を優先的に選択し、残りをランダムにサンプリング
  // 高速化のため、パース前にCSVデータをサンプリング（最大200行に制限）
  let optimizedCsv: string = '';
  if (parseCsvToPostsFn && combinedCsv) {
    try {
      // デバッグ: combinedCsvの内容を確認
      console.log('分析データソース:', analysisDataSource);
      console.log('combinedCsvの行数:', combinedCsv.split('\n').length);
      
      // 高速化のため、パース前にCSVデータをサンプリング（最大200行に制限）
      // これにより、大量のデータでもパース処理が高速化される
      const sampledCsv = sampleCsvForAnalysis(combinedCsv, 200);
      console.log('サンプリング後のCSV行数:', sampledCsv.split('\n').length);
      
      let allPosts = parseCsvToPostsFn(sampledCsv);
      
      console.log('パース後の投稿数:', allPosts.length);
      
      // 削除された投稿を除外
      if (deletedPostIdentifiers && deletedPostIdentifiers.size > 0) {
        const beforeDeletedFilterCount = allPosts.length;
        allPosts = allPosts.filter((post: any) => {
          const rawData = post.rawData || {};
          const tweetId = post.tweet_id || 
            post.tweetId || 
            post['Tweet ID'] || 
            post['TweetID'] || 
            post['tweet_id'] ||
            rawData.tweet_id ||
            rawData.tweetId ||
            rawData['Tweet ID'] ||
            rawData['TweetID'] ||
            rawData['tweet_id'] ||
            '';
          const url = post.URL || post.url || rawData.URL || rawData.url || '';
          const hasTweetId = !!tweetId;
          const hasUrl = !!url;
          const isBlogPost = hasUrl && !hasTweetId;
          
          // 識別子を取得
          const identifier = isBlogPost ? url : tweetId;
          let identifierToCheck = identifier;
          if (!identifierToCheck) {
            // 内容の最初の50文字を識別子として使用
            identifierToCheck = `content:${(post.content || '').substring(0, 50).toLowerCase().trim()}`;
          }
          
          // URLの正規化（末尾のスラッシュを統一）
          if (identifierToCheck && !identifierToCheck.startsWith('content:')) {
            identifierToCheck = identifierToCheck.replace(/\/$/, '');
          }
          
          // 削除された投稿の識別子と一致する場合は除外
          for (const deletedIdentifier of deletedPostIdentifiers) {
            const normalizedDeleted = deletedIdentifier.replace(/\/$/, '');
            if (normalizedDeleted === identifierToCheck) {
              return false; // 削除された投稿なので除外
            }
          }
          
          return true; // 削除されていない投稿なので含める
        });
        console.log(`削除された投稿を除外: ${beforeDeletedFilterCount}件 → ${allPosts.length}件`);
      }
      
      // Xのデータの場合、リツイートと返信を排除
      if (analysisDataSource === 'x' || analysisDataSource === 'all') {
        const beforeFilterCount = allPosts.length;
        console.log('フィルタリング前の投稿数:', beforeFilterCount);
        
        allPosts = allPosts.filter((post: any) => {
          // X投稿かどうかを判定（tweet_idがあるかどうか）
          const rawData = post.rawData || {};
          const hasTweetId = !!(
            post.tweet_id || 
            post.tweetId || 
            post['Tweet ID'] || 
            post['TweetID'] || 
            post['tweet_id'] ||
            rawData.tweet_id ||
            rawData.tweetId ||
            rawData['Tweet ID'] ||
            rawData['TweetID'] ||
            rawData['tweet_id']
          );
          
          // Xからを選択した場合、X投稿のみを対象とする
          if (analysisDataSource === 'x' && !hasTweetId) {
            return false;
          }
          
          // X投稿でない場合はそのまま通過（両方からの場合）
          if (!hasTweetId) return true;
          
          // X投稿の場合は、リツイートと返信を除外
          const content = (post.content || post.text || post['Post Content'] || post['Text'] || '').trim();
          
          if (!content) return false;
          
          // RT（リツイート）を除外（"RT @" で始まる、または "RT:" で始まる）
          const rtPattern = /^(RT\s*@|RT\s*:|rt\s*@|rt\s*:)/i;
          if (rtPattern.test(content)) {
            return false;
          }
          
          // 返信を除外（先頭の空白や改行を除いた後に"@"で始まる）
          const trimmedContent = content.replace(/^[\s\n\r\t]+/, '');
          if (trimmedContent.startsWith('@')) {
            return false;
          }
          
          // ハッシュタグから始まる投稿も除外（リツイートと返信を削除する場合）
          // 先頭の空白や改行を除いた後に"#"で始まる
          if (trimmedContent.startsWith('#')) {
            return false;
          }
          
          return true;
        });
        
        console.log('フィルタリング後の投稿数:', allPosts.length);
        
        // フィルタリング後のデータが空の場合、より詳細なエラーメッセージを表示
        if (allPosts.length === 0) {
          if (analysisDataSource === 'x') {
            if (beforeFilterCount === 0) {
              throw new Error('提供されたCSVデータはヘッダー行のみで、投稿内容が一切含まれていないため、分析を行うことができません。');
            } else {
              throw new Error('XのCSVデータからリツイートと返信を除外した結果、分析可能な投稿が残りませんでした。リツイートや返信以外の投稿が含まれていることを確認してください。');
            }
          } else {
            throw new Error('提供されたCSVデータはヘッダー行のみで、投稿内容が一切含まれていないため、分析を行うことができません。');
          }
        }
      }
      
      // パース結果が空の場合はエラー
      if (allPosts.length === 0) {
        throw new Error('提供されたCSVデータはヘッダー行のみで、投稿内容が一切含まれていないため、分析を行うことができません。');
      }
      
      // X投稿の場合、テキストデータが含まれているか確認
      if (analysisDataSource === 'x' || analysisDataSource === 'all') {
        const postsWithContent = allPosts.filter((post: any) => {
          const content = post.content || post.text || post['Post Content'] || post['Text'] || '';
          return content && content.trim().length > 0;
        });
        
        console.log(`テキストデータチェック: 全投稿数=${allPosts.length}, テキストあり=${postsWithContent.length}`);
        if (postsWithContent.length > 0 && postsWithContent.length <= 3) {
          console.log('テキストデータのサンプル:', postsWithContent.map((p: any) => ({
            content: (p.content || p.text || '').substring(0, 50),
            hasText: !!(p.text),
            hasContent: !!(p.content)
          })));
        }
        
        if (postsWithContent.length === 0) {
          console.error('X投稿のテキストデータが取得できませんでした。最初の3件の投稿:', allPosts.slice(0, 3).map((p: any) => ({
            keys: Object.keys(p),
            text: p.text,
            content: p.content,
            Text: p.Text,
            'Post Content': p['Post Content']
          })));
          throw new Error('提供されたCSVデータには、投稿内容を分析するための具体的なテキストデータが含まれておりません。そのため、投稿者のパーソナリティ、絵文字の使用傾向、性格・特徴・興味・話の構成などを分析することができません。');
        }
      }
      
      // 100件以下の場合は全て使用、100件を超える場合はランダムに100件をサンプリング
      let selectedPosts: any[] = [];
      if (allPosts.length <= 100) {
        selectedPosts = allPosts;
      } else {
        // エンゲージメントが分かる投稿を抽出
        const postsWithEngagement = allPosts.filter((post: any) => {
          const eng = post.engagement || post.favorite_count || post.likes || post['Likes'] || 0;
          return Number(eng) > 0;
        });
        
        if (postsWithEngagement.length > 0) {
          // エンゲージメントでソート（高い順）
          const sortedByEngagement = [...postsWithEngagement].sort((a: any, b: any) => {
            const aEng = a.engagement || a.favorite_count || a.likes || a['Likes'] || 0;
            const bEng = b.engagement || b.favorite_count || b.likes || b['Likes'] || 0;
            return Number(bEng) - Number(aEng);
          });
          
          // エンゲージメント上位30件を優先的に選択
          const topEngagementPosts = sortedByEngagement.slice(0, 30);
          
          // 残りの投稿からランダムにサンプリング（重複を避ける）
          const remainingPosts = allPosts.filter((post: any) => {
            const key = post.content || post.text || post['Post Content'] || post['Text'] || '';
            return !topEngagementPosts.some((topPost: any) => {
              const topKey = topPost.content || topPost.text || topPost['Post Content'] || topPost['Text'] || '';
              return key && topKey && key === topKey;
            });
          });
          
          // ランダムに70件をサンプリング（Fisher-Yatesシャッフル）
          const shuffled = [...remainingPosts];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          const randomPosts = shuffled.slice(0, 70);
          
          // エンゲージメント上位とランダムを結合（合計100件）
          selectedPosts = [...topEngagementPosts, ...randomPosts];
        } else {
          // エンゲージメントが分からない場合は、全てからランダムに100件をサンプリング
          const shuffled = [...allPosts];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          selectedPosts = shuffled.slice(0, 100);
        }
        
        // 重複を除去（投稿内容で判定）
        const uniquePosts = new Map<string, any>();
        selectedPosts.forEach((post: any) => {
          const key = post.content || post.text || post['Post Content'] || post['Text'] || '';
          if (key && !uniquePosts.has(key)) {
            uniquePosts.set(key, post);
          }
        });
        
        selectedPosts = Array.from(uniquePosts.values()).slice(0, 100);
      }
        
        // 選択された投稿をCSV形式に戻す
      if (selectedPosts.length > 0) {
        const originalHeader = sampledCsv.split('\n')[0];
          const headers = originalHeader.split(',').map((h: string) => h.trim().replace(/^"|"$/g, ''));
          
        const dataRows = selectedPosts.map((post: any) => {
            return headers.map((header: string) => {
              // ヘッダー名に基づいて値を取得（大文字小文字を区別しない、複数のキーを試す）
              const headerLower = header.toLowerCase();
              const value = post[header] || post[header.toLowerCase()] || post[header.toUpperCase()] || 
                           post[headerLower] || post[headerLower.charAt(0).toUpperCase() + headerLower.slice(1)] || '';
              const strValue = String(value);
              
              // CSV形式にエスケープ（カンマ、ダブルクォート、改行を含む場合）
              if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
                return `"${strValue.replace(/"/g, '""')}"`;
              }
              return strValue;
            }).join(',');
          });
          
          optimizedCsv = [originalHeader, ...dataRows].join('\n');
      } else {
        // 選択された投稿がない場合は、サンプリングデータを使用
        optimizedCsv = sampledCsv;
      }
    } catch (error) {
      console.warn('CSV最適化に失敗:', error);
      // エラーが発生した場合は、エラーを再スロー（呼び出し元で処理）
      if (error instanceof Error && error.message.includes('ヘッダー行のみ')) {
        throw error;
      }
      // その他のエラーの場合は、サンプリングデータを使用
      if (!optimizedCsv) {
        optimizedCsv = sampleCsvForAnalysis(combinedCsv, 100);
    }
    }
  } else {
    // パース関数が提供されていない場合は、サンプリングのみ
    optimizedCsv = sampleCsvForAnalysis(combinedCsv, 100);
  }
  
  // optimizedCsvがヘッダー行のみでないかチェック
  const csvLines = optimizedCsv.split('\n').filter(line => line.trim());
  if (csvLines.length <= 1) {
    throw new Error('提供されたCSVデータはヘッダー行のみで、投稿内容が一切含まれていないため、分析を行うことができません。');
  }
  
  // CSVデータを安全に処理（プロンプトに埋め込むため）
  // テンプレートリテラル内では改行はそのまま保持されるが、
  // 制御文字や不正な文字を除去
  let safeCsv = optimizedCsv
    .replace(/\r\n/g, '\n')  // CRLFをLFに統一
    .replace(/\r/g, '\n')     // CRをLFに統一
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // 制御文字を除去（改行とタブは保持）
  
  // CSVデータが長すぎる場合（50000文字以上）、さらに切り詰める
  // これにより、API応答のサイズを制限してJSON解析エラーを防ぐ
  if (safeCsv.length > 50000) {
    const lines = safeCsv.split('\n');
    const header = lines[0];
    const dataLines = lines.slice(1);
    // 最初の25行と最後の25行のみを保持（合計50行）
    const trimmedLines = [
      header,
      ...dataLines.slice(0, 25),
      ...dataLines.slice(-25)
    ];
    safeCsv = trimmedLines.join('\n');
  }
  
  const prompt = `
    あなたはSNSコンサルタントです。以下の[過去の投稿CSVデータ]を分析してください。

    【タスク1: パーソナリティ分析】
    投稿内容から、このユーザーの以下の特徴を推測・言語化してください。
    - persona: 一人称と名前を「・」で区切って表記（例: 私・らくらスタイル、僕・投稿主）。一人称は「私」「僕」「俺」「自分」「わたくし」「あたし」などから選択。名前は投稿主の実際の名前やブランド名を入れる。文体や口調は含めない。
    - emoji: 絵文字の使用傾向
    - character: 投稿者の性格・特徴・興味・話の構成をじっくり分析し、200文字以上でしっかりと傾向を分析してまとめること。
      
    【タスク2: テーマ提案】
    エンゲージメント、favorite_count、view_countが多い投稿の内容を分析し、
    その投稿から抽象化できるテーマやトピックの傾向を抽出してください。
    
    次回投稿すべき**「程よいテーマ案を3つ」**を作成してください。
    
    【重要】
    - 各テーマは以下の3つの要素を改行区切りで表現してください：
      1. 主題：（何について話すか）
      2. 内容：（伝えたいメッセージ）
      3. 目的：（伝えることなのか、連絡が欲しいのか、セミナーやLINE公式に登録してほしいのかなど）
    - 各要素は改行で区切り、以下の形式で出力してください：
      主題：朝の時間活用
      内容：時間管理の重要性を伝える
      目的：セミナー参加を促す
    - 各行は15～25文字程度で表現してください
    - 抽象的すぎる例（避ける）：「時間管理」「働き方の工夫」「日常の小さな発見」
    - 具体的すぎる例（避ける）：「朝の時間を有効活用する3つの方法について詳しく説明し、セミナーへの参加を促す」
    - CSVデータにtitle列がある場合、投稿にはタイトルが含まれています。タイトルの内容からもテーマを抽出してください
    - テーマは、過去の投稿の内容から考察した、抽象的すぎず具体的すぎない、程よいトピックとして作成してください

    出力は必ず以下の **JSON形式のみ** で返してください。
    {
      "settings": {
        "persona": "...",
        "emoji": "...",
        "character": "..."
      },
      "themes": ["テーマ案1", "テーマ案2", "テーマ案3"]
    }

    [過去の投稿CSVデータ]:
    ${safeCsv}
  `;

  try {
    const text = await callSecureApi(prompt, token, 'theme', userId);
    
    // 🔥 JSON抽出ロジックの強化
    let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }

    // JSONパース前に、不正な文字を除去
    // 制御文字や不正なエスケープシーケンスを除去
    cleanText = cleanText
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // 制御文字を除去（改行とタブは保持）
      .replace(/\\u0000/g, '');          // null文字を除去

    try {
    return JSON.parse(cleanText);
    } catch (parseError: any) {
      console.error("JSON parse error:", parseError);
      console.error("Problematic JSON (first 1000 chars):", cleanText.substring(0, 1000));
      console.error("Problematic JSON (last 1000 chars):", cleanText.substring(Math.max(0, cleanText.length - 1000)));
      
      // より積極的な修正を試みる
      let fixedText = cleanText;
      
      try {
        // 方法1: 文字列リテラル内の不正な文字を除去（ネストされた引用符に対応）
        fixedText = fixedText.replace(/"([^"\\]|\\.)*"/g, (match: string) => {
          // エスケープされた文字を保護しながら処理
          let content = match.slice(1, -1); // 最初と最後の引用符を除去
          // エスケープシーケンスを一時的に置換
          const escapes: string[] = [];
          content = content.replace(/\\(.)/g, (_, char) => {
            const id = `__ESCAPE_${escapes.length}__`;
            escapes.push(char);
            return id;
          });
          
          // 制御文字を除去
          content = content.replace(/[\x00-\x1F\x7F]/g, '');
          
          // エスケープシーケンスを復元
          content = content.replace(/__ESCAPE_(\d+)__/g, (_, index) => {
            const char = escapes[parseInt(index)];
            if (char === 'n') return '\\n';
            if (char === 'r') return '\\r';
            if (char === 't') return '\\t';
            if (char === '"') return '\\"';
            if (char === '\\') return '\\\\';
            return `\\${char}`;
          });
          
          return `"${content}"`;
        });
        
        return JSON.parse(fixedText);
      } catch (secondError: any) {
        console.error("Second parse attempt failed:", secondError);
        
        // 方法2: 不完全なJSONを検出して修復を試みる
        try {
          // 最後の不完全な文字列を検出して修復
          let repairedText = fixedText;
          
          // 開いている引用符の数をカウント
          let quoteCount = 0;
          let inString = false;
          let escapeNext = false;
          
          for (let i = 0; i < repairedText.length; i++) {
            const char = repairedText[i];
            if (escapeNext) {
              escapeNext = false;
              continue;
            }
            if (char === '\\') {
              escapeNext = true;
              continue;
            }
            if (char === '"') {
              inString = !inString;
              if (inString) quoteCount++;
            }
          }
          
          // 文字列が閉じられていない場合、閉じる
          if (inString) {
            repairedText += '"';
          }
          
          // 最後の不完全なオブジェクトを検出
          let braceCount = 0;
          let bracketCount = 0;
          for (let i = 0; i < repairedText.length; i++) {
            const char = repairedText[i];
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
            if (char === '[') bracketCount++;
            if (char === ']') bracketCount--;
          }
          
          // 閉じられていない括弧を閉じる
          while (braceCount > 0) {
            repairedText += '}';
            braceCount--;
          }
          while (bracketCount > 0) {
            repairedText += ']';
            bracketCount--;
          }
          
          return JSON.parse(repairedText);
        } catch (thirdError: any) {
          console.error("Third parse attempt failed:", thirdError);
          
          // 方法3: 部分的なJSON抽出を試みる
          try {
            // settingsオブジェクトを個別に抽出
            const settingsMatch = cleanText.match(/"settings"\s*:\s*\{[^}]*\}/);
            const themesMatch = cleanText.match(/"themes"\s*:\s*\[[^\]]*\]/);
            
            if (settingsMatch && themesMatch) {
              const settingsStr = settingsMatch[0].replace(/"settings"\s*:\s*/, '');
              const themesStr = themesMatch[0].replace(/"themes"\s*:\s*/, '');
              
              try {
                const settings = JSON.parse(settingsStr);
                const themes = JSON.parse(themesStr);
                return { settings, themes };
              } catch (e) {
                // 個別パースも失敗
              }
            }
          } catch (fourthError: any) {
            console.error("Fourth parse attempt failed:", fourthError);
          }
          
          throw new Error(`JSON解析エラー: ${parseError.message}. 応答データに不正な文字が含まれている可能性があります。`);
        }
      }
    }
  } catch (error: any) {
    console.error("Analysis failed:", error);
    throw new Error(error.message || "分析に失敗しました。もう一度試してみてください。");
  }
};

const generateTrendThemes = async (token: string, userId: string) => {
  const prompt = `
    あなたはトレンドマーケターです。
    **現在日時(${new Date().toLocaleDateString()})、季節、SNSでの一般的な流行**を考慮し、
    多くの反応が見込める**「程よいテーマ案を3つ」**作成してください。
    
    【重要】
    - 各テーマは以下の3つの要素を改行区切りで表現してください：
      1. 主題：（何について話すか）
      2. 内容：（伝えたいメッセージ）
      3. 目的：（伝えることなのか、連絡が欲しいのか、セミナーやLINE公式に登録してほしいのかなど）
    - 各要素は改行で区切り、以下の形式で出力してください：
      主題：朝の時間活用
      内容：時間管理の重要性を伝える
      目的：セミナー参加を促す
    - 各行は15～25文字程度で表現してください
    - 抽象的すぎる例（避ける）：「時間管理」「働き方の工夫」「日常の小さな発見」
    - 具体的すぎる例（避ける）：「朝の時間を有効活用する3つの方法について詳しく説明し、セミナーへの参加を促す」
      
    出力は必ず **純粋なJSON配列形式 (例: ["テーマA", "テーマB", "テーマC"])** で返してください。
  `;

  try {
    const text = await callSecureApi(prompt, token, 'theme', userId);
    
    // 🔥 JSON抽出ロジックの強化
    let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const firstBracket = cleanText.indexOf('[');
    const lastBracket = cleanText.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1) {
      cleanText = cleanText.substring(firstBracket, lastBracket + 1);
    }

    return JSON.parse(cleanText);
  } catch (error: any) {
    console.error("Trend generation failed:", error);
    throw new Error(error.message || "トレンドの取得に失敗しました。もう一度試してみてください。");
  }
};

// 禁止文字（*, #）を強制的に除去する関数
// 禁止文字（*, #）を強制的に除去する関数（本文用）
const sanitizeForbiddenChars = (text: string): string => {
  if (!text) return text;
  return text.replace(/[#*]/g, '');
};

// アスタリスクのみを除去する関数（ハッシュタグを保持する場合用）
const sanitizeAsteriskOnly = (text: string): string => {
  if (!text) return text;
  return text.replace(/\*/g, '');
};

// 文章を書き換えプロンプトで改善する関数
const rewritePostWithChecks = async (originalPost: string, settings: any, token: string, userId: string, hasTitle: boolean = false) => {
  const minLength = typeof settings.minLength === 'number' ? settings.minLength : (parseInt(String(settings.minLength || 50), 10) || 50);
  const maxLength = typeof settings.maxLength === 'number' ? settings.maxLength : (parseInt(String(settings.maxLength || 150), 10) || 150);
  
  let currentPost = sanitizeForbiddenChars(originalPost);
  
  // ① AI臭チェック
  const aiCheckPrompt = `
以下の文章を読んで、「AIっぽい」と感じる可能性がある箇所を具体的に探し、・なぜAIっぽく感じるか・人が書いた感を出すならどう直すかという観点で修正してください。

【元の文章】
${currentPost}

【最重要: 文字数制限（絶対厳守）】
★★★ 文字数は必ず ${minLength}文字以上、${maxLength}文字以内 ★★★
目安: ${Math.round((minLength + maxLength) / 2)}文字前後

【出力ルール】
1. AIっぽさや決まりきった一般論は避けてください。
2. 禁止文字: '*' や '#' は絶対に使用しないでください。
3. 「」の使用は必要最小限に。
4. 話題が散らばらないように。
5. 【最重要】修正後の投稿文のみを出力してください。説明、補足、プロンプトに対する受け答えは一切不要です。
`;
  
  try {
    currentPost = await callSecureApi(aiCheckPrompt, token, 'post', userId);
    currentPost = sanitizeForbiddenChars(currentPost);
  } catch (error) {
    console.error('AI臭チェックエラー:', error);
    // エラーが発生しても続行
  }
  
  // ② 人間チェック（違和感検出）
  const humanCheckPrompt = `
以下の文章を、忙しい社会人や文章を流し読みする人が読んだとき、引っかかりそうな一文、読み飛ばされそうな一文、不自然に感じる言い回しを探し、修正してください。

【元の文章】
${currentPost}

【最重要: 文字数制限（絶対厳守）】
★★★ 文字数は必ず ${minLength}文字以上、${maxLength}文字以内 ★★★
目安: ${Math.round((minLength + maxLength) / 2)}文字前後

【出力ルール】
1. AIっぽさや決まりきった一般論は避けてください。
2. 禁止文字: '*' や '#' は絶対に使用しないでください。
3. 「」の使用は必要最小限に。
4. 話題が散らばらないように。
5. 【最重要】修正後の投稿文のみを出力してください。説明、補足、プロンプトに対する受け答えは一切不要です。
`;
  
  try {
    currentPost = await callSecureApi(humanCheckPrompt, token, 'post', userId);
    currentPost = sanitizeForbiddenChars(currentPost);
  } catch (error) {
    console.error('人間チェックエラー:', error);
    // エラーが発生しても続行
  }
  
  // ③ 感情にじみチェック（盛りすぎ防止）
  const emotionCheckPrompt = `
以下の文章で、感情を説明しすぎている部分、わざとらしく感じる可能性がある表現があれば探し出し、人の感情が「にじむ」表現に直してください。

【元の文章】
${currentPost}

【最重要: 文字数制限（絶対厳守）】
★★★ 文字数は必ず ${minLength}文字以上、${maxLength}文字以内 ★★★
目安: ${Math.round((minLength + maxLength) / 2)}文字前後

【出力ルール】
1. AIっぽさや決まりきった一般論は避けてください。
2. 禁止文字: '*' や '#' は絶対に使用しないでください。
3. 「」の使用は必要最小限に。
4. 話題が散らばらないように。
5. 【最重要】修正後の投稿文のみを出力してください。説明、補足、プロンプトに対する受け答えは一切不要です。
`;
  
  try {
    currentPost = await callSecureApi(emotionCheckPrompt, token, 'post', userId);
    currentPost = sanitizeForbiddenChars(currentPost);
  } catch (error) {
    console.error('感情にじみチェックエラー:', error);
    // エラーが発生しても続行
  }
  
  // ④ 説明しすぎチェック（AIあるある潰し）
  const explanationCheckPrompt = `
以下の文章で、説明しすぎている部分がないか探し出してください。削っても意味が通る箇所、あえて書かない方が自然な箇所があれば削除してください。

【元の文章】
${currentPost}

【最重要: 文字数制限（絶対厳守）】
★★★ 文字数は必ず ${minLength}文字以上、${maxLength}文字以内 ★★★
目安: ${Math.round((minLength + maxLength) / 2)}文字前後

【出力ルール】
1. AIっぽさや決まりきった一般論は避けてください。
2. 禁止文字: '*' や '#' は絶対に使用しないでください。
3. 「」の使用は必要最小限に。
4. 話題が散らばらないように。
5. 【最重要】修正後の投稿文のみを出力してください。説明、補足、プロンプトに対する受け答えは一切不要です。
`;
  
  try {
    currentPost = await callSecureApi(explanationCheckPrompt, token, 'post', userId);
    currentPost = sanitizeForbiddenChars(currentPost);
  } catch (error) {
    console.error('説明しすぎチェックエラー:', error);
    // エラーが発生しても続行
  }
  
  // ⑤ 最終仕上げ（人が書いた感MAX）
  const finalCheckPrompt = `
「人が少し考えながら書いた文章」になるよう最終調整してください。完璧に整えすぎないでください。

【元の文章】
${currentPost}

【最重要: 文字数制限（絶対厳守）】
★★★ 文字数は必ず ${minLength}文字以上、${maxLength}文字以内 ★★★
目安: ${Math.round((minLength + maxLength) / 2)}文字前後
※文字数が範囲外の場合は、必ず調整してから出力してください。

【出力ルール】
1. AIっぽさや決まりきった一般論は避けてください。
2. 禁止文字: '*' や '#' は絶対に使用しないでください。
3. 「」の使用は必要最小限に。
4. 話題が散らばらないように。
5. 【最重要】修正後の投稿文のみを出力してください。説明、補足、プロンプトに対する受け答えは一切不要です。
`;
  
  try {
    currentPost = await callSecureApi(finalCheckPrompt, token, 'post', userId);
    currentPost = sanitizeForbiddenChars(currentPost);
  } catch (error) {
    console.error('最終仕上げエラー:', error);
    // エラーが発生しても続行
  }
  
  return sanitizeForbiddenChars(currentPost);
};

const generatePost = async (mode: string, topic: string, inputData: any, settings: any, token: string, userId: string, hasTitle: boolean = false) => {
  // 文字数設定を数値に変換（文字列の場合に対応）
  const minLength = typeof settings.minLength === 'number' ? settings.minLength : (parseInt(String(settings.minLength || 50), 10) || 50);
  const maxLength = typeof settings.maxLength === 'number' ? settings.maxLength : (parseInt(String(settings.maxLength || 150), 10) || 150);
  
  // personaを分解して一人称と名前を取得
  const rawPersona = settings.persona || settings.style || '私・投稿主';
  const [firstPersonRaw, nameRaw] = String(rawPersona).split('・');
  const firstPerson = firstPersonRaw || '私';
  const displayName = nameRaw || '投稿主';

  const personaInstruction = `
    【パーソナリティ設定（文体・表現方法・基礎知識のため）】
    - 一人称: ${firstPerson}
    - 自身の名前: ${displayName}（本文中で「○○」のようなプレースホルダは使わず、必ずこの名前をそのまま使用してください）
    - 絵文字の使い方: ${settings.emoji}
    - 性格・特徴: ${settings.character}

    【重要】パーソナリティ設定は、文体や表現方法、元となる投稿者の基礎知識を示すものです。テーマを考える材料ではありません。指定されたテーマに関する投稿のみを生成してください。

    【最重要: 文字数制限（絶対厳守）】
    ★★★ 文字数は必ず ${minLength}文字以上、${maxLength}文字以内 ★★★
    - この文字数制限は最優先事項です。他のどの要件よりも優先してください。
    - 生成前に必ず文字数を計算し、範囲内に収まるように調整してください。
    - ${minLength}文字未満は絶対に不可です。${maxLength}文字を超えるのも絶対に不可です。
    - 目安: ${Math.round((minLength + maxLength) / 2)}文字前後を目指してください。

    【テーマに関する最重要事項】
    ★★★ 指定されたテーマに関する内容のみを投稿してください ★★★
    - テーマから逸脱した話題は一切含めないでください。
    - 話題が多岐にわたらないよう、細心の注意を払ってください。
    - パーソナリティ設定からテーマを考えることは決してせず、あくまで指定されたテーマに沿った投稿を生成してください。

    【出力ルール（必ず守ること）】
    1. AIっぽさや決まりきった一般論は避けてください。
    2. 禁止文字: 文中で '*'（アスタリスク）や '#'（シャープ/ハッシュ）は絶対に使用しないでください。
       - Markdownの見出し記号（#）や強調（**）、箇条書き（-）は不要です。
    3. ハッシュタグも含め、本文中および文末で '#' を使う表現はすべて禁止です。
    4. 「」（かぎ括弧）の使用は必要最小限に。
    5. 話題の一貫性: 伝えたいことに対して話題が散らばらないように。
    6. 文章の構成:
       - 説明文: PREP法やステップバイステップ
       - 随筆: 起承転結や情緒的な表現
    7. 【最重要】投稿する文章以外の文は一切不要です。プロンプトに対する受け答え、説明、補足などは一切含めず、条件に合った投稿文のみを出力してください。

    この設定になりきってAIっぽくならない文章の投稿を作成してください。
  `;

  let prompt = "";
  if (mode === 'rewrite') {
    prompt = `
      ${personaInstruction}
      以下の[元の投稿]を、上記設定を活かして、より魅力的に書き直してください。
      [元の投稿]: ${inputData.sourcePost}
      
      【出力形式】
      投稿文のみを出力してください。説明や補足は一切不要です。
    `;
  } else {
    const titleInstruction = hasTitle 
      ? '\n【重要】過去の投稿にタイトルが含まれているため、投稿にもタイトルを含めてください。タイトルは1行目に記載し、タイトルと本文の間には必ず改行を2つ（空行1つ）入れてください。形式は「タイトル\n\n本文」としてください。'
      : '';
    prompt = `
      ${personaInstruction}
      以下の[テーマ]について、共感を呼ぶ魅力的なSNS投稿を作成してください。
      ${titleInstruction}
      [テーマ]: ${topic}
      
      【出力形式】
      投稿文のみを出力してください。説明や補足、プロンプトに対する受け答えは一切不要です。
      指定されたテーマに関する内容のみを含め、テーマから逸脱した話題は一切含めないでください。
    `;
  }

  try {
    const result = await callSecureApi(prompt, token, 'post', userId);
    return sanitizeForbiddenChars(result);
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// --- UI Components ---

// スマホ用ハンバーガーメニューコンポーネント
const MobileMenu = ({ user, isSubscribed, onGoogleLogin, onLogout, onManageSubscription, onUpgrade, isPortalLoading, onOpenXSettings }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <div className="md:hidden relative" ref={menuRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center w-10 h-10 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="メニュー"
      >
        {isOpen ? <XIcon size={24} /> : <Menu size={24} />}
      </button>

      {isOpen && (
        <>
          {/* オーバーレイ */}
          <div 
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setIsOpen(false)}
          />
          {/* メニューパネル */}
          <div className="fixed top-16 right-0 bottom-0 w-80 bg-white shadow-xl z-50 overflow-y-auto">
            <div className="p-4 space-y-4">
              {/* ユーザー情報 */}
              {user ? (
                <>
                  <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/50 rounded-lg">
                    <p className="text-sm font-medium text-slate-900 truncate">{user.email}</p>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      {isSubscribed ? <><Check size={12} className="text-green-500"/> Proプラン契約中</> : '無料プラン'}
                    </p>
                    {isSubscribed && (
                      <span className="inline-block mt-2 text-[10px] font-bold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                        <Check size={10} strokeWidth={3} /> 契約中
                      </span>
                    )}
                  </div>

                  {/* SNSリンク */}
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-500 px-2">SNSリンク</p>
                    <div className="flex items-center gap-3 px-2">
                      <a 
                        href="https://x.com/home" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-slate-700 hover:text-black transition-colors p-2 hover:bg-slate-100 rounded-lg"
                        onClick={() => setIsOpen(false)}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                        </svg>
                        <span className="text-sm">X</span>
                      </a>
                      <a 
                        href="https://www.facebook.com/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-slate-700 hover:text-blue-600 transition-colors p-2 hover:bg-slate-100 rounded-lg"
                        onClick={() => setIsOpen(false)}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                        </svg>
                        <span className="text-sm">Facebook</span>
                      </a>
                      <a 
                        href="https://www.instagram.com" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-slate-700 hover:text-pink-600 transition-colors p-2 hover:bg-slate-100 rounded-lg"
                        onClick={() => setIsOpen(false)}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                        </svg>
                        <span className="text-sm">Instagram</span>
                      </a>
                    </div>
                  </div>

                  <div className="h-px bg-slate-200"></div>

                  {/* 設定メニュー */}
                  <div className="space-y-1">
                    {isSubscribed ? (
                      <button 
                        onClick={() => { onManageSubscription(); setIsOpen(false); }}
                        disabled={isPortalLoading}
                        className="w-full text-left flex items-center gap-3 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <div className="bg-blue-50 p-1.5 rounded text-blue-600">
                          {isPortalLoading ? <Loader2 size={16} className="animate-spin"/> : <CreditCard size={16} />}
                        </div>
                        契約内容の確認・解約
                      </button>
                    ) : (
                      <button 
                        onClick={() => { onUpgrade(); setIsOpen(false); }}
                        disabled={isPortalLoading}
                        className="w-full text-left flex items-center gap-3 px-3 py-2.5 text-sm text-slate-700 hover:bg-orange-50 hover:text-orange-700 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <div className="bg-orange-100 p-1.5 rounded text-orange-500">
                          {isPortalLoading ? <Loader2 size={16} className="animate-spin"/> : <Zap size={16} className="fill-orange-500" />}
                        </div>
                        Proプランに登録
                      </button>
                    )}
                    
                    <button 
                      onClick={() => { onOpenXSettings(); setIsOpen(false); }}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                    >
                      <div className="bg-black p-1.5 rounded text-white">
                        <Send size={16} />
                      </div>
                      X設定
                    </button>

                    <button 
                      onClick={() => { 
                        window.open('https://docs.google.com/presentation/d/13usgF8xliRE4onBYtZ-k978YXsE5Aici6yQe9rm3yQI/edit?usp=sharing', '_blank');
                        setIsOpen(false);
                      }}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                    >
                      <div className="bg-[#066099] p-1.5 rounded text-white">
                        <BookOpen size={16} />
                      </div>
                      マニュアル
                    </button>

                    <div className="h-px bg-slate-200 my-2"></div>

                    <button 
                      onClick={() => { onLogout(); setIsOpen(false); }}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <div className="p-1.5">
                        <LogOut size={16} />
                      </div>
                      ログアウト
                    </button>
                  </div>
                </>
              ) : (
                <button 
                  onClick={() => { onGoogleLogin(); setIsOpen(false); }}
                  className="w-full text-center bg-[#066099] text-white py-3 rounded-lg hover:bg-[#055080] font-bold text-sm"
                >
                  ログイン
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// 🔥 ドロップダウンメニューコンポーネントの追加
const SettingsDropdown = ({ user, isSubscribed, onLogout, onManageSubscription, onUpgrade, isPortalLoading, onOpenXSettings, blogData, getBlogCsvForDownload, getAllDataCsvForDownload }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuRef]);

  return (
    <div className="relative" ref={menuRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-xs border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors text-slate-600 bg-white shadow-sm"
      >
        <Settings size={14} />
        <span>設定</span>
        <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-50 animate-in fade-in zoom-in-95 duration-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-50 bg-slate-50/50">
            <p className="text-xs font-medium text-slate-900 truncate">{user.email}</p>
            <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
              {isSubscribed ? <><Check size={10} className="text-green-500"/> Proプラン契約中</> : '無料プラン'}
            </p>
          </div>
          
          <div className="p-1.5 space-y-0.5">
            {isSubscribed ? (
              <button 
                onClick={() => { onManageSubscription(); setIsOpen(false); }}
                disabled={isPortalLoading}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50"
              >
                <div className="bg-blue-50 p-1 rounded text-blue-600">
                  {isPortalLoading ? <Loader2 size={14} className="animate-spin"/> : <CreditCard size={14} />}
                </div>
                契約内容の確認・解約
              </button>
            ) : (
              <button 
                onClick={() => { onUpgrade(); setIsOpen(false); }}
                disabled={isPortalLoading}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-orange-50 hover:text-orange-700 rounded-lg transition-colors disabled:opacity-50"
              >
                <div className="bg-orange-100 p-1 rounded text-orange-500">
                  {isPortalLoading ? <Loader2 size={14} className="animate-spin"/> : <Zap size={14} className="fill-orange-500" />}
                </div>
                Proプランに登録
              </button>
            )}
            
            <div className="h-px bg-slate-100 my-1 mx-2"></div>

            <button 
              onClick={() => { onOpenXSettings(); setIsOpen(false); }}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <div className="bg-black p-1 rounded text-white">
                <Send size={14} />
              </div>
              X設定
            </button>

            {blogData && blogData.trim() && (
              <>
                <div className="h-px bg-slate-100 my-1 mx-2"></div>
                <button 
                  onClick={() => {
                    // CSVダウンロード処理
                    const csvForDownload = getBlogCsvForDownload ? getBlogCsvForDownload(blogData) : blogData;
                    const blob = new Blob([`\uFEFF${csvForDownload}`], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    link.setAttribute('href', url);
                    link.setAttribute('download', `blog_data_${new Date().toISOString().split('T')[0]}.csv`);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                    setIsOpen(false);
                  }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  <div className="bg-[#066099] p-1 rounded text-white">
                    <Download size={14} />
                  </div>
                  ブログデータCSVをダウンロード
                </button>
              </>
            )}

            {getAllDataCsvForDownload && (
              <>
                <div className="h-px bg-slate-100 my-1 mx-2"></div>
                <button
                  onClick={() => {
                    const csvForDownload = getAllDataCsvForDownload();
                    const blob = new Blob([`\uFEFF${csvForDownload}`], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    link.setAttribute('href', url);
                    link.setAttribute('download', `all_data_${new Date().toISOString().split('T')[0]}.csv`);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                    setIsOpen(false);
                  }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  <div className="bg-slate-700 p-1 rounded text-white">
                    <Download size={14} />
                  </div>
                  全データCSVをダウンロード
                </button>
              </>
            )}

            <div className="h-px bg-slate-100 my-1 mx-2"></div>

            <button 
              onClick={() => { 
                window.open('https://docs.google.com/presentation/d/13usgF8xliRE4onBYtZ-k978YXsE5Aici6yQe9rm3yQI/edit?usp=sharing', '_blank');
                setIsOpen(false);
              }}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <div className="bg-[#066099] p-1 rounded text-white">
                <BookOpen size={14} />
              </div>
              マニュアル
            </button>
            
            <div className="h-px bg-slate-100 my-1 mx-2"></div>

            <button 
              onClick={() => { onLogout(); setIsOpen(false); }}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <div className="p-1">
                <LogOut size={14} />
              </div>
              ログアウト
            </button>
            
          </div>
          
        </div>
      )}
    </div>
  );
};

const ComboboxInput = ({ label, icon: Icon, value, onChange, options, placeholder, multiline = false }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  return (
    <div className="relative" ref={wrapperRef}>
      <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
        {Icon && <Icon size={12} />}
        {label}
      </label>
      <div className="relative group">
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onClick={() => setIsOpen(true)}
            className="w-full p-2.5 pr-8 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-slate-50 focus:bg-white transition-colors min-h-[9rem] resize-y leading-relaxed text-black"
            placeholder={placeholder}
          />
        ) : (
          <input 
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onClick={() => setIsOpen(true)}
            className="w-full p-2.5 pr-8 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-slate-50 focus:bg-white transition-colors text-black"
            placeholder={placeholder}
          />
        )}
        <button onClick={() => setIsOpen(!isOpen)} className={`absolute right-2 text-slate-400 hover:text-[#066099] transition-colors p-1 ${multiline ? 'top-2' : 'top-1/2 -translate-y-1/2'}`}>
          <ChevronDown size={14} className={`transform transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
          {options.map((option: string, i: number) => (
            <button key={i} onClick={() => { onChange(option); setIsOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-sky-50 hover:text-[#066099] transition-colors text-slate-600 border-b border-slate-50 last:border-none leading-snug">
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ModeButton = ({ active, icon: Icon, label, onClick }: any) => (
  <button onClick={onClick} className={`w-full flex items-center p-3 rounded-xl transition-all duration-200 text-sm font-bold text-left mb-2 group ${active ? 'bg-[#066099] text-white shadow-md shadow-sky-200' : 'bg-white text-slate-600 border border-slate-200 hover:bg-sky-50 hover:text-[#066099] hover:border-[#066099]/30'}`}>
    <div className={`p-1.5 rounded-lg mr-3 transition-colors ${active ? 'bg-white/20' : 'bg-slate-100 text-slate-500 group-hover:bg-sky-100 group-hover:text-[#066099]'}`}>
      <Icon size={18} />
    </div>
    {label}
    {active && <ChevronRight size={16} className="ml-auto opacity-80" />}
  </button>
);

const PersistentSettings = ({ settings, setSettings, mode, user }: any) => {
  // 文字数設定のエラー状態を管理
  const [minLengthError, setMinLengthError] = useState<string>('');
  const [maxLengthError, setMaxLengthError] = useState<string>('');
  
  // 文字数設定の値を文字列として管理（空文字列を許容）
  const minLengthValue = settings.minLength === undefined || settings.minLength === null ? '' : String(settings.minLength);
  const maxLengthValue = settings.maxLength === undefined || settings.maxLength === null ? '' : String(settings.maxLength);
  
  const handleChange = async (key: string, value: string | number | boolean) => {
    const updatedSettings = { ...settings, [key]: value };
    // 状態を更新（updateCurrentSettings関数を呼び出す）
    setSettings(updatedSettings);
    
    // Firestoreに保存
    if (user) {
      try {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);
        const currentData = userDoc.exists() ? userDoc.data() : {};
        const currentSettings = currentData.settings || {};
        
        await setDoc(userRef, {
          settings: {
            ...currentSettings,
            [mode]: updatedSettings
          }
        }, { merge: true });
      } catch (err) {
        console.error("パーソナリティ設定の保存に失敗:", err);
      }
    }
  };
  
  // 自然数かどうかをチェック（1以上の整数）
  const isNaturalNumber = (value: string): boolean => {
    if (value === '' || value === null || value === undefined) return false;
    const num = Number(value);
    return Number.isInteger(num) && num >= 1;
  };
  
  // 文字数設定の変更処理（入力時は空欄を許容）
  const handleLengthChange = (key: 'minLength' | 'maxLength', value: string) => {
    // 入力時は文字列のまま保存（空文字列も許容）
    handleChange(key, value);
    // エラーをクリア
    if (key === 'minLength') {
      setMinLengthError('');
    } else {
      setMaxLengthError('');
    }
  };
  
  // 文字数設定の確定処理（フォーカスアウト時）
  const handleLengthBlur = (key: 'minLength' | 'maxLength', defaultValue: number) => {
    const currentValue = key === 'minLength' ? minLengthValue : maxLengthValue;
    
    if (currentValue === '') {
      // 空欄の場合はデフォルト値を設定
      handleChange(key, defaultValue);
      if (key === 'minLength') {
        setMinLengthError('');
      } else {
        setMaxLengthError('');
      }
    } else if (!isNaturalNumber(currentValue)) {
      // 自然数でない場合はエラー表示とデフォルト値の設定
      const errorMsg = '自然数（1以上の整数）を入力してください';
      if (key === 'minLength') {
        setMinLengthError(errorMsg);
      } else {
        setMaxLengthError(errorMsg);
      }
      // デフォルト値を設定
      handleChange(key, defaultValue);
    } else {
      // 正常な値の場合は数値として保存
      const numValue = parseInt(currentValue, 10);
      handleChange(key, numValue);
      if (key === 'minLength') {
        setMinLengthError('');
      } else {
        setMaxLengthError('');
      }
    }
  };
  
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4 shadow-sm mt-4">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100 text-slate-700 font-bold text-sm">
        <Settings size={16} className="text-[#066099]" /><span>パーソナリティ設定</span>
      </div>
      <ComboboxInput label="一人称と自身の名前" icon={MessageCircle} value={settings.persona || settings.style || ''} onChange={(val: string) => handleChange('persona', val)} options={["私・投稿主",  "僕・投稿主","俺・投稿主", "自分・投稿主", "わたくし・投稿主", "あたし・投稿主"]} placeholder="例: 私・らくらスタイル" />
      <ComboboxInput label="絵文字の使い方" icon={Smile} value={settings.emoji} onChange={(val: string) => handleChange('emoji', val)} options={["適度に使用（文末に1つなど）", "多用する（賑やかに）", "一切使用しない", "特定の絵文字を好む（✨🚀）", "顔文字（( ^ω^ )）を使用"]} placeholder="例: 適度に使用" />
      <ComboboxInput label="性格・特徴" icon={UserIcon} value={settings.character} onChange={(val: string) => handleChange('character', val)} options={["SNS初心者\n頑張って更新している", "30代エンジニア\n技術トレンドに敏感", "熱血広報担当\n自社製品への愛が強い", "トレンドマーケター\n分析的で冷静な視点", "毒舌批評家\n本質を突くのが得意", "丁寧な暮らし系\n穏やかで情緒的"]} placeholder="例: 30代エンジニア" multiline={true} />
      
      {/* ハッシュタグ設定 */}
      <div className="pt-2 border-t border-slate-100">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.includeHashtags || false}
            onChange={(e) => handleChange('includeHashtags', e.target.checked)}
            className="w-4 h-4 text-[#066099] border-slate-300 rounded focus:ring-[#066099] focus:ring-2"
          />
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
            <Sparkles size={12} className="text-[#066099]" />
            文末にハッシュタグでキーワードを追加する
          </span>
        </label>
        {settings.includeHashtags && (
          <p className="text-[10px] text-slate-400 mt-1 ml-6">キーワードを3～4個ハッシュタグ付きで追加します</p>
        )}
      </div>
      
      {/* 文字数設定エリア */}
      <div className="pt-2 border-t border-slate-100">
        <label className="block text-xs font-bold text-slate-500 mb-2 flex items-center gap-1">
          <AlignLeft size={12} /> 文字数目安（全角文字の場合誤差が生じます）
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-[10px] text-slate-400 block mb-1">最小</span>
            <input 
              type="text" 
              inputMode="numeric"
              value={minLengthValue} 
              onChange={(e) => handleLengthChange('minLength', e.target.value)}
              onBlur={() => handleLengthBlur('minLength', 50)}
              className={`w-full p-2 text-sm border rounded-lg focus:ring-2 focus:ring-[#066099] outline-none text-right bg-slate-50 focus:bg-white transition-colors text-black ${
                minLengthError ? 'border-red-300 focus:ring-red-300' : 'border-slate-200'
              }`}
            />
            {minLengthError && (
              <p className="text-[10px] text-red-500 mt-1">{minLengthError}</p>
            )}
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block mb-1">最大</span>
            <input 
              type="text" 
              inputMode="numeric"
              value={maxLengthValue} 
              onChange={(e) => handleLengthChange('maxLength', e.target.value)}
              onBlur={() => handleLengthBlur('maxLength', 150)}
              className={`w-full p-2 text-sm border rounded-lg focus:ring-2 focus:ring-[#066099] outline-none text-right bg-slate-50 focus:bg-white transition-colors text-black ${
                maxLengthError ? 'border-red-300 focus:ring-red-300' : 'border-slate-200'
              }`}
            />
            {maxLengthError && (
              <p className="text-[10px] text-red-500 mt-1">{maxLengthError}</p>
            )}
          </div>
        </div>
      </div>

      {mode === 'mypost' && <p className="text-[10px] text-slate-400 leading-tight">※パーソナリティ分析ボタンで、取込みデータに基づいて内容が反映されます。</p>}
    </div>
  );
};

const ResultCard = ({ content, isLoading, error, onChange, user, onPostToX, isPostingToX, xAccessToken, showPostAnalysis, rewrittenContent, isRewriting }: any) => {
  const [copied, setCopied] = useState(false);
  const [isUpgradeLoading, setIsUpgradeLoading] = useState(false); 
  const [showPostModal, setShowPostModal] = useState(false);
  const [selectedDestinations, setSelectedDestinations] = useState<PostDestination[]>([]);
  const [showRewritten, setShowRewritten] = useState(true); // 書き換え後の文章を表示するか


  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 投稿先選択モーダルを開く
  const handleOpenPostModal = () => {
    setSelectedDestinations([]);
    setShowPostModal(true);
  };



  // 投稿を実行する関数
  const handlePost = () => {
    if (!content || selectedDestinations.length === 0) return;

    // Xが選択されている場合、文字数制限をチェック（全角文字は2文字として計算）
    const xCharCount = calculateXCharacterCount(content);
    if (selectedDestinations.includes('x') && xCharCount > X_CHARACTER_LIMIT) {
      const shouldContinue = confirm(
        `Xの文字数制限（${X_CHARACTER_LIMIT}文字）を超えています。\n` +
        `現在の文字数: ${xCharCount}文字（全角文字は2文字として計算）\n\n` +
        `このまま投稿すると、Xでは投稿できません。\n` +
        `書き直しますか？`
      );
      
      if (shouldContinue) {
        setShowPostModal(false);
        return; // ユーザーが書き直すことを選択
      }
    }

    // Xを選択している場合、直接投稿
    if (selectedDestinations.includes('x')) {
      setShowPostModal(false);
      if (onPostToX) {
        onPostToX(content, () => {
          setShowPostModal(false);
          setSelectedDestinations([]);
        });
      }
    }
  };


  // 🔥 API経由でStripeチェックアウトURLを取得する処理
  const handleUpgrade = async () => {
    try {
      setIsUpgradeLoading(true);
      const user = auth.currentUser;
      if (!user) {
        alert("ログインが必要です");
        return;
      }

      // IDトークンを取得
      const token = await user.getIdToken();

      // Stripe Checkoutセッション作成APIを呼び出し
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '決済ページの作成に失敗しました');
      }

      if (data.url) {
        // Stripeの決済ページへ移動
        window.location.href = data.url;
      }
    } catch (error: any) {
      console.error("Upgrade Error:", error);
      alert("エラーが発生しました: " + error.message);
    } finally {
      setIsUpgradeLoading(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-full min-h-[500px] transition-all duration-500">
      <div className="bg-gradient-to-r from-sky-50 to-white px-4 py-3 border-b border-slate-200 flex justify-between items-center">
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2"><Sparkles size={14} className="text-[#066099]" />{showPostAnalysis ? '投稿内容' : '生成結果'}</span>
        <div className="flex items-center gap-2">
          {content && !isLoading && !error && (
            <>
              <button 
                onClick={handleOpenPostModal} 
                className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all bg-[#066099] text-white hover:bg-[#055080]"
                title="Xに投稿"
              >
                <Send size={14} />
                Xに投稿
              </button>
            </>
          )}
        <button onClick={handleCopy} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${copied ? 'bg-green-50 text-green-600' : 'text-slate-500 hover:text-[#066099] hover:bg-sky-50'}`}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'コピー完了' : 'コピー'}</button>
        </div>
      </div>
      <div className="flex-1 relative min-h-0 flex flex-col">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-red-500 bg-red-50 p-6 rounded-xl text-sm flex flex-col gap-3 items-center max-w-sm text-center shadow-sm border border-red-100">
              <span className="text-3xl">⚠️</span> 
              <span className="font-bold text-base whitespace-pre-wrap">{error}</span>
              
              {/* 無料枠上限エラー時のボタン処理 */}
              {error.includes("無料枠") && (
                <div className="flex flex-col items-center mt-2 w-full">
                  <div className="bg-white/60 p-3 rounded-lg mb-3 w-full border border-red-100">
                    <p className="text-slate-700 font-bold mb-1">Proプランに登録</p>
                    <p className="text-xs text-slate-500">月額980円でほぼ使い放題</p>
                  </div>
                  
                  {/* API呼び出しボタン */}
                  <button 
                    onClick={handleUpgrade}
                    disabled={isUpgradeLoading}
                    className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white px-6 py-3 rounded-full text-sm font-bold hover:from-orange-600 hover:to-red-600 transition shadow-md flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isUpgradeLoading ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} className="fill-white" />}
                    {isUpgradeLoading ? "処理中..." : "今すぐ登録する"}
                  </button>
                  
                  <p className="text-[10px] text-slate-400 mt-2">※いつでもキャンセル可能です</p>
                </div>
              )}
            </div>
          </div>
        ) : isLoading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-3 bg-white/50 backdrop-blur-sm z-10"><Loader2 size={40} className="animate-spin text-[#066099]" /><p className="text-sm font-medium animate-pulse">AIが執筆中...</p></div>
        ) : !content ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 gap-3 border-2 border-dashed border-slate-100 rounded-lg m-6"><Sparkles size={40} className="text-slate-200" /><p className="text-sm font-medium">テーマを選んで「生成」ボタンを押してください</p></div>
        ) : (
          <div className="flex flex-col h-full min-h-0">
            {/* 書き換え中の表示 */}
            {isRewriting && (
              <div className="flex items-center justify-center py-4 text-slate-400 gap-2 flex-shrink-0">
                <Loader2 size={16} className="animate-spin text-[#066099]" />
                <p className="text-xs font-medium">文章を改善中（5段階のチェックを実行中）...</p>
              </div>
            )}
            
            {/* 書き換え後の文章（または元の生成結果） */}
            <div className="flex-1 min-h-0 flex flex-col p-6">
          <textarea
                className="w-full flex-1 min-h-[500px] whitespace-pre-wrap text-slate-800 leading-relaxed font-sans text-sm animate-in fade-in duration-500 bg-transparent focus:ring-0 resize-y outline-none"
                value={rewrittenContent || content}
            onChange={(e) => onChange && onChange(e.target.value)}
            placeholder="生成された内容がここに表示されます。直接編集も可能です。"
          />
            </div>
          </div>
        )}
      </div>

      {/* 投稿確認モーダル */}
      {showPostModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Send size={20} className="text-[#066099]" />
                Xに投稿
              </h3>
              <button 
                onClick={() => {
                  setShowPostModal(false);
                  setSelectedDestinations([]);
                }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <XIcon size={20} />
              </button>
            </div>
            
            <div className="space-y-3">
              {/* X設定チェック */}
              {!xAccessToken && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-700 font-bold mb-1">⚠️ X設定が必要です</p>
                  <p className="text-xs text-amber-600">Xへの投稿には、設定メニューからX API認証情報の設定をお願いします。</p>
                </div>
              )}
              
              {/* 投稿内容プレビュー */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500 mb-2 font-bold">投稿内容（プレビュー）</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{content}</p>
                {(() => {
                  const xCharCount = calculateXCharacterCount(content);
                  return (
                    <p className={`text-xs mt-2 ${xCharCount > X_CHARACTER_LIMIT ? 'text-red-500 font-bold' : 'text-slate-500'}`}>
                      文字数: {xCharCount} / {X_CHARACTER_LIMIT}文字（Xの制限・全角は2文字）
                    </p>
                  );
                })()}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  setShowPostModal(false);
                  setSelectedDestinations([]);
                }}
                className="flex-1 px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  if (!xAccessToken) {
                    setShowPostModal(false);
                    alert('X設定が必要です。設定メニューからX API認証情報を設定してください。');
                    return;
                  }
                  setSelectedDestinations(['x']);
                  handlePost();
                }}
                disabled={!xAccessToken}
                className="flex-1 px-4 py-2 text-sm font-bold text-white bg-[#066099] rounded-lg hover:bg-[#055080] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Send size={16} />
                投稿する
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default function SNSGeneratorApp() {
  const [isClient, setIsClient] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeMode, setActiveMode] = useState('trend'); 
  const [isSubscribed, setIsSubscribed] = useState(false); // 🔥 追加: サブスク状態
  const [isPortalLoading, setIsPortalLoading] = useState(false); // 🔥 追加: ポータル読み込み中

  const [manualInput, setManualInput] = useState('');
  const [selectedTheme, setSelectedTheme] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true);
  
  // XのCSVデータ
  const [csvData, setCsvData] = useState('Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200');
  const [csvUploadDate, setCsvUploadDate] = useState<string | null>(null);
  
  // ブログデータ
  const [blogData, setBlogData] = useState<string>('');
  const [blogUploadDate, setBlogUploadDate] = useState<string | null>(null);
  
  // 削除された投稿の識別子を保存（tweet_idやURL）
  const [deletedPostIdentifiers, setDeletedPostIdentifiers] = useState<Set<string>>(new Set());
  
  // 分析用のデータソース選択（ラジオボタン用）
  // デフォルトはブログ投稿
  const [dataSource, setDataSource] = useState<'csv' | 'blog' | 'all'>('blog');
  
  // 分析・更新用のデータソース選択（'x' | 'blog' | 'all'）
  // デフォルトはブログ投稿（ユーザー設定があれば後で上書き）
  const [analysisDataSource, setAnalysisDataSource] = useState<'x' | 'blog' | 'all'>('blog');
  
  // マイ投稿分析用の状態（選択されたデータソースから生成）
  const [parsedPosts, setParsedPosts] = useState<any[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sortBy, setSortBy] = useState<string>('engagement-desc');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showPostAnalysis, setShowPostAnalysis] = useState(false);
  const [excludeRTAndReplies, setExcludeRTAndReplies] = useState(true); // デフォルトでRT・返信を除外
  // Xデータの取込みは常に「追加」のみ（差替えは一括削除→再取込みとする）
  // ※ 互換性のため state は残すが、常に 'append' として扱う
  const [csvImportMode] = useState<'replace' | 'append'>('append');
  const [showCsvImportModal, setShowCsvImportModal] = useState(false);
  const [pendingCsvData, setPendingCsvData] = useState<string>('');
  const [isCsvLoading, setIsCsvLoading] = useState(false);
  const [showDataListModal, setShowDataListModal] = useState(false);
  const [dataListModalType, setDataListModalType] = useState<'csv' | 'blog' | null>(null);
  const [showDataImportModal, setShowDataImportModal] = useState(false); // データ取込みモーダル
  
  // セクション選択状態（取込み、分析・更新、投稿一覧のいずれか1つだけ表示）
  const [selectedSection, setSelectedSection] = useState<'import' | 'analysis' | 'posts' | null>(null);
  
  // ブログ取り込み用の状態
  const [sitemapUrl, setSitemapUrl] = useState(''); // サイトマップURL
  const [sitemapUrls, setSitemapUrls] = useState<Array<{ url: string; date: string; title?: string }>>([]); // サイトマップから取得したURL一覧
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set()); // 選択されたURL
  const [blogUrls, setBlogUrls] = useState<string[]>([]); // 取り込んだURLの一覧
  const [blogUrlDates, setBlogUrlDates] = useState<{ [url: string]: string }>({}); // 各URLの取込み日時
  const [isBlogImporting, setIsBlogImporting] = useState(false);
  const [isSitemapLoading, setIsSitemapLoading] = useState(false);
  const [blogImportProgress, setBlogImportProgress] = useState('');
  const [blogCacheInfo, setBlogCacheInfo] = useState<{ cachedAt: number; fromCache: boolean; isExpired?: boolean } | null>(null);
  const [showSitemapUrlModal, setShowSitemapUrlModal] = useState(false); // サイトマップURL選択モーダル
  // ブログデータの取込みも常に「追加」のみ（差替えは一括削除→再取込みとする）
  // 単独記事URL用の状態
  const [singleArticleUrl, setSingleArticleUrl] = useState(''); // 単独記事URL
  const [urlImportType, setUrlImportType] = useState<'sitemap' | 'entry' | 'article'>('sitemap'); // URL取り込みタイプ
  
  // ファイル選択前のモード選択ダイアログ
  // 以前のCSVモード選択モーダルは廃止（常に追加のみ）
  // URL入力ダイアログ
  const [showUrlInputModal, setShowUrlInputModal] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CSVキャッシュ用のユーティリティ関数
  const CSV_CACHE_KEY = (userId: string) => `csv_cache_${userId}`;
  const CSV_METADATA_KEY = (userId: string) => `csv_metadata_${userId}`;
  const CSV_EXPIRY_KEY = (userId: string) => `csv_expiry_${userId}`;
  
  // CSVキャッシュの有効期限（1年）- 表示用のみ（自動更新はしない）
  const CSV_CACHE_DURATION_MS = 365 * 24 * 60 * 60 * 1000; // 1年

  // ローカルストレージからキャッシュを読み込む
  const loadCsvFromCache = (userId: string): { data: string; metadata: string } | null => {
    try {
      const cachedDataEncoded = localStorage.getItem(CSV_CACHE_KEY(userId));
      const cachedMetadata = localStorage.getItem(CSV_METADATA_KEY(userId));
      if (cachedDataEncoded && cachedMetadata) {
        try {
          // Base64デコード（エラーをキャッチ）
          let binaryString: string;
          try {
            binaryString = atob(cachedDataEncoded);
          } catch (base64Error: any) {
            // Base64デコードエラーの場合、キャッシュが破損している可能性が高い
            console.warn("Base64デコードエラー。キャッシュを削除します。", base64Error);
            localStorage.removeItem(CSV_CACHE_KEY(userId));
            localStorage.removeItem(CSV_METADATA_KEY(userId));
            localStorage.removeItem(CSV_EXPIRY_KEY(userId));
            return null;
          }
          
          // UTF-8デコード（大きなデータでも安全に処理）
          const utf8Bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            utf8Bytes[i] = binaryString.charCodeAt(i);
          }
          
          const decodedData = new TextDecoder('utf-8').decode(utf8Bytes);
          return { data: decodedData, metadata: cachedMetadata };
        } catch (decodeError: any) {
          console.error("キャッシュデコードエラー:", decodeError);
          
          // エラーの詳細を確認（JSONパースエラー、Unterminated stringなど）
          const errorMessage = decodeError.message || String(decodeError);
          if (errorMessage.includes('JSON') || 
              errorMessage.includes('Unterminated') || 
              errorMessage.includes('Invalid') ||
              errorMessage.includes('Unexpected')) {
            // キャッシュが破損している可能性が高い
            console.warn("キャッシュが破損している可能性があります。キャッシュを削除します。");
            try {
              localStorage.removeItem(CSV_CACHE_KEY(userId));
              localStorage.removeItem(CSV_METADATA_KEY(userId));
              localStorage.removeItem(CSV_EXPIRY_KEY(userId));
            } catch (clearError) {
              console.error("キャッシュ削除エラー:", clearError);
            }
            return null;
          }
          
          // その他のエラーの場合も、キャッシュを削除して安全に処理
          console.warn("予期しないエラーが発生しました。キャッシュを削除します。");
          try {
            localStorage.removeItem(CSV_CACHE_KEY(userId));
            localStorage.removeItem(CSV_METADATA_KEY(userId));
            localStorage.removeItem(CSV_EXPIRY_KEY(userId));
          } catch (clearError) {
            console.error("キャッシュ削除エラー:", clearError);
          }
          return null;
        }
      }
    } catch (e: any) {
      console.error("キャッシュ読み込みエラー:", e);
      
      // すべてのエラーに対してキャッシュを削除
      const errorMessage = e.message || String(e);
      if (errorMessage.includes('JSON') || 
          errorMessage.includes('Unterminated') || 
          errorMessage.includes('Invalid') ||
          errorMessage.includes('Unexpected')) {
        console.warn("JSONパースエラーが発生しました。キャッシュを削除します。");
        try {
          localStorage.removeItem(CSV_CACHE_KEY(userId));
          localStorage.removeItem(CSV_METADATA_KEY(userId));
          localStorage.removeItem(CSV_EXPIRY_KEY(userId));
        } catch (clearError) {
          console.error("キャッシュ削除エラー:", clearError);
        }
      }
    }
    return null;
  };

  // ローカルストレージにキャッシュを保存（非同期で実行してUIをブロックしない）
  const saveCsvToCache = (userId: string, data: string, metadata: string) => {
    // 非同期で実行してUIをブロックしない
    setTimeout(() => {
      try {
        // UTF-8エンコードしてからBase64エンコード（非ASCII文字も安全に保存）
        const utf8Bytes = new TextEncoder().encode(data);
        
        // 大きな配列でも安全に処理するため、より効率的な方法を使用
        // String.fromCharCodeは大きな配列でスタックオーバーフローを起こす可能性があるため、
        // より安全な方法で処理
        let binaryString = '';
        const chunkSize = 8192; // 8KBずつ処理
        
        // 大きなデータの場合は、より安全な方法で処理
        if (utf8Bytes.length > 1000000) { // 1MB以上の場合
          // 大きなデータは、直接Uint8Arrayから処理
          const chunks: string[] = [];
          for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
            const chunk = utf8Bytes.slice(i, i + chunkSize);
            // 小さなチャンクごとにString.fromCharCodeを適用
            let chunkString = '';
            for (let j = 0; j < chunk.length; j++) {
              chunkString += String.fromCharCode(chunk[j]);
            }
            chunks.push(chunkString);
          }
          binaryString = chunks.join('');
        } else {
          // 小さなデータは従来の方法で処理
          for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
            const chunk = utf8Bytes.slice(i, i + chunkSize);
            binaryString += String.fromCharCode(...chunk);
          }
        }
        
        const encodedData = btoa(binaryString);
        const expiryDate = Date.now() + CSV_CACHE_DURATION_MS; // 1年後の期限日
        localStorage.setItem(CSV_CACHE_KEY(userId), encodedData);
        localStorage.setItem(CSV_METADATA_KEY(userId), metadata);
        localStorage.setItem(CSV_EXPIRY_KEY(userId), expiryDate.toString());
      } catch (e) {
        console.error("キャッシュ保存エラー:", e);
        // localStorageの容量制限（通常5-10MB）に達した場合
        if (e instanceof DOMException && (e.code === 22 || e.code === 1014)) {
          console.warn("ローカルストレージの容量が不足しています。古いキャッシュを削除します。");
          // 古いキャッシュを削除（必要に応じて実装）
          try {
            localStorage.removeItem(CSV_CACHE_KEY(userId));
            localStorage.removeItem(CSV_METADATA_KEY(userId));
          } catch (clearError) {
            console.error("キャッシュ削除エラー:", clearError);
          }
        } else {
          // その他のエラーの場合、キャッシュを保存しない（エラーを無視）
          console.warn("キャッシュの保存をスキップしました:", e);
        }
      }
    }, 0);
  };

  // CSVを分割してFirestoreに保存する関数（1MB以上のデータは自動で700KBずつ分割）
  const saveCsvToFirestore = async (userId: string, csvData: string, dateStr: string): Promise<string> => {
    const ONE_MB = 1024 * 1024; // 1MB
    const FIRESTORE_MAX_DOC_SIZE = 1048487; // Firestoreの1つのドキュメントの最大サイズ（約1MB）
    const CHUNK_SIZE = 700 * 1024; // 700KB（他のフィールドのサイズを考慮して余裕を持たせる）
    const FIRESTORE_MAX_FIELD_SIZE = 1048487; // Firestoreの1つのフィールドの最大サイズ（約1MB）
    const dataSize = new Blob([csvData]).size;
    
    // 既存のドキュメントを読み込んで、他のフィールドのサイズを確認
    let existingDocSize = 0;
    try {
      const docRef = doc(db, 'users', userId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const existingData = docSnap.data();
        // 他のフィールドのサイズを計算（blogData、blogUrls、blogUrlDatesなど）
        const otherFields = ['blogData', 'blogUrls', 'blogUrlDates', 'sitemapUrl', 'settings', 'themes', 'myPostThemes'];
        for (const field of otherFields) {
          if (existingData[field]) {
            const fieldSize = new Blob([JSON.stringify(existingData[field])]).size;
            existingDocSize += fieldSize;
          }
        }
        // 分割されたblogDataのチャンクも考慮
        if (existingData.blogIsSplit && existingData.blogChunkCount) {
          for (let i = 0; i < existingData.blogChunkCount; i++) {
            const chunkKey = i === 0 ? 'blogData' : `blogData_${i}`;
            if (existingData[chunkKey]) {
              existingDocSize += new Blob([existingData[chunkKey]]).size;
            }
          }
        }
        console.log(`既存ドキュメントのサイズ（CSV以外）: ${(existingDocSize / 1024).toFixed(2)} KB`);
      }
    } catch (error) {
      console.warn('既存ドキュメントの読み込みエラー（無視）:', error);
    }
    
    // 利用可能なサイズを計算（1MB - 既存データサイズ - メタデータ用の余裕）
    const METADATA_SIZE = 50 * 1024; // メタデータ用の余裕（50KB）
    const availableSize = FIRESTORE_MAX_DOC_SIZE - existingDocSize - METADATA_SIZE;
    const adjustedChunkSize = Math.min(CHUNK_SIZE, Math.max(500 * 1024, availableSize)); // 最小500KB、最大700KB
    
    console.log(`利用可能なサイズ: ${(availableSize / 1024).toFixed(2)} KB, 調整後のチャンクサイズ: ${(adjustedChunkSize / 1024).toFixed(2)} KB`);
    
    // 1MB以上の場合は自動で分割して保存
    // または、既存データと合わせて1MBを超える場合も分割
    if (dataSize >= ONE_MB || (existingDocSize + dataSize + METADATA_SIZE) > FIRESTORE_MAX_DOC_SIZE) {
      const totalSize = existingDocSize + dataSize + METADATA_SIZE;
      console.log(`CSVデータサイズ: ${(dataSize / 1024 / 1024).toFixed(2)} MB, 合計サイズ: ${(totalSize / 1024 / 1024).toFixed(2)} MB → ${(adjustedChunkSize / 1024).toFixed(2)}KBずつ自動分割して保存`);
      
      // CSVをヘッダーとデータ行に分割
      const lines = csvData.split('\n');
      if (lines.length < 2) {
        throw new Error('CSVデータが不正です');
      }
      
      const header = lines[0];
      const dataLines = lines.slice(1);
      
      // チャンクに分割（各チャンクは調整後のサイズ以下）
      const chunks: string[] = [];
      let currentChunk = header + '\n';
      let currentSize = new Blob([currentChunk]).size;
      
      for (const line of dataLines) {
        const lineWithNewline = line + '\n';
        const lineSize = new Blob([lineWithNewline]).size;
        
        // 現在のチャンクに追加すると調整後のサイズを超える場合
        if (currentSize + lineSize > adjustedChunkSize && currentChunk !== header + '\n') {
          // 現在のチャンクを保存
          chunks.push(currentChunk);
          currentChunk = header + '\n';
          currentSize = new Blob([currentChunk]).size;
        }
        
        currentChunk += lineWithNewline;
        currentSize += lineSize;
      }
      
      // 最後のチャンクを追加
      if (currentChunk !== header + '\n') {
        chunks.push(currentChunk);
      }
      
      console.log(`${chunks.length}個のチャンクに分割しました（各チャンクは約${(adjustedChunkSize / 1024).toFixed(2)}KB）`);
      
      // 各チャンクのサイズを確認（デバッグ用）
      let hasOversizedChunk = false;
      for (let i = 0; i < chunks.length; i++) {
        const chunkSize = new Blob([chunks[i]]).size;
        if (i < 5 || i === chunks.length - 1) {
          // 最初の5つと最後のチャンクのみログ出力（大量のログを避ける）
          console.log(`チャンク${i}: ${(chunkSize / 1024).toFixed(2)} KB`);
        }
        if (chunkSize > FIRESTORE_MAX_FIELD_SIZE) {
          hasOversizedChunk = true;
          console.error(`警告: チャンク${i}が大きすぎます: ${(chunkSize / 1024 / 1024).toFixed(2)} MB`);
        }
      }
      
      // 大きすぎるチャンクがある場合のみエラーをスロー（成功時はエラーを出さない）
      if (hasOversizedChunk) {
        throw new Error('一部のチャンクがFirestoreのサイズ制限を超えています。データを確認してください。');
      }
      
      // 各チャンクをFirestoreに保存（既存のデータと合わせて1MBを超えないように注意）
      const saveData: any = {
        csvUploadDate: dateStr,
        csvUpdatedTime: dateStr,
        csvChunkCount: chunks.length,
        csvIsSplit: true
      };
      
      // チャンクを1つずつ保存して、ドキュメントサイズを確認
      for (let i = 0; i < chunks.length; i++) {
        const chunkKey = i === 0 ? 'csvData' : `csvData_${i}`;
        saveData[chunkKey] = chunks[i];
        
        // 保存前のドキュメントサイズを確認
        const estimatedDocSize = new Blob([JSON.stringify(saveData)]).size + existingDocSize;
        if (estimatedDocSize > FIRESTORE_MAX_DOC_SIZE) {
          console.warn(`警告: チャンク${i}を追加するとドキュメントサイズが${(estimatedDocSize / 1024 / 1024).toFixed(2)}MBになります。`);
          // それでも保存を試みる（Firestoreがエラーを返す可能性がある）
        }
      }
      
      // 一度に保存（merge: trueを使用）
      try {
      await setDoc(doc(db, 'users', userId), saveData, { merge: true });
      console.log(`分割保存完了: ${chunks.length}個のチャンクをFirestoreに保存しました`);
        return dateStr;
      } catch (saveError: any) {
        // 容量超過エラーを検出
        if (saveError.message && saveError.message.includes('exceeds the maximum allowed size')) {
          const estimatedSize = (existingDocSize + dataSize + METADATA_SIZE) / 1024 / 1024;
          throw new Error(`データの保存に失敗しました。\n\n原因: Firestoreの容量制限（1MB）を超えています。\n\n現在のデータサイズ: 約${estimatedSize.toFixed(2)}MB\n制限: 1MB\n\n対処方法:\n1. 古いデータを削除してください\n2. データを分割して取り込んでください\n3. ブログデータを削除してから再度試してください`);
        }
        throw saveError;
      }
    } else {
      // 1MB未満でも、既存データと合わせて1MBを超える場合は分割
      const totalSize = existingDocSize + dataSize + METADATA_SIZE;
      if (totalSize > FIRESTORE_MAX_DOC_SIZE) {
        console.log(`CSVデータは1MB未満ですが、既存データと合わせて${(totalSize / 1024 / 1024).toFixed(2)}MBになるため分割保存します`);
        
        // 分割処理を実行
        const lines = csvData.split('\n');
        if (lines.length < 2) {
          throw new Error('CSVデータが不正です');
        }
        
        const header = lines[0];
        const dataLines = lines.slice(1);
        const chunks: string[] = [];
        let currentChunk = header + '\n';
        let currentSize = new Blob([currentChunk]).size;
        
        for (const line of dataLines) {
          const lineWithNewline = line + '\n';
          const lineSize = new Blob([lineWithNewline]).size;
          
          if (currentSize + lineSize > adjustedChunkSize && currentChunk !== header + '\n') {
            chunks.push(currentChunk);
            currentChunk = header + '\n';
            currentSize = new Blob([currentChunk]).size;
          }
          
          currentChunk += lineWithNewline;
          currentSize += lineSize;
        }
        
        if (currentChunk !== header + '\n') {
          chunks.push(currentChunk);
        }
        
        const saveData: any = {
          csvUploadDate: dateStr,
          csvUpdatedTime: dateStr,
          csvChunkCount: chunks.length,
          csvIsSplit: true
        };
        
        for (let i = 0; i < chunks.length; i++) {
          const chunkKey = i === 0 ? 'csvData' : `csvData_${i}`;
          saveData[chunkKey] = chunks[i];
        }
        
        try {
          await setDoc(doc(db, 'users', userId), saveData, { merge: true });
          console.log(`分割保存完了: ${chunks.length}個のチャンクをFirestoreに保存しました`);
      return dateStr;
        } catch (saveError: any) {
          // 容量超過エラーを検出
          if (saveError.message && saveError.message.includes('exceeds the maximum allowed size')) {
            const estimatedSize = (existingDocSize + dataSize + METADATA_SIZE) / 1024 / 1024;
            throw new Error(`データの保存に失敗しました。\n\n原因: Firestoreの容量制限（1MB）を超えています。\n\n現在のデータサイズ: 約${estimatedSize.toFixed(2)}MB\n制限: 1MB\n\n対処方法:\n1. 古いデータを削除してください\n2. データを分割して取り込んでください\n3. ブログデータを削除してから再度試してください`);
          }
          throw saveError;
        }
    } else {
        // 1MB未満で、既存データと合わせても1MB未満の場合は通常通り保存
        try {
      await setDoc(doc(db, 'users', userId), {
        csvData: csvData,
        csvUploadDate: dateStr,
        csvUpdatedTime: dateStr,
        csvIsSplit: false
      }, { merge: true });
      
      return dateStr;
        } catch (saveError: any) {
          // 容量超過エラーを検出
          if (saveError.message && saveError.message.includes('exceeds the maximum allowed size')) {
            const estimatedSize = (existingDocSize + dataSize + METADATA_SIZE) / 1024 / 1024;
            throw new Error(`データの保存に失敗しました。\n\n原因: Firestoreの容量制限（1MB）を超えています。\n\n現在のデータサイズ: 約${estimatedSize.toFixed(2)}MB\n制限: 1MB\n\n対処方法:\n1. 古いデータを削除してください\n2. データを分割して取り込んでください\n3. ブログデータを削除してから再度試してください`);
          }
          throw saveError;
        }
      }
    }
  };

  // ブログキャッシュの有効期限（1年）- 表示用のみ（自動更新はしない）
  const BLOG_CACHE_DURATION_MS = 365 * 24 * 60 * 60 * 1000; // 1年

  // ブログキャッシュから取得（期限切れでもキャッシュを返す - 手動更新のみ）
  const getBlogCache = async (userId: string, blogUrl: string): Promise<{ csv: string; cachedAt: number; isExpired: boolean } | null> => {
    try {
      const cacheRef = doc(db, 'users', userId, 'blogCache', encodeURIComponent(blogUrl));
      const cacheSnap = await getDoc(cacheRef);
      
      if (cacheSnap.exists()) {
        const cacheData = cacheSnap.data();
        const cachedAt = cacheData.cachedAt || 0;
        const now = Date.now();
        const isExpired = now - cachedAt >= BLOG_CACHE_DURATION_MS;
        
        if (isExpired) {
          const daysSinceCache = Math.floor((now - cachedAt) / (24 * 60 * 60 * 1000));
          console.log(`ブログキャッシュから読み込み（期限切れ: ${daysSinceCache}日前のキャッシュ）`);
        } else {
          const daysRemaining = Math.floor((BLOG_CACHE_DURATION_MS - (now - cachedAt)) / (24 * 60 * 60 * 1000));
          console.log(`ブログキャッシュから読み込み（有効期限: あと${daysRemaining}日）`);
        }
        
        return {
          csv: cacheData.csv,
          cachedAt: cachedAt,
          isExpired: isExpired,
        };
      }
    } catch (error) {
      console.error('ブログキャッシュ読み込みエラー:', error);
    }
    
    return null;
  };

  // ブログキャッシュを保存
  const saveBlogCache = async (userId: string, blogUrl: string, csv: string): Promise<void> => {
    try {
      const cacheRef = doc(db, 'users', userId, 'blogCache', encodeURIComponent(blogUrl));
      await setDoc(cacheRef, {
        csv: csv,
        cachedAt: Date.now(),
        blogUrl: blogUrl,
      }, { merge: true });
      console.log('ブログ記事をキャッシュに保存しました');
    } catch (error) {
      console.error('ブログキャッシュ保存エラー:', error);
    }
  };

  // CSVを行単位に分割（ダブルクォート内の改行を保持）
  const splitCsvIntoRows = (csvText: string): string[] => {
    if (!csvText) return [];
    const normalized = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows: string[] = [];
    let currentRow = '';
    let inQuotes = false;

    for (let i = 0; i < normalized.length; i++) {
      const char = normalized[i];
      const nextChar = i + 1 < normalized.length ? normalized[i + 1] : '';

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentRow += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === '\n' && !inQuotes) {
        if (currentRow !== '' || rows.length > 0) {
          rows.push(currentRow);
        }
        currentRow = '';
      } else {
        currentRow += char;
      }
    }

    if (currentRow !== '' || rows.length > 0) {
      rows.push(currentRow);
    }

    return rows;
  };

  const normalizeUrlForDedup = (url: string): string => {
    if (!url) return '';
    const trimmed = url.trim();
    try {
      const parsed = new URL(trimmed);
      parsed.hash = '';
      let normalized = parsed.toString();
      if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
      return normalized;
    } catch {
      return trimmed.replace(/\/$/, '');
    }
  };

  // ブログデータをFirestoreに保存（CSVデータと同様の分割機能付き）
  const saveBlogDataToFirestore = async (userId: string, blogData: string, dateStr: string): Promise<string> => {
    const ONE_MB = 1024 * 1024;
    const CHUNK_SIZE = 800 * 1024;
    const FIRESTORE_MAX_FIELD_SIZE = 1048487;
    const dataSize = new Blob([blogData]).size;
    
    if (dataSize >= ONE_MB) {
      console.log(`ブログデータサイズ: ${(dataSize / 1024 / 1024).toFixed(2)} MB → 800KBずつ自動分割して保存`);
      
      const lines = splitCsvIntoRows(blogData);
      if (lines.length < 2) {
        throw new Error('ブログデータが不正です');
      }
      
      const header = lines[0];
      const dataLines = lines.slice(1);
      const chunks: string[] = [];
      let currentChunk = header + '\n';
      let currentSize = new Blob([currentChunk]).size;
      
      for (const line of dataLines) {
        const lineWithNewline = line + '\n';
        const lineSize = new Blob([lineWithNewline]).size;
        
        if (currentSize + lineSize > CHUNK_SIZE && currentChunk !== header + '\n') {
          chunks.push(currentChunk);
          currentChunk = header + '\n';
          currentSize = new Blob([currentChunk]).size;
        }
        
        currentChunk += lineWithNewline;
        currentSize += lineSize;
      }
      
      if (currentChunk !== header + '\n') {
        chunks.push(currentChunk);
      }
      
      console.log(`${chunks.length}個のチャンクに分割しました（各チャンクは約800KB）`);
      
      let hasOversizedChunk = false;
      for (let i = 0; i < chunks.length; i++) {
        const chunkSize = new Blob([chunks[i]]).size;
        if (i < 5 || i === chunks.length - 1) {
          console.log(`チャンク${i}: ${(chunkSize / 1024).toFixed(2)} KB`);
        }
        if (chunkSize > FIRESTORE_MAX_FIELD_SIZE) {
          hasOversizedChunk = true;
          console.error(`警告: チャンク${i}が大きすぎます: ${(chunkSize / 1024 / 1024).toFixed(2)} MB`);
        }
      }
      
      if (hasOversizedChunk) {
        throw new Error('一部のチャンクがFirestoreのサイズ制限を超えています。データを確認してください。');
      }
      
      const saveData: any = {
        blogUploadDate: dateStr,
        blogUpdatedTime: dateStr,
        blogChunkCount: chunks.length,
        blogIsSplit: true
      };
      
      for (let i = 0; i < chunks.length; i++) {
        const chunkKey = i === 0 ? 'blogData' : `blogData_${i}`;
        saveData[chunkKey] = chunks[i];
      }
      
      try {
      await setDoc(doc(db, 'users', userId), saveData, { merge: true });
      console.log(`分割保存完了: ${chunks.length}個のチャンクをFirestoreに保存しました`);
      return dateStr;
      } catch (saveError: any) {
        // 容量超過エラーを検出
        if (saveError.message && saveError.message.includes('exceeds the maximum allowed size')) {
          const estimatedSize = dataSize / 1024 / 1024;
          throw new Error(`ブログデータの保存に失敗しました。\n\n原因: Firestoreの容量制限（1MB）を超えています。\n\nブログデータサイズ: 約${estimatedSize.toFixed(2)}MB\n制限: 1MB\n\n対処方法:\n1. 古いブログデータを削除してください\n2. 取り込むURLの数を減らしてください（1回あたり50件以下を推奨）\n3. CSVデータを削除してから再度試してください`);
        }
        throw saveError;
      }
    } else {
      try {
      await setDoc(doc(db, 'users', userId), {
        blogData: blogData,
        blogUploadDate: dateStr,
        blogUpdatedTime: dateStr,
        blogIsSplit: false
      }, { merge: true });
      
      return dateStr;
      } catch (saveError: any) {
        // 容量超過エラーを検出
        if (saveError.message && saveError.message.includes('exceeds the maximum allowed size')) {
          const estimatedSize = dataSize / 1024 / 1024;
          throw new Error(`ブログデータの保存に失敗しました。\n\n原因: Firestoreの容量制限（1MB）を超えています。\n\nブログデータサイズ: 約${estimatedSize.toFixed(2)}MB\n制限: 1MB\n\n対処方法:\n1. 古いブログデータを削除してください\n2. 取り込むURLの数を減らしてください（1回あたり50件以下を推奨）\n3. CSVデータを削除してから再度試してください`);
        }
        throw saveError;
      }
    }
  };

  // ブログデータをFirestoreから読み込み
  const loadBlogDataFromFirestore = (data: any): string | null => {
    if (data.blogIsSplit && data.blogChunkCount) {
      const chunks: string[] = [];
      for (let i = 0; i < data.blogChunkCount; i++) {
        const chunkKey = i === 0 ? 'blogData' : `blogData_${i}`;
        if (data[chunkKey]) {
          chunks.push(data[chunkKey]);
        }
      }
      if (chunks.length > 0) {
        // チャンクをCSV行として結合し、ヘッダー重複を除去
        let mergedRows: string[] = [];
        let header: string | null = null;
        for (const chunk of chunks) {
          const rows = splitCsvIntoRows(chunk);
          if (rows.length === 0) continue;
          if (!header) {
            header = rows[0];
            mergedRows.push(...rows);
          } else {
            const startIndex = rows[0] === header ? 1 : 0;
            mergedRows.push(...rows.slice(startIndex));
          }
        }
        if (mergedRows.length > 0) {
          return mergedRows.join('\n');
        }
      }
    } else if (data.blogData) {
      return data.blogData;
    }
    return null;
  };

  // CSVキャッシュの期限日を取得
  const getCsvCacheExpiry = (userId: string): number | null => {
    try {
      const expiryStr = localStorage.getItem(CSV_EXPIRY_KEY(userId));
      if (expiryStr) {
        return parseInt(expiryStr, 10);
      }
    } catch (error) {
      console.error('CSVキャッシュ期限取得エラー:', error);
    }
    return null;
  };

  // ブログキャッシュの期限日を取得（最新のブログキャッシュから計算）
  const getBlogCacheExpiry = (): number | null => {
    if (blogCacheInfo && blogCacheInfo.cachedAt) {
      return blogCacheInfo.cachedAt + BLOG_CACHE_DURATION_MS;
    }
    return null;
  };

  // キャッシュの有効期限を表示する関数（設定内でのみ使用）
  const getCacheStatus = (cachedAt: number, isExpired: boolean): string => {
    const now = Date.now();
    const daysSinceCache = Math.floor((now - cachedAt) / (24 * 60 * 60 * 1000));
    const daysRemaining = 365 - daysSinceCache;
    
    if (isExpired) {
      return `キャッシュ期限切れ（${daysSinceCache}日前のデータ）`;
    } else if (daysRemaining > 0) {
      return `キャッシュ有効（あと${daysRemaining}日）`;
    } else {
      return 'キャッシュ期限切れ';
    }
  };

  // サイトマップからURL一覧を取得
  const handleFetchSitemap = async (overrideUrl?: string): Promise<void> => {
    const urlToUse = overrideUrl || sitemapUrl;
    if (!urlToUse || !user) return;
    
    setIsSitemapLoading(true);
    setBlogImportProgress('サイトマップからURL一覧を取得中...');
    
    try {
      const response = await fetch('/api/blog/sitemap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sitemapUrl: urlToUse.trim(),
        }),
      });
      
      // レスポンスをテキストとして取得し、JSONとしてパースを試みる
      const responseText = await response.text();
      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('サイトマップAPIのレスポンスがJSONではありません:', responseText.substring(0, 200));
        throw new Error(`サイトマップの取得に失敗しました。サイトマップURLが正しいか確認してください。`);
      }
      
      if (!response.ok) {
        throw new Error(data.error || 'サイトマップの取得に失敗しました');
      }
      
      if (!data.urls || data.urls.length === 0) {
        throw new Error('サイトマップからURLが見つかりませんでした');
      }
      
      // 既に取り込まれているURLを除外
      const existingUrlsSet = new Set(blogUrls);
      const filteredUrls = data.urls.filter((item: { url: string; date: string; title?: string }) => !existingUrlsSet.has(item.url));
      
      // タイトルがないURLに対してタイトルを取得
      const urlsWithoutTitle = filteredUrls.filter((item: { url: string; date: string; title?: string }) => !item.title || item.title === '');
      if (urlsWithoutTitle.length > 0) {
        setBlogImportProgress(`タイトルを取得中... (${urlsWithoutTitle.length}件)`);
        try {
          const titleResponse = await fetch('/api/blog/titles', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              urls: urlsWithoutTitle.map((item: { url: string; date: string; title?: string }) => item.url),
            }),
          });
          
          if (titleResponse.ok) {
            const titleData = await titleResponse.json();
            if (titleData.titles) {
              const titleMap = new Map(titleData.titles.map((t: { url: string; title: string }) => [t.url, t.title]));
              // タイトルを更新
              filteredUrls.forEach((item: { url: string; date: string; title?: string }) => {
                if (!item.title && titleMap.has(item.url)) {
                  const fetchedTitle = titleMap.get(item.url);
                  item.title = (fetchedTitle && typeof fetchedTitle === 'string') ? fetchedTitle : '';
                }
              });
            }
          }
        } catch (error) {
          console.error('タイトル取得エラー:', error);
          // タイトル取得に失敗しても続行
        }
      }
      
      setSitemapUrls(filteredUrls);
      setSelectedUrls(new Set()); // 選択をリセット
      setBlogImportProgress(`${filteredUrls.length}件のURLを取得しました（既存の${data.urls.length - filteredUrls.length}件は除外）`);
      setShowSitemapUrlModal(true); // モーダルを開く
      
      // サイトマップURLをFirestoreに保存
      try {
        await setDoc(doc(db, 'users', user.uid), {
          sitemapUrl: urlToUse.trim()
        }, { merge: true });
      } catch (saveError) {
        console.error('サイトマップURLの保存エラー:', saveError);
        // 保存エラーは無視（表示には影響しない）
      }
    } catch (error: any) {
      console.error('Sitemap fetch error:', error);
      alert(`サイトマップの取得に失敗しました: ${error.message}`);
      setBlogImportProgress('');
    } finally {
      setIsSitemapLoading(false);
    }
  };

  // URLの種類を自動判別する関数
  const detectUrlType = (url: string): 'blog-sitemap' | 'single-article' => {
    const normalizedUrl = url.trim();
    
    // その他のURLは、まずサイトマップを試す
    return 'blog-sitemap';
  };

  // 統一されたURL処理関数（自動判別）
  const handleAutoDetectAndImport = async (inputUrl: string) => {
    if (!inputUrl.trim() || !user) return;
    
    const urlType = detectUrlType(inputUrl);
    let normalizedUrl = inputUrl.trim();
    if (normalizedUrl.endsWith('/')) {
      normalizedUrl = normalizedUrl.slice(0, -1);
    }
    
    // URLの検証
    try {
      new URL(normalizedUrl);
    } catch (e) {
      alert('無効なURLです');
      return;
    }
    
    // URLタイプに応じて適切なローディング状態を設定
    if (urlType === 'blog-sitemap') {
      setIsSitemapLoading(true);
    } else {
      setIsBlogImporting(true);
    }
    
    setBlogImportProgress('URLを解析中...');
    
    try {
      if (urlType === 'blog-sitemap') {
        // ブログサイトの場合、サイトマップを試す
        const urlObj = new URL(normalizedUrl);
        const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
        
        // 入力URL自体に/post-sitemap.xmlを追加したパターンも試す
        let inputUrlWithSitemap = '';
        try {
          // 入力URLに直接/post-sitemap.xmlを追加
          const inputUrlObj = new URL(normalizedUrl);
          // パスの最後に/post-sitemap.xmlを追加
          const inputPath = inputUrlObj.pathname;
          if (inputPath.endsWith('/')) {
            inputUrlWithSitemap = `${inputUrlObj.protocol}//${inputUrlObj.host}${inputPath}post-sitemap.xml`;
          } else {
            inputUrlWithSitemap = `${inputUrlObj.protocol}//${inputUrlObj.host}${inputPath}/post-sitemap.xml`;
          }
        } catch (e) {
          // URL解析エラーは無視
        }
        
        // 複数のサイトマップURLパターンを試す（入力URLベースを最初に試す）
        const sitemapCandidates = [];
        if (inputUrlWithSitemap) {
          sitemapCandidates.push(inputUrlWithSitemap);
        }
        sitemapCandidates.push(
          `${baseUrl}/post-sitemap.xml`,
          `${baseUrl}/sitemap.xml`,
          `${baseUrl}/sitemap_index.xml`,
          `${baseUrl}/wp-sitemap.xml`,
        );
        
        let foundSitemap = false;
        for (const sitemapUrlCandidate of sitemapCandidates) {
          try {
            setBlogImportProgress(`サイトマップを確認中: ${sitemapUrlCandidate}...`);
            const response = await fetch(sitemapUrlCandidate, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
              signal: AbortSignal.timeout(10000),
            });
            
            if (response.ok) {
              const xml = await response.text();
              // サイトマップかどうかを確認（XML形式で、<urlset>または<sitemapindex>を含む）
              if (xml.includes('<urlset') || xml.includes('<sitemapindex')) {
                foundSitemap = true;
                setSitemapUrl(sitemapUrlCandidate);
                // handleFetchSitemap内でsetIsSitemapLoading(false)が呼ばれる
                await handleFetchSitemap();
                break;
              }
            }
          } catch (error) {
            // このサイトマップURLは存在しない、次のを試す
            continue;
          }
        }
        
        if (!foundSitemap) {
          // サイトマップが見つからない場合、単独記事として処理
          setIsSitemapLoading(false);
          setIsBlogImporting(true);
          setBlogImportProgress('サイトマップが見つかりませんでした。単独記事として取り込みます...');
          // 既に取り込まれているかチェック
          if (blogUrls.includes(normalizedUrl)) {
            if (!confirm('このURLは既に取り込まれています。更新しますか？')) {
              setIsBlogImporting(false);
              setBlogImportProgress('');
              return;
            }
          }
          await handleImportSelectedUrls([normalizedUrl], 'wordpress');
          setSingleArticleUrl('');
          setBlogImportProgress('取り込み完了');
          setTimeout(() => setBlogImportProgress(''), 2000);
          setIsBlogImporting(false);
        }
      }
    } catch (error: any) {
      alert(`処理に失敗しました: ${error.message}`);
      setBlogImportProgress('');
      // エラー時は全てのローディング状態をリセット
      setIsBlogImporting(false);
      setIsSitemapLoading(false);
    }
  };

  // ラジオボタンに応じたURL取り込み処理
  const handleUrlImportByType = async (): Promise<void> => {
    if (!singleArticleUrl.trim() || !user) return;
    
    const inputUrl = singleArticleUrl.trim();
    // 末尾のスラッシュは削除しない（サーバー側で判断させる）
    let normalizedUrl = inputUrl;
    
    // URLの検証
    try {
      new URL(normalizedUrl);
    } catch (e) {
      alert('無効なURLです');
      return;
    }
    
    if (urlImportType === 'sitemap') {
      // サイトマップの場合：複数のサイトマップパターンを試す
      setIsSitemapLoading(true);
      setBlogImportProgress('サイトマップを検索中...');
      
      try {
        const baseUrl = normalizedUrl.endsWith('/') ? normalizedUrl.slice(0, -1) : normalizedUrl;
        
        // まずrobots.txtからサイトマップURLを取得してみる
        const sitemapPatterns: string[] = [];
        
        try {
          setBlogImportProgress('robots.txtからサイトマップを検索中...');
          const robotsResponse = await fetch(`${baseUrl}/robots.txt`, {
            signal: AbortSignal.timeout(5000),
          });
          if (robotsResponse.ok) {
            const robotsTxt = await robotsResponse.text();
            // Sitemap: で始まる行を探す
            const sitemapMatches = robotsTxt.match(/^Sitemap:\s*(.+)$/gim);
            if (sitemapMatches) {
              for (const match of sitemapMatches) {
                const sitemapUrl = match.replace(/^Sitemap:\s*/i, '').trim();
                if (sitemapUrl && !sitemapPatterns.includes(sitemapUrl)) {
                  console.log(`robots.txtからサイトマップを発見: ${sitemapUrl}`);
                  sitemapPatterns.push(sitemapUrl);
                }
              }
            }
          }
        } catch (robotsError) {
          console.log('robots.txtの取得に失敗（スキップ）:', robotsError);
        }
        
        // 追加のサイトマップURLパターン（優先度順）
        const additionalPatterns = [
          `${baseUrl}/post-sitemap.xml`,           // Yoast SEO
          `${baseUrl}/sitemap.xml`,                 // 一般的なサイトマップ
          `${baseUrl}/sitemap_index.xml`,           // サイトマップインデックス
          `${baseUrl}/wp-sitemap.xml`,              // WordPress 5.5+
          `${baseUrl}/wp-sitemap-posts-post-1.xml`, // WordPress 5.5+ 記事用
          `${baseUrl}/page-sitemap.xml`,            // Yoast SEO ページ用
          `${baseUrl}/category-sitemap.xml`,        // Yoast SEO カテゴリ用
        ];
        
        // 重複を避けて追加
        for (const pattern of additionalPatterns) {
          if (!sitemapPatterns.includes(pattern)) {
            sitemapPatterns.push(pattern);
          }
        }
        
        let successUrl = null;
        let lastError = '';
        const triedUrls: string[] = [];
        
        for (const sitemapUrl of sitemapPatterns) {
          setBlogImportProgress(`${sitemapUrl} を確認中...`);
          triedUrls.push(sitemapUrl);
          
          try {
            // APIを直接呼び出して確認
            const response = await fetch('/api/blog/sitemap', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                sitemapUrl: sitemapUrl,
              }),
            });
            
            const responseText = await response.text();
            console.log(`サイトマップ ${sitemapUrl} のレスポンス:`, response.status, responseText.substring(0, 200));
            
            let data: any;
            try {
              data = JSON.parse(responseText);
            } catch {
              console.log(`サイトマップ ${sitemapUrl}: JSONパースエラー`);
              lastError = `${sitemapUrl}: JSONパースエラー`;
              continue; // JSONパースエラーの場合は次のパターンを試す
            }
            
            if (!response.ok) {
              console.log(`サイトマップ ${sitemapUrl}: APIエラー - ${data.error || response.status}`);
              lastError = `${sitemapUrl}: ${data.error || `HTTPエラー ${response.status}`}`;
              continue;
            }
            
            if (!data.urls || data.urls.length === 0) {
              console.log(`サイトマップ ${sitemapUrl}: URLが0件`);
              lastError = `${sitemapUrl}: URLが見つかりませんでした`;
              continue;
            }
            
            // 成功
            successUrl = sitemapUrl;
            setSitemapUrl(sitemapUrl);
            console.log(`サイトマップ ${sitemapUrl}: ${data.urls.length}件のURL取得成功`);
            
            // 成功した場合、handleFetchSitemapと同様の処理を行う
            const existingUrlsSet = new Set(blogUrls);
            const filteredUrls = data.urls.filter((item: { url: string; date: string; title?: string }) => !existingUrlsSet.has(item.url));
            
            setSitemapUrls(filteredUrls);
            setSelectedUrls(new Set());
            setBlogImportProgress(`${filteredUrls.length}件のURLを取得しました`);
            setShowSitemapUrlModal(true);
            
            // サイトマップURLをFirestoreに保存
            if (user) {
              try {
                await setDoc(doc(db, 'users', user.uid), {
                  sitemapUrl: sitemapUrl
                }, { merge: true });
              } catch (saveError) {
                console.error('サイトマップURLの保存エラー:', saveError);
              }
            }
            
            break;
          } catch (error: any) {
            console.log(`サイトマップ ${sitemapUrl} の取得に失敗:`, error.message || error);
            lastError = `${sitemapUrl}: ${error.message || 'ネットワークエラー'}`;
            // 次のパターンを試す
          }
        }
        
        if (!successUrl) {
          console.error('すべてのサイトマップパターンが失敗:', triedUrls.join(', '));
          throw new Error(`サイトマップが見つかりませんでした。\n\n試したURL:\n${triedUrls.join('\n')}\n\n最後のエラー: ${lastError}`);
        }
      } catch (error: any) {
        alert(`サイトマップの取得に失敗しました: ${error.message}`);
        setBlogImportProgress('');
      } finally {
        setIsSitemapLoading(false);
      }
    } else if (urlImportType === 'entry') {
      // エントリー一覧の場合：入力されたURLに/entry/または/archiveを追加
      const baseUrl = normalizedUrl.endsWith('/') ? normalizedUrl.slice(0, -1) : normalizedUrl;
      
      // エントリー一覧ページから記事リストを取得
      setIsBlogImporting(true);
      setBlogImportProgress('エントリー一覧から記事を取得中...');
      
      try {
        const token = await user.getIdToken();
        
        // まず/entry/を試す、ダメなら/archiveを試す
        const urlsToTry = [
          `${baseUrl}/entry/`,
          `${baseUrl}/archive`,
        ];
        
        let successData = null;
        let lastError = null;
        
        for (const entryListUrl of urlsToTry) {
          try {
            setBlogImportProgress(`${entryListUrl} を確認中...`);
            const response = await fetch('/api/blog/entry-list', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({ entryListUrl: entryListUrl }),
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.success && data.urls && data.urls.length > 0) {
                successData = data;
                break;
              }
            }
          } catch (e: any) {
            lastError = e;
            continue;
          }
        }
        
        if (!successData) {
          throw new Error(lastError?.message || '記事URLが見つかりませんでした。はてなブログのURLを確認してください。');
        }
        
        // 記事URLのリストを取得して、選択モーダルを表示
        const urlList = successData.urls.map((url: string) => ({
          url: url,
          date: '', // 日付は後で取得
          title: undefined,
        }));
        setSitemapUrls(urlList);
        setSelectedUrls(new Set());
        setShowSitemapUrlModal(true);
        setSingleArticleUrl('');
        setBlogImportProgress('');
        setIsBlogImporting(false);
      } catch (error: any) {
        alert(`エントリー一覧の取得に失敗しました: ${error.message}`);
        setBlogImportProgress('');
        setIsBlogImporting(false);
      }
    } else if (urlImportType === 'article') {
      // 単独記事の場合：入力されたページのみから取り込む（既存データに追加）
      setIsBlogImporting(true);
      setBlogImportProgress('記事を取得中...');
      
      try {
        // 既に取り込まれているかチェック
        if (blogUrls.includes(normalizedUrl)) {
          if (!confirm('このURLは既に取り込まれています。更新しますか？')) {
            setIsBlogImporting(false);
            setBlogImportProgress('');
            return;
          }
        }
        
        // 単独URLの場合は自動判定で、常に既存データへ追加
        await handleImportSelectedUrls([normalizedUrl], 'auto');
        setSingleArticleUrl('');
        setBlogImportProgress('取り込み完了');
        setTimeout(() => setBlogImportProgress(''), 2000);
        setIsBlogImporting(false);
      } catch (error: any) {
        alert(`記事の取り込みに失敗しました: ${error.message}`);
        setBlogImportProgress('');
        setIsBlogImporting(false);
      }
    }
  };

  // カスタムドメインのnoteから記事を取得

  // 単独記事URLを取り込む（後方互換性のため残す）
  const handleImportSingleArticle = async () => {
    if (!singleArticleUrl.trim() || !user) return;
    await handleAutoDetectAndImport(singleArticleUrl);
  };

  // 選択されたURLを取り込む
  // ブログURLから記事を取り込む（常に既存データへ「追加」する）
  const handleImportSelectedUrls = async (urlsToImport: string[] = [], blogType: 'wordpress' | 'hatena' | 'auto' = 'auto') => {
    if (!user) return;
    
    let urls = urlsToImport.length > 0 ? urlsToImport : Array.from(selectedUrls);
    console.log('[handleImportSelectedUrls] 開始 - urlsToImport:', urlsToImport.length, 'selectedUrls:', selectedUrls.size, 'urls:', urls.length);
    
    if (urls.length === 0) {
      alert('取り込むURLを選択してください');
      return;
    }
    
    // 最終的なURLリストを関数スコープで初期化（常に既存データに追加）
    let updatedBlogUrls: string[] = [...blogUrls];
    let updatedBlogUrlDates: { [key: string]: string } = { ...blogUrlDates };
    let saveSucceeded = false; // tryブロック内での保存成功フラグ
    const dateStr = new Date().toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    
    // 取り込み開始時点で全URLをblogUrlsに追加（記事取得の成否に関わらずURLは保存）
    for (const originalUrl of urls) {
      if (originalUrl && (originalUrl.startsWith('http://') || originalUrl.startsWith('https://'))) {
        if (!updatedBlogUrls.includes(originalUrl)) {
          updatedBlogUrls.push(originalUrl);
          updatedBlogUrlDates[originalUrl] = dateStr;
        }
      }
    }
    console.log('[handleImportSelectedUrls] URL追加後 - updatedBlogUrls:', updatedBlogUrls.length);
    
    // 一覧ページURLの場合は、先に記事URLを収集
    const processedUrls: string[] = [];
    for (const url of urls) {
      // 一覧ページURLかどうかを判定（サイトマップURLでなく、明らかな記事URLでない場合）
      // ※ はてなブログの `/entry/...` はすべて「記事」として扱うため、ここでは判定に使わない
      const isListPage = !url.endsWith('.xml') && 
                        !url.includes('sitemap') && 
                        (url.includes('/blog') || url.includes('/posts') || url.includes('/articles'));
      
      console.log(`[handleImportSelectedUrls] URL判定: ${url}, isListPage=${isListPage}`);
      
      if (isListPage) {
        // 一覧ページの場合は、サイトマップAPIを使って記事URLを収集
        try {
          setBlogImportProgress(`一覧ページから記事URLを収集中: ${url}...`);
          const response = await fetch('/api/blog/sitemap', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sitemapUrl: url,
            }),
          });
          
          const data = await response.json();
          if (response.ok && data.urls && data.urls.length > 0) {
            // 収集した記事URLを追加
            const articleUrls = data.urls.map((item: { url: string; date: string; title?: string }) => item.url);
            processedUrls.push(...articleUrls);
            setBlogImportProgress(`${url}から${articleUrls.length}件の記事URLを収集しました`);
          } else {
            // 記事URLが収集できなかった場合、元のURLをそのまま使用（単独記事として扱う）
            processedUrls.push(url);
            console.warn(`一覧ページから記事URLを収集できませんでした: ${url}`);
          }
        } catch (error: any) {
          console.error(`一覧ページからの記事URL収集エラー (${url}):`, error);
          // エラーの場合、元のURLをそのまま使用
          processedUrls.push(url);
        }
      } else {
        // 一覧ページでない場合は、そのまま使用
        processedUrls.push(url);
      }
    }
    
    // 重複を除去
    const uniqueUrls = Array.from(new Set(processedUrls));
    
    // 1回あたり最大50件に制限（Firestoreのドキュメントサイズ制限のため）
    const MAX_IMPORT_PER_RUN = 50;
    if (uniqueUrls.length > MAX_IMPORT_PER_RUN) {
      alert(`1回あたり最大${MAX_IMPORT_PER_RUN}件まで取り込めます。収集された${uniqueUrls.length}件のうち、最初の${MAX_IMPORT_PER_RUN}件のみを取り込みます。`);
      urls = uniqueUrls.slice(0, MAX_IMPORT_PER_RUN);
    } else {
      urls = uniqueUrls;
    }
    
    setIsBlogImporting(true);
    setBlogImportProgress(`選択された${urls.length}件のURLから記事を取得中...`);
    
    try {
      const allPosts: Array<{
        title: string;
        content: string;
        date: string;
        url: string;
        category: string;
        tags: string;
      }> = [];
      
      // 既存のブログデータをパースしてURLのマップを作成（重複チェック用）
      const existingPostsByUrl = new Map<string, any>();
      if (blogData && blogData.trim()) {
        try {
          const existingPosts = parseCsvToPosts(blogData);
          existingPosts.forEach(post => {
            const url = post.URL || post.url;
            if (url) {
              existingPostsByUrl.set(url, post);
            }
          });
        } catch (e) {
          console.warn('既存データのパースエラー:', e);
        }
      }
      
      // 既に取り込まれているURLを確認
      const newUrls: string[] = [];
      const existingUrls: string[] = [];
      for (const url of urls) {
        if (existingPostsByUrl.has(url) || blogUrls.includes(url)) {
          existingUrls.push(url);
        } else {
          newUrls.push(url);
        }
      }
      
      if (existingUrls.length > 0) {
        setBlogImportProgress(`${existingUrls.length}件のURLは既に取り込まれています。更新します...`);
      }
      
      // 各URLから記事を取得（並列処理）
      const CONCURRENT_LIMIT = 3;
      const ONE_MB = 1024 * 1024;
      let shouldStop = false;
      let processedCount = 0;
      
      for (let i = 0; i < urls.length && !shouldStop; i += CONCURRENT_LIMIT) {
        const batch = urls.slice(i, i + CONCURRENT_LIMIT);
        const batchPromises = batch.map(async (url) => {
          if (shouldStop) return null;
          
          try {
            const response = await fetch('/api/blog/import', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                blogUrl: url,
                maxPosts: 1, // 1つのURLから1記事のみ
                forceRefresh: true,
                userId: user.uid,
                blogType: blogType, // ブログタイプを渡す
              }),
            });
            
            const data = await response.json();
            if (!response.ok) {
              const errorMsg = data.error || `HTTP ${response.status}`;
              console.error(`ブログ取り込みエラー (${url}):`, errorMsg);
              setBlogImportProgress(`エラー: ${url} - ${errorMsg}`);
              return {
                title: '',
                content: '',
                date: new Date().toISOString().split('T')[0],
                url: url,
                category: '',
                tags: '',
                error: errorMsg, // エラー情報を追加
              };
            }
            
            if (data.csv) {
              // CSVから投稿を抽出（改行を含むフィールドに対応）
              // 改行を含むフィールドに対応したCSVパース
              const csvText = data.csv;
              const rows: string[] = [];
              let currentRow = '';
              let inQuotes = false;
              
              for (let i = 0; i < csvText.length; i++) {
                const char = csvText[i];
                const nextChar = i + 1 < csvText.length ? csvText[i + 1] : null;
                
                if (char === '"') {
                  // エスケープされたダブルクォート（""）の処理
                  if (inQuotes && nextChar === '"') {
                    currentRow += '"';
                    i++; // 次の文字をスキップ
                  } else {
                    inQuotes = !inQuotes;
                  }
                } else if (char === '\n' && !inQuotes) {
                  // クォート外の改行は行の区切り
                  if (currentRow.trim()) {
                    rows.push(currentRow);
                  }
                  currentRow = '';
                } else {
                  currentRow += char;
                }
              }
              
              // 最後の行を追加
              if (currentRow.trim()) {
                rows.push(currentRow);
              }
              
              if (rows.length > 1) {
                // ヘッダー行を取得
                const headerRow = rows[0];
                // データ行（ヘッダーを除く最初の行）を取得
                const dataRow = rows[1];
                
                // CSVパーサー（引用符内のカンマと改行を正しく処理）
                const parseCsvRow = (row: string): string[] => {
                  const values: string[] = [];
                  let current = '';
                  let inQuotes = false;
                  
                  for (let i = 0; i < row.length; i++) {
                    const char = row[i];
                    const nextChar = i + 1 < row.length ? row[i + 1] : null;
                    
                    if (char === '"') {
                      // エスケープされたダブルクォート（""）の処理
                      if (inQuotes && nextChar === '"') {
                        current += '"';
                        i++; // 次の文字をスキップ
                      } else {
                        // 引用符の開始または終了
                        inQuotes = !inQuotes;
                        // 引用符自体は値に含めない（最初と最後の引用符を除去）
                      }
                    } else if (char === ',' && !inQuotes) {
                      // クォート外のカンマはフィールドの区切り
                      values.push(current);
                      current = '';
                    } else {
                      // 引用符内の文字、または引用符外の通常の文字
                      current += char;
                    }
                  }
                  // 最後のフィールドを追加
                  values.push(current);
                  return values;
                };
                
                const parts = parseCsvRow(dataRow);
                console.log(`ブログ取り込みデバッグ (${url}): CSV列数: ${parts.length}`);
                console.log(`ブログ取り込みデバッグ (${url}): CSV行の先頭200文字:`, dataRow.substring(0, 200));
                console.log(`ブログ取り込みデバッグ (${url}): パース結果 - Date: "${parts[0]}", Title: "${parts[1]?.substring(0, 50)}...", Content長: ${parts[2]?.length || 0}, Category: "${parts[3]}", Tags: "${parts[4]}", URL: "${parts[5]}"`);
                
                // 列数に応じて柔軟に対応
                if (parts.length >= 3) {
                  // 最低限、Date, Title, Contentがあれば処理する
                  const date = parts[0]?.replace(/^"|"$/g, '') || '';
                  const title = parts[1]?.replace(/^"|"$/g, '').replace(/""/g, '"') || '';
                  const content = parts[2]?.replace(/^"|"$/g, '').replace(/""/g, '"') || '';
                  
                  // URLを取得（引用符を除去）
                  let extractedUrl = '';
                  if (parts.length >= 6) {
                    extractedUrl = parts[5]?.replace(/^"|"$/g, '').replace(/""/g, '"') || '';
                  } else {
                    // URL列がない場合は、元のURLを使用
                    extractedUrl = url;
                  }
                  
                  // URLが正しい形式でない場合、元のURLを使用
                  const isValidUrl = extractedUrl && 
                    (extractedUrl.startsWith('http://') || extractedUrl.startsWith('https://'));
                  
                  const category = parts.length >= 4 ? (parts[3]?.replace(/^"|"$/g, '').replace(/""/g, '"') || '') : '';
                  const tags = parts.length >= 5 ? (parts[4]?.replace(/^"|"$/g, '').replace(/""/g, '"') || '') : '';
                  
                  // タイトルやコンテンツが空の場合は警告
                  if (!title.trim() || !content.trim()) {
                    console.warn(`ブログ取り込み警告 (${url}): タイトルまたはコンテンツが空です。タイトル: "${title}", コンテンツ長: ${content.length}`);
                  }
                  
                  if (parts.length < 6) {
                    console.warn(`ブログ取り込み警告 (${url}): CSVの列数が不足しています。期待: 6列, 実際: ${parts.length}列。取得できたデータを使用します。`);
                  }
                  
                  return {
                    title,
                    content,
                    date,
                    url: isValidUrl ? extractedUrl : url, // 正しいURLでない場合は元のURLを使用
                    category,
                    tags,
                  };
                } else {
                  console.warn(`ブログ取り込み警告 (${url}): CSVの列数が不足しています。期待: 3列以上, 実際: ${parts.length}列。CSV内容:`, dataRow.substring(0, 200));
                }
              } else {
                console.warn(`ブログ取り込み警告 (${url}): CSVデータが空です。`);
              }
            } else {
              console.warn(`ブログ取り込み警告 (${url}): API応答にCSVデータが含まれていません。`, data);
            }
            
            // CSVが取得できない場合でも、元のURLを返す
            return {
              title: '',
              content: '',
              date: new Date().toISOString().split('T')[0],
              url: url,
              category: '',
              tags: '',
              error: 'CSVデータが取得できませんでした', // エラー情報を追加
            };
          } catch (error: any) {
            const errorMsg = error.message || String(error);
            console.error(`ブログ取り込み例外 (${url}):`, errorMsg, error);
            setBlogImportProgress(`例外エラー: ${url} - ${errorMsg}`);
            return {
              title: '',
              content: '',
              date: new Date().toISOString().split('T')[0],
              url: url,
              category: '',
              tags: '',
              error: errorMsg, // エラー情報を追加
            };
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        const validPosts = batchResults.filter(p => p !== null) as any[];
        const errorPosts = validPosts.filter((p: any) => p.error) as any[];
        const successPosts = validPosts.filter((p: any) => !p.error) as any[];
        
        // 成功した投稿をallPostsに追加
        allPosts.push(...successPosts);
        processedCount += successPosts.length;
        
        // エラーがあった投稿もallPostsに追加（URLリストには追加されるようにする）
        // ただし、content_empty以外のエラーは記録しない
        const recoverableErrors = errorPosts.filter((p: any) => p.error === 'content_empty' || p.title);
        allPosts.push(...recoverableErrors);
        
        // エラーがあった場合は進捗に表示
        if (errorPosts.length > 0) {
          const errorUrls = errorPosts.map((p: any) => p.url).join(', ');
          setBlogImportProgress(`${successPosts.length}件成功, ${errorPosts.length}件エラー (${errorUrls.substring(0, 100)}...)`);
        }
        
        // バッチ処理後にサイズをチェック（エラーのない投稿のみ）
        const tempCsvRows = [
          'Date,Title,Content,Category,Tags,URL',
          ...allPosts.filter((post: any) => !post.error).map((post: any) => {
            const date = post.date || ''; // 空欄の可能性があるため
            const title = `"${(post.title || '').replace(/"/g, '""')}"`;
            const content = `"${(post.content || '').replace(/"/g, '""')}"`; // 改行を保持
            const category = `"${(post.category || '').replace(/"/g, '""')}"`;
            // タグは必ずダブルクォートで囲む（カンマが含まれる可能性があるため）
            const tags = `"${(post.tags || '').replace(/"/g, '""')}"`; // タグ（CSVエスケープ処理を徹底）
            const url = `"${(post.url || '').replace(/"/g, '""')}"`;
            return `${date},${title},${content},${category},${tags},${url}`;
          }),
        ];
        const tempCsv = tempCsvRows.join('\n');
        
        // 既存データと結合したサイズをチェック
        let tempFinalData = tempCsv;
        if (blogData && blogData.trim()) {
          const existingLines = blogData.split('\n');
          const newLines = tempCsv.split('\n');
          if (existingLines.length > 0 && newLines.length > 1) {
            tempFinalData = existingLines[0] + '\n' + existingLines.slice(1).join('\n') + '\n' + newLines.slice(1).join('\n');
          }
        }
        
        const tempDataSize = new Blob([tempFinalData]).size;
        if (tempDataSize > ONE_MB) {
          // サイズ制限に達した場合、それ以降の処理を停止
          shouldStop = true;
          setBlogImportProgress(`サイズ制限に達しました。${processedCount}件の記事を取り込みました。`);
          break;
        }
        
        setBlogImportProgress(`${Math.min(i + CONCURRENT_LIMIT, urls.length)}/${urls.length}件のURLを処理中...`);
        
        // バッチ間で少し待機
        if (i + CONCURRENT_LIMIT < urls.length && !shouldStop) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // 成功した投稿をカウント（タイトルまたはコンテンツがあれば成功とみなす）
      const successPosts = allPosts.filter((p: any) => {
        // エラーがなくコンテンツがある
        if (!p.error && p.content && p.content.trim().length > 0) return true;
        // エラーがあるがcontent_emptyでタイトルがある
        if (p.error === 'content_empty' && p.title) return true;
        return false;
      });
      
      // URLが1つも取り込めなかった場合のみエラー
      if (allPosts.length === 0) {
        throw new Error('記事の取得に失敗しました。URLを確認してください。');
      }
      
      // 部分的に失敗した場合は警告を表示
      if (successPosts.length === 0 && allPosts.length > 0) {
        const errorDetails = allPosts.map((p: any) => {
          if (p.error && p.error !== 'content_empty') {
            return `${p.url}: ${p.error}`;
          } else if (!p.content || !p.content.trim()) {
            return `${p.url}: 記事の内容が空です`;
          } else {
            return `${p.url}: 不明なエラー`;
          }
        }).join('\n');
        
        console.warn(`ブログ取り込み警告: 本文の取得に失敗した記事があります\n${errorDetails}`);
        // エラーを投げずに続行（URLリストには追加される）
      }
      
      // エラーがあった投稿がある場合は警告を表示
      const errorPosts = allPosts.filter((p: any) => p.error);
      if (errorPosts.length > 0) {
        console.warn(`ブログ取り込み: ${successPosts.length}件成功, ${errorPosts.length}件失敗`);
      }
      
      // CSV形式に変換（コンテンツが取得できた投稿、またはcontent_emptyでタイトルがある投稿）
      // タイトルがあれば有効な投稿として扱う（コンテンツが空でもOK）
      const validPosts = allPosts.filter((post: any) => {
        // エラーがなければ有効
        if (!post.error) return true;
        // content_emptyでタイトルがあれば有効
        if (post.error === 'content_empty' && post.title) return true;
        // タイトルがあれば有効（エラーがあっても）
        if (post.title && post.title.trim()) return true;
        return false;
      });
      console.log(`ブログ取り込み: 有効な投稿数 = ${validPosts.length} / 全投稿数 = ${allPosts.length}`);
      
      // デバッグ: 最初の3件の投稿を確認
      console.log('ブログ取り込み: 最初の3件の投稿:', allPosts.slice(0, 3).map((p: any) => ({
        url: p.url,
        title: p.title?.substring(0, 30),
        contentLength: p.content?.length || 0,
        error: p.error
      })));
      
      // 重複を除外（同じURLの投稿は1つだけ残す）
      const uniquePosts = new Map<string, any>();
      let noUrlCounter = 0;
      for (const post of validPosts) {
        const rawUrl = post.url || (post as any).URL || '';
        const url = normalizeUrlForDedup(String(rawUrl));
        const key = url ? `u:${url}` : `no-url:${noUrlCounter++}`;
        if (!uniquePosts.has(key)) {
          uniquePosts.set(key, post);
        }
      }
      const uniquePostsArray = Array.from(uniquePosts.values());
      console.log(`ブログ取り込み: 重複除外後の投稿数 = ${uniquePostsArray.length}`);
      
      const csvRows = [
        'Date,Title,Content,Category,Tags,URL',
        ...uniquePostsArray.map((post: any) => {
          // すべてのフィールドをダブルクォートで囲む（一貫性と安全性のため）
          const date = `"${(post.date || '').replace(/"/g, '""')}"`;
          const title = `"${(post.title || '').replace(/"/g, '""')}"`;
          const content = `"${(post.content || '').replace(/"/g, '""')}"`; // 改行を保持
          const category = `"${(post.category || '').replace(/"/g, '""')}"`;
          // タグは必ずダブルクォートで囲む（カンマが含まれる可能性があるため）
          const tags = `"${(post.tags || '').replace(/"/g, '""')}"`; // タグ（CSVエスケープ処理を徹底）
          const url = `"${(post.url || '').replace(/"/g, '""')}"`;
          return `${date},${title},${content},${category},${tags},${url}`;
        }),
      ];
      
      const csv = csvRows.join('\n');
      console.log(`ブログ取り込み: 生成したCSV行数 = ${csvRows.length} (ヘッダー含む)`);
      
      // 既存のブログデータと結合（モードに応じて）
      let finalBlogData: string;
      console.log(`ブログ取り込み: allPosts.length = ${allPosts.length}, 成功した投稿数 = ${allPosts.filter((p: any) => !p.error).length}`);
      console.log(`ブログ取り込み: 新しいCSV行数 = ${csv.split('\n').length}`);
      
      if (blogData && blogData.trim()) {
        const existingLines = blogData.split('\n');
        const newLines = csv.split('\n');
        
        console.log(`ブログ取り込み: 既存データ行数 = ${existingLines.length}, 新しいデータ行数 = ${newLines.length}`);
        
        if (existingLines.length > 0 && newLines.length > 1) {
          // 既存データから新しいURLのデータを除外（重複を避ける）
          const existingPosts = parseCsvToPosts(blogData);
          console.log(`ブログ取り込み: 既存データからパースした投稿数 = ${existingPosts.length}`);
          
          // URLの正規化関数（末尾のスラッシュを統一）
          const normalizeUrl = (url: string) => normalizeUrlForDedup(url);
          
          const newUrlsSet = new Set(allPosts.map(p => {
            const rawUrl = p.url || (p as any).URL || '';
            return normalizeUrl(rawUrl);
          }));
          console.log(`ブログ取り込み: 新しいURL数 = ${newUrlsSet.size}`);
          
          // 既存データから新しいURLのデータを除外
          const filteredExistingPosts = existingPosts.filter(post => {
            const url = normalizeUrl(post.URL || post.url || post.Url || '');
            const isDuplicate = newUrlsSet.has(url);
            if (isDuplicate) {
              console.log(`ブログ取り込み: 重複を除外 - ${url}`);
            }
            return !isDuplicate;
          });
          
          console.log(`ブログ取り込み: 重複除外後の既存投稿数 = ${filteredExistingPosts.length}`);
          
          // フィルタリングされた既存データをCSVに変換
          const filteredExistingCsv = [
            'Date,Title,Content,Category,Tags,URL',
            ...filteredExistingPosts.map(post => {
              const date = post.Date || post.date || '';
              const title = `"${(post.Title || post.title || '').replace(/"/g, '""')}"`;
              const content = `"${(post.Content || post.content || '').replace(/"/g, '""')}"`; // 改行を保持
              const category = `"${(post.Category || post.category || '').replace(/"/g, '""')}"`;
              const tags = `"${(post.Tags || post.tags || '').replace(/"/g, '""')}"`;
              const url = `"${post.URL || post.url || post.Url || ''}"`;
              return `${date},${title},${content},${category},${tags},${url}`;
            }),
          ].join('\n');
          
          // 既存データ（重複除外）と新しいデータを結合
          const filteredLines = filteredExistingCsv.split('\n');
          if (filteredLines.length > 0 && newLines.length > 1) {
            finalBlogData = filteredLines[0] + '\n' + filteredLines.slice(1).join('\n') + '\n' + newLines.slice(1).join('\n');
          } else {
            finalBlogData = csv;
          }
        } else {
          finalBlogData = csv;
        }
      } else {
        // 上書きモード：新しいデータのみ
        finalBlogData = csv;
      }
      
      // データサイズをチェック（Firestoreのドキュメントサイズ制限: 1MB）
      const dataSize = new Blob([finalBlogData]).size;
      if (dataSize > ONE_MB) {
        // 既存データが大きすぎる場合は、新しいデータのみを保存
        console.warn(`データサイズが大きすぎます（${(dataSize / 1024 / 1024).toFixed(2)} MB）。新しいデータのみを保存します。`);
        finalBlogData = csv;
      }
      
      // Firestoreに保存
      const now = new Date();
      const dateStr = now.toLocaleString('ja-JP', { 
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' 
      });
      
      await saveBlogDataToFirestore(user.uid, finalBlogData, dateStr);
      
      // デバッグ: 保存前のデータを確認
      const finalLines = finalBlogData.split('\n');
      console.log(`ブログ取り込み: 保存するデータの行数 = ${finalLines.length}`);
      console.log(`ブログ取り込み: 保存するデータの最初の3行:`, finalLines.slice(0, 3));
      
      // パースして投稿数を確認
      const testParsed = parseCsvToPosts(finalBlogData);
      console.log(`ブログ取り込み: 保存するデータからパースした投稿数 = ${testParsed.length}`);
      
      console.log(`ブログ取り込み: setBlogData呼び出し - データサイズ: ${finalBlogData.length}文字, 行数: ${finalBlogData.split('\n').length}`);
      setBlogData(finalBlogData);
      setBlogUploadDate(dateStr);
      
      // ブログデータを取り込んだ場合、デフォルトでブログ投稿が表示されるようにする
      if (finalBlogData && finalBlogData.trim() && finalBlogData.split('\n').length > 1) {
        setDataSource('blog');
        setAnalysisDataSource('blog');
        console.log(`ブログ取り込み: dataSource/analysisDataSourceを'blog'に変更しました - 過去投稿一覧に表示されます`);
      } else {
        console.warn(`ブログ取り込み: blogDataが空のためdataSourceは変更されません`);
      }
      
      // 取り込んだURLを記録（重複しないように）
      // ※updatedBlogUrlsとupdatedBlogUrlDatesは関数スコープで初期化済み
      
      // 元のURLリストを保持（確実に正しいURLを保存するため）
      const originalUrlsMap = new Map<string, string>();
      urls.forEach(originalUrl => {
        originalUrlsMap.set(originalUrl, originalUrl);
      });
      
      for (const post of allPosts) {
        let postUrl = post.url;
        
        // URLが正しい形式でない場合、元のURLリストから探す
        const isValidUrl = postUrl && 
          (postUrl.startsWith('http://') || postUrl.startsWith('https://'));
        
        if (!isValidUrl) {
          // 元のURLリストから該当するURLを探す
          const foundUrl = urls.find(u => {
            // postUrlが元のURLを含む、または元のURLがpostUrlを含む場合
            return postUrl && (postUrl.includes(u) || u.includes(postUrl));
          });
          if (foundUrl) {
            postUrl = foundUrl;
          } else {
            // それでも見つからない場合は、元のURLリストの最初の未使用URLを使用
            const unusedUrl = urls.find(u => !updatedBlogUrls.includes(u));
            if (unusedUrl) {
              postUrl = unusedUrl;
            } else {
              // 最後の手段：元のURLリストの最初のURLを使用
              postUrl = urls[0] || postUrl;
            }
          }
        }
        
        // 最終的に正しいURL形式であることを確認
        if (postUrl && (postUrl.startsWith('http://') || postUrl.startsWith('https://'))) {
          if (!updatedBlogUrls.includes(postUrl)) {
            updatedBlogUrls.push(postUrl);
          }
          updatedBlogUrlDates[postUrl] = dateStr;
        }
      }
      
      // 元のURLリストで、まだ追加されていないURLを追加（記事取得に失敗した場合でもURLは保存）
      for (const originalUrl of urls) {
        if (originalUrl && (originalUrl.startsWith('http://') || originalUrl.startsWith('https://'))) {
          if (!updatedBlogUrls.includes(originalUrl)) {
            updatedBlogUrls.push(originalUrl);
            updatedBlogUrlDates[originalUrl] = dateStr;
          }
        }
      }
      
      // ブログURL一覧を50件に制限（古いものから削除）
      const MAX_BLOG_URLS = 50;
      if (updatedBlogUrls.length > MAX_BLOG_URLS) {
        // 取込み日時でソート（古い順）
        const sortedUrls = [...updatedBlogUrls].sort((a, b) => {
          const dateA = updatedBlogUrlDates[a] || '';
          const dateB = updatedBlogUrlDates[b] || '';
          if (dateA && dateB) {
            return new Date(dateA.replace(/\//g, '-')).getTime() - new Date(dateB.replace(/\//g, '-')).getTime();
          }
          if (dateA) return -1;
          if (dateB) return 1;
          return 0;
        });
        
        // 古いものから削除
        const urlsToRemove = sortedUrls.slice(0, updatedBlogUrls.length - MAX_BLOG_URLS);
        const finalBlogUrls = updatedBlogUrls.filter(url => !urlsToRemove.includes(url));
        const finalBlogUrlDates: { [key: string]: string } = {};
        finalBlogUrls.forEach(url => {
          if (updatedBlogUrlDates[url]) {
            finalBlogUrlDates[url] = updatedBlogUrlDates[url];
          }
        });
        
        updatedBlogUrls.length = 0;
        updatedBlogUrls.push(...finalBlogUrls);
        Object.keys(updatedBlogUrlDates).forEach(key => {
          if (!finalBlogUrls.includes(key)) {
            delete updatedBlogUrlDates[key];
          }
        });
        Object.assign(updatedBlogUrlDates, finalBlogUrlDates);
        
        // 削除されたURLのデータも削除
        const removedUrlsSet = new Set(urlsToRemove);
        const updatedPosts = parsedPosts.filter(post => {
          const postUrl = post.URL || post.url;
          return !postUrl || !removedUrlsSet.has(postUrl);
        });
        setParsedPosts(updatedPosts);
        
        // ブログデータからも削除
        if (blogData && blogData.trim()) {
          try {
            const blogPosts = parseCsvToPosts(blogData);
            const filteredPosts = blogPosts.filter(post => {
              const postUrl = post.URL || post.url;
              return !postUrl || !removedUrlsSet.has(postUrl);
            });
            
            if (filteredPosts.length > 0) {
              const filteredBlogData = [
                'Date,Title,Content,Category,Tags,URL',
                ...filteredPosts.map(post => {
                  const date = post.Date || post.date || '';
                  const title = `"${(post.Title || post.title || '').replace(/"/g, '""')}"`;
                  const content = `"${(post.Content || post.content || '').replace(/"/g, '""')}"`;
                  const category = `"${(post.Category || post.category || '').replace(/"/g, '""')}"`;
                  const tags = `"${(post.Tags || post.tags || '').replace(/"/g, '""')}"`;
                  const url = `"${post.URL || post.url || ''}"`;
                  return `${date},${title},${content},${category},${tags},${url}`;
                }),
              ].join('\n');
              
              setBlogData(filteredBlogData);
              await saveBlogDataToFirestore(user.uid, filteredBlogData, dateStr);
            } else {
              setBlogData('');
              setBlogUploadDate(null);
              await setDoc(doc(db, 'users', user.uid), {
                blogData: null,
                blogUploadDate: null,
                blogUpdatedTime: null,
                blogIsSplit: false,
                blogChunkCount: null
              }, { merge: true });
            }
          } catch (error) {
            console.error('ブログデータのフィルタリングエラー:', error);
          }
        }
      }
      
      console.log('[handleImportSelectedUrls] tryブロック - setBlogUrls呼び出し:', updatedBlogUrls.length, updatedBlogUrls);
      setBlogUrls(updatedBlogUrls);
      setBlogUrlDates(updatedBlogUrlDates);
      
      // FirestoreにURLの一覧と取込み日時を保存
      try {
        const userRef = doc(db, 'users', user.uid);
        await setDoc(userRef, {
          blogUrls: updatedBlogUrls,
          blogUrlDates: updatedBlogUrlDates
        }, { merge: true });
        console.log('[handleImportSelectedUrls] tryブロック - Firestore保存完了');
        saveSucceeded = true; // 保存成功フラグを設定
      } catch (saveError) {
        console.error('[handleImportSelectedUrls] tryブロック - Firestore保存エラー:', saveError);
        // 保存に失敗しても、状態更新は成功しているのでsaveSucceededはfalseのまま
        // finallyブロックで再試行される
      }
      
      // エラーがあった投稿をカウント
      const errorCount = allPosts.filter((p: any) => p.error).length;
      const successCount = allPosts.filter((p: any) => !p.error).length;
      
      let successMessage = '';
      if (shouldStop) {
        successMessage = `${successCount}件の記事を取り込みました（サイズ制限により一部のURLは取り込まれていません）`;
      } else {
        successMessage = `${successCount}件の記事を取得しました`;
      }
      
      if (errorCount > 0) {
        const errorPosts = allPosts.filter((p: any) => p.error);
        const errorUrls = errorPosts.map((p: any) => p.url).slice(0, 5);
        const errorMessages = errorPosts.map((p: any) => `${p.url}: ${p.error || '不明なエラー'}`).slice(0, 5);
        successMessage += `\n\nエラー: ${errorCount}件のURLで取り込みに失敗しました。\n失敗したURL（最大5件）:\n${errorMessages.join('\n')}`;
        if (errorCount > 5) {
          successMessage += `\n...他${errorCount - 5}件`;
        }
        successMessage += '\n\n詳細はブラウザのコンソール（F12）を確認してください。';
        console.error('ブログ取り込みエラー詳細:', errorPosts);
      }
      
      setBlogImportProgress(successMessage);
      
      if (shouldStop || errorCount > 0) {
        alert(successMessage);
      }
      
      setSelectedUrls(new Set()); // 選択をリセット
    } catch (error: any) {
      console.error('Blog import error:', error);
      const errorDetails = error.stack || error.message || String(error);
      console.error('エラー詳細:', errorDetails);
      
      // 容量超過エラーの場合は詳細なメッセージを表示
      if (error.message && error.message.includes('容量制限')) {
        alert(error.message);
      } else if (error.message && error.message.includes('exceeds the maximum allowed size')) {
        alert(`ブログデータの保存に失敗しました。\n\n原因: Firestoreの容量制限（1MB）を超えています。\n\n制限: 1MB\n\n対処方法:\n1. 古いブログデータを削除してください\n2. 取り込むURLの数を減らしてください（1回あたり50件以下を推奨）\n3. CSVデータを削除してから再度試してください`);
      } else {
        alert(`ブログの取り込みに失敗しました: ${error.message}\n\n詳細はブラウザのコンソール（F12）を確認してください。`);
      }
      setBlogImportProgress(`エラー: ${error.message}`);
    } finally {
      setIsBlogImporting(false);
      
      // エラー発生時でも、URLリストは保存する（取り込み開始時に追加済み）
      // tryブロックで保存成功した場合はスキップ
      if (!saveSucceeded && updatedBlogUrls.length > 0) {
        console.log('[handleImportSelectedUrls] finally - エラー発生のためURLリストを保存:', updatedBlogUrls.length);
        
        // 50件制限を適用
        const MAX_BLOG_URLS = 50;
        if (updatedBlogUrls.length > MAX_BLOG_URLS) {
          const sortedUrls = [...updatedBlogUrls].sort((a, b) => {
            const dateA = updatedBlogUrlDates[a] || '';
            const dateB = updatedBlogUrlDates[b] || '';
            if (dateA && dateB) {
              return new Date(dateA.replace(/\//g, '-')).getTime() - new Date(dateB.replace(/\//g, '-')).getTime();
            }
            if (dateA) return -1;
            if (dateB) return 1;
            return 0;
          });
          const urlsToRemove = sortedUrls.slice(0, updatedBlogUrls.length - MAX_BLOG_URLS);
          updatedBlogUrls = updatedBlogUrls.filter(url => !urlsToRemove.includes(url));
          Object.keys(updatedBlogUrlDates).forEach(key => {
            if (!updatedBlogUrls.includes(key)) {
              delete updatedBlogUrlDates[key];
            }
          });
        }
        
        setBlogUrls(updatedBlogUrls);
        setBlogUrlDates(updatedBlogUrlDates);
        
        // Firestoreにも保存
        try {
          const userRef = doc(db, 'users', user.uid);
          await setDoc(userRef, {
            blogUrls: updatedBlogUrls,
            blogUrlDates: updatedBlogUrlDates
          }, { merge: true });
          console.log('[handleImportSelectedUrls] Firestoreへの保存成功');
        } catch (saveError) {
          console.error('[handleImportSelectedUrls] Firestore保存エラー:', saveError);
        }
      }
      
      // 取り込み完了後、ダイアログを自動で閉じる
      setShowDataImportModal(false);
      setShowSitemapUrlModal(false);
      setBlogImportProgress('');
    }
  };

  // 個別URLの更新（再取得） - 常に追加モードで再取得
  const handleUpdateUrl = async (url: string) => {
    await handleImportSelectedUrls([url], 'auto');
  };

  // 旧実装のhandleBlogImport関数は削除（サイトマップ方式に変更）

  // 分割されたCSVを結合して読み込む関数
  const loadCsvFromFirestore = (data: any): string | null => {
    if (data.csvIsSplit && data.csvChunkCount) {
      // 分割されている場合は結合
      const chunks: string[] = [];
      for (let i = 0; i < data.csvChunkCount; i++) {
        const chunkKey = i === 0 ? 'csvData' : `csvData_${i}`;
        if (data[chunkKey]) {
          chunks.push(data[chunkKey]);
        }
      }
      
      if (chunks.length > 0) {
        // ヘッダー行を取得（最初のチャンクから）
        const firstChunk = chunks[0];
        const firstLines = firstChunk.split('\n');
        const header = firstLines[0];
        
        // 全チャンクからデータ行を結合
        let combinedData = header + '\n';
        for (const chunk of chunks) {
          const lines = chunk.split('\n');
          // ヘッダー行を除いて結合
          if (lines.length > 1) {
            combinedData += lines.slice(1).join('\n') + '\n';
          }
        }
        
        return combinedData.trim();
      }
    } else if (data.csvData) {
      // 分割されていない場合はそのまま返す
      return data.csvData;
    }
    
    return null;
  };

  // WordPressのブロックコメントとHTMLタグを除去してテキストのみを抽出する関数
  // 改行を保持するバージョン
  const extractTextFromWordPress = (html: string, preserveLineBreaks: boolean = true): string => {
    if (!html) return '';
    
    let text = html;
    
    // WordPressのブロックコメントを除去（<!-- wp:xxx --> や <!-- /wp:xxx -->）
    text = text.replace(/<!--\s*\/?wp:[^>]+-->/g, '');
    
    // 改行を保持する場合、<br>、<p>、<div>などの改行要素を改行に変換
    if (preserveLineBreaks) {
      text = text
        .replace(/<br\s*\/?>/gi, '\n')  // <br>を改行に
        .replace(/<\/p>/gi, '\n')       // </p>を改行に
        .replace(/<\/div>/gi, '\n')     // </div>を改行に
        .replace(/<\/h[1-6]>/gi, '\n')  // 見出しタグの終了を改行に
        .replace(/<\/li>/gi, '\n');     // リスト項目の終了を改行に
    }
    
    // HTMLタグを除去
    text = text.replace(/<[^>]+>/g, '');
    
    // HTMLエンティティをデコード（ブラウザ環境の場合）
    // セキュリティ: innerHTMLの代わりにtextContentを使用してXSSを防止
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      // innerHTMLの代わりにtextContentを使用（XSS対策）
      textarea.textContent = text;
      text = textarea.value;
    } else {
      // Node.js環境の場合（サーバーサイド）
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
    }
    
    if (preserveLineBreaks) {
      // 改行を保持しつつ、連続する空白を整理
      // 3つ以上の連続する改行を2つに制限
      text = text.replace(/\n{3,}/g, '\n\n');
      // 行頭・行末の空白を除去
      text = text.split('\n').map(line => line.trim()).join('\n');
      // 連続する空白（改行以外）を1つに
      text = text.replace(/[ \t]+/g, ' ');
    } else {
      // 改行を保持しない場合（従来の動作）
      text = text.replace(/\s+/g, ' ').trim();
      text = text.replace(/\n\s*\n/g, '\n');
    }
    
    return text.trim();
  };

  // CSV行をパースするヘルパー関数（カンマ区切り、ダブルクォート対応）
  // CSV行をパースする関数（外部からも使用可能）
  const parseCsvRow = (row: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      const nextChar = row[i + 1];
      
      if (char === '"') {
        // エスケープされたダブルクォート（""）の処理
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++; // 次の文字をスキップ
        } else {
          inQuotes = !inQuotes;
          // クォート自体は値に含めない（最初と最後のクォートのみ）
        }
      } else if (char === ',' && !inQuotes) {
        // クォート外のカンマはフィールドの区切り
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    // 最後のフィールドを追加
    values.push(current);
    
    return values;
  };

  // CSVをパースして投稿データの配列に変換（改行を含むフィールドに対応、最適化版）
  const parseCsvToPosts = (csvText: string): any[] => {
    if (!csvText) return [];
    
    // 改行を含むフィールドに対応したCSVパース（最適化版）
    const rows: string[] = [];
    let currentRow = '';
    let inQuotes = false;
    const textLength = csvText.length;
    
    // 文字列連結を最適化（配列にpushして最後にjoin）
    const rowParts: string[] = [];
    
    for (let i = 0; i < textLength; i++) {
      const char = csvText[i];
      const nextChar = i + 1 < textLength ? csvText[i + 1] : null;
      
      if (char === '"') {
        // エスケープされたダブルクォート（""）の処理
        if (inQuotes && nextChar === '"') {
          rowParts.push('"');
          i++; // 次の文字をスキップ
        } else {
          inQuotes = !inQuotes;
          // クォート自体は値に含めない（最初と最後のクォートのみ）
        }
      } else if (char === '\n' && !inQuotes) {
        // クォート外の改行は行の区切り
        if (rowParts.length > 0 || currentRow.trim()) {
          rows.push(currentRow + rowParts.join(''));
        }
        currentRow = '';
        rowParts.length = 0; // 配列をクリア
      } else {
        // 文字列連結を最適化（小さなチャンクは直接連結、大きなチャンクは配列にpush）
        if (rowParts.length === 0 && currentRow.length < 1000) {
          currentRow += char;
        } else {
          if (currentRow) {
            rowParts.push(currentRow);
            currentRow = '';
          }
          rowParts.push(char);
        }
      }
    }
    
    // 最後の行を追加
    if (rowParts.length > 0 || currentRow.trim()) {
      rows.push(currentRow + rowParts.join(''));
    }
    
    if (rows.length < 2) return [];
    
    // ヘッダー行を取得
    const headerValues = parseCsvRow(rows[0]);
    const headers = headerValues.map((h: string, index: number) => {
      // ヘッダーからダブルクォートやBOM/制御文字を除去
      let header = h.trim();
      if (header.startsWith('"') && header.endsWith('"')) {
        header = header.slice(1, -1);
      }
      header = header.replace(/""/g, '"');
      header = header.replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
      return header || `Column${index + 1}`;
    });
    
    // データ行をパース（最適化：事前に配列サイズを確保し、インデックスで直接代入）
    const posts: any[] = [];
    
    // キー配列を事前に定義（ループ内で毎回作成しない）
    const likesKeys = ['Likes', 'likes', 'Like', 'いいね', 'Like Count', 'like_count', 'favorite_count', 'Favorite Count'];
    const viewsKeys = ['Views', 'views', 'View', 'ビュー', 'View Count', 'view_count', 'Impressions', 'impressions', 'インプレッション'];
    const engagementKeys = ['Engagement', 'engagement', 'エンゲージメント', 'Total Engagement'];
    const titleKeys = ['Title', 'title', 'タイトル', '見出し', 'Headline'];
    // XのCSVデータとブログデータを区別するため、データソースを判定
    // ヘッダーに'text'がある場合はXのCSVデータ、'Content'がある場合はブログデータと判定
    const hasTextColumn = headers.some((h: string) => h.toLowerCase() === 'text');
    const hasContentColumn = headers.some((h: string) => h.toLowerCase() === 'content');
    
    // XのCSVデータの場合は'text'を優先、ブログデータの場合は'Content'を優先
    const contentKeys = hasTextColumn 
      ? ['text', 'Text', 'Tweet', 'tweet', 'Post Content', '投稿内容', '投稿', 'Post']
      : ['Content', 'content', 'Post Content', '投稿内容', 'Text', 'text', 'Tweet', 'tweet', '投稿', 'Post'];
    // 日付キー（created_atを最優先、clientは日付ではないので除外）
    const dateKeys = ['created_at', 'Created At', 'createdAt', 'Date', 'date', '日付', '投稿日', 'Posted At'];
    
    // 数値列のインデックスを事前に取得
    const numericColumnIndices = new Set<number>();
    headers.forEach((header: string, index: number) => {
      const lowerHeader = header.toLowerCase();
      if (likesKeys.some(k => k.toLowerCase() === lowerHeader) || 
          viewsKeys.some(k => k.toLowerCase() === lowerHeader) || 
          engagementKeys.some(k => k.toLowerCase() === lowerHeader)) {
        numericColumnIndices.add(index);
      }
    });
    
    // tweet_id列のインデックスを取得
    const tweetIdColumnIndex = headers.findIndex((h: string) => {
      const normalized = h.toLowerCase().trim().replace(/^"|"$/g, '');
      return normalized === 'tweet id' || normalized === 'tweet_id' || normalized === 'tweetid' || normalized === 'id';
    });
    
    // text列のインデックスを取得（tweet_idの次の列がtext列）
    let textColumnIndex = -1;
    if (tweetIdColumnIndex >= 0 && tweetIdColumnIndex < headers.length - 1) {
      // tweet_idの次の列がtext列
      textColumnIndex = tweetIdColumnIndex + 1;
      console.log('tweet_id列のインデックス:', tweetIdColumnIndex, '→ text列のインデックス:', textColumnIndex);
    } else {
      // フォールバック: ヘッダーから'text'列を探す
      textColumnIndex = headers.findIndex((h: string) => h.toLowerCase() === 'text');
      if (textColumnIndex >= 0) {
        console.log('tweet_id列が見つからないため、ヘッダーからtext列を検索:', textColumnIndex);
      } else {
        console.warn('⚠️ tweet_id列もtext列も見つかりません！');
      }
    }
    
    // text列が存在する場合、最初の数値列のインデックスを事前に計算（パフォーマンス最適化）
    let firstNumericIndex = headers.length;
    if (textColumnIndex >= 0) {
      const numericIndicesAfterText = Array.from(numericColumnIndices).filter(idx => idx > textColumnIndex);
      if (numericIndicesAfterText.length > 0) {
        firstNumericIndex = Math.min(...numericIndicesAfterText);
      }
    }
    
    // 日付列のインデックスを事前に取得（スキップしないように）
    const dateColumnIndices = new Set<number>();
    const dateKeyPatterns = ['created_at', 'createdat', 'date', 'posted_at', 'postedat', '投稿日', '日付'];
    headers.forEach((header: string, index: number) => {
      const normalizedHeader = header.toLowerCase().replace(/[_\s]/g, '');
      for (const pattern of dateKeyPatterns) {
        const normalizedPattern = pattern.toLowerCase().replace(/[_\s]/g, '');
        if (normalizedHeader === normalizedPattern || normalizedHeader.includes(normalizedPattern)) {
          dateColumnIndices.add(index);
          break;
        }
      }
    });
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const values = parseCsvRow(row);
      
      // オブジェクトに変換
      const post: any = {};
      const headerCount = headers.length;
      
      // text列が存在する場合、元の行データから直接text列を抽出
      if (textColumnIndex >= 0) {
        let textValue = '';
        
        // まず、parseCsvRowで正しくパースした値を取得
        if (values[textColumnIndex] !== undefined && values[textColumnIndex] !== null && values[textColumnIndex] !== '') {
          textValue = String(values[textColumnIndex]);
          // ダブルクォートを除去
          if (textValue.startsWith('"') && textValue.endsWith('"') && textValue.length >= 2) {
            textValue = textValue.slice(1, -1).replace(/""/g, '"');
          }
          textValue = textValue.trim();
        }
        
        // パースに失敗した場合、フォールバックとして行データから直接抽出を試みる
        if (!textValue || textValue === '') {
          // 方法1: tweet_idの次から、,jaの前までを取得（XのCSVデータの形式に対応）
          // 改行を含む可能性があるため、行全体から直接抽出
          
          // tweet_id列の終了位置を特定
          // tweet_idは通常、シングルクォートで囲まれている: '2007298478318481583'
          let tweetIdEndIndex = -1;
          let inSingleQuotes = false;
          
          // シングルクォートで囲まれたtweet_idを探す
          for (let j = 0; j < row.length; j++) {
            const char = row[j];
            if (char === "'" && !inSingleQuotes) {
              inSingleQuotes = true;
            } else if (char === "'" && inSingleQuotes) {
              // シングルクォートの終了
              // 次のカンマの位置を探す（空白をスキップ）
              for (let k = j + 1; k < row.length; k++) {
                if (row[k] === ',') {
                  tweetIdEndIndex = k;
                  break;
                } else if (row[k] !== ' ' && row[k] !== '\t') {
                  // 空白以外の文字が見つかった場合は、カンマがない可能性がある
                  break;
                }
              }
              break;
            }
          }
          
          // シングルクォートが見つからない場合は、最初のカンマの位置を使用
          if (tweetIdEndIndex < 0) {
            tweetIdEndIndex = row.indexOf(',');
          }
          
          // ,ja を探す（改行を含む可能性があるため、正規表現を使用）
          // テキストフィールド内の,jaは除外する必要があるため、ダブルクォート外の,jaを探す
          let jaMatchIndex = -1;
          let inDoubleQuotes = false;
          
          for (let j = tweetIdEndIndex + 1; j < row.length; j++) {
            const char = row[j];
            const nextChar = j + 1 < row.length ? row[j + 1] : null;
            
            if (char === '"') {
              if (inDoubleQuotes && nextChar === '"') {
                j++; // エスケープされたダブルクォートをスキップ
                continue;
              }
              inDoubleQuotes = !inDoubleQuotes;
            } else if (!inDoubleQuotes && char === ',' && nextChar === 'j' && j + 2 < row.length && row[j + 2] === 'a') {
              // ダブルクォート外で,jaが見つかった
              // 次の文字がカンマ、Tweet、Reply、Retweet、または行末か確認
              const afterJa = j + 3;
              if (afterJa >= row.length || row[afterJa] === ',' || row[afterJa] === '\n' || 
                  row.substring(afterJa, afterJa + 5) === ',Tweet' ||
                  row.substring(afterJa, afterJa + 6) === ',Reply' ||
                  row.substring(afterJa, afterJa + 8) === ',Retweet') {
                jaMatchIndex = j;
                break;
              }
            }
          }
          
          if (tweetIdEndIndex >= 0 && jaMatchIndex > tweetIdEndIndex) {
            // tweet_id列の次の文字（カンマの後）から、,jaの前までを抽出
            let rawTextValue = row.slice(tweetIdEndIndex + 1, jaMatchIndex);
          
          // 先頭と末尾のダブルクォートを除去
            if (rawTextValue.startsWith('"') && rawTextValue.endsWith('"') && rawTextValue.length >= 2) {
              rawTextValue = rawTextValue.slice(1, -1).replace(/""/g, '"');
            }
            // 前後の空白を除去
            textValue = rawTextValue.trim();
            
            // デバッグログ
            if (i <= 5) {
              console.log(`行${i}: 方法1で抽出成功（tweet_idの次から,jaまで） - textValue長 =`, textValue.length, '先頭50文字 =', textValue.substring(0, 50));
            }
          } else {
            // デバッグログ
            if (i <= 5) {
              console.log(`行${i}: 方法1で抽出失敗 - tweetIdEndIndex =`, tweetIdEndIndex, 'jaMatchIndex =', jaMatchIndex);
            }
          }
          
          // 方法2: 引用符で囲まれたtext列を抽出（より堅牢な方法）
          if (!textValue || textValue === '') {
            // text列は通常、引用符で囲まれている
            // ヘッダーの位置を考慮して、text列の位置を特定
            let quoteStartIndex = -1;
            let quoteEndIndex = -1;
            let commaCount = 0;
            let inQuotes = false;
            
            for (let j = 0; j < row.length; j++) {
              const char = row[j];
              const nextChar = j + 1 < row.length ? row[j + 1] : null;
              
              if (char === '"') {
                if (inQuotes && nextChar === '"') {
                  // エスケープされたダブルクォート
                  j++;
                  continue;
                }
                inQuotes = !inQuotes;
                if (inQuotes && commaCount === textColumnIndex) {
                  quoteStartIndex = j + 1; // 引用符の次の文字から開始
                } else if (!inQuotes && commaCount === textColumnIndex && quoteStartIndex >= 0) {
                  quoteEndIndex = j; // 引用符の前まで
                  break;
                }
              } else if (char === ',' && !inQuotes) {
                commaCount++;
                if (commaCount > textColumnIndex) {
                  break;
                }
              }
            }
            
            if (quoteStartIndex >= 0 && quoteEndIndex > quoteStartIndex) {
              textValue = row.slice(quoteStartIndex, quoteEndIndex);
              textValue = textValue.replace(/""/g, '"').trim();
            }
          }
          
          // 方法3: ヘッダー名から列の位置を特定して抽出（最後の手段）
          if (!textValue || textValue === '') {
            // ヘッダー行からtext列の位置を確認
            const headerRow = rows[0];
            const headerParts = parseCsvRow(headerRow);
            const textHeaderIndex = headerParts.findIndex((h: string) => h.toLowerCase().trim().replace(/^"|"$/g, '') === 'text');
            
            if (textHeaderIndex >= 0 && values.length > textHeaderIndex) {
              textValue = String(values[textHeaderIndex] || '').trim();
          if (textValue.startsWith('"') && textValue.endsWith('"') && textValue.length >= 2) {
            textValue = textValue.slice(1, -1).replace(/""/g, '"');
          }
            }
          }
        }
        
        // デバッグログ（最初の5行のみ）- 詳細版
        if (i <= 5) {
          console.log('=== CSVパースデバッグ（行' + i + '） ===');
          console.log('元の行データ（最初の200文字）:', row.substring(0, 200));
          console.log('textColumnIndex:', textColumnIndex);
          console.log('values配列の長さ:', values.length);
          console.log('ヘッダーの数:', headers.length);
          console.log('values配列の内容:', values.map((v, idx) => ({
            index: idx,
            header: headers[idx] || '(なし)',
            value: v?.substring(0, 100) || '(空)',
            length: v?.length || 0
          })));
          console.log('values[textColumnIndex]:', values[textColumnIndex]?.substring(0, 100) || '(空)', '長さ:', values[textColumnIndex]?.length || 0);
          console.log('抽出されたtextValue:', textValue?.substring(0, 100) || '(空)', '長さ:', textValue?.length || 0);
          console.log('postオブジェクトのキー:', Object.keys(post));
          console.log('post[text]:', post['text']?.substring(0, 100) || '(空)');
          console.log('post[content]:', post['content']?.substring(0, 100) || '(空)');
          console.log('==========================================');
        }
        
        // 大文字小文字に関わらず取得できるように、両方のキーで設定
        post[headers[textColumnIndex]] = textValue;
        post['text'] = textValue;
        post['Text'] = textValue;
        // contentフィールドにも設定（analyzeCsvAndGenerateThemesで使用）
        post['content'] = textValue;
        post['Content'] = textValue;
        post['Post Content'] = textValue;
      }
      
      // すべての列を処理
      for (let j = 0; j < headerCount; j++) {
        // text列が結合処理された場合、結合範囲内の列はスキップ
        if (textColumnIndex >= 0 && j === textColumnIndex) {
          // text列は既に処理済み
          continue;
        }
        // 日付列はスキップしない（created_at等を保持するため）
        if (textColumnIndex >= 0 && j > textColumnIndex && j < firstNumericIndex && !dateColumnIndices.has(j)) {
          // text列の結合範囲内はスキップ（ただし日付列は除く）
          continue;
        }
        
        const header = headers[j];
        let value = values[j] || '';
        if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        if (value.includes('""')) {
          value = value.replace(/""/g, '"');
        }
        post[header] = value;
      }
      
      // URL列を標準化（ヘッダー揺れ対策）
      const urlKey = Object.keys(post).find((key) => {
        const normalized = key.toLowerCase().trim();
        return normalized === 'url' || normalized === 'link' || normalized === 'permalink';
      });
      if (urlKey && post[urlKey]) {
        const normalizedUrl = String(post[urlKey]).trim();
        post.url = normalizedUrl;
        post.URL = normalizedUrl;
      }

      // いいね数を抽出
      let likes = 0;
      for (const key of likesKeys) {
        const val = post[key];
        if (val !== undefined && val !== '') {
          const num = parseInt(String(val).replace(/,/g, ''), 10);
          if (!isNaN(num)) {
            likes = num;
            break;
          }
        }
      }
      
      // ビュー数を抽出
      let views = 0;
      for (const key of viewsKeys) {
        const val = post[key];
        if (val !== undefined && val !== '') {
          const num = parseInt(String(val).replace(/,/g, ''), 10);
          if (!isNaN(num)) {
            views = num;
            break;
          }
        }
      }
      
      // エンゲージメント数値を抽出（Engagement等の列から、いいねとビューが別々の場合は合算）
      let engagement = 0;
      for (const key of engagementKeys) {
        const val = post[key];
        if (val !== undefined && val !== '') {
          const num = parseInt(String(val).replace(/,/g, ''), 10);
          if (!isNaN(num)) {
            engagement = num;
            break;
          }
        }
      }
      // エンゲージメントが0で、いいねとビューがある場合は合算
      if (engagement === 0 && (likes > 0 || views > 0)) {
        engagement = likes + views;
      }
      
      // タイトルを取得（ブログデータの場合は改行を保持）
      let title = '';
      for (const key of titleKeys) {
        const val = post[key];
        if (val !== undefined && val !== '') {
          const rawTitle = String(val);
          // ブログデータの場合（text列がない場合）は、HTMLタグを除去しつつ改行を保持
          if (!hasTextColumn) {
            title = extractTextFromWordPress(rawTitle, true);
          } else {
            // XのCSVデータの場合はそのまま使用
            title = rawTitle;
          }
          break;
        }
      }
      
      // 投稿内容を取得（XのCSVデータの場合は'text'列のみを使用）
      let content = '';
      
      // text列が存在する場合は、必ずtext列のみを使用（他の列は無視）
      if (hasTextColumn && textColumnIndex >= 0) {
        // text列の値を取得（複数のキーを試す）
        const textVal = post['text'] || post['Text'] || post['content'] || post['Content'] || post[headers[textColumnIndex]];
        
        // デバッグログ（最初の5行のみ）- 詳細版
        if (i <= 5) {
          console.log('=== content抽出デバッグ（行' + i + '） ===');
          console.log('hasTextColumn:', hasTextColumn);
          console.log('textColumnIndex:', textColumnIndex);
          console.log('textVal:', textVal?.substring(0, 100) || '(空)', '長さ:', textVal?.length || 0);
          console.log('post[text]:', post['text']?.substring(0, 100) || '(空)', '長さ:', post['text']?.length || 0);
          console.log('post[content]:', post['content']?.substring(0, 100) || '(空)', '長さ:', post['content']?.length || 0);
          console.log('post[Text]:', post['Text']?.substring(0, 100) || '(空)');
          console.log('post[Content]:', post['Content']?.substring(0, 100) || '(空)');
          console.log('post[Post Content]:', post['Post Content']?.substring(0, 100) || '(空)');
          console.log('最終的なcontent:', content?.substring(0, 100) || '(空)', '長さ:', content?.length || 0);
          console.log('========================================');
        }
        
        if (textVal !== undefined && textVal !== null && textVal !== '' && textVal.trim() !== '') {
          // XのCSVデータのtext列はそのまま使用（WordPress処理は不要）
          content = String(textVal).trim();
        } else {
          // text列が空の場合は、values配列から直接取得を試みる
          if (values[textColumnIndex] !== undefined && values[textColumnIndex] !== null && values[textColumnIndex] !== '') {
            let rawValue = String(values[textColumnIndex]);
            // ダブルクォートを除去
            if (rawValue.startsWith('"') && rawValue.endsWith('"') && rawValue.length >= 2) {
              rawValue = rawValue.slice(1, -1).replace(/""/g, '"');
            }
            content = rawValue.trim();
            if (i <= 5) {
              console.log(`行${i}: values配列から取得したcontent =`, content.substring(0, 50));
            }
          } else {
            // values配列からも取得できない場合、postオブジェクトに既に設定されている値を確認
            // これは、text列抽出処理で既に設定されている可能性がある
            if (post['text'] && post['text'].trim() !== '') {
              content = post['text'].trim();
              if (i <= 5) {
                console.log(`行${i}: post[text]から取得したcontent =`, content.substring(0, 50));
              }
            }
          }
        }
        
        // contentが空の場合の警告
        if (!content && i <= 5) {
          console.warn(`行${i}: contentが空です。post =`, Object.keys(post), 'values[textColumnIndex] =', values[textColumnIndex]);
        }
        // hasTextColumnがtrueの場合、text列が空でも他の列は使用しない
      } else {
        // text列がない場合のみ、他の列を試す（ブログデータの場合）
        for (const key of contentKeys) {
          // text列は既に試したのでスキップ
          if (key.toLowerCase() === 'text') continue;
          
          const val = post[key];
          if (val !== undefined && val !== null && val !== '') {
            const rawContent = String(val).trim();
            // 空でない場合は使用
            if (rawContent && rawContent.length > 0) {
              // ブログデータ（Content列など）の場合はWordPress処理を適用（改行を保持）
              const extractedContent = extractTextFromWordPress(rawContent, true);
              if (extractedContent.trim()) {
                content = extractedContent;
                break;
              }
            }
          }
        }
      }
      
      // 日付を取得（created_atを最優先、clientは日付ではないので除外）
      let date = '';
      // client列の値（Twitter for iPhone等）を日付として誤認識しないようにする
      const isClientValueForDate = (val: string) => {
        if (!val) return false;
        const v = String(val);
        return v.includes('Twitter') || v.includes('iPhone') || v.includes('Android') || v.includes('Web') || v.includes('TweetDeck');
      };
      
      // まず、dateKeysで厳密にマッチを試みる
      for (const key of dateKeys) {
        const val = post[key];
        if (val !== undefined && val !== '') {
          const strVal = String(val);
          if (!isClientValueForDate(strVal)) {
            date = strVal;
            break;
          }
        }
      }
      
      // 見つからない場合は、postオブジェクトの全キーを正規化して検索
      if (!date) {
        const dateKeyPatterns = ['created_at', 'createdat', 'date', 'posted_at', 'postedat', '投稿日', '日付'];
        for (const pattern of dateKeyPatterns) {
          for (const key of Object.keys(post)) {
            const normalizedKey = key.toLowerCase().replace(/[_\s]/g, '');
            const normalizedPattern = pattern.toLowerCase().replace(/[_\s]/g, '');
            if (normalizedKey === normalizedPattern || normalizedKey.includes(normalizedPattern)) {
              const val = post[key];
              if (val !== undefined && val !== '' && !isClientValueForDate(String(val))) {
                date = String(val);
                break;
              }
            }
          }
          if (date) break;
        }
      }
      
      // client列は削除（rawDataからも除外）
      if (post.client) delete post.client;
      if (post.Client) delete post.Client;
      
      // カテゴリを取得
      let category = '';
      const categoryKeys = ['Category', 'category', 'カテゴリ'];
      for (const key of categoryKeys) {
        const val = post[key];
        if (val !== undefined && val !== '') {
          category = String(val);
          break;
        }
      }
      
      // タグを取得
      let tags = '';
      const tagsKeys = ['Tags', 'tags', 'Tag', 'tag', 'タグ'];
      for (const key of tagsKeys) {
        const val = post[key];
        if (val !== undefined && val !== '') {
          tags = String(val);
          break;
        }
      }
      
      // 投稿の追加条件
      const trimmedContent = content ? content.trim() : '';
      const isHashtagOnly = trimmedContent ? /^[#\s]+$/.test(trimmedContent) : false;
      const hasTitle = title && title.trim();
      const urlValue = post['URL'] || post['url'] || post['Url'] || '';
      const hasUrl = !!(urlValue && String(urlValue).trim());

      // XのCSV（text列がある場合）は本文必須、ブログはタイトル/URLがあれば表示
      const shouldIncludePost = hasTextColumn
        ? !!(trimmedContent && !isHashtagOnly)
        : !!((trimmedContent && !isHashtagOnly) || hasTitle || hasUrl);

      if (shouldIncludePost) {
        // URLをトップレベルに設定（ブログ投稿の表示・フィルタリング用）
        const postUrl = post.url || post.URL || post.Url || '';
        posts.push({
          id: `post-${i}`,
          title,
          content,
          category, // カテゴリを追加
          tags, // タグを追加
          likes,
          views,
          engagement,
          date,
          url: postUrl, // URLをトップレベルに追加
          URL: postUrl, // 大文字バージョンも追加（互換性のため）
          rawData: post
        });
      }
    }
    
    return posts;
  };

  const escapeCsvField = (value: string): string => {
    let text = value ?? '';
    text = String(text);
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    text = text.replace(/"/g, '""');
    // CSV内の改行はCRLFに統一
    text = text.replace(/\n/g, '\r\n');
    return `"${text}"`;
  };

  // ダウンロード用にブログCSVを再生成（列ずれ・文字化け対策）
  const buildBlogCsvForDownload = (csvText: string): string => {
    const posts = parseCsvToPosts(csvText);
    if (posts.length === 0) {
      // フォールバック: 元データをCRLFに統一
      return csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
    }

    const header = 'Date,Title,Content,Category,Tags,URL';
    const unique = new Map<string, any>();
    let noUrlCounter = 0;
    for (const post of posts) {
      const raw = post.rawData || {};
      // URL取得を強化（post側もrawData側も両方確認）
      const rawUrl =
        raw.URL || raw.url || raw.Url || raw.Link || raw.Permalink ||
        post.URL || post.url || post.Url || '';
      const normalized = normalizeUrlForDedup(String(rawUrl));
      const key = normalized ? `u:${normalized}` : `no-url:${noUrlCounter++}`;
      if (!unique.has(key)) {
        unique.set(key, post);
      }
    }
    const rows = Array.from(unique.values()).map((post: any) => {
      const raw = post.rawData || {};
      // URL取得を強化
      const url =
        raw.URL || raw.url || raw.Url || raw.Link || raw.Permalink ||
        post.URL || post.url || post.Url || '';
      const date = post.date || post.Date || raw.Date || raw.date || '';
      const title = post.title || post.Title || raw.Title || raw.title || '';
      const content = post.content || post.Content || raw.Content || raw.content || '';
      const category = post.category || post.Category || raw.Category || raw.category || '';
      // タグ取得を強化
      const tags = post.tags || post.Tags || raw.Tags || raw.tags || raw.Tag || raw.tag || '';
      return [
        escapeCsvField(date),
        escapeCsvField(title),
        escapeCsvField(content),
        escapeCsvField(category),
        escapeCsvField(tags),
        escapeCsvField(url),
      ].join(',');
    });

    return [header, ...rows].join('\r\n');
  };

  const buildAllDataCsvForDownload = (): string => {
    // TweetId列を削除
    const header = [
      'Source',
      'Date',
      'Title',
      'Content',
      'URL',
      'Likes',
      'Views',
      'Engagement',
      'Category',
      'Tags',
    ].join(',');

    const rows: string[] = [];
    const seenContentKeys = new Set<string>();
    const shouldSkipByContent = (source: string, contentValue: string): boolean => {
      const trimmed = (contentValue || '').trim();
      if (!trimmed) return false;
      const key = `${source}|${trimmed}`;
      if (seenContentKeys.has(key)) return true;
      seenContentKeys.add(key);
      return false;
    };

    // 日付を抽出するヘルパー関数（大文字小文字、アンダースコア/スペースを統一して検索）
    const extractDateFromObject = (obj: any): string => {
      if (!obj) return '';
      
      // client列の値（Twitter for iPhone等）を日付として誤認識しないようにする
      const isClientValue = (val: string) => {
        if (!val) return false;
        const v = String(val);
        return v.includes('Twitter') || v.includes('iPhone') || v.includes('Android') || v.includes('Web') || v.includes('TweetDeck');
      };
      
      // 優先順位の高いキーのリスト
      const dateKeyPatterns = [
        'created_at', 'createdat', 'created at',
        'date', 'posted_at', 'postedat', 'posted at',
        '投稿日', '日付'
      ];
      
      // objのキーを正規化して検索
      for (const pattern of dateKeyPatterns) {
        for (const key of Object.keys(obj)) {
          const normalizedKey = key.toLowerCase().replace(/[_\s]/g, '');
          const normalizedPattern = pattern.toLowerCase().replace(/[_\s]/g, '');
          if (normalizedKey === normalizedPattern || normalizedKey.includes(normalizedPattern)) {
            const val = obj[key];
            if (val && !isClientValue(String(val))) {
              return String(val);
            }
          }
        }
      }
      return '';
    };

    // Xデータ
    if (csvData && csvData.trim()) {
      const defaultCsv = 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200';
      if (csvData !== defaultCsv) {
        const xPosts = parseCsvToPosts(csvData);
        xPosts.forEach((post: any) => {
          const raw = post.rawData || {};
          
          // 日付取得: parseCsvToPostsで抽出されたpost.dateを最優先、次にrawDataから検索
          let dateValue = '';
          if (post.date && post.date.trim()) {
            dateValue = post.date;
          } else {
            // rawDataから日付を検索
            dateValue = extractDateFromObject(raw);
          }
          
          const contentValue = post.content || '';
          if (shouldSkipByContent('x', contentValue)) return;
          rows.push([
            escapeCsvField('x'),
            escapeCsvField(dateValue),
            escapeCsvField(''),
            escapeCsvField(contentValue),
            escapeCsvField(raw.URL || raw.url || post.url || post.URL || ''),
            escapeCsvField(String(post.likes ?? '')),
            escapeCsvField(String(post.views ?? '')),
            escapeCsvField(String(post.engagement ?? '')),
            escapeCsvField(''),
            escapeCsvField(''),
          ].join(','));
        });
      }
    }

    // ブログデータ
    if (blogData && blogData.trim()) {
      const blogPosts = parseCsvToPosts(blogData);
      blogPosts.forEach((post: any) => {
        const raw = post.rawData || {};
        const url =
          raw.URL || raw.url || raw.Url ||
          raw.Link || raw.Permalink || post.url || post.URL || '';
        const contentValue = post.content || post.Content || raw.Content || '';
        const tags = post.tags || post.Tags || raw.Tags || raw.tags || raw.Tag || raw.tag || '';
        
        // 日付取得: parseCsvToPostsで抽出されたpost.dateを最優先、次にrawDataから検索
        let dateValue = '';
        if (post.date && post.date.trim()) {
          dateValue = post.date;
        } else {
          dateValue = extractDateFromObject(raw);
        }
        
        if (shouldSkipByContent('blog', contentValue)) return;
        rows.push([
          escapeCsvField('blog'),
          escapeCsvField(dateValue),
          escapeCsvField(post.title || post.Title || raw.Title || ''),
          escapeCsvField(contentValue),
          escapeCsvField(url),
          escapeCsvField(''),
          escapeCsvField(''),
          escapeCsvField(''),
          escapeCsvField(post.category || post.Category || raw.Category || ''),
          escapeCsvField(tags),
        ].join(','));
      });
    }

    return [header, ...rows].join('\r\n');
  };

  const [trendThemes, setTrendThemes] = useState<string[]>([]);
  const [myPostThemes, setMyPostThemes] = useState<string[]>([]);
  
  // テーマ候補の編集状態管理
  const [editingThemeIndex, setEditingThemeIndex] = useState<number | null>(null);
  const [editingThemeValue, setEditingThemeValue] = useState<string>('');
  
  const [isThemesLoading, setIsThemesLoading] = useState(false);
  
  const [result, setResult] = useState('');
  const [rewrittenResult, setRewrittenResult] = useState(''); // 書き換え後の文章
  const [isPostLoading, setIsPostLoading] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false); // 書き換え処理中
  const [error, setError] = useState('');
  const [showFacebookSettings, setShowFacebookSettings] = useState(false);
  const [facebookAppId, setFacebookAppId] = useState('');
  const [showXSettings, setShowXSettings] = useState(false);
  const [xApiKey, setXApiKey] = useState('');
  const [xApiKeySecret, setXApiKeySecret] = useState('');
  const [xAccessToken, setXAccessToken] = useState('');
  const [xAccessTokenSecret, setXAccessTokenSecret] = useState('');
  const [isPostingToX, setIsPostingToX] = useState(false);
  
  const [allSettings, setAllSettings] = useState({
    mypost: { persona: '私・投稿主', emoji: '要点を強調するために使用', character: 'SNS初心者。\n丁寧な言葉遣いで、分かりやすく簡潔に表現する。', minLength: 50, maxLength: 150 },
    trend: { persona: '私・投稿主', emoji: '要点を強調するために使用', character: 'SNS初心者。\n丁寧な言葉遣いで、分かりやすく簡潔に表現する。', minLength: 50, maxLength: 150 },
    rewrite: { persona: '私・投稿主', emoji: '要点を強調するために使用', character: 'SNS初心者。\n丁寧な言葉遣いで、分かりやすく簡潔に表現する。', minLength: 50, maxLength: 150 }
  });

  // 投稿先設定（デフォルトはX）
  const [postDestination, setPostDestination] = useState<PostDestination>('x');

  const currentSettings = allSettings[activeMode as keyof typeof allSettings];

  const updateCurrentSettings = (newSettingsUpdater: any) => {
    setAllSettings(prev => {
      const updatedModeSettings = typeof newSettingsUpdater === 'function' 
        ? newSettingsUpdater(prev[activeMode as keyof typeof allSettings]) 
        : newSettingsUpdater;
      
      return { ...prev, [activeMode]: updatedModeSettings };
    });
  };

  const changeMode = (mode: string) => {
    setActiveMode(mode);
    setError('');
    setManualInput(''); 
    setSelectedTheme('');
    setResult('');
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } 
    catch (e) { alert("ログイン失敗"); }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isLoginMode) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      console.error(err);
      setError(isLoginMode ? "ログインに失敗しました（メール/パスワードを確認してください）" : "登録に失敗しました（パスワードは6文字以上必要です）");
    }
  };

  const handleLogout = () => signOut(auth);

  const handleCsvImportClick = () => {
    // 現在のデータ一覧を表示するモーダルを開く
    setDataListModalType('csv');
    setShowDataListModal(true);
  };

  const handleCsvFileSelect = () => {
    setShowDataListModal(false);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      if (text) {
        // 既存データの有無に関わらず、常に「追加」で取り込む
        if (confirm('CSVデータを既存データに追加して取り込みますか？')) {
          await applyCsvData(text, 'append');
        }
      }
      event.target.value = ''; 
    };
    reader.readAsText(file);
  };

  const applyCsvData = async (csvText: string, mode: 'replace' | 'append'): Promise<boolean> => {
    if (!user) return false;
    
    setIsCsvLoading(true);
    const startTime = performance.now();
    
    // デバッグ: CSVデータの基本情報を出力
    console.log('=== CSVファイル読み込み開始 ===');
    console.log('CSVデータのサイズ:', csvText.length, '文字');
    console.log('CSVデータの行数:', csvText.split('\n').length);
    console.log('CSVデータの最初の500文字:');
    console.log(csvText.substring(0, 500));
    console.log('CSVデータの最初の5行:');
    const firstLines = csvText.split('\n').slice(0, 5);
    firstLines.forEach((line, idx) => {
      console.log(`行${idx + 1}:`, line.substring(0, 200));
    });
    console.log('============================');
    
    // 変数を外側で定義（スコープの問題を解決）
    let parsed: any[] = [];
    let parsedCsvData = csvText;
    let finalCsvData: string = '';
    let truncatedData: string = '';
    let dataSize: number = 0;
    let isTruncated = false;
    
    try {
      // CSVパース処理（エラーが発生しても可能な限り取り込む）
      try {
        parsed = parseCsvToPosts(csvText);
        parsedCsvData = csvText;
      } catch (parseError: any) {
        console.warn("CSVパースエラー（部分的な取り込みを試みます）:", parseError);
        // パースエラーが発生した場合、行ごとに処理を試みる
        const lines = csvText.split('\n');
        if (lines.length > 1) {
          const header = lines[0];
          const dataLines: string[] = [];
          for (let i = 1; i < lines.length; i++) {
            try {
              const testParsed = parseCsvToPosts(header + '\n' + lines[i]);
              if (testParsed.length > 0) {
                dataLines.push(lines[i]);
                parsed.push(...testParsed);
              }
            } catch (e) {
              // この行はスキップ
              console.warn(`行${i + 1}をスキップしました`);
            }
          }
          parsedCsvData = header + '\n' + dataLines.join('\n');
        }
      }
      
      console.log(`CSVパース完了: ${parsed.length}件 (${((performance.now() - startTime) / 1000).toFixed(2)}秒)`);
      
      // XのCSVデータの制限処理（300件まで）
      const MAX_X_POSTS = 300;
      let xPosts: any[] = [];
      let otherPosts: any[] = [];
      let originalXPostCount = 0;
      
      // X投稿（tweet_idがある投稿）とその他の投稿を分離
      parsed.forEach((post: any) => {
        const rawData = post.rawData || {};
        const hasTweetId = !!(
          post.tweet_id || 
          post.tweetId || 
          post['Tweet ID'] || 
          post['TweetID'] || 
          post['tweet_id'] ||
          rawData.tweet_id ||
          rawData.tweetId ||
          rawData['Tweet ID'] ||
          rawData['TweetID'] ||
          rawData['tweet_id']
        );
        
        if (hasTweetId) {
          xPosts.push(post);
        } else {
          otherPosts.push(post);
        }
      });
      
      // X投稿をエンゲージメント順（第1順位）→ 日付順（第2順位、新しい順）でソート
      xPosts.sort((a: any, b: any) => {
        // エンゲージメントで比較（降順）
        const aEng = a.engagement || a.favorite_count || a.likes || a['Likes'] || 0;
        const bEng = b.engagement || b.favorite_count || b.likes || b['Likes'] || 0;
        const engagementDiff = Number(bEng) - Number(aEng);
        
        if (engagementDiff !== 0) {
          return engagementDiff;
        }
        
        // エンゲージメントが同じ場合は日付で比較（新しい順）
        const aDate = a.date || a.Date || a['Posted At'] || '';
        const bDate = b.date || b.Date || b['Posted At'] || '';
        if (aDate && bDate) {
          return new Date(bDate).getTime() - new Date(aDate).getTime();
        }
        return 0;
      });
      
      // 上位500件のみを保持
      originalXPostCount = xPosts.length;
      if (xPosts.length > MAX_X_POSTS) {
        console.log(`X投稿が${xPosts.length}件あります。上位${MAX_X_POSTS}件のみを保持します。`);
        xPosts = xPosts.slice(0, MAX_X_POSTS);
        isTruncated = true;
      }
      
      // X投稿とその他の投稿を結合
      parsed = [...xPosts, ...otherPosts];
      
      if (originalXPostCount > MAX_X_POSTS) {
        console.log(`X投稿を${originalXPostCount}件から${xPosts.length}件に制限しました。`);
      }
      
      // 制限後のデータでCSVを再構築
      if (xPosts.length > 0 || otherPosts.length > 0) {
        const header = parsedCsvData.split('\n')[0];
        const csvRows: string[] = [header];
        
        // パースされたデータからCSV行を再構築
        parsed.forEach((post: any) => {
          const rawData = post.rawData || {};
          const row: string[] = [];
          
          // ヘッダーに基づいて値を取得
          const headers = header.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
          headers.forEach((headerName: string) => {
            const lowerHeader = headerName.toLowerCase();
            let value = '';
            
            if (lowerHeader.includes('date')) {
              value = post.date || post.Date || post['Posted At'] || '';
            } else if (lowerHeader.includes('text') || lowerHeader.includes('tweet') || lowerHeader.includes('post content')) {
              value = post.text || post.content || post['Post Content'] || post['Text'] || '';
            } else if (lowerHeader.includes('like')) {
              value = String(post.likes || post['Likes'] || post.favorite_count || 0);
            } else if (lowerHeader.includes('view')) {
              value = String(post.views || post['Views'] || post.impressions || 0);
            } else if (lowerHeader.includes('engagement')) {
              value = String(post.engagement || 0);
            } else if (lowerHeader.includes('tweet id') || lowerHeader.includes('tweet_id')) {
              value = post.tweet_id || post.tweetId || post['Tweet ID'] || rawData.tweet_id || '';
            } else {
              // その他のフィールドはrawDataから取得
              value = post[headerName] || rawData[headerName] || '';
            }
            
            // CSVエスケープ処理
            if (value.includes(',') || value.includes('"') || value.includes('\n')) {
              value = `"${value.replace(/"/g, '""')}"`;
            }
            row.push(value);
          });
          
          csvRows.push(row.join(','));
        });
        
        parsedCsvData = csvRows.join('\n');
      }
      
      // 保存するCSVデータを先に計算（状態に依存しない）
      if (mode === 'append') {
        // 追加モード：既存データに追加
        const existingLines = csvData.split('\n');
        const newLines = parsedCsvData.split('\n');
        if (existingLines.length > 0 && newLines.length > 1) {
          // ヘッダー行は最初のものを使い、データ行を結合
          finalCsvData = existingLines[0] + '\n' + existingLines.slice(1).join('\n') + '\n' + newLines.slice(1).join('\n');
        } else {
          finalCsvData = parsedCsvData;
        }
      } else {
        // 書き換えモード：既存データを置き換え
        finalCsvData = parsedCsvData;
      }
      
      // サイズ制限をチェック（15MB以上の場合、15MBまで取り込む）
      const MAX_SIZE = 15 * 1024 * 1024; // 15MB
      dataSize = new Blob([finalCsvData]).size;
      truncatedData = finalCsvData;
      
      if (dataSize >= MAX_SIZE) {
        // 15MBを超える場合、15MBまで取り込む
        const lines = finalCsvData.split('\n');
        if (lines.length > 1) {
          const header = lines[0];
          const dataLines = lines.slice(1);
          let truncatedLines = [header];
          let currentSize = new Blob([header + '\n']).size;
          
          for (const line of dataLines) {
            const lineWithNewline = line + '\n';
            const lineSize = new Blob([lineWithNewline]).size;
            
            if (currentSize + lineSize > MAX_SIZE) {
              isTruncated = true;
              break;
            }
            
            truncatedLines.push(line);
            currentSize += lineSize;
          }
          
          truncatedData = truncatedLines.join('\n');
          dataSize = new Blob([truncatedData]).size;
          
          // 切り詰めたデータで再パース
          try {
            parsed = parseCsvToPosts(truncatedData);
          } catch (e) {
            console.warn("切り詰めたデータのパースエラー:", e);
          }
        }
      }
      
      // 状態を更新（メモリキャッシュ）
      if (mode === 'append') {
        setParsedPosts(prev => [...prev, ...parsed]);
        setCsvData(truncatedData);
      } else {
        setParsedPosts(parsed);
        setCsvData(truncatedData);
      }
      
        const now = new Date();
        const dateStr = now.toLocaleString('ja-JP', { 
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' 
        });
        setCsvUploadDate(dateStr);
        
      // Firestoreに保存（分割機能付き、エラーが発生しても可能な限り保存）
      try {
        const updatedTime = await saveCsvToFirestore(user.uid, truncatedData, dateStr);
        
        // ローカルストレージキャッシュを更新（非同期で実行、エラーは無視）
        saveCsvToCache(user.uid, truncatedData, updatedTime);
        
        const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
        const sizeInMB = (dataSize / 1024 / 1024).toFixed(2);
        console.log(`CSVデータを保存しました (${parsed.length}件, ${sizeInMB} MB, 合計: ${totalTime}秒)`);
        
        // 成功メッセージを表示
        const xPostCount = parsed.filter((post: any) => {
          const rawData = post.rawData || {};
          return !!(
            post.tweet_id || 
            post.tweetId || 
            post['Tweet ID'] || 
            post['TweetID'] || 
            post['tweet_id'] ||
            rawData.tweet_id ||
            rawData.tweetId ||
            rawData['Tweet ID'] ||
            rawData['TweetID'] ||
            rawData['tweet_id']
          );
        }).length;
        
        if (isTruncated) {
          if (originalXPostCount > MAX_X_POSTS) {
            alert(`XのCSVデータを取り込みました。\n\n取り込まれたデータ: ${parsed.length}件（X投稿: ${xPostCount}件、その他: ${parsed.length - xPostCount}件）\n\nX投稿はエンゲージメント順→新しい順でソートし、上位${MAX_X_POSTS}件のみを保持しました。\nそれより下の${originalXPostCount - MAX_X_POSTS}件は自動で削除されました。`);
          } else {
          alert(`取込み可能なデータ量（${parsed.length}件、${sizeInMB} MB）を取り込みました。\n\n元のデータが大きすぎたため、一部のデータは取り込まれていません。`);
          }
        } else {
          if (originalXPostCount > MAX_X_POSTS) {
            alert(`XのCSVデータを取り込みました。\n\n取り込まれたデータ: ${parsed.length}件（X投稿: ${xPostCount}件、その他: ${parsed.length - xPostCount}件）\n\nX投稿はエンゲージメント順→新しい順でソートし、上位${MAX_X_POSTS}件のみを保持しました。\nそれより下の${originalXPostCount - MAX_X_POSTS}件は自動で削除されました。`);
        } else {
          alert(`${parsed.length}件のデータ（${sizeInMB} MB）を取り込みました。`);
          }
        }
      } catch (saveError: any) {
        console.error("Firestore保存エラー:", saveError);
        
        // 容量超過エラーの場合は詳細なメッセージを表示
        if (saveError.message && saveError.message.includes('容量制限')) {
          alert(saveError.message);
        } else if (saveError.message && saveError.message.includes('exceeds the maximum allowed size')) {
          // Firestoreのエラーメッセージから容量超過を検出
        const sizeInMB = (dataSize / 1024 / 1024).toFixed(2);
          alert(`データの保存に失敗しました。\n\n原因: Firestoreの容量制限（1MB）を超えています。\n\nCSVデータサイズ: 約${sizeInMB}MB\n制限: 1MB\n\n対処方法:\n1. 古いデータを削除してください\n2. データを分割して取り込んでください\n3. ブログデータを削除してから再度試してください\n\n※メモリ上にはデータが保持されていますが、次回の読み込み時には失われます。`);
        } else {
          // その他のエラーの場合
          const sizeInMB = (dataSize / 1024 / 1024).toFixed(2);
          alert(`取込み可能なデータ量（${parsed.length}件、${sizeInMB} MB）を取り込みました。\n\n保存時にエラーが発生しました: ${saveError.message || '不明なエラー'}\n\n※メモリ上にはデータが保持されていますが、次回の読み込み時には失われます。`);
          setIsCsvLoading(false);
          return false; // エラー時はfalseを返す
        }
      }
      
      setIsCsvLoading(false);
      return true; // 成功時はtrueを返す
    } catch (err: any) {
      console.error("CSV処理エラー:", err);
      
      // パースできたデータがあれば、それを使用
      if (parsed.length > 0) {
        const sizeInMB = (dataSize > 0 ? dataSize : new Blob([truncatedData || csvData]).size) / 1024 / 1024;
        alert(`取込み可能なデータ量（${parsed.length}件、${sizeInMB.toFixed(2)} MB）を取り込みました。\n\n一部のデータは取り込まれていない可能性があります。`);
      } else {
        alert(`CSVデータの取り込みに失敗しました: ${err.message || '不明なエラー'}`);
      }
      setIsCsvLoading(false);
      return false; // エラー時はfalseを返す
    } finally {
      setIsCsvLoading(false);
      // モーダルは呼び出し側で制御するため、ここでは閉じない
    }
  };

  useEffect(() => {
    if (!user) return;
    const loadUserData = async () => {
      try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          
          // CSVデータの読み込み（キャッシュ優先）
          let csvContent: string | null = null;
          let csvMetadata: string | null = null;
          
          // 1. メモリキャッシュ（state）をチェック（既に読み込まれている場合）
          const defaultCsv = 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200';
          if (csvData && csvData !== defaultCsv) {
            csvContent = csvData;
            console.log("メモリキャッシュから読み込み");
          } else {
            // 2. ローカルストレージキャッシュをチェック
            const cache = loadCsvFromCache(user.uid);
            if (cache) {
              // 3. Firestoreのメタデータと比較
              const firestoreMetadata = data.csvUpdatedTime || data.csvUploadDate;
              if (firestoreMetadata === cache.metadata) {
                // キャッシュが最新
                csvContent = cache.data;
                csvMetadata = cache.metadata;
                console.log("ローカルストレージキャッシュから読み込み（最新）");
              } else {
                // キャッシュが古い、またはメタデータがない
                console.log("キャッシュが古いため、Firestoreから再読み込み");
              }
            }
            
            // 4. キャッシュがない、または古い場合はFirestoreから読み込み
            if (!csvContent) {
              csvContent = loadCsvFromFirestore(data);
              if (csvContent) {
                csvMetadata = data.csvUploadDate || data.csvUpdatedTime || new Date().toISOString();
                console.log("Firestoreから読み込み");
              }
              
              // キャッシュに保存
              if (csvContent && csvMetadata) {
                saveCsvToCache(user.uid, csvContent, csvMetadata);
              }
            }
          }
          
          // CSVデータを設定
          if (csvContent) {
            setCsvData(csvContent);
          }
          
          if (data.csvUploadDate) setCsvUploadDate(data.csvUploadDate);
          
          // ブログデータの読み込み
          const blogContent = loadBlogDataFromFirestore(data);
          if (blogContent) {
            setBlogData(blogContent);
          }
          
          if (data.blogUploadDate) setBlogUploadDate(data.blogUploadDate);
          
          // 取り込んだURLの一覧を読み込み（50件に制限）
          console.log('[ユーザーデータ読み込み] blogUrls:', data.blogUrls?.length || 0, 'blogUrlDates:', Object.keys(data.blogUrlDates || {}).length);
          if (data.blogUrls && Array.isArray(data.blogUrls)) {
            const MAX_BLOG_URLS = 50;
            let urlsToSet = data.blogUrls;
            let datesToSet = data.blogUrlDates && typeof data.blogUrlDates === 'object' ? data.blogUrlDates : {};
            
            // 50件を超える場合は、取込み日時でソートして古いものから削除
            if (urlsToSet.length > MAX_BLOG_URLS) {
              const sortedUrls = [...urlsToSet].sort((a, b) => {
                const dateA = datesToSet[a] || '';
                const dateB = datesToSet[b] || '';
                if (dateA && dateB) {
                  return new Date(dateA.replace(/\//g, '-')).getTime() - new Date(dateB.replace(/\//g, '-')).getTime();
                }
                if (dateA) return -1;
                if (dateB) return 1;
                return 0;
              });
              
              const urlsToKeep = sortedUrls.slice(-MAX_BLOG_URLS);
              urlsToSet = urlsToKeep;
              const filteredDates: { [key: string]: string } = {};
              urlsToKeep.forEach(url => {
                if (datesToSet[url]) {
                  filteredDates[url] = datesToSet[url];
                }
              });
              datesToSet = filteredDates;
              
              // Firestoreも更新
              await setDoc(doc(db, 'users', user.uid), {
                blogUrls: urlsToSet,
                blogUrlDates: datesToSet
              }, { merge: true });
            }
            
            console.log('[ユーザーデータ読み込み] setBlogUrls呼び出し:', urlsToSet.length);
            setBlogUrls(urlsToSet);
            setBlogUrlDates(datesToSet);
          } else if (data.blogUrlDates && typeof data.blogUrlDates === 'object') {
            console.log('[ユーザーデータ読み込み] blogUrlsなし、blogUrlDatesのみ設定');
            setBlogUrlDates(data.blogUrlDates);
          } else {
            console.log('[ユーザーデータ読み込み] blogUrlsとblogUrlDatesが空');
          }
          
          // サイトマップURLを読み込み
          if (data.sitemapUrl) {
            setSitemapUrl(data.sitemapUrl);
          }
          
          // マイ投稿分析用データソース（ユーザーごとのデフォルト）
          try {
            const src = (data as any).defaultAnalysisDataSource;
            if (src === 'x' || src === 'blog') {
              setAnalysisDataSource(src);
              setDataSource(src === 'x' ? 'csv' : 'blog');
            } else {
              // 未設定または不正値の場合はブログをデフォルトにする
              setAnalysisDataSource('blog');
              setDataSource('blog');
            }
          } catch (e) {
            console.warn('defaultAnalysisDataSource の読み込みに失敗しました。blog をデフォルトとして使用します。', e);
            setAnalysisDataSource('blog');
            setDataSource('blog');
          }
          
          // 🔥 修正: サブスク状態をロード
          if (data.isSubscribed) setIsSubscribed(true);
          else setIsSubscribed(false);
          // 削除された投稿の識別子をロード
          if (data.deletedPostIdentifiers && Array.isArray(data.deletedPostIdentifiers)) {
            setDeletedPostIdentifiers(new Set(data.deletedPostIdentifiers));
          }
          // 🔥 Facebook App IDをロード
          if (data.facebookAppId) setFacebookAppId(data.facebookAppId);
          // 🔥 X API認証情報はクライアントからFirestore直読みしない（サーバーAPI経由で取得）
          // パーソナリティ設定をロード（既存のstyleをpersonaに変換）
          if (data.settings) {
            const migratedSettings: any = {};
            Object.keys(data.settings).forEach((mode: string) => {
              const modeSettings = data.settings[mode];
              if (modeSettings) {
                migratedSettings[mode] = {
                  ...modeSettings,
                  // 既存のstyleをpersonaに変換（互換性のため）
                  persona: modeSettings.persona || modeSettings.style || '私・投稿主',
                  // characterをそのまま使用（注意事項は追加しない）
                  character: modeSettings.character && typeof modeSettings.character === 'string' ? modeSettings.character : '',
                  // minLengthとmaxLengthも確実に含める
                  minLength: modeSettings.minLength || 50,
                  maxLength: modeSettings.maxLength || 150
                };
              }
            });
            // 保存された設定を完全に置き換える（デフォルト値とマージしない）
            setAllSettings((prev: any) => {
              const merged: any = {
                mypost: prev.mypost,
                trend: prev.trend,
                rewrite: prev.rewrite
              };
              Object.keys(migratedSettings).forEach((mode: string) => {
                // 保存された設定を完全に使用（デフォルト値は上書き）
                if (mode === 'mypost' || mode === 'trend' || mode === 'rewrite') {
                  merged[mode] = migratedSettings[mode];
                }
              });
              return merged;
            });
          }
        }
      } catch (e) {
        console.error("データの読み込みに失敗:", e);
      }
    };
    loadUserData();
  }, [user]);

  // X API認証情報をサーバーAPI経由で読み込む（Firestoreの直読みを避ける）
  useEffect(() => {
    if (!user) return;

    const loadXCredentials = async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/x/credentials', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          // 未登録 or 旧データ（平文）等の場合は空にする
          setXApiKey('');
          setXApiKeySecret('');
          setXAccessToken('');
          setXAccessTokenSecret('');
          return;
        }

        const data = await response.json();
        setXApiKey(data?.apiKey || '');
        setXApiKeySecret(data?.apiKeySecret || '');
        setXAccessToken(data?.accessToken || '');
        setXAccessTokenSecret(data?.accessTokenSecret || '');
      } catch (error) {
        console.error('X認証情報の読み込みに失敗:', error);
      }
    };

    loadXCredentials();
  }, [user]);

  // 選択されたデータソースから分析用データを生成
  useEffect(() => {
    const posts: any[] = [];
    
    // データソースに応じてフィルタリング
    if (dataSource === 'csv' || dataSource === 'all') {
      if (csvData) {
        const defaultCsv = 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200';
        if (csvData !== defaultCsv) {
          const csvPosts = parseCsvToPosts(csvData);
          posts.push(...csvPosts);
        }
      }
    }
    
    if (dataSource === 'blog' || dataSource === 'all') {
      if (blogData && blogData.trim()) {
        try {
        const blogPosts = parseCsvToPosts(blogData);
        // 取り込まれたURLのブログは全て参照する
        posts.push(...blogPosts);
          console.log(`ブログデータから${blogPosts.length}件の投稿を読み込みました`);
        } catch (error) {
          console.error('ブログデータのパースエラー:', error);
        }
      }
    }
    
    // 重複を除外（Xはtweet_id、ブログはURLで判定）
    const dedupedPostsMap = new Map<string, any>();
    let dedupIndex = 0;
    for (const post of posts) {
      const rawData = post.rawData || {};
      const tweetId = post.tweet_id || 
        post.tweetId || 
        post['Tweet ID'] || 
        post['TweetID'] || 
        post['tweet_id'] ||
        rawData.tweet_id ||
        rawData.tweetId ||
        rawData['Tweet ID'] ||
        rawData['TweetID'];
      const urlValue =
        post.URL || post.url || post.Url ||
        rawData.URL || rawData.url || rawData.Url ||
        post.Link || rawData.Link ||
        post.Permalink || rawData.Permalink;
      const hasTweetId = !!tweetId;
      const normalizedUrl = urlValue ? normalizeUrlForDedup(String(urlValue)) : '';
      const key = hasTweetId
        ? `x:${tweetId}`
        : normalizedUrl
          ? `b:${normalizedUrl}`
          : `n:${dedupIndex++}`;
      if (!dedupedPostsMap.has(key)) {
        dedupedPostsMap.set(key, post);
      }
    }
    const dedupedPosts = Array.from(dedupedPostsMap.values());

    // 削除された投稿を除外
    const filteredPosts = dedupedPosts.filter((post) => {
      const rawData = post.rawData || {};
      const tweetId = post.tweet_id || 
        post.tweetId || 
        post['Tweet ID'] || 
        post['TweetID'] || 
        post['tweet_id'] ||
        rawData.tweet_id ||
        rawData.tweetId ||
        rawData['Tweet ID'] ||
        rawData['TweetID'] ||
        rawData['tweet_id'] ||
        '';
      const url = post.URL || post.url || rawData.URL || rawData.url || '';
      const hasTweetId = !!tweetId;
      const hasUrl = !!url;
      const isBlogPost = hasUrl && !hasTweetId;
      
      // 識別子を取得
      const identifier = isBlogPost ? url : tweetId;
      let identifierToCheck = identifier;
      if (!identifierToCheck) {
        // 内容の最初の50文字を識別子として使用
        identifierToCheck = `content:${post.content.substring(0, 50).toLowerCase().trim()}`;
      }
      
      // URLの正規化（末尾のスラッシュを統一）
      if (identifierToCheck && !identifierToCheck.startsWith('content:')) {
        identifierToCheck = identifierToCheck.replace(/\/$/, '');
      }
      
      // 削除された投稿の識別子と一致する場合は除外
      for (const deletedIdentifier of deletedPostIdentifiers) {
        const normalizedDeleted = deletedIdentifier.replace(/\/$/, '');
        if (normalizedDeleted === identifierToCheck) {
          return false; // 削除された投稿なので除外
        }
      }
      
      return true; // 削除されていない投稿なので含める
    });
    
    console.log(`parsedPosts更新: 合計${filteredPosts.length}件 (元の投稿数: ${posts.length}, 削除された投稿数: ${posts.length - filteredPosts.length}, dataSource: ${dataSource}, csvData: ${csvData ? 'あり' : 'なし'}, blogData: ${blogData ? 'あり' : 'なし'})`);
    setParsedPosts(filteredPosts);
  }, [csvData, blogData, dataSource, deletedPostIdentifiers]);

  // XのCSVデータを再読取りして制限を適用
  const handleReloadCsvData = async () => {
    if (!user) return;
    
    const defaultCsv = 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200';
    
    if (!csvData || csvData === defaultCsv) {
      alert('再読取りするデータがありません。');
      return;
    }
    
    if (!confirm('XのCSVデータを再読取りして、上位300件のみを保持しますか？\n\nそれより下のデータは自動で削除されます。')) {
      return;
    }
    
    setIsCsvLoading(true);
    try {
      // 既存のCSVデータを再処理（制限を適用）
      await applyCsvData(csvData, 'replace');
      alert('XのCSVデータを再読取りしました。\n\nエンゲージメント順→新しい順でソートし、上位300件のみを保持しました。');
    } catch (error: any) {
      console.error('CSV再読取りエラー:', error);
      alert(`再読取りに失敗しました: ${error.message || '不明なエラー'}`);
    } finally {
      setIsCsvLoading(false);
    }
  };

  // ブログデータを再読取りして制限を適用
  const handleReloadBlogData = async () => {
    if (!user) return;
    
    if (!blogData || blogData.trim() === '') {
      alert('再読取りするデータがありません。');
      return;
    }
    
    if (!confirm('ブログとnoteのデータを再読取りして、上位50件（新しい順）のみを保持しますか？\n\nそれより古いデータは自動で削除されます。')) {
      return;
    }
    
    setIsBlogImporting(true);
    try {
      // 既存のブログデータをパース
      const allBlogPosts = parseCsvToPosts(blogData);
      const MAX_BLOG_POSTS = 50;
      
      if (allBlogPosts.length <= MAX_BLOG_POSTS) {
        alert(`ブログデータは既に${allBlogPosts.length}件で、制限内です。`);
        setIsBlogImporting(false);
        return;
      }
      
      // 日付順でソート（新しい順）
      const sortedPosts = [...allBlogPosts].sort((a: any, b: any) => {
        const aDate = a.Date || a.date || a['Posted At'] || '';
        const bDate = b.Date || b.date || b['Posted At'] || '';
        if (aDate && bDate) {
          return new Date(bDate).getTime() - new Date(aDate).getTime();
        }
        return 0;
      });
      
      // 上位50件のみを保持
      const limitedPosts = sortedPosts.slice(0, MAX_BLOG_POSTS);
      
      // CSVに再変換
      const limitedBlogData = [
        'Date,Title,Content,Category,Tags,URL',
        ...limitedPosts.map(post => {
          const date = post.Date || post.date || '';
          const title = `"${(post.Title || post.title || '').replace(/"/g, '""')}"`;
          const content = `"${(post.Content || post.content || '').replace(/"/g, '""')}"`;
          const category = `"${(post.Category || post.category || '').replace(/"/g, '""')}"`;
          const tags = `"${(post.Tags || post.tags || '').replace(/"/g, '""')}"`;
          const url = `"${post.URL || post.url || ''}"`;
          return `${date},${title},${content},${category},${tags},${url}`;
        }),
      ].join('\n');
      
      // Firestoreに保存
      const now = new Date();
      const dateStr = now.toLocaleString('ja-JP', { 
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' 
      });
      
      await saveBlogDataToFirestore(user.uid, limitedBlogData, dateStr);
      
      setBlogData(limitedBlogData);
      setBlogUploadDate(dateStr);
      
      alert(`ブログとnoteのデータを再読取りしました。\n\n${allBlogPosts.length}件から${limitedPosts.length}件（新しい順）に制限しました。\n\nそれより古い${allBlogPosts.length - MAX_BLOG_POSTS}件は自動で削除されました。`);
    } catch (error: any) {
      console.error('ブログ再読取りエラー:', error);
      alert(`再読取りに失敗しました: ${error.message || '不明なエラー'}`);
    } finally {
      setIsBlogImporting(false);
    }
  };

  // XのCSVデータをクリア
  const handleClearCsvData = async () => {
    if (!user) return;
    
    if (!confirm('XのCSVデータをクリアしますか？この操作は取り消せません。')) {
      return;
    }
    
    try {
      const defaultCsv = 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200';
      setCsvData(defaultCsv);
      setCsvUploadDate(null);
      setParsedPosts([]);
      
      // Firestoreから削除
      await setDoc(doc(db, 'users', user.uid), {
        csvData: null,
        csvUploadDate: null,
        csvUpdatedTime: null,
        csvIsSplit: false,
        csvChunkCount: null
      }, { merge: true });
      
      // ローカルストレージから削除
      localStorage.removeItem(CSV_CACHE_KEY(user.uid));
      localStorage.removeItem(CSV_METADATA_KEY(user.uid));
      localStorage.removeItem(CSV_EXPIRY_KEY(user.uid));
      
      alert('XのCSVデータをクリアしました');
    } catch (error) {
      console.error('CSVデータのクリアに失敗:', error);
      alert('CSVデータのクリアに失敗しました');
    }
  };

  // 特定の投稿を削除
  const handleDeletePost = async (postId: string) => {
    if (!user) return;
    
    const postToDelete = parsedPosts.find(p => p.id === postId);
    if (!postToDelete) return;
    
    if (!confirm(`この投稿を削除しますか？\n\n${postToDelete.content.substring(0, 100)}${postToDelete.content.length > 100 ? '...' : ''}\n\nこの操作は取り消せません。`)) {
      return;
    }
    
    try {
      // parsedPostsから削除
      const updatedPosts = parsedPosts.filter(p => p.id !== postId);
      setParsedPosts(updatedPosts);
      
      // 投稿の種類を判定（X投稿かブログ投稿か）
      const rawData = postToDelete.rawData || {};
      const tweetId = postToDelete.tweet_id || 
        postToDelete.tweetId || 
        postToDelete['Tweet ID'] || 
        postToDelete['TweetID'] || 
        postToDelete['tweet_id'] ||
        rawData.tweet_id ||
        rawData.tweetId ||
        rawData['Tweet ID'] ||
        rawData['TweetID'] ||
        rawData['tweet_id'] ||
        '';
      const url = postToDelete.URL || postToDelete.url || rawData.URL || rawData.url || '';
      const hasTweetId = !!tweetId;
      const hasUrl = !!url;
      const isBlogPost = hasUrl && !hasTweetId;
      
      // 削除された投稿の識別子を取得
      const identifier = isBlogPost ? url : tweetId;
      
      // 識別子がない場合は、内容で判定（フォールバック）
      let identifierToDelete = identifier;
      if (!identifierToDelete) {
        // 内容の最初の50文字を識別子として使用
        identifierToDelete = `content:${postToDelete.content.substring(0, 50).toLowerCase().trim()}`;
      }
      
      // 削除された投稿の識別子を追加
      const updatedDeletedIdentifiers = new Set(deletedPostIdentifiers);
      updatedDeletedIdentifiers.add(identifierToDelete);
      setDeletedPostIdentifiers(updatedDeletedIdentifiers);
      
      // 元のデータからも削除（投稿の種類に基づいて判定）
      if (!isBlogPost && csvData) {
        // X投稿の場合はCSVデータから削除
        const lines = csvData.split('\n');
        const header = lines[0];
        const dataLines = lines.slice(1);
        
        // ヘッダーからtweet_id列のインデックスを取得
        const headerValues = parseCsvRow(header);
        const tweetIdColumnIndex = headerValues.findIndex((h: string) => {
          const normalized = h.toLowerCase().trim().replace(/^"|"$/g, '');
          return normalized === 'tweet id' || normalized === 'tweet_id' || normalized === 'tweetid';
        });
        
        // rawDataを使って該当する行を特定
        const filteredLines = dataLines.filter((line) => {
          // tweet_idがある場合は、tweet_idで一致判定
          if (tweetId && tweetIdColumnIndex >= 0) {
            const values = parseCsvRow(line);
            const lineTweetId = values[tweetIdColumnIndex] || '';
            const normalizedLineTweetId = lineTweetId.trim().replace(/^"|"$/g, '');
            const normalizedTweetId = tweetId.trim();
            if (normalizedLineTweetId === normalizedTweetId) {
              return false; // 削除対象
            }
          }
          
          // tweet_idがない場合は、内容で判定（フォールバック）
            const lineContent = line.toLowerCase();
            const postContent = postToDelete.content.toLowerCase().substring(0, 50);
            return !lineContent.includes(postContent);
        });
        
        const updatedCsvData = [header, ...filteredLines].join('\n');
        setCsvData(updatedCsvData);
        
        // Firestoreに保存
        await setDoc(doc(db, 'users', user.uid), {
          csvData: updatedCsvData,
          deletedPostIdentifiers: Array.from(updatedDeletedIdentifiers)
        }, { merge: true });
        
        // ローカルストレージも更新
        try {
          const encoded = btoa(unescape(encodeURIComponent(updatedCsvData)));
          localStorage.setItem(CSV_CACHE_KEY(user.uid), encoded);
        } catch (error) {
          console.error('ローカルストレージ更新エラー:', error);
        }
      } else if (isBlogPost && blogData) {
        // ブログ投稿の場合はブログデータから削除
        const lines = blogData.split('\n');
        const header = lines[0];
        const dataLines = lines.slice(1);
        
        // ヘッダーからURL列のインデックスを取得
        const headerValues = parseCsvRow(header);
        const urlColumnIndex = headerValues.findIndex((h: string) => {
          const normalized = h.toLowerCase().trim().replace(/^"|"$/g, '');
          return normalized === 'url';
        });
        
        const filteredLines = dataLines.filter((line) => {
          // URLがある場合は、URLで一致判定
          if (url && urlColumnIndex >= 0) {
            const values = parseCsvRow(line);
            const lineUrl = values[urlColumnIndex] || '';
            const normalizedLineUrl = lineUrl.trim().replace(/^"|"$/g, '').replace(/\/$/, '');
            const normalizedUrl = url.trim().replace(/\/$/, '');
            if (normalizedLineUrl === normalizedUrl) {
              return false; // 削除対象
            }
          }
          
          // URLがない場合は、内容で判定（フォールバック）
          const lineContent = line.toLowerCase();
          const postContent = postToDelete.content.toLowerCase().substring(0, 50);
          return !lineContent.includes(postContent);
        });
        
        const updatedBlogData = [header, ...filteredLines].join('\n');
        setBlogData(updatedBlogData);
        
        // blogUrlsからも削除
        if (url) {
          const normalizedUrl = url.trim().replace(/\/$/, '');
          const updatedBlogUrls = blogUrls.filter(u => {
            const normalizedU = u.trim().replace(/\/$/, '');
            return normalizedU !== normalizedUrl;
          });
          const updatedBlogUrlDates = { ...blogUrlDates };
          delete updatedBlogUrlDates[url];
          
          setBlogUrls(updatedBlogUrls);
          setBlogUrlDates(updatedBlogUrlDates);
        
        // Firestoreに保存
        await setDoc(doc(db, 'users', user.uid), {
            blogData: updatedBlogData,
            blogUrls: updatedBlogUrls,
            blogUrlDates: updatedBlogUrlDates,
            deletedPostIdentifiers: Array.from(updatedDeletedIdentifiers)
          }, { merge: true });
        } else {
          // Firestoreに保存
          await setDoc(doc(db, 'users', user.uid), {
            blogData: updatedBlogData,
            deletedPostIdentifiers: Array.from(updatedDeletedIdentifiers)
          }, { merge: true });
        }
      } else {
        // 識別子のみを保存（CSVデータがない場合）
        await setDoc(doc(db, 'users', user.uid), {
          deletedPostIdentifiers: Array.from(updatedDeletedIdentifiers)
        }, { merge: true });
      }
      
      alert('投稿を削除しました');
    } catch (error) {
      console.error('投稿の削除に失敗:', error);
      alert('投稿の削除に失敗しました');
    }
  };

  // 特定のブログURLを削除
  // 複数のURLを一括削除
  const handleBulkDeleteBlogUrls = async (urlsToDelete: string[]) => {
    if (!user || urlsToDelete.length === 0) return;
    
    if (!confirm(`${urlsToDelete.length}件のURLを削除しますか？\n\nこの操作は取り消せません。`)) {
      return;
    }
    
    try {
      setIsBlogImporting(true);
      setBlogImportProgress('処理中...');
      // ブログURL一覧から削除
      const normalizedSetToDelete = new Set(urlsToDelete.map(u => normalizeUrlForDedup(u)));
      const updatedBlogUrls = blogUrls.filter(url => !normalizedSetToDelete.has(normalizeUrlForDedup(url)));
      const updatedBlogUrlDates = { ...blogUrlDates };
      Object.keys(updatedBlogUrlDates).forEach(key => {
        if (normalizedSetToDelete.has(normalizeUrlForDedup(key))) {
          delete updatedBlogUrlDates[key];
        }
      });
      
      setBlogUrls(updatedBlogUrls);
      setBlogUrlDates(updatedBlogUrlDates);
      
      // Firestoreから削除
      await setDoc(doc(db, 'users', user.uid), {
        blogUrls: updatedBlogUrls,
        blogUrlDates: updatedBlogUrlDates
      }, { merge: true });
      
      // ブログキャッシュも削除
      for (const urlToDelete of urlsToDelete) {
        try {
          const cacheRef = doc(db, 'users', user.uid, 'blogCache', encodeURIComponent(urlToDelete));
          await deleteDoc(cacheRef);
        } catch (error) {
          console.error(`ブログキャッシュ削除エラー (${urlToDelete}):`, error);
        }
      }
      
      // 削除したURLのデータが含まれている場合、parsedPostsからも削除
      const updatedParsedPosts = parsedPosts.filter(post => {
        const postUrl = post.URL || post.url || (post.rawData && (post.rawData.URL || post.rawData.url)) || '';
        return !normalizedSetToDelete.has(normalizeUrlForDedup(String(postUrl)));
      });
      setParsedPosts(updatedParsedPosts);
      
      // ブログデータからも削除
      if (blogData) {
        // URL一覧が全て削除された場合、blogDataも完全にクリア
        if (updatedBlogUrls.length === 0) {
          setBlogData('');
          setBlogUploadDate(null);
          
          // Firestoreから完全に削除
          await setDoc(doc(db, 'users', user.uid), {
            blogData: null,
            blogUploadDate: null,
            blogIsSplit: false,
            blogChunkCount: null
          }, { merge: true });
          
          // ローカルストレージからも削除
          localStorage.removeItem(`blogData_${user.uid}`);
        } else {
          const blogLines = blogData.split('\n');
          const header = blogLines[0];
          const dataLines = blogLines.slice(1);
          
          const headerValues = parseCsvRow(header);
          const urlColumnIndex = headerValues.findIndex((h: string) => {
            const normalized = h.toLowerCase().trim().replace(/^"|"$/g, '');
            return normalized === 'url';
          });
          
          if (urlColumnIndex >= 0) {
            const filteredDataLines = dataLines.filter(line => {
              if (!line.trim()) return false;
              const values = parseCsvRow(line);
              const lineUrl = values[urlColumnIndex]?.replace(/^"|"$/g, '') || '';
              return !normalizedSetToDelete.has(normalizeUrlForDedup(lineUrl));
            });
            
            if (filteredDataLines.length === 0) {
              // 全てのデータが削除された場合、blogDataを完全にクリア
              setBlogData('');
              setBlogUploadDate(null);
              
              // Firestoreから完全に削除
              await setDoc(doc(db, 'users', user.uid), {
                blogData: null,
                blogUploadDate: null,
                blogIsSplit: false,
                blogChunkCount: null
              }, { merge: true });
              
              // ローカルストレージからも削除
              localStorage.removeItem(`blogData_${user.uid}`);
            } else {
              const updatedBlogData = [header, ...filteredDataLines].join('\n');
              setBlogData(updatedBlogData);
              
              // Firestoreに保存
              await setDoc(doc(db, 'users', user.uid), {
                blogData: updatedBlogData
              }, { merge: true });
              
              // ローカルストレージにも保存
              localStorage.setItem(`blogData_${user.uid}`, updatedBlogData);
            }
          }
        }
      }
      
      alert(`${urlsToDelete.length}件のURLを削除しました`);
    } catch (error) {
      console.error('一括削除エラー:', error);
      alert('URLの削除に失敗しました');
    } finally {
      setIsBlogImporting(false);
      setBlogImportProgress('');
    }
  };

  const handleDeleteBlogUrl = async (urlToDelete: string) => {
    if (!user) return;
    
    if (!confirm(`このURLを削除しますか？\n${urlToDelete}\n\nこの操作は取り消せません。`)) {
      return;
    }
    
    try {
      setIsBlogImporting(true);
      setBlogImportProgress('処理中...');
      // ブログURL一覧から削除
      const normalizedToDelete = normalizeUrlForDedup(urlToDelete);
      const updatedBlogUrls = blogUrls.filter(url => normalizeUrlForDedup(url) !== normalizedToDelete);
      const updatedBlogUrlDates = { ...blogUrlDates };
      Object.keys(updatedBlogUrlDates).forEach(key => {
        if (normalizeUrlForDedup(key) === normalizedToDelete) {
          delete updatedBlogUrlDates[key];
        }
      });
      
      setBlogUrls(updatedBlogUrls);
      setBlogUrlDates(updatedBlogUrlDates);
      
      // Firestoreから削除
      await setDoc(doc(db, 'users', user.uid), {
        blogUrls: updatedBlogUrls,
        blogUrlDates: updatedBlogUrlDates
      }, { merge: true });
      
      // ブログキャッシュも削除
      try {
        const cacheRef = doc(db, 'users', user.uid, 'blogCache', encodeURIComponent(urlToDelete));
        await deleteDoc(cacheRef);
      } catch (error) {
        console.error(`ブログキャッシュ削除エラー (${urlToDelete}):`, error);
      }
      
      // 削除したURLのデータが含まれている場合、parsedPostsからも削除
      const updatedPosts = parsedPosts.filter(post => {
        const postUrl = post.URL || post.url || (post.rawData && (post.rawData.URL || post.rawData.url));
        return normalizeUrlForDedup(String(postUrl || '')) !== normalizedToDelete;
      });
      setParsedPosts(updatedPosts);
      
      // ブログデータを再構築（残りのURLのデータのみ）
      if (updatedBlogUrls.length === 0) {
        // すべてのURLが削除された場合
        setBlogData('');
        setBlogUploadDate(null);
        await setDoc(doc(db, 'users', user.uid), {
          blogData: null,
          blogUploadDate: null,
          blogUpdatedTime: null,
          blogIsSplit: false,
          blogChunkCount: null
        }, { merge: true });
      } else {
        // 既存のブログデータから該当URLの記事を削除して保存
        if (blogData && blogData.trim()) {
          try {
            const posts = parseCsvToPosts(blogData);
            const remainingPosts = posts.filter((post: any) => {
              const postUrl = post.URL || post.url || post.Url || '';
              return normalizeUrlForDedup(String(postUrl)) !== normalizedToDelete;
            });
            
            if (remainingPosts.length > 0) {
              const rebuiltBlogData = [
                'Date,Title,Content,Category,Tags,URL',
                ...remainingPosts.map((post: any) => {
                  const date = post.Date || post.date || '';
                  const title = `"${(post.Title || post.title || '').replace(/"/g, '""')}"`;
                  const content = `"${(post.Content || post.content || '').replace(/"/g, '""')}"`;
                  const category = `"${(post.Category || post.category || '').replace(/"/g, '""')}"`;
                  const tags = `"${(post.Tags || post.tags || '').replace(/"/g, '""')}"`;
                  const url = `"${post.URL || post.url || ''}"`;
                  return `${date},${title},${content},${category},${tags},${url}`;
                }),
              ].join('\n');
              
              const now = new Date();
              const dateStr = now.toLocaleString('ja-JP', { 
                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' 
              });
              
              await saveBlogDataToFirestore(user.uid, rebuiltBlogData, dateStr);
              setBlogData(rebuiltBlogData);
              setBlogUploadDate(dateStr);
            } else {
              // 万が一すべての投稿がなくなった場合はクリア
              setBlogData('');
              setBlogUploadDate(null);
              await setDoc(doc(db, 'users', user.uid), {
                blogData: null,
                blogUploadDate: null,
                blogUpdatedTime: null,
                blogIsSplit: false,
                blogChunkCount: null
              }, { merge: true });
            }
          } catch (e) {
            console.error('ブログデータ再構築エラー:', e);
          }
        }
      }
    } catch (error) {
      console.error('URLの削除に失敗:', error);
      alert('URLの削除に失敗しました');
    } finally {
      setIsBlogImporting(false);
      setBlogImportProgress('');
    }
  };

  // Facebook App IDを保存
  const saveFacebookAppId = async () => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { facebookAppId }, { merge: true });
      alert('Facebook App IDを保存しました');
      setShowFacebookSettings(false);
    } catch (error) {
      console.error("Facebook App IDの保存に失敗:", error);
      alert('保存に失敗しました');
    }
  };

  // X API認証情報を保存
  const saveXApiCredentials = async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/x/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          apiKey: xApiKey,
          apiKeySecret: xApiKeySecret,
          accessToken: xAccessToken,
          accessTokenSecret: xAccessTokenSecret,
        }),
      });

      if (!response.ok) {
        let msg = `HTTP ${response.status}`;
        try {
          const data = await response.json();
          if (data?.error) msg = data.error;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      alert('X API認証情報を保存しました');
      setShowXSettings(false);
    } catch (error: any) {
      console.error("X API認証情報の保存に失敗:", error);
      alert(`保存に失敗しました: ${error?.message || '不明なエラー'}`);
    }
  };

  // Xに投稿する関数
  const handlePostToX = async (postContent: string, onSuccess?: () => void) => {
    if (!postContent || !user) return;

    if (!xAccessToken) {
      const shouldAuth = confirm('Xへの投稿には認証が必要です。\n設定画面でX API認証情報とアクセストークンを設定してください。\n設定画面を開きますか？');
      if (shouldAuth) {
        setShowXSettings(true);
      }
      return;
    }

    setIsPostingToX(true);

    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/x/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          content: postContent,
          apiKey: xApiKey,
          apiKeySecret: xApiKeySecret,
          accessToken: xAccessToken,
          accessTokenSecret: xAccessTokenSecret,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Xへの投稿に失敗しました');
      }

      alert('Xへの投稿が完了しました！');
      if (onSuccess) onSuccess();
    } catch (error: any) {
      console.error('X post error:', error);
      alert('エラー: ' + error.message);
    } finally {
      setIsPostingToX(false);
    }
  };


  // パーソナリティ設定の分析のみを行う関数
  const handleAnalyzePersonality = async () => {
    if (!user) { setError("ログインが必要です"); return; }
    setIsThemesLoading(true);
    setError('');
    try {
      const token = await user.getIdToken(); 
      const userId = user.uid;
      
        // データの存在チェック（事前チェック）
        const defaultCsv = 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200';
        const isCsvDataDefault = csvData === defaultCsv || !csvData || csvData.trim() === '';
        const hasBlogData = blogData && blogData.trim() && blogData.split('\n').length > 1;
        
        if (isCsvDataDefault && !hasBlogData) {
          throw new Error('分析するデータがありません。\n\nXのCSVデータまたはブログデータを取り込んでください。');
        }
        
      const analysisResult = await analyzeCsvAndGenerateThemes(csvData, token, userId, parseCsvToPosts, blogData, analysisDataSource, deletedPostIdentifiers);
      
        if (analysisResult.settings) {
          // styleをpersonaに変換し、characterの最後に注意事項を追加
        // 文字数設定（minLengthとmaxLength）は既存の設定を保持
        setAllSettings(prev => {
          const migratedSettings = {
            ...analysisResult.settings,
            persona: analysisResult.settings.persona || analysisResult.settings.style || '私・投稿主',
            character: analysisResult.settings.character && typeof analysisResult.settings.character === 'string' ? analysisResult.settings.character : '',
            // 文字数設定は既存の設定を保持（分析結果で上書きしない）
            minLength: prev.mypost.minLength,
            maxLength: prev.mypost.maxLength
          };
          
          // マイ投稿分析後のパーソナリティ設定をFirestoreに保存
          // 既存の設定とマージして、mypostモードの設定を更新
          if (user) {
            (async () => {
          try {
            const userRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userRef);
            const currentData = userDoc.exists() ? userDoc.data() : {};
            const currentSettings = currentData.settings || {};
            
                // 既存のmypost設定とマージ（分析結果を優先、ただし文字数設定は既存の設定を保持）
            const updatedMypostSettings = {
              ...(currentSettings.mypost || {}),
                  ...migratedSettings,
                  // 文字数設定は既存の設定を保持
                  minLength: currentSettings.mypost?.minLength || prev.mypost.minLength,
                  maxLength: currentSettings.mypost?.maxLength || prev.mypost.maxLength
            };
            
            await setDoc(userRef, {
              settings: {
                ...currentSettings,
                mypost: updatedMypostSettings
              }
            }, { merge: true });
            
            console.log("パーソナリティ設定を保存しました:", updatedMypostSettings);
              } catch (error) {
                console.error("パーソナリティ設定の保存に失敗:", error);
              }
            })();
          }
          
          return {
            ...prev,
            mypost: { ...prev.mypost, ...migratedSettings }
          };
        });
      }
    } catch (err: any) {
      setError(err.message || "パーソナリティ設定の分析に失敗しました");
    } finally {
      setIsThemesLoading(false);
    }
  };

  // テーマ候補の更新のみを行う関数
  const handleUpdateThemes = async (mode: string) => {
    if (!user) { setError("ログインが必要です"); return; }
    setIsThemesLoading(true);
    setError('');
    setManualInput('');
    setSelectedTheme('');
    // テーマ候補更新ボタンを押したら分析・更新セクションを選択し、他を非表示
    if (mode === 'mypost') {
      setSelectedSection('analysis');
      setShowPostAnalysis(false);
    }
    try {
      const token = await user.getIdToken(); 
      const userId = user.uid;
      if (mode === 'mypost') {
        // データの存在チェック（事前チェック）
        const defaultCsv = 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200';
        const isCsvDataDefault = csvData === defaultCsv || !csvData || csvData.trim() === '';
        const hasBlogData = blogData && blogData.trim() && blogData.split('\n').length > 1;
        
        if (isCsvDataDefault && !hasBlogData) {
          throw new Error('分析するデータがありません。\n\nXのCSVデータまたはブログデータを取り込んでください。');
        }
        
        const analysisResult = await analyzeCsvAndGenerateThemes(csvData, token, userId, parseCsvToPosts, blogData, analysisDataSource, deletedPostIdentifiers);
        setMyPostThemes(analysisResult.themes || []);
        
        // テーマ候補更新によって、過去投稿一覧から個別に削除した記事のみをCSVデータから削除
        try {
          // deletedPostIdentifiersに含まれている識別子の投稿をCSVから削除
          if (deletedPostIdentifiers.size > 0) {
            console.log(`テーマ候補更新: 削除された投稿の識別子数 = ${deletedPostIdentifiers.size}`);
            
            // X投稿のCSVデータから削除
            if (csvData) {
              const defaultCsv = 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200';
              if (csvData !== defaultCsv) {
                const lines = csvData.split('\n');
                const header = lines[0];
                const dataLines = lines.slice(1);
                
                // ヘッダーからtweet_id列のインデックスを取得
                const headerValues = parseCsvRow(header);
                const tweetIdColumnIndex = headerValues.findIndex((h: string) => {
                  const normalized = h.toLowerCase().trim().replace(/^"|"$/g, '');
                  return normalized === 'tweet id' || normalized === 'tweet_id' || normalized === 'tweetid';
                });
                
                const filteredLines = dataLines.filter((line) => {
                  // 削除された投稿の識別子と一致する場合は削除
                  if (tweetIdColumnIndex >= 0) {
                    const values = parseCsvRow(line);
                    const lineTweetId = values[tweetIdColumnIndex] || '';
                    const normalizedLineTweetId = lineTweetId.trim().replace(/^"|"$/g, '').replace(/\/$/, '');
                    
                    // 削除された識別子に一致する場合は削除
                    for (const deletedIdentifier of deletedPostIdentifiers) {
                      const normalizedDeleted = deletedIdentifier.replace(/\/$/, '');
                      if (normalizedLineTweetId && normalizedLineTweetId === normalizedDeleted) {
                        return false; // 削除対象
                      }
                    }
                  }
                  
                  // tweet_idがない場合は、内容で判定（フォールバック）
                  const lineContent = line.toLowerCase();
                  for (const deletedIdentifier of deletedPostIdentifiers) {
                    if (deletedIdentifier.startsWith('content:')) {
                      const contentMatch = deletedIdentifier.replace('content:', '');
                      if (lineContent.includes(contentMatch)) {
                        return false; // 削除対象
                      }
                    }
                  }
                  
                  // 削除対象でない場合は保持
                  return true;
                });
                
                const updatedCsvData = [header, ...filteredLines].join('\n');
                
                if (updatedCsvData !== csvData) {
                  console.log(`テーマ候補更新: X投稿のCSVデータを更新 (${dataLines.length}行 → ${filteredLines.length}行)`);
                  setCsvData(updatedCsvData);
                  
                  // Firestoreに保存
                  await setDoc(doc(db, 'users', user.uid), {
                    csvData: updatedCsvData
                  }, { merge: true });
                  
                  // ローカルストレージも更新
                  try {
                    const encoded = btoa(unescape(encodeURIComponent(updatedCsvData)));
                    localStorage.setItem(CSV_CACHE_KEY(user.uid), encoded);
                  } catch (error) {
                    console.error('ローカルストレージ更新エラー:', error);
                  }
                }
              }
            }
            
            // ブログ投稿のデータから削除
            if (blogData && blogData.trim()) {
              const lines = blogData.split('\n');
              const header = lines[0];
              const dataLines = lines.slice(1);
              
              // ヘッダーからURL列のインデックスを取得
              const headerValues = parseCsvRow(header);
              const urlColumnIndex = headerValues.findIndex((h: string) => {
                const normalized = h.toLowerCase().trim().replace(/^"|"$/g, '');
                return normalized === 'url';
              });
              
              const filteredLines = dataLines.filter((line) => {
                // 削除された投稿の識別子と一致する場合は削除
                if (urlColumnIndex >= 0) {
                  const values = parseCsvRow(line);
                  const lineUrl = values[urlColumnIndex] || '';
                  const normalizedLineUrl = lineUrl.trim().replace(/^"|"$/g, '').replace(/\/$/, '');
                  
                  // 削除された識別子に一致する場合は削除
                  for (const deletedIdentifier of deletedPostIdentifiers) {
                    const normalizedDeleted = deletedIdentifier.replace(/\/$/, '');
                    if (normalizedLineUrl && normalizedLineUrl === normalizedDeleted) {
                      return false; // 削除対象
                    }
                  }
                }
                
                // URLがない場合は、内容で判定（フォールバック）
                const lineContent = line.toLowerCase();
                for (const deletedIdentifier of deletedPostIdentifiers) {
                  if (deletedIdentifier.startsWith('content:')) {
                    const contentMatch = deletedIdentifier.replace('content:', '');
                    if (lineContent.includes(contentMatch)) {
                      return false; // 削除対象
                    }
                  }
                }
                
                // 削除対象でない場合は保持
                return true;
              });
              
              const updatedBlogData = [header, ...filteredLines].join('\n');
              
              if (updatedBlogData !== blogData) {
                console.log(`テーマ候補更新: ブログデータを更新 (${dataLines.length}行 → ${filteredLines.length}行)`);
                setBlogData(updatedBlogData);
                
                // Firestoreに保存
                await setDoc(doc(db, 'users', user.uid), {
                  blogData: updatedBlogData
                }, { merge: true });
              }
            }
          }
        } catch (cleanupError) {
          console.error('CSVデータのクリーンアップに失敗:', cleanupError);
          // エラーが発生しても分析結果は表示するため、エラーを無視
        }
      } else if (mode === 'trend') {
        const themes = await generateTrendThemes(token, userId);
        setTrendThemes(themes);
      }
    } catch (err: any) {
      setError(err.message || "テーマの取得に失敗しました");
    } finally {
      setIsThemesLoading(false);
    }
  };

  const handleGeneratePost = async () => {
    const topic = selectedTheme || manualInput;
    if (!user) { setError("ログインが必要です"); return; }
    if (!topic) {
      setError("テーマを選択するか、入力してください。");
      return;
    }
    setIsPostLoading(true);
    setError('');
    try {
      const token = await user.getIdToken(); 
      const userId = user.uid;
      const inputSource = activeMode === 'rewrite' ? manualInput : topic;
      const inputData = { sourcePost: activeMode === 'rewrite' ? inputSource : undefined };
      
      // CSVにTitleがあるかチェック
      const hasTitle = parsedPosts.length > 0 && parsedPosts.some((post: any) => post.title && post.title.trim() !== '');
      
      const post = await generatePost(activeMode, inputSource, inputData, currentSettings, token, userId, hasTitle);
      
      // タイトルと本文の間に改行を2つ入れる処理
      let formattedPost = post;
      if (hasTitle && post) {
        // 生成結果がタイトルと本文に分かれている場合、改行を2つに統一
        const lines = post.split('\n');
        if (lines.length >= 2) {
          // 最初の行がタイトル、2行目以降が本文と仮定
          const title = lines[0].trim();
          const body = lines.slice(1).join('\n').trim();
          if (title && body) {
            formattedPost = `${title}\n\n${body}`;
          }
        }
      }
      
      setResult(formattedPost);
      setRewrittenResult(''); // リセット
      
      // 書き換えプロンプトで改善
      setIsRewriting(true);
      try {
        const rewrittenPost = await rewritePostWithChecks(formattedPost, currentSettings, token, userId, hasTitle);
        
        // タイトルと本文の間に改行を2つ入れる処理（書き換え後も同様）
        let formattedRewrittenPost = rewrittenPost;
        if (hasTitle && rewrittenPost) {
          const lines = rewrittenPost.split('\n');
          if (lines.length >= 2) {
            const title = lines[0].trim();
            const body = lines.slice(1).join('\n').trim();
            if (title && body) {
              formattedRewrittenPost = `${title}\n\n${body}`;
            }
          }
        }
        
        // ハッシュタグが必要な場合、キーワードを3～4個追加
        let finalPost = formattedRewrittenPost;
        if ((currentSettings as any).includeHashtags && formattedRewrittenPost) {
          try {
            const hashtagPrompt = `
以下の文章を読んで、キーワードを3～4個抽出してください。
抽出したキーワードを**必ずハッシュタグ形式（#キーワード）で**文末に追加してください。

【文章】
${formattedRewrittenPost}

【重要: 出力ルール（絶対に守ること）】
1. 文章の内容を変更せず、そのまま出力してください。
2. 文末に改行を1つ入れてから、ハッシュタグを追加してください。
3. ハッシュタグは3～4個、スペースで区切って追加してください。
4. **各キーワードには必ず「#」記号を先頭につけてください。ハッシュタグ形式（#キーワード）で出力することが絶対に必要です。**
5. ハッシュタグは文章の内容に関連する重要なキーワードを選んでください。
6. ハッシュタグ以外の形式（例：「キーワード」「キーワード1、キーワード2」など）は使用しないでください。必ず「#キーワード1 #キーワード2 #キーワード3」の形式で出力してください。
7. 修正理由を説明せず、文章とハッシュタグを含めた完全な出力のみを返してください。

【出力例】
文章の内容...

#キーワード1 #キーワード2 #キーワード3
`;
            const postWithHashtags = await callSecureApi(hashtagPrompt, token, 'post', userId);
            // ハッシュタグを保持するため、アスタリスクのみを除去
            finalPost = sanitizeAsteriskOnly(postWithHashtags);
            
            // ハッシュタグが含まれているか確認し、含まれていない場合は追加処理
            if (!finalPost.match(/#[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\w]+/)) {
              // ハッシュタグが含まれていない場合、キーワードを抽出して追加
              const fallbackHashtagPrompt = `
以下の文章から重要なキーワードを3～4個抽出し、必ずハッシュタグ形式（#キーワード）で文末に追加してください。

【文章】
${formattedRewrittenPost}

【出力形式】
文章の内容...

#キーワード1 #キーワード2 #キーワード3

必ずハッシュタグ形式（#キーワード）で出力してください。
`;
              const postWithFallbackHashtags = await callSecureApi(fallbackHashtagPrompt, token, 'post', userId);
              // ハッシュタグを保持するため、アスタリスクのみを除去
              finalPost = sanitizeAsteriskOnly(postWithFallbackHashtags);
            }
          } catch (error) {
            console.error('ハッシュタグ追加エラー:', error);
            // エラーが発生しても元の文章をそのまま使用
            finalPost = formattedRewrittenPost;
          }
        }
        
        setRewrittenResult(finalPost);
      } catch (err: any) {
        console.error('書き換えエラー:', err);
        // 書き換えに失敗しても元の文章は表示する
        setRewrittenResult('');
      } finally {
        setIsRewriting(false);
      }
    } catch (err: any) {
      setError(err.message || "投稿の生成に失敗しました。");
    } finally {
      setIsPostLoading(false);
    }
  };

  // 🔥 追加: カスタマーポータルへ遷移する処理
  const handleManageSubscription = async () => {
    try {
      setIsPortalLoading(true);
      const token = await user?.getIdToken();
      if (!token) return;

      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'ポータルへの移動に失敗しました');
      
      window.location.href = data.url;
    } catch (error: any) {
      alert("エラー: " + error.message);
    } finally {
      setIsPortalLoading(false);
    }
  };

  // 🔥 追加: 未契約者のための登録ボタン処理（ResultCardと同じロジック）
  const handleUpgradeFromMenu = async () => {
    try {
      setIsPortalLoading(true); // ポータル用ローディングを再利用
      const token = await user?.getIdToken();
      if (!token) return;

      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (data.url) window.location.href = data.url;
    } catch (error: any) {
      alert("エラー: " + error.message);
    } finally {
      setIsPortalLoading(false);
    }
  };

  const isThemeMode = activeMode === 'mypost' || activeMode === 'trend';
  const currentThemeCandidates = activeMode === 'mypost' ? myPostThemes : trendThemes;

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient || loading) return <div className="p-10 text-center">読み込み中...</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-[#066099]/10 pb-12">
      
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm mb-6">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* タイトル（常に表示） */}
          <div className="flex items-center gap-2">
            <div className="bg-gradient-to-br from-[#066099] to-sky-600 text-white p-1.5 rounded-lg shadow-sm">
              <Send size={20} />
            </div>
            <h1 className="font-bold text-xl tracking-tight text-slate-900">投稿サポAI（β版）</h1>
          </div>

          {/* デスクトップ表示（md以上） */}
          <div className="hidden md:flex items-center gap-4">
            <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
              <a 
                href="https://x.com/home" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-slate-600 hover:text-black transition-colors p-1.5 hover:bg-slate-100 rounded-lg"
                title="Xを開く"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </a>
              <a 
                href="https://www.facebook.com/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-slate-600 hover:text-blue-600 transition-colors p-1.5 hover:bg-slate-100 rounded-lg"
                title="Facebookを開く"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
              </a>
              <a 
                href="https://www.instagram.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-slate-600 hover:text-pink-600 transition-colors p-1.5 hover:bg-slate-100 rounded-lg"
                title="Instagramを開く"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                </svg>
              </a>
          </div>
          {user ? (
            <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">{user.email}</span>
              {isSubscribed && (
                <span className="text-[10px] font-bold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Check size={10} strokeWidth={3} /> 契約中
                </span>
              )}
              <SettingsDropdown 
                user={user} 
                isSubscribed={isSubscribed} 
                onLogout={handleLogout}
                onManageSubscription={handleManageSubscription}
                onUpgrade={handleUpgradeFromMenu}
                isPortalLoading={isPortalLoading}
                onOpenFacebookSettings={() => setShowFacebookSettings(true)}
                onOpenXSettings={() => setShowXSettings(true)}
                blogData={blogData}
                getBlogCsvForDownload={buildBlogCsvForDownload}
                getAllDataCsvForDownload={buildAllDataCsvForDownload}
              />
            </div>
          ) : (
            <button onClick={handleGoogleLogin} className="text-xs bg-[#066099] text-white px-4 py-2 rounded-lg hover:bg-[#055080] font-bold">ログイン</button>
          )}
          </div>

          {/* スマホ表示（md未満）: ハンバーガーメニュー */}
          <MobileMenu 
            user={user}
            isSubscribed={isSubscribed}
            onGoogleLogin={handleGoogleLogin}
            onLogout={handleLogout}
            onManageSubscription={handleManageSubscription}
            onUpgrade={handleUpgradeFromMenu}
            isPortalLoading={isPortalLoading}
            onOpenXSettings={() => setShowXSettings(true)}
          />
        </div>
      </header>

      {!user ? (
        <div className="max-w-md mx-auto mt-20 p-8 bg-white rounded-xl shadow-lg">
          <h2 className="text-xl font-bold mb-6 text-center">ようこそ！</h2>
          <button onClick={handleGoogleLogin} className="w-full bg-[#066099] text-white py-3 rounded-xl font-bold hover:bg-[#055080] transition mb-6 shadow-sm">
            Googleでログイン
          </button>
          {/* ... Login Form ... */}
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px bg-slate-200 flex-1"></div>
            <span className="text-xs text-slate-400">またはメールアドレスで</span>
            <div className="h-px bg-slate-200 flex-1"></div>
          </div>
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-3 text-slate-400"/>
                <input type="email" placeholder="メールアドレス" className="w-full pl-10 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#066099] transition-all text-black" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
            </div>
            <div>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-3 text-slate-400"/>
                <input type="password" placeholder="パスワード（6文字以上）" className="w-full pl-10 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#066099] transition-all text-black" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </div>
            </div>
            {error && <p className="text-xs text-red-500 text-center">{error}</p>}
            <button type="submit" className="w-full bg-slate-800 text-white py-3 rounded-xl font-bold hover:bg-slate-900 transition shadow-sm">{isLoginMode ? 'メールでログイン' : '新規登録する'}</button>
          </form>
          <div className="mt-4 text-center">
            <button onClick={() => { setIsLoginMode(!isLoginMode); setError(''); }} className="text-xs text-[#066099] hover:underline">{isLoginMode ? 'アカウントをお持ちでない方は新規登録' : 'すでにアカウントをお持ちの方はログイン'}</button>
          </div>
          <div className="mt-6 pt-4 border-t border-slate-200 text-center">
            <a 
              href="https://rakura.net/policy/" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-xs text-slate-500 hover:text-[#066099] transition-colors"
            >
              プライバシーポリシー
            </a>
          </div>
        </div>
      ) : (
        <main className="max-w-7xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          <div className="lg:col-span-1 space-y-6">
            <div>
              <ModeButton active={activeMode === 'trend'} onClick={() => changeMode('trend')} icon={TrendingUp} label="トレンド提案" />
              <ModeButton active={activeMode === 'mypost'} onClick={() => changeMode('mypost')} icon={BarChart3} label="マイ投稿分析" />
              <ModeButton active={activeMode === 'rewrite'} onClick={() => changeMode('rewrite')} icon={RefreshCcw} label="文章リライト" />
            </div>

            <PersistentSettings settings={currentSettings} setSettings={updateCurrentSettings} mode={activeMode} user={user} />

          </div>

          <div className="lg:col-span-2 space-y-4">
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                  {activeMode === 'trend' && <><TrendingUp className="text-[#066099]" /> トレンド提案</>}
                  {activeMode === 'mypost' && <><BarChart3 className="text-[#066099]" /> マイ投稿分析</>}
                  {activeMode === 'rewrite' && <><RefreshCcw className="text-[#066099]" /> 文章リライト</>}
                </h2>
                
                {activeMode === 'mypost' && (
                  <div className="flex flex-col gap-3">
                      {/* データソース選択（分析・更新用） */}
                    <div className="flex flex-col sm:flex-row gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200 w-full sm:w-auto items-center justify-center">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="analysisDataSource"
                          value="x"
                          checked={analysisDataSource === 'x'}
                          onChange={async () => {
                            setAnalysisDataSource('x');
                            setDataSource('csv');
                            // ユーザーごとのデフォルトデータソースとして保存
                            if (user) {
                              try {
                                await setDoc(doc(db, 'users', user.uid), {
                                  defaultAnalysisDataSource: 'x',
                                }, { merge: true });
                              } catch (error) {
                                console.error('defaultAnalysisDataSource(x) の保存に失敗しました:', error);
                              }
                            }
                          }}
                            className="w-4 h-4 text-[#066099] border-slate-300 focus:ring-[#066099]"
                          />
                        <span className="text-xs text-slate-700">X投稿</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="analysisDataSource"
                          value="blog"
                          checked={analysisDataSource === 'blog'}
                          onChange={async () => {
                            setAnalysisDataSource('blog');
                            setDataSource('blog');
                            // ユーザーごとのデフォルトデータソースとして保存
                            if (user) {
                              try {
                                await setDoc(doc(db, 'users', user.uid), {
                                  defaultAnalysisDataSource: 'blog',
                                }, { merge: true });
                              } catch (error) {
                                console.error('defaultAnalysisDataSource(blog) の保存に失敗しました:', error);
                              }
                            }
                          }}
                            className="w-4 h-4 text-[#066099] border-slate-300 focus:ring-[#066099]"
                          />
                        <span className="text-xs text-slate-700">ブログ</span>
                        </label>
                      </div>
                    
                    {/* 2×2グリッド: データ取込み、過去投稿、パーソナリティ分析、テーマ候補更新 */}
                    <div className="flex justify-end">
                      <div className="grid grid-cols-2 gap-2 w-auto">
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          onChange={handleFileChange} 
                          className="hidden" 
                          accept=".csv, .txt" 
                        />
                      <button
                          onClick={() => setShowDataImportModal(true)}
                          disabled={isCsvLoading || isBlogImporting}
                          className="text-xs px-3 py-1.5 rounded-lg font-bold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 shadow-sm"
                          title="データ取込み"
                        >
                          {(isCsvLoading || isBlogImporting) ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Upload size={12} />
                          )}
                          データ取込み
                      </button>
                        {parsedPosts.length > 0 ? (
                        <button 
                          onClick={() => {
                            if (selectedSection === 'posts') {
                              setSelectedSection(null);
                              setShowPostAnalysis(false);
                            } else {
                              setSelectedSection('posts');
                              setShowPostAnalysis(true);
                              // 分析用のデータソースと表示用のデータソースを同期
                              if (analysisDataSource === 'blog') {
                                setDataSource('blog');
                              } else {
                                // デフォルトはX投稿
                                setDataSource('csv');
                              }
                            }
                          }}
                            className={`text-xs border px-3 py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1 font-bold shadow-sm ${
                            selectedSection === 'posts'
                              ? 'bg-slate-100 border-slate-400 text-slate-800'
                              : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <BarChart3 size={12} />
                          過去投稿 ({parsedPosts.length})
                        </button>
                        ) : (
                          <div className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 flex items-center justify-center gap-1 font-bold shadow-sm">
                            <BarChart3 size={12} />
                            過去投稿 (0)
                          </div>
                        )}
                        <button
                          onClick={() => {
                            handleAnalyzePersonality();
                          }}
                          disabled={isThemesLoading}
                          className="text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1 font-bold shadow-sm bg-[#066099] hover:bg-[#055080] text-white"
                        >
                          {isThemesLoading ? <Loader2 size={12} className="animate-spin"/> : <UserIcon size={12}/>}
                          パーソナリティ分析
                        </button>
                        <button
                          onClick={() => {
                            if (selectedSection === 'analysis') {
                              setSelectedSection(null);
                            } else {
                              setSelectedSection('analysis');
                              setShowPostAnalysis(false);
                            }
                            handleUpdateThemes('mypost');
                          }}
                          disabled={isThemesLoading}
                          className={`text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1 font-bold shadow-sm ${
                            selectedSection === 'analysis'
                              ? 'bg-[#066099] text-white'
                              : 'bg-[#066099] hover:bg-[#055080] text-white'
                          }`}
                        >
                          {isThemesLoading ? <Loader2 size={12} className="animate-spin"/> : <Zap size={12}/>}
                          テーマ候補更新
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                
                {activeMode === 'trend' && (
                   <button 
                     onClick={() => handleUpdateThemes('trend')}
                     disabled={isThemesLoading}
                     className="text-xs bg-white border border-[#066099] text-[#066099] px-3 py-1.5 rounded-lg hover:bg-sky-50 transition-colors disabled:opacity-50 flex items-center gap-1 font-bold shadow-sm"
                   >
                     <RefreshCcw size={12} className={isThemesLoading ? "animate-spin" : ""}/>
                     トレンドテーマ更新
                   </button>
                )}
              </div>

              {/* マイ投稿分析: 投稿一覧 */}
              {activeMode === 'mypost' && showPostAnalysis && selectedSection === 'posts' && (
                <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <BarChart3 size={16} className="text-[#066099]" />
                      過去の投稿
                    </h3>
                    <button
                      onClick={() => {
                        setSelectedSection(null);
                        setShowPostAnalysis(false);
                      }}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <XIcon size={16} />
                    </button>
                  </div>
                  
                  
                  {parsedPosts.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-4">
                      データがありません。CSVまたはブログデータを取り込んでください。
                    </p>
                  )}
                  
                  {parsedPosts.length > 0 && (
                    <>
                      {/* 検索・ソート・フィルタ */}
                      <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          placeholder="キーワード検索..."
                          value={searchKeyword}
                          onChange={(e) => setSearchKeyword(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-slate-50 focus:bg-white text-black"
                        />
                      </div>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-white text-black"
                      >
                        <option value="likes-desc">いいね数（降順）</option>
                        <option value="likes-asc">いいね数（昇順）</option>
                        <option value="views-desc">ビュー数（降順）</option>
                        <option value="views-asc">ビュー数（昇順）</option>
                        <option value="engagement-desc">エンゲージメント（降順）</option>
                        <option value="engagement-asc">エンゲージメント（昇順）</option>
                        <option value="date-desc">日付（新しい順）</option>
                        <option value="date-asc">日付（古い順）</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={excludeRTAndReplies}
                        onChange={(e) => setExcludeRTAndReplies(e.target.checked)}
                        className="w-4 h-4 text-[#066099] border-slate-300 rounded focus:ring-[#066099]"
                      />
                      <span>RT（リツイート）と返信（@で始まる投稿）を除外</span>
                    </label>
                  </div>
                  
                  {/* 投稿一覧 */}
                  <div key={dataSource} className="space-y-2 max-h-96 overflow-y-auto">
                    {(() => {
                      // フィルタリングとソート
                      const effectiveDataSource = (dataSource === 'csv' && blogData && blogData.trim())
                        ? 'all'
                        : dataSource;
                      let filtered = parsedPosts.filter(post => {
                        // データソースでフィルタリング（tweet_id列の有無で判定）
                        // rawDataも確認して、より確実に判定
                        const rawData = post.rawData || {};
                        const hasTweetId = !!(
                          post.tweet_id || 
                          post.tweetId || 
                          post['Tweet ID'] || 
                          post['TweetID'] || 
                          post['tweet_id'] ||
                          rawData.tweet_id ||
                          rawData.tweetId ||
                          rawData['Tweet ID'] ||
                          rawData['TweetID'] ||
                          rawData['tweet_id']
                        );
                        
                        // URL列がある場合はブログ投稿と判定（複数のキーを許容）
                        const urlValue =
                          post.URL || post.url || post.Url ||
                          rawData.URL || rawData.url || rawData.Url ||
                          post.Link || rawData.Link ||
                          post.Permalink || rawData.Permalink;
                        const hasUrl = !!(urlValue && String(urlValue).trim());
                        
                        const isCsvPost = hasTweetId;
                        const isBlogPost = hasUrl && !hasTweetId;
                        
                        // X投稿とブログ投稿のフィルター
                        if (effectiveDataSource === 'all') {
                          // 全データ選択の場合は全て表示
                        } else if (effectiveDataSource === 'csv') {
                          // X投稿のみ
                          if (!isCsvPost) return false;
                        } else if (effectiveDataSource === 'blog') {
                          // ブログ投稿のみ - Xのデータ（tweet_idがあるもの）は確実に除外
                          // tweet_idがある場合は確実に除外（Xのデータ）
                          if (hasTweetId || isCsvPost) return false;
                          // tweet_idがなければブログ投稿として表示（URLの有無は問わない）
                        } else {
                          // どちらも選択されていない場合は何も表示しない
                          return false;
                        }
                        
                        // キーワード検索（本文・タイトル・URLを対象）
                        if (searchKeyword && searchKeyword.trim()) {
                          const keyword = searchKeyword.toLowerCase();
                          const contentText = (post.content || '').toLowerCase();
                          const titleText = (post.title || post.Title || '').toLowerCase();
                          const urlText = String(urlValue || '').toLowerCase();
                          const hit = contentText.includes(keyword) || titleText.includes(keyword) || urlText.includes(keyword);
                          if (!hit) return false;
                        }
                        
                        // RTと返信の除外（X投稿のみに適用）
                        if (excludeRTAndReplies && isCsvPost) {
                          const content = (post.content || '').trim();
                          
                          if (!content) return false;
                          
                          // RT（リツイート）を除外（"RT @" で始まる、または "RT:" で始まる）
                          const rtPattern = /^(RT\s*@|RT\s*:|rt\s*@|rt\s*:)/i;
                          if (rtPattern.test(content)) {
                            return false;
                          }
                          
                          // 返信を除外（先頭の空白や改行を除いた後に"@"で始まる）
                          // 先頭の空白・改行・タブなどを除去
                          const trimmedContent = content.replace(/^[\s\n\r\t]+/, '');
                          // "@"で始まる場合を除外
                          if (trimmedContent.startsWith('@')) {
                            return false;
                          }
                          
                          // ハッシュタグから始まる投稿も除外（リツイートと返信を削除する場合）
                          // 先頭の空白や改行を除いた後に"#"で始まる
                          if (trimmedContent.startsWith('#')) {
                            return false;
                          }
                        }
                        return true;
                      });
                      
                      // ソート処理
                      const [sortField, sortDirection] = sortBy.split('-');
                      filtered.sort((a, b) => {
                        let aValue: number;
                        let bValue: number;
                        
                        switch (sortField) {
                          case 'likes':
                            aValue = a.likes || 0;
                            bValue = b.likes || 0;
                            break;
                          case 'views':
                            aValue = a.views || 0;
                            bValue = b.views || 0;
                            break;
                          case 'engagement':
                            aValue = a.engagement || 0;
                            bValue = b.engagement || 0;
                            break;
                          case 'date':
                            aValue = new Date(a.date || 0).getTime();
                            bValue = new Date(b.date || 0).getTime();
                            break;
                          default:
                            aValue = a.engagement || 0;
                            bValue = b.engagement || 0;
                        }
                        
                        if (sortDirection === 'asc') {
                          return aValue - bValue;
                        } else {
                          return bValue - aValue;
                        }
                      });
                      
                      return filtered.map((post, index) => {
                        // ブログ投稿かどうかを判定
                        const rawData = post.rawData || {};
                        const hasTweetId = !!(
                          post.tweet_id || 
                          post.tweetId || 
                          post['Tweet ID'] || 
                          post['TweetID'] || 
                          post['tweet_id'] ||
                          rawData.tweet_id ||
                          rawData.tweetId ||
                          rawData['Tweet ID'] ||
                          rawData['TweetID'] ||
                          rawData['tweet_id']
                        );
                        const urlValue =
                          post.URL || post.url || post.Url ||
                          rawData.URL || rawData.url || rawData.Url ||
                          post.Link || rawData.Link ||
                          post.Permalink || rawData.Permalink;
                        const hasUrl = !!(urlValue && String(urlValue).trim());
                        const isBlogPost = hasUrl && !hasTweetId;
                        
                        // 過去投稿一覧に表示するのはタイトルのみ
                        const displayTitle = isBlogPost ? (post.title || post.Title || 'タイトルなし') : (post.content ? post.content.substring(0, 50) + (post.content.length > 50 ? '...' : '') : 'タイトルなし');
                        
                        // 投稿日を取得（複数のパターンを確認）
                        const postDate = post.date || post.Date || rawData.date || rawData.Date || '';
                        
                        return (
                          <div
                            key={`${effectiveDataSource}-${post.id}-${urlValue || post.tweet_id || index}`}
                            className="p-3 bg-slate-50 rounded-lg border border-slate-200 hover:border-[#066099]/50 transition-colors group"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  {post.likes !== undefined && post.likes > 0 && (
                                    <span className="text-xs font-bold text-pink-600 bg-pink-50 px-2 py-0.5 rounded">
                                      ❤️ {post.likes.toLocaleString()}
                                    </span>
                                  )}
                                  {post.views !== undefined && post.views > 0 && (
                                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                                      👁️ {post.views.toLocaleString()}
                                    </span>
                                  )}
                                  {post.engagement > 0 && (
                                    <span className="text-xs font-bold text-[#066099] bg-[#066099]/10 px-2 py-0.5 rounded">
                                      📊 {post.engagement.toLocaleString()}
                                    </span>
                                  )}
                                  {postDate && (
                                    <span className="text-xs text-slate-500">投稿日：{postDate}</span>
                                  )}
                                </div>
                                <h4 className="text-sm font-bold text-slate-800 mb-1 whitespace-pre-line">{displayTitle}</h4>
                              </div>
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100">
                              <button
                                onClick={() => {
                                  // 編集ボタンが押下された記事のCSVから、全文を取得
                                  // rawDataからContent列またはcontent列を取得（全文）
                                  let fullContent = '';
                                  
                                  if (isBlogPost) {
                                    // ブログ投稿の場合は、rawDataからContent列の全文を取得
                                    const rawContent = rawData.Content || rawData.content || '';
                                    const title = post.title || post.Title || rawData.Title || rawData.title || '';
                                    
                                    // rawContentが空の場合は、post.contentを使用（フォールバック）
                                    if (!rawContent && post.content) {
                                      fullContent = post.content;
                                    } else if (rawContent) {
                                      // rawDataから取得したContent列の全文を使用
                                      // HTMLタグを除去しつつ改行を保持
                                      const extractedContent = extractTextFromWordPress(rawContent, true);
                                      fullContent = extractedContent;
                                    }
                                    
                                    // タイトルと本文を結合
                                    if (title.trim() && fullContent.trim()) {
                                      fullContent = title.trim() + '\n\n' + fullContent.trim();
                                    } else if (fullContent.trim()) {
                                      fullContent = fullContent.trim();
                                    }
                                  } else {
                                    // X投稿の場合は、rawDataからtext列またはContent列の全文を取得
                                    const rawText = rawData.text || rawData.Text || rawData['Post Content'] || rawData['投稿内容'] || '';
                                    const rawContent = rawData.Content || rawData.content || '';
                                    
                                    // rawTextが優先、なければrawContent、それもなければpost.content
                                    if (rawText) {
                                      fullContent = rawText;
                                    } else if (rawContent) {
                                      fullContent = rawContent;
                                    } else {
                                      fullContent = post.content || '';
                                    }
                                  }
                                  
                                  setResult(fullContent);
                                  setShowPostAnalysis(true);
                                  // 投稿分析の一覧は閉じない
                                }}
                                className="px-3 py-1.5 text-xs font-bold text-white bg-[#066099] rounded-lg hover:bg-[#055080] transition-colors flex items-center gap-1"
                                title="この投稿を編集"
                              >
                                <Pencil size={12} />
                                編集
                              </button>
                              <button
                                onClick={() => {
                                  handleDeletePost(post.id);
                                }}
                                className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors flex items-center gap-1"
                                title="この投稿を削除"
                              >
                                <Trash2 size={12} />
                                削除
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                      });
                    })()}
                  </div>
                  
                  {(() => {
                    const filtered = parsedPosts.filter(post => 
                      post.content.toLowerCase().includes(searchKeyword.toLowerCase())
                    );
                    if (filtered.length === 0) {
                      return (
                        <p className="text-sm text-slate-400 text-center py-4">
                          検索結果が見つかりませんでした
                        </p>
                      );
                    }
                    return null;
                  })()}
                    </>
                  )}
                </div>
              )}


              {/* ブログ取り込みUI - 削除済み */}
              {false && (
                <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 mb-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <BookOpen size={16} className="text-[#066099]" />
                      ブログ取り込み
                    </h3>
                    <button
                      onClick={() => {
                        setSelectedSection(null);
                        setSitemapUrl('');
                        setSitemapUrls([]);
                        setSelectedUrls(new Set());
                        setBlogCacheInfo(null);
                      }}
                      className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <XIcon size={16} />
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    {/* URL取り込みタイプの選択（ラジオボタン） */}
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">
                        取り込みタイプを選択
                      </label>
                      <div className="space-y-2">
                        <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#066099] cursor-pointer bg-white">
                          <input
                            type="radio"
                            name="urlImportType"
                            value="sitemap"
                            checked={urlImportType === 'sitemap'}
                            onChange={(e) => setUrlImportType(e.target.value as 'sitemap' | 'entry' | 'article')}
                            className="w-4 h-4 text-[#066099] border-slate-300 focus:ring-[#066099]"
                          />
                          <div>
                            <p className="text-sm font-bold text-slate-800">サイトマップのURL（WordPress）</p>
                            <p className="text-xs text-slate-500">※サイトURLに /sitemap.xml や /post-sitemap.xml 等を追加してください</p>
                          </div>
                        </label>
                        
                        <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#066099] cursor-pointer bg-white">
                          <input
                            type="radio"
                            name="urlImportType"
                            value="entry"
                            checked={urlImportType === 'entry'}
                            onChange={(e) => setUrlImportType(e.target.value as 'sitemap' | 'entry' | 'article')}
                            className="w-4 h-4 text-[#066099] border-slate-300 focus:ring-[#066099]"
                          />
                          <div>
                            <p className="text-sm font-bold text-slate-800">はてなブログのURL</p>
                            <p className="text-xs text-slate-500">※入力されたURLに/entry/を追加して検索します</p>
                          </div>
                        </label>
                        
                        <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#066099] cursor-pointer bg-white">
                          <input
                            type="radio"
                            name="urlImportType"
                            value="article"
                            checked={urlImportType === 'article'}
                            onChange={(e) => setUrlImportType(e.target.value as 'sitemap' | 'entry' | 'article')}
                            className="w-4 h-4 text-[#066099] border-slate-300 focus:ring-[#066099]"
                          />
                          <div>
                            <p className="text-sm font-bold text-slate-800">記事の単独URL</p>
                            <p className="text-xs text-slate-500">入力されたページのみから取り込みます（未検証です）</p>
                          </div>
                        </label>
                      </div>
                    </div>
                    
                    {/* URL入力欄 */}
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">
                        URL入力
                      </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                            placeholder={
                              urlImportType === 'sitemap' 
                                ? "例: https://example.com"
                                : urlImportType === 'entry'
                                ? "例: https://example.com"
                                : "例: https://example.com/article/123"
                            }
                            value={singleArticleUrl}
                            onChange={(e) => setSingleArticleUrl(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-white text-black"
                            disabled={isBlogImporting || isSitemapLoading}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !isBlogImporting && !isSitemapLoading && singleArticleUrl.trim()) {
                                handleUrlImportByType();
                              }
                            }}
                          />
                        </div>
                        <button
                          onClick={handleUrlImportByType}
                          disabled={isBlogImporting || isSitemapLoading || !singleArticleUrl.trim()}
                          className="px-4 py-2 text-sm font-bold text-white bg-[#066099] rounded-lg hover:bg-[#055080] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {(isBlogImporting || isSitemapLoading) ? (
                            <>
                              <Loader2 size={16} className="animate-spin" />
                              処理中...
                            </>
                          ) : (
                            <>
                              <Upload size={16} />
                              取得
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                    
                    {/* 詳細設定（オプション） */}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-slate-600 hover:text-slate-800 mb-2">
                        詳細設定（サイトマップURLを直接指定する場合）
                      </summary>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 relative">
                          <input
                            type="text"
                            placeholder="サイトマップURLを直接入力（例: https://example.com/sitemap.xml）"
                          value={sitemapUrl}
                          onChange={(e) => setSitemapUrl(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-white text-black"
                          disabled={isSitemapLoading || isBlogImporting}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isSitemapLoading && sitemapUrl.trim()) {
                              handleFetchSitemap();
                            }
                          }}
                        />
                      </div>
                      <button
                          onClick={() => handleFetchSitemap()}
                        disabled={isSitemapLoading || !sitemapUrl.trim()}
                        className="px-4 py-2 text-sm font-bold text-white bg-[#066099] rounded-lg hover:bg-[#055080] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {isSitemapLoading ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            取得中...
                          </>
                        ) : (
                          <>
                            <Upload size={16} />
                            URL一覧取得
                          </>
                        )}
                      </button>
                    </div>
                    </details>
                    
                    {blogImportProgress && (
                      <p className="text-sm text-slate-600">{blogImportProgress}</p>
                    )}
                    
                    {/* 取り込んだURLの一覧 */}
                    {blogUrls && blogUrls.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <p className="text-xs font-bold text-slate-700 mb-2">取り込んだブログ記事:</p>
                        <div className="space-y-1 max-h-96 overflow-y-auto">
                          {blogUrls.map((url: string) => {
                            // ブログデータから該当するURLの投稿を探す
                            const blogPost = parsedPosts.find((post: any) => {
                              const postUrl = post.URL || post.url;
                              return postUrl === url;
                            });
                            
                            const postDate = blogPost?.Date || blogPost?.date || '';
                            const postTitle = blogPost?.Title || blogPost?.title || '';
                            const displayTitle = postTitle ? (postTitle.length > 50 ? postTitle.substring(0, 50) + '...' : postTitle) : 'タイトルなし';
                            
                            return (
                              <div
                                key={url}
                                className="flex items-center justify-between gap-2 text-xs bg-slate-50 p-2 rounded hover:bg-slate-100"
                              >
                                <div className="flex-1 min-w-0">
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-slate-700 hover:text-[#066099] hover:underline cursor-pointer"
                                    title={url}
                                  >
                                    <p className="font-medium truncate">
                                      {postDate ? `${postDate} - ` : ''}{displayTitle}
                                    </p>
                                  </a>
                                  {blogUrlDates[url] && (
                                    <p className="text-slate-400 text-[10px]">
                                      取込み日時: {blogUrlDates[url]}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleDeleteBlogUrl(url)}
                                    disabled={isBlogImporting}
                                    className="px-2 py-1 text-[10px] font-bold text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex items-center gap-1"
                                    title="このURLを削除"
                                  >
                                    <Trash2 size={10} />
                                    削除
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* データ取込みモーダル（統合） */}
              {showDataImportModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
                    <div className="flex items-center justify-between p-6 border-b border-slate-200">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Upload size={20} className="text-[#066099]" />
                        データ取込み
                      </h3>
                      <button
                        onClick={() => {
                          setShowDataImportModal(false);
                        }}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <XIcon size={20} />
                      </button>
                    </div>
                    
                    <div className="flex-1 overflow-hidden flex flex-col p-6">
                      {/* 現在のデータ一覧 */}
                      <div className="mb-4 space-y-4">
                        {/* X投稿データ（CSV） */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-bold text-slate-700">
                              {(() => {
                                try {
                                  if (csvData && csvData !== 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200') {
                                    const parsed = parseCsvToPosts(csvData);
                                    const MAX_X_POSTS = 300;
                                    // X投稿（tweet_idがある投稿）の数をカウント
                                    let xPostCount = 0;
                                    parsed.forEach((post: any) => {
                                      const rawData = post.rawData || {};
                                      const hasTweetId = !!(
                                        post.tweet_id || 
                                        post.tweetId || 
                                        post['Tweet ID'] || 
                                        post['TweetID'] || 
                                        post['tweet_id'] ||
                                        rawData.tweet_id ||
                                        rawData.tweetId ||
                                        rawData['Tweet ID'] ||
                                        rawData['TweetID']
                                      );
                                      if (hasTweetId) {
                                        xPostCount++;
                                      }
                                    });
                                    return `X投稿データ（${xPostCount}/${MAX_X_POSTS}）`;
                                  }
                                  return 'X投稿データ（0/300）';
                                } catch {
                                  return 'X投稿データ（0/300）';
                                }
                              })()}
                            </h4>
                            <div className="flex items-center gap-2">
                              {/* 追加ボタン（X） */}
                            <button
                              onClick={() => {
                                  // 既存データに追加でCSVを取り込む
                                  const fileInput = fileInputRef.current;
                                  if (fileInput) {
                                    const tempHandler = async (e: Event) => {
                                      const target = e.target as HTMLInputElement;
                                      const file = target.files?.[0];
                                      if (!file) return;
                                      
                                      const reader = new FileReader();
                                      reader.onload = async (event) => {
                                        const text = event.target?.result as string;
                                        if (text) {
                                          if (confirm('CSVデータを既存データに追加して取り込みますか？')) {
                                            await applyCsvData(text, 'append');
                                          }
                                        }
                                        target.value = '';
                                        fileInput.removeEventListener('change', tempHandler);
                                      };
                                      reader.readAsText(file);
                                    };
                                    fileInput.addEventListener('change', tempHandler);
                                    fileInput.click();
                                  }
                                }}
                                disabled={isCsvLoading}
                                className="px-3 py-1.5 text-xs font-bold text-white bg-[#F99F66] rounded hover:bg-[#F98A40] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                title="CSVデータを追加"
                              >
                                <Upload size={12} />
                                追加
                              </button>
                              {/* 削除ボタン（X） */}
                              <button
                                onClick={async () => {
                                  await handleClearCsvData();
                                }}
                                disabled={isCsvLoading}
                                className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                title="CSVデータを削除"
                              >
                                <Trash2 size={12} />
                                削除
                            </button>
                            </div>
                          </div>
                          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                            {csvData && csvData !== 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200' ? (
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-slate-700">
                                    投稿データ
                                  </p>
                                  {csvUploadDate && (
                                    <div className="text-[10px] text-slate-500 mt-1">
                                      <p>取込み日: {csvUploadDate}</p>
                                      {(() => {
                                        try {
                                          const uploadDate = new Date(csvUploadDate.replace(/\//g, '-'));
                                          const expiryDate = new Date(uploadDate);
                                          expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                                          return (
                                            <p>期限: {expiryDate.toLocaleDateString('ja-JP', {
                                              year: 'numeric',
                                              month: '2-digit',
                                              day: '2-digit',
                                            })}</p>
                                          );
                                        } catch {
                                          return null;
                                        }
                                      })()}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-slate-400 text-center py-4">データがありません</p>
                            )}
                          </div>
                        </div>
                        
                        {/* ブログデータ（URL一覧） */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                              {isBlogImporting && (
                                <Loader2 size={14} className="animate-spin text-[#066099]" />
                              )}
                              ブログ一覧（{blogUrls.length}/50）
                              {isBlogImporting && blogImportProgress && (
                                <span className="text-xs font-normal text-[#066099]">{blogImportProgress}</span>
                              )}
                            </h4>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setShowUrlInputModal(true);
                                }}
                                disabled={isBlogImporting}
                                className="px-3 py-1.5 text-xs font-bold text-white bg-[#F99F66] rounded hover:bg-[#F98A40] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                title="ブログURLを追加"
                              >
                                <Upload size={12} />
                                追加
                              </button>
                              {blogUrls && blogUrls.length > 0 && (
                                <button
                                  onClick={() => handleBulkDeleteBlogUrls(blogUrls)}
                                  disabled={isBlogImporting}
                                  className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                  title="すべてのURLを削除"
                                >
                                  <Trash2 size={12} />
                                  削除
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="border border-slate-200 rounded-lg p-4 max-h-96 overflow-y-auto bg-slate-50 relative">
                            {/* 処理中のオーバーレイ */}
                            {isBlogImporting && (
                              <div className="absolute inset-0 bg-white/80 z-10 flex flex-col items-center justify-center rounded-lg">
                                <Loader2 size={32} className="animate-spin text-[#066099] mb-2" />
                                <p className="text-sm font-medium text-slate-700">処理中...</p>
                                {blogImportProgress && (
                                  <p className="text-xs text-slate-500 mt-1 max-w-xs text-center px-4">{blogImportProgress}</p>
                                )}
                              </div>
                            )}
                            {blogUrls && blogUrls.length > 0 ? (
                              <div className="space-y-2">
                                {blogUrls.map((url: string, index: number) => {
                                  // URLが正しい形式かチェック（http://またはhttps://で始まる）
                                  const isValidUrl = url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
                                  const displayUrl = isValidUrl ? url : (url || `URL ${index + 1}`);
                                  
                                  const uploadDate = blogUrlDates[url] || blogUrlDates[displayUrl];
                                  
                                  // ブログ公開日とタイトルを取得（parsedPostsから該当するURLの投稿を探す）
                                  const blogPost = parsedPosts.find((post: any) => {
                                    const postUrl = post.URL || post.url;
                                    return postUrl === url || postUrl === displayUrl;
                                  });
                                  const blogPublishDate = blogPost?.Date || blogPost?.date || '';
                                  const blogTitle = blogPost?.Title || blogPost?.title || '';
                                  
                                  // タイトルが取得できない場合は、blogDataから直接取得を試みる
                                  let displayTitle = blogTitle;
                                  if (!displayTitle && blogData) {
                                    try {
                                      const blogPosts = parseCsvToPosts(blogData);
                                      const foundPost = blogPosts.find((post: any) => {
                                        const postUrl = post.URL || post.url;
                                        return postUrl === url || postUrl === displayUrl;
                                      });
                                      if (foundPost) {
                                        displayTitle = foundPost.Title || foundPost.title || '';
                                      }
                                    } catch {
                                      // パースエラーは無視
                                    }
                                  }
                                  
                                  // タイトルが取得できない場合はURLを表示
                                  const displayText = displayTitle || displayUrl;
                                  
                                  let expiryDateStr = '';
                                  if (uploadDate) {
                                    try {
                                      const date = new Date(uploadDate.replace(/\//g, '-'));
                                      const expiryDate = new Date(date);
                                      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                                      expiryDateStr = expiryDate.toLocaleDateString('ja-JP', {
                                        year: 'numeric',
                                        month: '2-digit',
                                        day: '2-digit',
                                      });
                                    } catch {
                                      // 日付パースエラーは無視
                                    }
                                  }
                                  
                                  return (
                                    <div key={url || index} className="group flex items-start justify-between gap-3 p-2 bg-white rounded border border-slate-200 hover:bg-slate-50">
                                      <div className="flex-1 min-w-0">
                                        <a
                                          href={displayUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs text-[#066099] font-medium break-words hover:underline cursor-pointer"
                                          title={displayUrl}
                                        >
                                          {displayText}
                                        </a>
                                        <div className="text-[10px] text-slate-500 mt-1">
                                          {blogPublishDate && (
                                            <p>ブログ公開日: {blogPublishDate}</p>
                                          )}
                                          {uploadDate && (
                                            <p>取込み日: {uploadDate}</p>
                                          )}
                                          {expiryDateStr && (
                                            <p>保存期限: {expiryDateStr}</p>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={async () => {
                                            // confirmを削除（handleDeleteBlogUrl内で確認するため）
                                            await handleDeleteBlogUrl(url || displayUrl);
                                          }}
                                          disabled={isBlogImporting}
                                          className="px-2 py-1 text-[10px] font-bold text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                          title="このURLを削除"
                                        >
                                          <Trash2 size={10} />
                                          削除
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-sm text-slate-400 text-center py-4">データがありません</p>
                            )}
                          </div>
                        </div>
                      </div>
                      
                    </div>
                  </div>
                </div>
              )}

              {/* CSV取込みモーダル */}
              {showCsvImportModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Upload size={20} className="text-[#066099]" />
                        CSV取込み方法を選択
                      </h3>
                      <button 
                        onClick={() => {
                          setShowCsvImportModal(false);
                          setPendingCsvData('');
                        }}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <XIcon size={20} />
                      </button>
                    </div>
                    
                      <div className="space-y-3">
                        <p className="text-sm text-slate-600">
                          既存の投稿データ（{parsedPosts.length}件）があります。
                          <br />
                          新しいCSVデータは、既存データに<strong>追加</strong>されます。
                          差し替えたい場合は、一度「削除」で全データを消してから再度取り込んでください。
                        </p>
                      </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => {
                          setShowCsvImportModal(false);
                          setPendingCsvData('');
                        }}
                        disabled={isCsvLoading}
                        className="flex-1 px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={() => {
                          if (pendingCsvData) {
                            // モーダル経由の取込みも常に「追加」
                            applyCsvData(pendingCsvData, 'append');
                          }
                        }}
                        disabled={isCsvLoading}
                        className="flex-1 px-4 py-2 text-sm font-bold text-white bg-[#066099] rounded-lg hover:bg-[#055080] transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isCsvLoading ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            処理中...
                          </>
                        ) : (
                          <>
                            <Upload size={16} />
                            取込み実行
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* CSVモード選択モーダルは廃止（常に追加のみ） */}

              {/* URL入力モーダル */}
              {showUrlInputModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <BookOpen size={20} className="text-[#066099]" />
                        URL取り込み
                      </h3>
                      <button
                        onClick={() => {
                          setShowUrlInputModal(false);
                          setSitemapUrl('');
                          setSingleArticleUrl('');
                        }}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <XIcon size={20} />
                      </button>
                    </div>
                    
                    <div className="space-y-3">
                      {/* URL取り込みタイプの選択（ラジオボタン） */}
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">
                          取り込みタイプを選択
                        </label>
                        <div className="space-y-2">
                          <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#066099] cursor-pointer bg-white">
                            <input
                              type="radio"
                              name="urlImportTypeModal"
                              value="sitemap"
                              checked={urlImportType === 'sitemap'}
                              onChange={(e) => setUrlImportType(e.target.value as 'sitemap' | 'entry' | 'article')}
                              className="w-4 h-4 text-[#066099] border-slate-300 focus:ring-[#066099]"
                            />
                            <div>
                              <p className="text-sm font-bold text-slate-800">サイトマップのURL（WordPress）</p>
                              <p className="text-xs text-slate-500">URLに /sitemap.xml や /post-sitemap.xml 等を追加してください</p>
                            </div>
                          </label>
                          
                          <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#066099] cursor-pointer bg-white">
                            <input
                              type="radio"
                              name="urlImportTypeModal"
                              value="entry"
                              checked={urlImportType === 'entry'}
                              onChange={(e) => setUrlImportType(e.target.value as 'sitemap' | 'entry' | 'article')}
                              className="w-4 h-4 text-[#066099] border-slate-300 focus:ring-[#066099]"
                            />
                            <div>
                              <p className="text-sm font-bold text-slate-800">はてなブログのURL</p>
                              <p className="text-xs text-slate-500">入力されたURLに/entry/を追加して検索します</p>
                            </div>
                          </label>
                          
                          <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#066099] cursor-pointer bg-white">
                            <input
                              type="radio"
                              name="urlImportTypeModal"
                              value="article"
                              checked={urlImportType === 'article'}
                              onChange={(e) => setUrlImportType(e.target.value as 'sitemap' | 'entry' | 'article')}
                              className="w-4 h-4 text-[#066099] border-slate-300 focus:ring-[#066099]"
                            />
                            <div>
                              <p className="text-sm font-bold text-slate-800">記事の単独URL</p>
                              <p className="text-xs text-slate-500">入力されたページのみから取り込みます（未検証）</p>
                            </div>
                          </label>
                        </div>
                      </div>
                      
                      {/* URL入力欄 */}
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">
                          URL入力
                        </label>
                        <input
                          type="text"
                          placeholder={
                            urlImportType === 'sitemap' 
                              ? "例: https://example.com"
                              : urlImportType === 'entry'
                              ? "例: https://example.com"
                              : "例: https://example.com/article/123"
                          }
                          value={urlImportType === 'sitemap' ? sitemapUrl : singleArticleUrl}
                          onChange={(e) => {
                            if (urlImportType === 'sitemap') {
                              setSitemapUrl(e.target.value);
                            } else {
                              setSingleArticleUrl(e.target.value);
                            }
                          }}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-white text-black"
                          disabled={isSitemapLoading || isBlogImporting}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isSitemapLoading && !isBlogImporting) {
                              if (urlImportType === 'sitemap' && sitemapUrl.trim()) {
                                handleFetchSitemap().then(() => {
                                  // 成功時のみモーダルを閉じる
                              setShowUrlInputModal(false);
                                }).catch(() => {
                                  // エラー時はモーダルを開いたまま
                                });
                              } else if ((urlImportType === 'entry' || urlImportType === 'article') && singleArticleUrl.trim()) {
                                handleUrlImportByType().then(() => {
                                  // 成功時のみモーダルを閉じる
                                  setShowUrlInputModal(false);
                                }).catch(() => {
                                  // エラー時はモーダルを開いたまま
                                });
                              }
                            }
                          }}
                        />
                      </div>
                      
                      {/* 取込みモードは常に「追加」 */}
                      
                      <div className="flex items-center gap-2 pt-2">
                        <button
                          onClick={async () => {
                            try {
                              if (urlImportType === 'sitemap') {
                            if (sitemapUrl.trim()) {
                              await handleFetchSitemap();
                                  // 成功時のみモーダルを閉じる
                              setShowUrlInputModal(false);
                            } else {
                              alert('サイトマップURLを入力してください');
                                }
                              } else if (urlImportType === 'entry' || urlImportType === 'article') {
                                if (singleArticleUrl.trim()) {
                                  await handleUrlImportByType();
                                  // 成功時のみモーダルを閉じる
                                  setShowUrlInputModal(false);
                                } else {
                                  alert('URLを入力してください');
                                }
                              }
                            } catch (error) {
                              // エラー時はモーダルを開いたまま
                              console.error('URL取り込みエラー:', error);
                            }
                          }}
                          disabled={
                            (urlImportType === 'sitemap' && (isSitemapLoading || !sitemapUrl.trim())) ||
                            ((urlImportType === 'entry' || urlImportType === 'article') && (isBlogImporting || !singleArticleUrl.trim()))
                          }
                          className="flex-1 px-4 py-2 text-sm font-bold text-white bg-[#066099] rounded-lg hover:bg-[#055080] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          {isSitemapLoading ? (
                            <>
                              <Loader2 size={16} className="animate-spin" />
                              取得中...
                            </>
                          ) : (
                            <>
                              <Upload size={16} />
                              決定
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            setShowUrlInputModal(false);
                            setSitemapUrl('');
                          }}
                          className="flex-1 px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* サイトマップURL選択モーダル */}
              {showSitemapUrlModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
                    <div className="flex items-center justify-between p-6 border-b border-slate-200">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <BookOpen size={20} className="text-[#066099]" />
                        サイトマップURL一覧 ({sitemapUrls.length}件)
                      </h3>
                      <button
                        onClick={() => {
                          setShowSitemapUrlModal(false);
                          setSelectedUrls(new Set());
                        }}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <XIcon size={20} />
                      </button>
                    </div>
                    
                    <div className="flex-1 overflow-hidden flex flex-col p-6">
                      {/* 既存URLデータについての注意書き（取込みは常に「追加」） */}
                      <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <p className="text-sm font-bold text-slate-800 mb-1">既存URLデータの扱い</p>
                        <p className="text-xs text-slate-600">
                          ここでの取込みは、常に既存のブログデータに「追加」されます。
                          差し替えたい場合は、一度「削除」ボタンでデータを全て削除してから、再度URLを取り込んでください。
                        </p>
                      </div>
                      
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-slate-600">
                          取り込むURLを選択してください
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              if (selectedUrls.size === sitemapUrls.length) {
                                setSelectedUrls(new Set());
                              } else {
                                const maxSelect = Math.min(50, sitemapUrls.length);
                                if (sitemapUrls.length > 50) {
                                  alert(`1回あたり最大50件まで選択できます。最初の50件を選択します。`);
                                }
                                setSelectedUrls(new Set(sitemapUrls.slice(0, maxSelect).map(u => u.url)));
                              }
                            }}
                            className="px-3 py-1.5 text-sm font-bold text-slate-600 bg-slate-100 rounded hover:bg-slate-200 transition-colors"
                          >
                            {selectedUrls.size === sitemapUrls.length || selectedUrls.size === 50 ? 'すべて解除' : 'すべて選択（最大50件）'}
                          </button>
                        </div>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto border border-slate-200 rounded-lg p-4 space-y-2">
                        {sitemapUrls.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                            <p className="text-sm font-medium">新しく取り込めるURLが見つかりませんでした</p>
                            <p className="text-xs mt-1">すでに取り込み済みのURLは表示されません</p>
                          </div>
                        ) : sitemapUrls.map((item) => (
                          <label
                            key={item.url}
                            className="flex items-start gap-3 p-3 hover:bg-slate-50 rounded-lg cursor-pointer border border-transparent hover:border-slate-200 transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={selectedUrls.has(item.url)}
                              onChange={(e) => {
                                const newSelected = new Set(selectedUrls);
                                if (e.target.checked) {
                                  if (newSelected.size >= 50) {
                                    alert('1回あたり最大50件まで選択できます');
                                    return;
                                  }
                                  newSelected.add(item.url);
                                } else {
                                  newSelected.delete(item.url);
                                }
                                setSelectedUrls(newSelected);
                              }}
                              className="mt-1 w-5 h-5 text-[#066099] border-slate-300 rounded focus:ring-[#066099]"
                            />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-slate-700 font-medium truncate" title={item.url}>
                                {item.title || item.url}
                                </p>
                              {item.date && (
                                <p className="text-xs text-slate-400 mt-1">
                                  更新日: {item.date}
                                </p>
                              )}
                              {item.title && (
                                <p className="text-xs text-slate-500 mt-1 truncate" title={item.url}>
                                  {item.url}
                                </p>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                      
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
                        <div className="flex flex-col gap-1">
                          <p className="text-sm text-slate-600">
                            {sitemapUrls.length === 0 ? '取り込み可能なURLがありません' : `${selectedUrls.size}件のURLが選択されています`}
                          </p>
                          {selectedUrls.size > 50 && (
                            <p className="text-xs text-red-600 font-medium">
                              ⚠️ 1回あたり最大50件まで取り込めます。最初の50件のみ取り込みます。
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setShowSitemapUrlModal(false);
                              setSelectedUrls(new Set());
                            }}
                            className="px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                          >
                            キャンセル
                          </button>
                          <button
                            onClick={async () => {
                              if (selectedUrls.size === 0) {
                                alert('取り込むURLを選択してください');
                                return;
                              }
                              if (selectedUrls.size > 50) {
                                if (!confirm(`1回あたり最大50件まで取り込めます。選択された${selectedUrls.size}件のうち、最初の50件のみを取り込みます。続けますか？`)) {
                                  return;
                                }
                              }
                              setShowSitemapUrlModal(false);
                              // URLタイプに基づいてblogTypeを決定（常に既存データへ追加）
                              const importBlogType = urlImportType === 'sitemap' ? 'wordpress' : urlImportType === 'entry' ? 'hatena' : 'auto';
                              await handleImportSelectedUrls([], importBlogType);
                            }}
                            disabled={isBlogImporting || selectedUrls.size === 0}
                            className="px-4 py-2 text-sm font-bold text-white bg-[#066099] rounded-lg hover:bg-[#055080] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            {isBlogImporting ? (
                              <>
                                <Loader2 size={16} className="animate-spin" />
                                {blogImportProgress || '処理中...'}
                              </>
                            ) : (
                              <>
                                <Upload size={16} />
                                選択したURLを取り込み ({selectedUrls.size > 100 ? '100' : selectedUrls.size}件)
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 過去の投稿分析を表示している場合は、テーマ候補と投稿生成ボタンを非表示 */}
              {isThemeMode && !(activeMode === 'mypost' && showPostAnalysis) ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {isThemesLoading ? (
                      [...Array(3)].map((_, i) => (
                        <div key={i} className="h-24 bg-slate-50 rounded-xl animate-pulse border border-slate-100"></div>
                      ))
                    ) : currentThemeCandidates.length > 0 ? (
                      currentThemeCandidates.slice(0, 3).map((theme, i) => {
                        const isEditing = editingThemeIndex === i;
                        const displayTheme = isEditing ? editingThemeValue : theme;
                        
                        // テーマ候補の更新関数
                        const handleThemeChange = (newTheme: string) => {
                          if (activeMode === 'mypost') {
                            const updatedThemes = [...myPostThemes];
                            updatedThemes[i] = newTheme;
                            setMyPostThemes(updatedThemes);
                            // Firestoreに保存
                            if (user) {
                              (async () => {
                                try {
                                  await setDoc(doc(db, 'users', user.uid), {
                                    myPostThemes: updatedThemes
                                  }, { merge: true });
                                } catch (error) {
                                  console.error("テーマ候補の保存に失敗:", error);
                                }
                              })();
                            }
                          } else {
                            const updatedThemes = [...trendThemes];
                            updatedThemes[i] = newTheme;
                            setTrendThemes(updatedThemes);
                            // Firestoreに保存
                            if (user) {
                              (async () => {
                                try {
                                  await setDoc(doc(db, 'users', user.uid), {
                                    trendThemes: updatedThemes
                                  }, { merge: true });
                                } catch (error) {
                                  console.error("テーマ候補の保存に失敗:", error);
                                }
                              })();
                            }
                          }
                        };
                        
                        const handleStartEdit = () => {
                          setEditingThemeIndex(i);
                          setEditingThemeValue(theme);
                        };
                        
                        const handleSaveEdit = () => {
                          if (editingThemeValue.trim()) {
                            handleThemeChange(editingThemeValue.trim());
                          }
                          setEditingThemeIndex(null);
                          setEditingThemeValue('');
                        };
                        
                        const handleCancelEdit = () => {
                          setEditingThemeIndex(null);
                          setEditingThemeValue('');
                        };
                        
                        return (
                          <div
                          key={i}
                            className={`relative rounded-xl border text-xs transition-all h-24 flex flex-col group overflow-hidden
                              ${selectedTheme === theme && !isEditing
                              ? 'bg-gradient-to-br from-sky-50 to-white border-[#066099] ring-1 ring-[#066099] text-[#066099] shadow-sm' 
                              : 'bg-white border-slate-200 hover:border-[#066099]/50 text-slate-600 hover:shadow-sm'
                            }`}
                        >
                            <div className="absolute top-0 right-0 p-1.5 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
                            <Lightbulb size={24} />
                          </div>
                            {isEditing ? (
                              <textarea
                                className="w-full h-full p-3 pt-6 text-xs bg-transparent border-none focus:ring-0 outline-none resize-none leading-snug z-10"
                                value={editingThemeValue}
                                onChange={(e) => setEditingThemeValue(e.target.value)}
                                onBlur={handleSaveEdit}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSaveEdit();
                                  }
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    handleCancelEdit();
                                  }
                                }}
                                autoFocus
                                placeholder="テーマを入力..."
                              />
                            ) : (
                              <button
                                onClick={() => {
                                  setSelectedTheme(theme);
                                  setManualInput('');
                                }}
                                onDoubleClick={(e) => {
                                  e.preventDefault();
                                  handleStartEdit();
                                }}
                                className="w-full h-full text-left p-3 pt-6 flex flex-col justify-between z-10"
                              >
                                <span className="line-clamp-4 leading-snug font-medium whitespace-pre-line text-[10px]">{theme}</span>
                          {selectedTheme === theme && <div className="flex justify-end"><Check size={14} className="text-[#066099]" /></div>}
                        </button>
                            )}
                            {!isEditing && (
                              <div className="absolute bottom-1 right-1 text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                ダブルクリックで編集
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      [...Array(3)].map((_, i) => (
                        <div key={i} className="h-24 bg-slate-50 border border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-xs text-slate-400 gap-1">
                           <Lightbulb size={16} className="opacity-50"/>
                           <span>{activeMode === 'mypost' ? "分析待ち" : "更新待ち"}</span>
                        </div>
                      ))
                    )}

                    <div className={`relative rounded-xl border transition-all h-24 overflow-hidden group
                      ${(manualInput && !selectedTheme)
                        ? 'border-[#066099] ring-1 ring-[#066099] bg-white' 
                        : 'border-slate-200 bg-white hover:border-[#066099]/50'
                      }`}
                    >
                      <div className="absolute top-2 left-2 flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase pointer-events-none group-focus-within:text-[#066099]">
                        <Pencil size={10} /> 手入力
                      </div>
                      <textarea 
                        className="w-full h-full p-2 pt-6 text-xs bg-transparent border-none focus:ring-0 outline-none resize-none text-slate-700 leading-snug"
                        value={manualInput}
                        onChange={(e) => {
                          setManualInput(e.target.value);
                          setSelectedTheme(''); 
                        }}
                        placeholder="自由に入力..."
                      />
                    </div>
                </div>
              ) : (
                // マイ投稿分析の投稿分析を選択している場合は非表示、文章リライトを選択しているときは表示
                activeMode === 'rewrite' && (
                <div className="relative">
                    <textarea 
                      className="w-full h-24 p-3 text-sm bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#066099] focus:border-[#066099] outline-none transition-all resize-none shadow-sm"
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      placeholder="ここにリライトしたい文章を入力..."
                    />
                    <div className="absolute bottom-2 right-2 text-xs text-slate-400 pointer-events-none">
                      <Pencil size={12} className="inline mr-1"/>
                      入力中
                    </div>
                </div>
                )
              )}

              {/* 投稿生成ボタン（常に表示） */}
              {selectedSection !== 'posts' && (
              <button
                onClick={handleGeneratePost}
                disabled={isPostLoading || (!manualInput && !selectedTheme)}
                className="w-full bg-gradient-to-r from-[#066099] to-sky-600 hover:from-[#055080] hover:to-sky-700 text-white font-bold py-3 rounded-xl shadow-md shadow-sky-100 transform transition active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
              >
                {isPostLoading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                {activeMode === 'rewrite' ? 'リライトを実行' : '投稿を作成する'}
              </button>
              )}
            </div>

            <div className="flex-1 min-h-0 flex flex-col gap-2">
               {/* 生成結果（常に表示） */}
               <ResultCard 
                 content={result} 
                 isLoading={isPostLoading} 
                 error={error} 
                 onChange={setResult} 
                 user={user}
                 onPostToX={handlePostToX}
                 isPostingToX={isPostingToX}
                 rewrittenContent={rewrittenResult}
                 isRewriting={isRewriting}
                 xAccessToken={xAccessToken}
                 showPostAnalysis={activeMode === 'mypost' && showPostAnalysis}
               />
               <div className="text-right text-xs text-slate-400">
                 Created by <a href="https://rakura-style.com" target="_blank" rel="noopener noreferrer" className="text-[#066099] hover:underline">らくらスタイル</a>
               </div>
            </div>
            
          </div>

        </main>
      )}

      {/* X設定モーダル */}
      {showXSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Send size={20} className="text-black" />
                X設定
              </h3>
              <button 
                onClick={() => setShowXSettings(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <XIcon size={20} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">
                  API Key
                </label>
                <input
                  type="text"
                  value={xApiKey}
                  onChange={(e) => setXApiKey(e.target.value)}
                  placeholder="例: abcd1234..."
                  className="w-full p-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-slate-50 focus:bg-white transition-colors text-black"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">
                  API Key Secret
                </label>
                <input
                  type="password"
                  value={xApiKeySecret}
                  onChange={(e) => setXApiKeySecret(e.target.value)}
                  placeholder="例: xyz789..."
                  className="w-full p-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-slate-50 focus:bg-white transition-colors text-black"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">
                  Access Token
                </label>
                <input
                  type="password"
                  value={xAccessToken}
                  onChange={(e) => setXAccessToken(e.target.value)}
                  placeholder="例: 1234567890..."
                  className="w-full p-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-slate-50 focus:bg-white transition-colors text-black"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">
                  Access Token Secret
                </label>
                <input
                  type="password"
                  value={xAccessTokenSecret}
                  onChange={(e) => setXAccessTokenSecret(e.target.value)}
                  placeholder="例: efgh567..."
                  className="w-full p-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-slate-50 focus:bg-white transition-colors text-black"
                />
              </div>

              <p className="text-xs text-slate-400">
                X Developer Portalで取得した4つの認証情報を入力してください。
                <br />
                <a href="https://developer.twitter.com/en/portal/dashboard" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  X Developer Portal
                </a>
              </p>

              <div className="pt-4 border-t border-slate-200">
                <p className="text-xs text-slate-500 bg-blue-50 p-3 rounded border border-blue-200">
                  <Lock size={12} className="inline mr-1" />
                  認証情報はお客様のアカウントでのみアクセス可能な形で保存されます。
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowXSettings(false)}
                className="flex-1 px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={saveXApiCredentials}
                className="flex-1 px-4 py-2 text-sm font-bold text-white bg-black rounded-lg hover:bg-slate-800 transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Facebook設定モーダル */}
      {showFacebookSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Send size={20} className="text-blue-600" />
                Facebook設定
              </h3>
              <button 
                onClick={() => setShowFacebookSettings(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <XIcon size={20} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">
                  Facebook App ID
                </label>
                <input
                  type="text"
                  value={facebookAppId}
                  onChange={(e) => setFacebookAppId(e.target.value)}
                  placeholder="例: 1234567890123456"
                  className="w-full p-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-slate-50 focus:bg-white transition-colors text-black"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Facebook開発者向けサイトで取得したApp IDを入力してください。
                  <br />
                  <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    Facebook開発者向けサイト
                  </a>
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowFacebookSettings(false)}
                className="flex-1 px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={saveFacebookAppId}
                className="flex-1 px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}