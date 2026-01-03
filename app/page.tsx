'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, BarChart3, RefreshCcw, Send, Copy, Check, Sparkles, Zap,
  Loader2, Settings, Pencil, ChevronRight, Lightbulb, Upload,
  ChevronDown, User as UserIcon, MessageCircle, Smile, ExternalLink, AlignLeft, Mail, Lock, CreditCard, LogOut,
  X as XIcon, Trash2, BookOpen, Menu, HelpCircle
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
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const usageRef = doc(db, 'artifacts', appId, 'users', userId, 'daily_usage', today);
  
  let currentCount = 0;
  try {
    const usageSnap = await getDoc(usageRef);
    if (usageSnap.exists()) {
      currentCount = usageSnap.data().count || 0;
    }
  } catch (error) {
    console.error("Usage check failed:", error);
  }

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

const analyzeCsvAndGenerateThemes = async (csvData: string, token: string, userId: string) => {
  const prompt = `
    あなたはSNSコンサルタントです。以下の[過去の投稿CSVデータ]を分析してください。

    【タスク1: パーソナリティ分析】
    投稿内容から、このユーザーの以下の特徴を推測・言語化してください。
    - persona: 一人称と名前を「・」で区切って表記（例: 私・らくらスタイル、僕・投稿主）。一人称は「私」「僕」「俺」「自分」「わたくし」「あたし」などから選択。名前は投稿主の実際の名前やブランド名を入れる。文体や口調は含めない。
    - emoji: 絵文字の使用傾向
    - character: 投稿者の性格・特徴・興味・話の構成をじっくり分析し、200文字以上でしっかりと傾向を分析してまとめる。最後に必ず「AIっぽさや決まりきった一般論は避ける」「#や*を本文に決して使わない」を含めること。
      
    【タスク2: テーマ提案】
    エンゲージメント、favorite_count、view_countが多い投稿の傾向（勝ちパターン）じっくり分析し、
    次回投稿すべき**「テーマ案を3つ」**作成してください。
    
    【重要】CSVデータにTitle列がある場合、投稿にはタイトルが含まれています。タイトルの傾向も分析し、同様の傾向のタイトルを生成するようにしてください。

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
    ${csvData}
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

    return JSON.parse(cleanText);
  } catch (error: any) {
    console.error("Analysis failed:", error);
    throw new Error(error.message || "分析に失敗しました。もう一度試してみてください。");
  }
};

const generateTrendThemes = async (token: string, userId: string) => {
  const prompt = `
    あなたはトレンドマーケターです。
    **現在日時(${new Date().toLocaleDateString()})、季節、SNSでの一般的な流行**を考慮し、
    多くの反応が見込める**「おすすめテーマ案を3つ」**作成してください。
      
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

const generatePost = async (mode: string, topic: string, inputData: any, settings: any, token: string, userId: string, hasTitle: boolean = false) => {
  const personaInstruction = `
    【パーソナリティ設定】
    - 一人称・名前: ${settings.persona || settings.style || '私・投稿主'}（一人称と名前を「・」で区切った形式）
    - 絵文字の使い方: ${settings.emoji}
    - 性格・特徴: ${settings.character}

    【重要: 出力ルール（必ず守ること）】
    1. 文字数: **絶対に${settings.minLength}文字以上、${settings.maxLength}文字以内**にしてください。これは厳密な要件です。文字数を数えて必ず範囲内に収めてください。
    2. 禁止文字: 文中で '*'（アスタリスク）や '#'（シャープ/ハッシュ）は絶対に使用しないでください。これは絶対に厳守してください。
       - Markdownの見出し記号（#）や強調（**）、箇条書き（-）は不要です。これは絶対に厳守してください。
       - 箇条書き等の装飾にもこれらを使わないでください。これは絶対に厳守してください。
    3. ハッシュタグ: 投稿の最後にハッシュタグを記載する場合のみ '#' を使用してください。文中の使用は禁止です。
    4. 文字数確認: 生成後、必ず文字数を確認し、範囲外の場合は調整してください。

    この設定になりきってAIっぽくならない文章の投稿を作成してください。
  `;

  let prompt = "";
  if (mode === 'rewrite') {
    prompt = `
      ${personaInstruction}
      以下の[元の投稿]を、上記設定を活かして、より魅力的に書き直してください。
      [元の投稿]: ${inputData.sourcePost}
    `;
  } else {
    const titleInstruction = hasTitle 
      ? '\n【重要】過去の投稿にタイトルが含まれているため、投稿にもタイトルを含めてください。タイトルは1行目に記載し、タイトルと本文の間には必ず改行を2つ（空行1つ）入れてください。形式は「タイトル\n\n本文」としてください。'
      : '';
    prompt = `
      ${personaInstruction}
      以下の[テーマ]について、共感を呼ぶ魅力的なSNS投稿を作成してください。
      ハッシュタグも適切に含めてください（文末のみ）。${titleInstruction}
      [テーマ]: ${topic}
    `;
  }

  try {
    return await callSecureApi(prompt, token, 'post', userId);
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
const SettingsDropdown = ({ user, isSubscribed, onLogout, onManageSubscription, onUpgrade, isPortalLoading, onOpenXSettings, csvCacheExpiry, blogCacheExpiry, csvUploadDate, blogUploadDate, blogUrls, blogUrlDates, onDeleteBlogUrl }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  // 日付をフォーマットする関数
  const formatDate = (timestamp: number | null): string => {
    if (!timestamp) return 'なし';
    const date = new Date(timestamp);
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

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
          
          <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/50 space-y-1">
            {csvUploadDate && (
              <p className="text-[10px] text-slate-500">
                Xデータ取込み日時: {csvUploadDate}
              </p>
            )}
            {csvCacheExpiry && (
              <p className="text-[10px] text-slate-500">
                Xデータ有効期限: {formatDate(csvCacheExpiry)}
              </p>
            )}
            {blogUrls && blogUrls.length > 0 && (
              <>
                {blogUrls.map((url: string, index: number) => (
                  <div key={index} className="space-y-0.5 flex items-start justify-between gap-2 group">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-slate-500 truncate" title={url}>
                        URL取込み日時 ({index + 1}): {blogUrlDates[url] || '不明'}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate" title={url}>
                        {url}
                      </p>
                    </div>
                    {onDeleteBlogUrl && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteBlogUrl(url);
                        }}
                        className="opacity-0 group-hover:opacity-100 px-2 py-1 text-[10px] font-bold text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-all flex items-center gap-1"
                        title="このURLを削除"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
            {blogCacheExpiry && (
              <p className="text-[10px] text-slate-500">
                URLデータ有効期限: {formatDate(blogCacheExpiry)}
              </p>
            )}
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
  const handleChange = async (key: string, value: string | number) => {
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
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4 shadow-sm mt-4">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100 text-slate-700 font-bold text-sm">
        <Settings size={16} className="text-[#066099]" /><span>パーソナリティ設定</span>
      </div>
      <ComboboxInput label="一人称・名前" icon={MessageCircle} value={settings.persona || settings.style || ''} onChange={(val: string) => handleChange('persona', val)} options={["私・投稿主",  "僕・投稿主","俺・投稿主", "自分・投稿主", "わたくし・投稿主", "あたし・投稿主"]} placeholder="例: 私・らくらスタイル" />
      <ComboboxInput label="絵文字の使い方" icon={Smile} value={settings.emoji} onChange={(val: string) => handleChange('emoji', val)} options={["適度に使用（文末に1つなど）", "多用する（賑やかに）", "一切使用しない", "特定の絵文字を好む（✨🚀）", "顔文字（( ^ω^ )）を使用"]} placeholder="例: 適度に使用" />
      <ComboboxInput label="性格・特徴" icon={UserIcon} value={settings.character} onChange={(val: string) => handleChange('character', val)} options={["SNS初心者\n頑張って更新している\n\nAIっぽさや決まりきった一般論は避ける\n#や*を本文に決して使わない", "30代エンジニア\n技術トレンドに敏感\n\nAIっぽさや決まりきった一般論は避ける\n#や*を本文に決して使わない", "熱血広報担当\n自社製品への愛が強い\n\nAIっぽさや決まりきった一般論は避ける\n#や*を本文に決して使わない", "トレンドマーケター\n分析的で冷静な視点\n\nAIっぽさや決まりきった一般論は避ける\n#や*を本文に決して使わない", "毒舌批評家\n本質を突くのが得意\n\nAIっぽさや決まりきった一般論は避ける\n#や*を本文に決して使わない", "丁寧な暮らし系\n穏やかで情緒的\n\nAIっぽさや決まりきった一般論は避ける\n#や*を本文に決して使わない"]} placeholder="例: 30代エンジニア" multiline={true} />
      
      {/* 文字数設定エリア */}
      <div className="pt-2 border-t border-slate-100">
        <label className="block text-xs font-bold text-slate-500 mb-2 flex items-center gap-1">
          <AlignLeft size={12} /> 文字数目安（全角文字の場合誤差が生じます）
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-[10px] text-slate-400 block mb-1">最小</span>
            <input 
              type="number" 
              value={settings.minLength} 
              onChange={(e) => handleChange('minLength', parseInt(e.target.value) || 50)}
              className="w-full p-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none text-right bg-slate-50 focus:bg-white transition-colors text-black"
            />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block mb-1">最大</span>
            <input 
              type="number" 
              value={settings.maxLength} 
              onChange={(e) => handleChange('maxLength', parseInt(e.target.value) || 150)}
              className="w-full p-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none text-right bg-slate-50 focus:bg-white transition-colors text-black"
            />
          </div>
        </div>
      </div>

      {mode === 'mypost' && <p className="text-[10px] text-slate-400 leading-tight">※CSVデータに基づいてこれらの設定が自動更新されます。</p>}
    </div>
  );
};

const ResultCard = ({ content, isLoading, error, onChange, user, onPostToX, isPostingToX, xAccessToken, showPostAnalysis }: any) => {
  const [copied, setCopied] = useState(false);
  const [isUpgradeLoading, setIsUpgradeLoading] = useState(false); 
  const [showPostModal, setShowPostModal] = useState(false);
  const [selectedDestinations, setSelectedDestinations] = useState<PostDestination[]>([]);


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
      <div className="flex-1 p-6 relative">
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
          <textarea
            className="w-full h-full min-h-[400px] whitespace-pre-wrap text-slate-800 leading-relaxed font-sans text-base animate-in fade-in duration-500 bg-transparent border-none focus:ring-0 resize-y outline-none"
            value={content}
            onChange={(e) => onChange && onChange(e.target.value)}
            placeholder="生成された内容がここに表示されます。直接編集も可能です。"
          />
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
  
  // ブログ・noteデータ
  const [blogData, setBlogData] = useState<string>('');
  const [blogUploadDate, setBlogUploadDate] = useState<string | null>(null);
  
  // 分析用のデータソース選択
  const [useCsvData, setUseCsvData] = useState<boolean>(true);
  const [useBlogData, setUseBlogData] = useState<boolean>(false);
  
  // マイ投稿分析用の状態（選択されたデータソースから生成）
  const [parsedPosts, setParsedPosts] = useState<any[]>([]);
  const [selectedBlogUrlsForDisplay, setSelectedBlogUrlsForDisplay] = useState<Set<string>>(new Set()); // 表示用に選択されたURL
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sortBy, setSortBy] = useState<string>('engagement-desc');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showPostAnalysis, setShowPostAnalysis] = useState(false);
  const [excludeRTAndReplies, setExcludeRTAndReplies] = useState(false);
  const [csvImportMode, setCsvImportMode] = useState<'replace' | 'append'>('replace');
  const [showCsvImportModal, setShowCsvImportModal] = useState(false);
  const [pendingCsvData, setPendingCsvData] = useState<string>('');
  const [isCsvLoading, setIsCsvLoading] = useState(false);
  
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
  const [showBlogImport, setShowBlogImport] = useState(false);
  
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

  // CSVを分割してFirestoreに保存する関数（1MB以上のデータは自動で800KBずつ分割）
  const saveCsvToFirestore = async (userId: string, csvData: string, dateStr: string): Promise<string> => {
    const ONE_MB = 1024 * 1024; // 1MB
    const CHUNK_SIZE = 800 * 1024; // 800KB（Firestoreの1MB制限を考慮して余裕を持たせる）
    const FIRESTORE_MAX_FIELD_SIZE = 1048487; // Firestoreの1つのフィールドの最大サイズ（約1MB）
    const dataSize = new Blob([csvData]).size;
    
    // 1MB以上の場合は自動で800KBずつ分割して保存
    if (dataSize >= ONE_MB) {
      console.log(`CSVデータサイズ: ${(dataSize / 1024 / 1024).toFixed(2)} MB → 800KBずつ自動分割して保存`);
      
      // CSVをヘッダーとデータ行に分割
      const lines = csvData.split('\n');
      if (lines.length < 2) {
        throw new Error('CSVデータが不正です');
      }
      
      const header = lines[0];
      const dataLines = lines.slice(1);
      
      // チャンクに分割（各チャンクは800KB以下）
      const chunks: string[] = [];
      let currentChunk = header + '\n';
      let currentSize = new Blob([currentChunk]).size;
      
      for (const line of dataLines) {
        const lineWithNewline = line + '\n';
        const lineSize = new Blob([lineWithNewline]).size;
        
        // 現在のチャンクに追加すると800KBを超える場合
        if (currentSize + lineSize > CHUNK_SIZE && currentChunk !== header + '\n') {
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
      
      console.log(`${chunks.length}個のチャンクに分割しました（各チャンクは約800KB）`);
      
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
      
      // 各チャンクをFirestoreに保存
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
      
      await setDoc(doc(db, 'users', userId), saveData, { merge: true });
      
      console.log(`分割保存完了: ${chunks.length}個のチャンクをFirestoreに保存しました`);
      
      return dateStr;
    } else {
      // 1MB未満は通常通り保存
      await setDoc(doc(db, 'users', userId), {
        csvData: csvData,
        csvUploadDate: dateStr,
        csvUpdatedTime: dateStr,
        csvIsSplit: false
      }, { merge: true });
      
      return dateStr;
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

  // ブログデータをFirestoreに保存（CSVデータと同様の分割機能付き）
  const saveBlogDataToFirestore = async (userId: string, blogData: string, dateStr: string): Promise<string> => {
    const ONE_MB = 1024 * 1024;
    const CHUNK_SIZE = 800 * 1024;
    const FIRESTORE_MAX_FIELD_SIZE = 1048487;
    const dataSize = new Blob([blogData]).size;
    
    if (dataSize >= ONE_MB) {
      console.log(`ブログデータサイズ: ${(dataSize / 1024 / 1024).toFixed(2)} MB → 800KBずつ自動分割して保存`);
      
      const lines = blogData.split('\n');
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
      
      await setDoc(doc(db, 'users', userId), saveData, { merge: true });
      console.log(`分割保存完了: ${chunks.length}個のチャンクをFirestoreに保存しました`);
      
      return dateStr;
    } else {
      await setDoc(doc(db, 'users', userId), {
        blogData: blogData,
        blogUploadDate: dateStr,
        blogUpdatedTime: dateStr,
        blogIsSplit: false
      }, { merge: true });
      
      return dateStr;
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
        return chunks.join('');
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
  const handleFetchSitemap = async () => {
    if (!sitemapUrl || !user) return;
    
    setIsSitemapLoading(true);
    setBlogImportProgress('サイトマップからURL一覧を取得中...');
    
    try {
      const response = await fetch('/api/blog/sitemap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sitemapUrl: sitemapUrl.trim(),
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'サイトマップの取得に失敗しました');
      }
      
      if (!data.urls || data.urls.length === 0) {
        throw new Error('サイトマップからURLが見つかりませんでした');
      }
      
      setSitemapUrls(data.urls);
      setSelectedUrls(new Set()); // 選択をリセット
      setBlogImportProgress(`${data.urls.length}件のURLを取得しました`);
    } catch (error: any) {
      console.error('Sitemap fetch error:', error);
      alert(`サイトマップの取得に失敗しました: ${error.message}`);
      setBlogImportProgress('');
    } finally {
      setIsSitemapLoading(false);
    }
  };

  // 選択されたURLを取り込む
  const handleImportSelectedUrls = async (urlsToImport: string[] = []) => {
    if (!user) return;
    
    const urls = urlsToImport.length > 0 ? urlsToImport : Array.from(selectedUrls);
    if (urls.length === 0) {
      alert('取り込むURLを選択してください');
      return;
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
      
      // 各URLから記事を取得（並列処理）
      const CONCURRENT_LIMIT = 3;
      for (let i = 0; i < urls.length; i += CONCURRENT_LIMIT) {
        const batch = urls.slice(i, i + CONCURRENT_LIMIT);
        const batchPromises = batch.map(async (url) => {
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
              }),
            });
            
            const data = await response.json();
            if (response.ok && data.csv) {
              // CSVから投稿を抽出
              const lines = data.csv.split('\n');
              if (lines.length > 1) {
                const csvLine = lines[1]; // ヘッダーを除く最初の行
                const parts = csvLine.split(',');
                if (parts.length >= 6) {
                  return {
                    title: parts[1]?.replace(/^"|"$/g, '') || '',
                    content: parts[2]?.replace(/^"|"$/g, '') || '',
                    date: parts[0] || '',
                    url: parts[5]?.replace(/^"|"$/g, '') || url,
                    category: parts[3]?.replace(/^"|"$/g, '') || '',
                    tags: parts[4]?.replace(/^"|"$/g, '') || '',
                  };
                }
              }
            }
            return null;
          } catch (error) {
            console.error(`Failed to import ${url}:`, error);
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        const validPosts = batchResults.filter(p => p !== null) as any[];
        allPosts.push(...validPosts);
        
        setBlogImportProgress(`${Math.min(i + CONCURRENT_LIMIT, urls.length)}/${urls.length}件のURLを処理中...`);
        
        // バッチ間で少し待機
        if (i + CONCURRENT_LIMIT < urls.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      if (allPosts.length === 0) {
        throw new Error('記事の取得に失敗しました');
      }
      
      // CSV形式に変換
      const csvRows = [
        'Date,Title,Content,Category,Tags,URL',
        ...allPosts.map(post => {
          const date = post.date;
          const title = `"${post.title.replace(/"/g, '""')}"`;
          const content = `"${post.content.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
          const category = `"${post.category.replace(/"/g, '""')}"`;
          const tags = `"${post.tags.replace(/"/g, '""')}"`;
          const url = `"${post.url}"`;
          return `${date},${title},${content},${category},${tags},${url}`;
        }),
      ];
      
      const csv = csvRows.join('\n');
      
      // 既存のブログデータがある場合は追加
      let finalBlogData: string;
      if (blogData && blogData.trim()) {
        const existingLines = blogData.split('\n');
        const newLines = csv.split('\n');
        if (existingLines.length > 0 && newLines.length > 1) {
          finalBlogData = existingLines[0] + '\n' + existingLines.slice(1).join('\n') + '\n' + newLines.slice(1).join('\n');
        } else {
          finalBlogData = csv;
        }
      } else {
        finalBlogData = csv;
      }
      
      // Firestoreに保存
      const now = new Date();
      const dateStr = now.toLocaleString('ja-JP', { 
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' 
      });
      
      await saveBlogDataToFirestore(user.uid, finalBlogData, dateStr);
      setBlogData(finalBlogData);
      setBlogUploadDate(dateStr);
      
      // 取り込んだURLを記録
      const updatedBlogUrls = [...blogUrls];
      const updatedBlogUrlDates = { ...blogUrlDates };
      
      for (const url of urls) {
        if (!updatedBlogUrls.includes(url)) {
          updatedBlogUrls.push(url);
        }
        updatedBlogUrlDates[url] = dateStr;
      }
      
      setBlogUrls(updatedBlogUrls);
      setBlogUrlDates(updatedBlogUrlDates);
      
      // FirestoreにURLの一覧と取込み日時を保存
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        blogUrls: updatedBlogUrls,
        blogUrlDates: updatedBlogUrlDates
      }, { merge: true });
      
      setBlogImportProgress(`${allPosts.length}件の記事を取得しました`);
      setSelectedUrls(new Set()); // 選択をリセット
    } catch (error: any) {
      console.error('Blog import error:', error);
      alert(`ブログの取り込みに失敗しました: ${error.message}`);
    } finally {
      setIsBlogImporting(false);
      setBlogImportProgress('');
    }
  };

  // 個別URLの更新（再取得）
  const handleUpdateUrl = async (url: string) => {
    await handleImportSelectedUrls([url]);
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
  const extractTextFromWordPress = (html: string): string => {
    if (!html) return '';
    
    let text = html;
    
    // WordPressのブロックコメントを除去（<!-- wp:xxx --> や <!-- /wp:xxx -->）
    text = text.replace(/<!--\s*\/?wp:[^>]+-->/g, '');
    
    // HTMLタグを除去
    text = text.replace(/<[^>]+>/g, '');
    
    // HTMLエンティティをデコード（ブラウザ環境の場合）
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = text;
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
    
    // 連続する空白や改行を整理
    text = text.replace(/\s+/g, ' ').trim();
    text = text.replace(/\n\s*\n/g, '\n');
    
    return text;
  };

  // CSV行をパースするヘルパー関数（カンマ区切り、ダブルクォート対応）
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
    const headers = headerValues.map((h: string) => {
      // ヘッダーからダブルクォートを除去
      let header = h.trim();
      if (header.startsWith('"') && header.endsWith('"')) {
        header = header.slice(1, -1);
      }
      header = header.replace(/""/g, '"');
      return header;
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
    const dateKeys = ['Date', 'date', '日付', '投稿日', 'Posted At'];
    
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
    
    // text列のインデックスを取得
    const textColumnIndex = headers.findIndex((h: string) => h.toLowerCase() === 'text');
    
    // text列が存在する場合、最初の数値列のインデックスを事前に計算（パフォーマンス最適化）
    let firstNumericIndex = headers.length;
    if (textColumnIndex >= 0) {
      const numericIndicesAfterText = Array.from(numericColumnIndices).filter(idx => idx > textColumnIndex);
      if (numericIndicesAfterText.length > 0) {
        firstNumericIndex = Math.min(...numericIndicesAfterText);
      }
    }
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const values = parseCsvRow(row);
      
      // オブジェクトに変換
      const post: any = {};
      const headerCount = headers.length;
      
      // text列が存在する場合、元の行データから直接text列を抽出
      if (textColumnIndex >= 0) {
        let textValue = '';
        
        // シンプルな方法：最初のカンマの後から、,jaの前までを取得
        // text列の内容は、'IDの数字',から,jaの間の文字列
        const firstCommaIndex = row.indexOf(',');
        const jaCommaIndex = row.indexOf(',ja');
        
        if (firstCommaIndex >= 0 && jaCommaIndex > firstCommaIndex) {
          // 最初のカンマの次の文字から、,jaの前までを抽出
          textValue = row.slice(firstCommaIndex + 1, jaCommaIndex);
          
          // 先頭と末尾のダブルクォートを除去
          if (textValue.startsWith('"') && textValue.endsWith('"') && textValue.length >= 2) {
            textValue = textValue.slice(1, -1).replace(/""/g, '"');
          }
          // 前後の空白を除去
          textValue = textValue.trim();
        }
        
        // デバッグログ（最初の5行のみ）
        if (i <= 5) {
          console.log(`行${i}: firstCommaIndex =`, firstCommaIndex, 'jaCommaIndex =', jaCommaIndex, 'textValue =', textValue);
        }
        
        // 大文字小文字に関わらず取得できるように、両方のキーで設定
        post[headers[textColumnIndex]] = textValue;
        post['text'] = textValue;
        post['Text'] = textValue;
      }
      
      // すべての列を処理
      for (let j = 0; j < headerCount; j++) {
        // text列が結合処理された場合、結合範囲内の列はスキップ
        if (textColumnIndex >= 0 && j === textColumnIndex) {
          // text列は既に処理済み
          continue;
        }
        if (textColumnIndex >= 0 && j > textColumnIndex && j < firstNumericIndex) {
          // text列の結合範囲内はスキップ
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
      
      // タイトルを取得
      let title = '';
      for (const key of titleKeys) {
        const val = post[key];
        if (val !== undefined && val !== '') {
          title = String(val);
          break;
        }
      }
      
      // 投稿内容を取得（XのCSVデータの場合は'text'列のみを使用）
      let content = '';
      
      // text列が存在する場合は、必ずtext列のみを使用（他の列は無視）
      if (hasTextColumn && textColumnIndex >= 0) {
        // text列の値を取得（複数のキーを試す）
        const textVal = post['text'] || post['Text'] || post[headers[textColumnIndex]];
        
        // デバッグログ（最初の5行のみ）
        if (i <= 5) {
          console.log(`行${i}: hasTextColumn =`, hasTextColumn, 'textColumnIndex =', textColumnIndex, 'textVal =', textVal, 'post[text] =', post['text'], 'post[Text] =', post['Text'], 'post[headers[textColumnIndex]] =', post[headers[textColumnIndex]]);
        }
        
        if (textVal !== undefined && textVal !== null && textVal !== '') {
          // XのCSVデータのtext列はそのまま使用（WordPress処理は不要）
          content = String(textVal).trim();
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
              // ブログデータ（Content列など）の場合はWordPress処理を適用
              const extractedContent = extractTextFromWordPress(rawContent);
              if (extractedContent.trim()) {
                content = extractedContent;
                break;
              }
            }
          }
        }
      }
      
      // 日付を取得
      let date = '';
      for (const key of dateKeys) {
        const val = post[key];
        if (val !== undefined && val !== '') {
          date = String(val);
          break;
        }
      }
      
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
      
      // contentが空でない場合のみ投稿を追加（ハッシュタグだけの場合は後で除外）
      if (content && content.trim()) {
        const trimmedContent = content.trim();
        // ハッシュタグだけ（#と空白のみ）の場合は除外
        if (!trimmedContent.match(/^[#\s]+$/)) {
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
            rawData: post
          });
        }
      }
    }
    
    return posts;
  };

  const [trendThemes, setTrendThemes] = useState<string[]>([]);
  const [myPostThemes, setMyPostThemes] = useState<string[]>([]);
  
  const [isThemesLoading, setIsThemesLoading] = useState(false);
  
  const [result, setResult] = useState('');
  const [isPostLoading, setIsPostLoading] = useState(false);
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
    mypost: { persona: '私・投稿主', emoji: '要点を強調するために使用', character: 'SNS初心者。\n丁寧な言葉遣いで、分かりやすく簡潔に表現する。\n\nAIっぽさや決まりきった一般論は避ける\n#や*を本文に決して使わない', minLength: 50, maxLength: 150 },
    trend: { persona: '私・投稿主', emoji: '要点を強調するために使用', character: 'SNS初心者。\n丁寧な言葉遣いで、分かりやすく簡潔に表現する。\n\nAIっぽさや決まりきった一般論は避ける\n#や*を本文に決して使わない', minLength: 50, maxLength: 150 },
    rewrite: { persona: '私・投稿主', emoji: '要点を強調するために使用', character: 'SNS初心者。\n丁寧な言葉遣いで、分かりやすく簡潔に表現する。\n\nAIっぽさや決まりきった一般論は避ける\n#や*を本文に決して使わない', minLength: 50, maxLength: 150 }
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
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      if (text) {
        // 既存のデータがある場合はモーダルを表示
        if (parsedPosts.length > 0) {
          setPendingCsvData(text);
          setShowCsvImportModal(true);
        } else {
          // 既存データがない場合は直接書き換え
          await applyCsvData(text, 'replace');
        }
      }
      event.target.value = ''; 
    };
    reader.readAsText(file);
  };

  const applyCsvData = async (csvText: string, mode: 'replace' | 'append') => {
    if (!user) return;
    
    setIsCsvLoading(true);
    const startTime = performance.now();
    
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
        if (isTruncated) {
          alert(`取込み可能なデータ量（${parsed.length}件、${sizeInMB} MB）を取り込みました。\n\n元のデータが大きすぎたため、一部のデータは取り込まれていません。`);
        } else {
          alert(`${parsed.length}件のデータ（${sizeInMB} MB）を取り込みました。`);
        }
      } catch (saveError: any) {
        console.error("Firestore保存エラー（部分的な保存を試みます）:", saveError);
        
        // 保存エラーが発生した場合でも、メモリ上のデータは保持
        const sizeInMB = (dataSize / 1024 / 1024).toFixed(2);
        alert(`取込み可能なデータ量（${parsed.length}件、${sizeInMB} MB）を取り込みました。\n\n保存時にエラーが発生しましたが、メモリ上にはデータが保持されています。`);
      }
    } catch (err: any) {
      console.error("CSV処理エラー:", err);
      
      // パースできたデータがあれば、それを使用
      if (parsed.length > 0) {
        const sizeInMB = (dataSize > 0 ? dataSize : new Blob([truncatedData || csvData]).size) / 1024 / 1024;
        alert(`取込み可能なデータ量（${parsed.length}件、${sizeInMB.toFixed(2)} MB）を取り込みました。\n\n一部のデータは取り込まれていない可能性があります。`);
      } else {
        alert(`CSVデータの取り込みに失敗しました: ${err.message || '不明なエラー'}`);
      }
    } finally {
      setIsCsvLoading(false);
      setShowCsvImportModal(false);
      setPendingCsvData('');
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
          
          // 取り込んだURLの一覧を読み込み
          if (data.blogUrls && Array.isArray(data.blogUrls)) {
            setBlogUrls(data.blogUrls);
          }
          if (data.blogUrlDates && typeof data.blogUrlDates === 'object') {
            setBlogUrlDates(data.blogUrlDates);
          }
          
          // 🔥 修正: サブスク状態をロード
          if (data.isSubscribed) setIsSubscribed(true);
          else setIsSubscribed(false);
          // 🔥 Facebook App IDをロード
          if (data.facebookAppId) setFacebookAppId(data.facebookAppId);
          // 🔥 X API認証情報をロード（平文）
          if (data.xApiKey) setXApiKey(data.xApiKey);
          if (data.xApiKeySecret) setXApiKeySecret(data.xApiKeySecret);
          if (data.xAccessToken) setXAccessToken(data.xAccessToken);
          if (data.xAccessTokenSecret) setXAccessTokenSecret(data.xAccessTokenSecret);
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
                  // characterの最後に注意事項を追加（まだ含まれていない場合）
                  character: (modeSettings.character && typeof modeSettings.character === 'string' &&
                    (modeSettings.character.includes('AIっぽさ') || modeSettings.character.includes('#や*')))
                      ? modeSettings.character
                      : (modeSettings.character && typeof modeSettings.character === 'string' ? modeSettings.character : '') + '\n\nAIっぽさや決まりきった一般論は避ける\n#や*を本文に決して使わない',
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

  // 選択されたデータソースから分析用データを生成
  useEffect(() => {
    const posts: any[] = [];
    
    if (useCsvData && csvData) {
      const defaultCsv = 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200';
      if (csvData !== defaultCsv) {
        const csvPosts = parseCsvToPosts(csvData);
        posts.push(...csvPosts);
      }
    }
    
    if (useBlogData && blogData) {
      const blogPosts = parseCsvToPosts(blogData);
      // 選択されたURLの投稿だけをフィルタリング
      if (selectedBlogUrlsForDisplay.size > 0) {
        const filteredBlogPosts = blogPosts.filter(post => {
          if (post.rawData && post.rawData.URL) {
            return selectedBlogUrlsForDisplay.has(post.rawData.URL);
          }
          return false;
        });
        posts.push(...filteredBlogPosts);
      } else {
        // 選択されていない場合はすべて表示
        posts.push(...blogPosts);
      }
    }
    
    setParsedPosts(posts);
  }, [csvData, blogData, useCsvData, useBlogData, selectedBlogUrlsForDisplay]);

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
      
      // 元のデータからも削除
      if (useCsvData && csvData) {
        // CSVデータから該当する行を削除
        const lines = csvData.split('\n');
        const header = lines[0];
        const dataLines = lines.slice(1);
        
        // rawDataを使って該当する行を特定
        const filteredLines = dataLines.filter((line, index) => {
          // rawDataのインデックスと一致する行を削除
          // 簡易的な方法: 投稿の内容が含まれている行を削除
          if (postToDelete.rawData) {
            // rawDataの内容と一致する行を探す
            const lineContent = line.toLowerCase();
            const postContent = postToDelete.content.toLowerCase().substring(0, 50);
            // 完全一致ではなく、部分一致で判定（より確実な方法が必要な場合は改善が必要）
            return !lineContent.includes(postContent);
          }
          return true;
        });
        
        const updatedCsvData = [header, ...filteredLines].join('\n');
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
      } else if (useBlogData && blogData) {
        // ブログデータから該当する投稿を削除
        // ブログデータはCSV形式なので、同様の処理
        const lines = blogData.split('\n');
        const header = lines[0];
        const dataLines = lines.slice(1);
        
        const filteredLines = dataLines.filter((line) => {
          if (postToDelete.rawData && postToDelete.rawData.URL) {
            // URLが一致する行を削除
            const lineUrl = line.match(/"([^"]+)"/g)?.[5]; // URLは6番目のカラム（0-indexedで5）
            if (lineUrl) {
              const url = lineUrl.replace(/"/g, '');
              return url !== postToDelete.rawData.URL;
            }
          }
          // rawDataがない場合は、内容で判定
          const lineContent = line.toLowerCase();
          const postContent = postToDelete.content.toLowerCase().substring(0, 50);
          return !lineContent.includes(postContent);
        });
        
        const updatedBlogData = [header, ...filteredLines].join('\n');
        setBlogData(updatedBlogData);
        
        // Firestoreに保存
        await setDoc(doc(db, 'users', user.uid), {
          blogData: updatedBlogData
        }, { merge: true });
      }
      
      alert('投稿を削除しました');
    } catch (error) {
      console.error('投稿の削除に失敗:', error);
      alert('投稿の削除に失敗しました');
    }
  };

  // 特定のブログURLを削除
  const handleDeleteBlogUrl = async (urlToDelete: string) => {
    if (!user) return;
    
    if (!confirm(`このURLを削除しますか？\n${urlToDelete}\n\nこの操作は取り消せません。`)) {
      return;
    }
    
    try {
      // ブログURL一覧から削除
      const updatedBlogUrls = blogUrls.filter(url => url !== urlToDelete);
      const updatedBlogUrlDates = { ...blogUrlDates };
      delete updatedBlogUrlDates[urlToDelete];
      
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
        // rawDataにURLが含まれているかチェック
        if (post.rawData && post.rawData.URL) {
          return post.rawData.URL !== urlToDelete;
        }
        return true;
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
        // 残りのURLのデータを再取得する必要がある場合は、ここで処理
        // 現在は、parsedPostsから該当URLのデータを削除するだけ
      }
      
      alert('URLを削除しました');
    } catch (error) {
      console.error('URLの削除に失敗:', error);
      alert('URLの削除に失敗しました');
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
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { 
        xApiKey, 
        xApiKeySecret,
        xAccessToken,
        xAccessTokenSecret
      }, { merge: true });
      alert('X API認証情報を保存しました');
      setShowXSettings(false);
    } catch (error) {
      console.error("X API認証情報の保存に失敗:", error);
      alert('保存に失敗しました');
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


  const handleUpdateThemes = async (mode: string) => {
    if (!user) { setError("ログインが必要です"); return; }
    setIsThemesLoading(true);
    setError('');
    setManualInput('');
    setSelectedTheme('');
    // 分析・更新ボタンを押したら分析・更新セクションを選択し、他を非表示
    if (mode === 'mypost') {
      setSelectedSection('analysis');
      setShowPostAnalysis(false);
      setShowBlogImport(false);
    }
    try {
      const token = await user.getIdToken(); 
      const userId = user.uid;
      if (mode === 'mypost') {
        const analysisResult = await analyzeCsvAndGenerateThemes(csvData, token, userId);
        setMyPostThemes(analysisResult.themes || []); 
        if (analysisResult.settings) {
          // styleをpersonaに変換し、characterの最後に注意事項を追加
          const migratedSettings = {
            ...analysisResult.settings,
            persona: analysisResult.settings.persona || analysisResult.settings.style || '私・投稿主',
            character: (analysisResult.settings.character && typeof analysisResult.settings.character === 'string' &&
              (analysisResult.settings.character.includes('AIっぽさ') || analysisResult.settings.character.includes('#や*')))
                ? analysisResult.settings.character
                : (analysisResult.settings.character && typeof analysisResult.settings.character === 'string' ? analysisResult.settings.character : '') + '\n\nAIっぽさや決まりきった一般論は避ける\n#や*を本文に決して使わない',
            // minLengthとmaxLengthも確実に含める
            minLength: analysisResult.settings.minLength || 50,
            maxLength: analysisResult.settings.maxLength || 150
          };
          // 状態を更新
          setAllSettings(prev => ({
            ...prev,
            mypost: { ...prev.mypost, ...migratedSettings }
          }));
          
          // マイ投稿分析後のパーソナリティ設定をFirestoreに保存
          // 既存の設定とマージして、mypostモードの設定を更新
          try {
            const userRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userRef);
            const currentData = userDoc.exists() ? userDoc.data() : {};
            const currentSettings = currentData.settings || {};
            
            // 既存のmypost設定とマージ（分析結果を優先）
            const updatedMypostSettings = {
              ...(currentSettings.mypost || {}),
              ...migratedSettings
            };
            
            await setDoc(userRef, {
              settings: {
                ...currentSettings,
                mypost: updatedMypostSettings
              }
            }, { merge: true });
            
            console.log("パーソナリティ設定を保存しました:", updatedMypostSettings);
          } catch (err) {
            console.error("パーソナリティ設定の保存に失敗:", err);
            alert("パーソナリティ設定の保存に失敗しました。設定は画面に表示されていますが、リロードすると元に戻る可能性があります。");
          }
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
                csvCacheExpiry={user ? getCsvCacheExpiry(user.uid) : null}
                blogCacheExpiry={getBlogCacheExpiry()}
                csvUploadDate={csvUploadDate}
                blogUploadDate={blogUploadDate}
                blogUrls={blogUrls}
                blogUrlDates={blogUrlDates}
                onDeleteBlogUrl={handleDeleteBlogUrl}
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
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      className="hidden" 
                      accept=".csv, .txt" 
                    />
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={handleCsvImportClick} 
                        disabled={isCsvLoading}
                        className="p-1.5 text-slate-500 hover:text-[#066099] hover:bg-slate-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed relative group" 
                        title="XのCSVデータ取込み"
                      >
                        {isCsvLoading ? (
                          <Loader2 size={16} className="animate-spin text-[#066099]" />
                        ) : (
                      <Upload size={16} />
                        )}
                    </button>
                      {csvData && csvData !== 'Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200' && (
                        <span className="text-xs text-slate-600 font-medium">
                          ({(() => {
                            try {
                              const parsed = parseCsvToPosts(csvData);
                              return parsed.length;
                            } catch {
                              return 0;
                            }
                          })()})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                    <button 
                        onClick={() => {
                          if (selectedSection === 'import') {
                            setSelectedSection(null);
                            setShowBlogImport(false);
                          } else {
                            setSelectedSection('import');
                            setShowBlogImport(true);
                            setShowPostAnalysis(false);
                          }
                        }}
                        disabled={isBlogImporting}
                        className={`p-1.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed relative group ${
                          selectedSection === 'import' 
                            ? 'text-[#066099] bg-slate-100' 
                            : 'text-slate-500 hover:text-[#066099] hover:bg-slate-100'
                        }`}
                        title="ブログ・noteのURL取込み"
                      >
                        {isBlogImporting ? (
                          <Loader2 size={16} className="animate-spin text-[#066099]" />
                        ) : (
                          <BookOpen size={16} />
                        )}
                      </button>
                      {blogData && blogData.trim() && (
                        <span className="text-xs text-slate-600 font-medium">
                          ({(() => {
                            try {
                              const parsed = parseCsvToPosts(blogData);
                              return parsed.length;
                            } catch {
                              return 0;
                            }
                          })()})
                        </span>
                      )}
                    </div>
                    <div className="hidden sm:block h-4 w-px bg-slate-300 mx-1"></div>
                    <button 
                      onClick={() => {
                        if (selectedSection === 'analysis') {
                          setSelectedSection(null);
                        } else {
                          setSelectedSection('analysis');
                          setShowBlogImport(false);
                          setShowPostAnalysis(false);
                        }
                        handleUpdateThemes('mypost');
                      }}
                      disabled={isThemesLoading}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1 font-bold shadow-sm w-full sm:w-auto ${
                        selectedSection === 'analysis'
                          ? 'bg-[#066099] text-white'
                          : 'bg-[#066099] hover:bg-[#055080] text-white'
                      }`}
                    >
                      {isThemesLoading ? <Loader2 size={12} className="animate-spin"/> : <Zap size={12}/>}
                      分析・更新
                    </button>
                    {parsedPosts.length > 0 && (
                      <>
                        <div className="hidden sm:block h-4 w-px bg-slate-300 mx-1"></div>
                        <button 
                          onClick={() => {
                            if (selectedSection === 'posts') {
                              setSelectedSection(null);
                              setShowPostAnalysis(false);
                            } else {
                              setSelectedSection('posts');
                              setShowPostAnalysis(true);
                              setShowBlogImport(false);
                            }
                          }}
                          className={`text-xs border px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 font-bold shadow-sm w-full sm:w-auto ${
                            selectedSection === 'posts'
                              ? 'bg-slate-100 border-slate-400 text-slate-800'
                              : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <BarChart3 size={12} />
                          投稿分析 ({parsedPosts.length})
                        </button>
                      </>
                    )}
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
                     トレンド更新
                   </button>
                )}
              </div>

              {/* マイ投稿分析: 投稿一覧 */}
              {activeMode === 'mypost' && showPostAnalysis && selectedSection === 'posts' && (
                <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <BarChart3 size={16} className="text-[#066099]" />
                      過去の投稿分析
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
                  
                  {/* データソース選択 */}
                  <div className="flex flex-col sm:flex-row gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useCsvData}
                        onChange={(e) => setUseCsvData(e.target.checked)}
                        className="w-4 h-4 text-[#066099] border-slate-300 rounded focus:ring-[#066099]"
                      />
                      <span className="text-sm text-slate-700">XのCSVデータ</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useBlogData}
                        onChange={(e) => setUseBlogData(e.target.checked)}
                        className="w-4 h-4 text-[#066099] border-slate-300 rounded focus:ring-[#066099]"
                      />
                      <span className="text-sm text-slate-700">ブログ・noteデータ</span>
                    </label>
                    {!useCsvData && !useBlogData && (
                      <p className="text-xs text-red-600">データソースを1つ以上選択してください</p>
                    )}
                  </div>
                  
                  {parsedPosts.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-4">
                      データがありません。CSVまたはブログ・noteデータを取り込んでください。
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
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {(() => {
                      // フィルタリングとソート
                      let filtered = parsedPosts.filter(post => {
                        // キーワード検索
                        if (!post.content.toLowerCase().includes(searchKeyword.toLowerCase())) {
                          return false;
                        }
                        // RTと返信の除外
                        if (excludeRTAndReplies) {
                          const content = post.content.trim();
                          // RT（リツイート）を除外（"RT @" で始まる、または "RT:" で始まる）
                          if (content.startsWith('RT @') || content.startsWith('RT:') || content.startsWith('rt @') || content.startsWith('rt:')) {
                            return false;
                          }
                          // 返信を除外（"@" で始まる）
                          if (content.startsWith('@')) {
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
                      
                      return filtered.map((post) => (
                        <div
                          key={post.id}
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
                                {post.date && (
                                  <span className="text-xs text-slate-500">{post.date}</span>
                                )}
                              </div>
                              <p className="text-sm text-slate-700 line-clamp-2">{post.content}</p>
                            </div>
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100">
                              <button
                                onClick={() => {
                                  setResult(post.content);
                                  // 投稿分析の一覧は閉じない
                                }}
                                className="px-3 py-1.5 text-xs font-bold text-white bg-[#066099] rounded-lg hover:bg-[#055080] transition-colors flex items-center gap-1"
                                title="この投稿を編集（全文）"
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
                      ));
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

              {/* ブログ取り込みUI */}
              {showBlogImport && activeMode === 'mypost' && selectedSection === 'import' && (
                <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 mb-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <BookOpen size={16} className="text-[#066099]" />
                      ブログ・note取り込み
                    </h3>
                    <button
                      onClick={() => {
                        setSelectedSection(null);
                        setShowBlogImport(false);
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
                    {/* サイトマップURL入力 */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          placeholder="サイトマップURLを入力（例: https://example.com/sitemap.xml）"
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
                        onClick={handleFetchSitemap}
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
                    
                    {blogImportProgress && (
                      <p className="text-sm text-slate-600">{blogImportProgress}</p>
                    )}
                    
                    {/* URL一覧表示と選択 */}
                    {sitemapUrls.length > 0 && (
                      <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-slate-700">
                            URL一覧 ({sitemapUrls.length}件)
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                if (selectedUrls.size === sitemapUrls.length) {
                                  setSelectedUrls(new Set());
                                } else {
                                  setSelectedUrls(new Set(sitemapUrls.map(u => u.url)));
                                }
                              }}
                              className="px-3 py-1 text-xs font-bold text-slate-600 bg-slate-100 rounded hover:bg-slate-200 transition-colors"
                            >
                              {selectedUrls.size === sitemapUrls.length ? 'すべて解除' : 'すべて選択'}
                            </button>
                            <button
                              onClick={() => handleImportSelectedUrls()}
                              disabled={isBlogImporting || selectedUrls.size === 0}
                              className="px-4 py-1 text-xs font-bold text-white bg-[#066099] rounded hover:bg-[#055080] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                              {isBlogImporting ? (
                                <>
                                  <Loader2 size={12} className="animate-spin" />
                                  取り込み中...
                                </>
                              ) : (
                                <>
                                  <Upload size={12} />
                                  選択したURLを取り込み ({selectedUrls.size}件)
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto space-y-1">
                          {sitemapUrls.map((item, index) => (
                            <label
                              key={index}
                              className="flex items-start gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedUrls.has(item.url)}
                                onChange={(e) => {
                                  const newSelected = new Set(selectedUrls);
                                  if (e.target.checked) {
                                    newSelected.add(item.url);
                                  } else {
                                    newSelected.delete(item.url);
                                  }
                                  setSelectedUrls(newSelected);
                                }}
                                className="mt-1 w-4 h-4 text-[#066099] border-slate-300 rounded focus:ring-[#066099]"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-slate-700 truncate" title={item.url}>
                                  {item.url}
                                </p>
                                {item.date && (
                                  <p className="text-[10px] text-slate-400">
                                    更新日: {item.date}
                                  </p>
                                )}
                                {item.title && (
                                  <p className="text-[10px] text-slate-500 truncate" title={item.title}>
                                    {item.title}
                                  </p>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* 取り込んだURLの一覧 */}
                    {blogUrls && blogUrls.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold text-slate-700">取り込んだURL一覧:</p>
                          <button
                            onClick={() => {
                              if (selectedBlogUrlsForDisplay.size === blogUrls.length) {
                                setSelectedBlogUrlsForDisplay(new Set());
                              } else {
                                setSelectedBlogUrlsForDisplay(new Set(blogUrls));
                              }
                            }}
                            className="px-2 py-1 text-[10px] font-bold text-slate-600 bg-slate-100 rounded hover:bg-slate-200 transition-colors"
                          >
                            {selectedBlogUrlsForDisplay.size === blogUrls.length ? 'すべて解除' : 'すべて選択'}
                          </button>
                        </div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {blogUrls.map((url: string, index: number) => (
                            <label
                              key={index}
                              className="flex items-center gap-2 text-xs bg-slate-50 p-2 rounded cursor-pointer hover:bg-slate-100"
                            >
                              <input
                                type="checkbox"
                                checked={selectedBlogUrlsForDisplay.has(url)}
                                onChange={(e) => {
                                  const newSelected = new Set(selectedBlogUrlsForDisplay);
                                  if (e.target.checked) {
                                    newSelected.add(url);
                                  } else {
                                    newSelected.delete(url);
                                  }
                                  setSelectedBlogUrlsForDisplay(newSelected);
                                }}
                                className="w-4 h-4 text-[#066099] border-slate-300 rounded focus:ring-[#066099]"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-slate-600 truncate" title={url}>
                                  {index + 1}. {url}
                                </p>
                                {blogUrlDates[url] && (
                                  <p className="text-slate-400 text-[10px]">
                                    取込み日時: {blogUrlDates[url]}
                                  </p>
                                )}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpdateUrl(url);
                                }}
                                disabled={isBlogImporting}
                                className="px-2 py-1 text-[10px] font-bold text-white bg-[#066099] rounded hover:bg-[#055080] transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                              >
                                {isBlogImporting ? '更新中...' : '更新'}
                              </button>
                            </label>
                          ))}
                        </div>
                        {selectedBlogUrlsForDisplay.size > 0 && (
                          <p className="text-xs text-slate-500 mt-2">
                            {selectedBlogUrlsForDisplay.size}件のURLが選択されています（選択されたURLの内容のみ表示されます）
                          </p>
                        )}
                      </div>
                    )}
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
                        取込み方法を選択してください。
                      </p>
                      
                      <div className="space-y-2">
                        <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#066099] cursor-pointer">
                          <input
                            type="radio"
                            name="csvMode"
                            value="replace"
                            checked={csvImportMode === 'replace'}
                            onChange={(e) => setCsvImportMode(e.target.value as 'replace' | 'append')}
                            className="w-4 h-4 text-[#066099] border-slate-300 focus:ring-[#066099]"
                          />
                          <div>
                            <p className="text-sm font-bold text-slate-800">書き換え</p>
                            <p className="text-xs text-slate-500">既存データを削除して、新しいCSVデータに置き換えます</p>
                          </div>
                        </label>
                        
                        <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#066099] cursor-pointer">
                          <input
                            type="radio"
                            name="csvMode"
                            value="append"
                            checked={csvImportMode === 'append'}
                            onChange={(e) => setCsvImportMode(e.target.value as 'replace' | 'append')}
                            className="w-4 h-4 text-[#066099] border-slate-300 focus:ring-[#066099]"
                          />
                          <div>
                            <p className="text-sm font-bold text-slate-800">追加</p>
                            <p className="text-xs text-slate-500">既存データに新しいCSVデータを追加します</p>
                          </div>
                        </label>
                      </div>
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
                            applyCsvData(pendingCsvData, csvImportMode);
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

              {/* 過去の投稿分析を表示している場合は、テーマ候補と投稿生成ボタンを非表示 */}
              {isThemeMode && !(activeMode === 'mypost' && showPostAnalysis) ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {isThemesLoading ? (
                      [...Array(3)].map((_, i) => (
                        <div key={i} className="h-24 bg-slate-50 rounded-xl animate-pulse border border-slate-100"></div>
                      ))
                    ) : currentThemeCandidates.length > 0 ? (
                      currentThemeCandidates.slice(0, 3).map((theme, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setSelectedTheme(theme);
                            setManualInput(''); 
                          }}
                          className={`relative text-left p-3 rounded-xl border text-xs transition-all h-24 flex flex-col justify-between group overflow-hidden
                            ${selectedTheme === theme 
                              ? 'bg-gradient-to-br from-sky-50 to-white border-[#066099] ring-1 ring-[#066099] text-[#066099] shadow-sm' 
                              : 'bg-white border-slate-200 hover:border-[#066099]/50 text-slate-600 hover:shadow-sm'
                            }`}
                        >
                          <div className="absolute top-0 right-0 p-1.5 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Lightbulb size={24} />
                          </div>
                          <span className="line-clamp-3 leading-snug font-medium z-10">{theme}</span>
                          {selectedTheme === theme && <div className="flex justify-end"><Check size={14} className="text-[#066099]" /></div>}
                        </button>
                      ))
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

              {/* 過去の投稿分析を表示している場合は、投稿生成ボタンを非表示 */}
              {!(activeMode === 'mypost' && showPostAnalysis) && selectedSection !== 'analysis' && (
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
               {(activeMode !== 'mypost' || selectedSection === 'analysis' || selectedSection === null) && (
                 <ResultCard 
                   content={result} 
                   isLoading={isPostLoading} 
                   error={error} 
                   onChange={setResult} 
                   user={user}
                   onPostToX={handlePostToX}
                   isPostingToX={isPostingToX}
                   xAccessToken={xAccessToken}
                   showPostAnalysis={activeMode === 'mypost' && showPostAnalysis}
                 />
               )}
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