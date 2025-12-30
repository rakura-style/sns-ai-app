'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, BarChart3, RefreshCcw, Send, Copy, Check, Sparkles, Zap,
  Loader2, Settings, Pencil, ChevronRight, Lightbulb, Upload,
  ChevronDown, User as UserIcon, MessageCircle, Smile, ExternalLink, AlignLeft, Mail, Lock, CreditCard, LogOut,
  Clock, Calendar, X as XIcon, Trash2, BookOpen, Menu
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
import { doc, getDoc, setDoc, collection, query, where, orderBy, onSnapshot, deleteDoc } from 'firebase/firestore';

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
    try {
      errorBody = await response.text();
    } catch (e) {
      errorBody = "Failed to read error body";
    }
    console.error("API Error Detail:", errorBody);

    if (response.status === 429) {
        throw new Error("アクセスが集中しており制限がかかりました。\nしばらく時間を置いてから再試行してください。");
    }

    throw new Error(`API Error: ${response.status} - ${errorBody}`);
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
    - style: 文体・口調・語尾の傾向
    - emoji: 絵文字の使用傾向
    - character: 投稿者の性格・特徴・興味をじっくり分析し、100文字以上でしっかりと傾向を分析してまとめる
      
    【タスク2: テーマ提案】
    エンゲージメント、favorite_count、view_countが多い投稿の傾向（勝ちパターン）じっくり分析し、
    次回投稿すべき**「テーマ案を3つ」**作成してください。

    出力は必ず以下の **JSON形式のみ** で返してください。
    {
      "settings": {
        "style": "...",
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

const generatePost = async (mode: string, topic: string, inputData: any, settings: any, token: string, userId: string) => {
  const personaInstruction = `
    【パーソナリティ設定】
    - 文体・口調: ${settings.style}
    - 絵文字: ${settings.emoji}
    - 性格・特徴: ${settings.character}

    【重要: 出力ルール（必ず守ること）】
    1. 文字数: **絶対に${settings.minLength}文字以上、${settings.maxLength}文字以内**にしてください。これは厳密な要件です。文字数を数えて必ず範囲内に収めてください。
    2. 禁止文字: 文中で '*'（アスタリスク）や '#'（シャープ/ハッシュ）は絶対に使用しないでください。
       - Markdownの見出し記号（#）や強調（**）は不要です。
       - 箇条書き等の装飾にもこれらを使わないでください。
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
    prompt = `
      ${personaInstruction}
      以下の[テーマ]について、共感を呼ぶ魅力的なSNS投稿を作成してください。
      ハッシュタグも適切に含めてください（文末のみ）。
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
const SettingsDropdown = ({ user, isSubscribed, onLogout, onManageSubscription, onUpgrade, isPortalLoading, onOpenXSettings }: any) => {
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
  const handleChange = async (key: string, value: string | number) => {
    const updatedSettings = { ...settings, [key]: value };
    // 状態を更新（updateCurrentSettings関数を呼び出す）
    setSettings(updatedSettings);
    
    // Firestoreに保存
    if (user) {
      try {
        await setDoc(doc(db, 'users', user.uid), {
          [`settings.${mode}`]: updatedSettings
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
      <ComboboxInput label="文体・口調" icon={MessageCircle} value={settings.style} onChange={(val: string) => handleChange('style', val)} options={["親しみやすい（です・ます調）", "プロフェッショナル（だ・である調）", "ハイテンション・カジュアル", "辛口・批評的", "ポエム・エモーショナル", "簡潔・箇条書き中心"]} placeholder="例: 親しみやすい" />
      <ComboboxInput label="絵文字の使い方" icon={Smile} value={settings.emoji} onChange={(val: string) => handleChange('emoji', val)} options={["適度に使用（文末に1つなど）", "多用する（賑やかに）", "一切使用しない", "特定の絵文字を好む（✨🚀）", "顔文字（( ^ω^ )）を使用"]} placeholder="例: 適度に使用" />
      <ComboboxInput label="性格・特徴" icon={UserIcon} value={settings.character} onChange={(val: string) => handleChange('character', val)} options={["SNS初心者\n頑張って更新している", "30代エンジニア\n技術トレンドに敏感", "熱血広報担当\n自社製品への愛が強い", "トレンドマーケター\n分析的で冷静な視点", "毒舌批評家\n本質を突くのが得意", "丁寧な暮らし系\n穏やかで情緒的"]} placeholder="例: 30代エンジニア" multiline={true} />
      
      {/* 文字数設定エリア */}
      <div className="pt-2 border-t border-slate-100">
        <label className="block text-xs font-bold text-slate-500 mb-2 flex items-center gap-1">
          <AlignLeft size={12} /> 文字数目安
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-[10px] text-slate-400 block mb-1">最小</span>
            <input 
              type="number" 
              value={settings.minLength} 
              onChange={(e) => handleChange('minLength', e.target.value)}
              className="w-full p-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none text-right bg-slate-50 focus:bg-white transition-colors text-black"
            />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block mb-1">最大</span>
            <input 
              type="number" 
              value={settings.maxLength} 
              onChange={(e) => handleChange('maxLength', e.target.value)}
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
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledPosts, setScheduledPosts] = useState<any[]>([]);
  const [selectedDestinations, setSelectedDestinations] = useState<PostDestination[]>([]);

  // 予約投稿一覧を取得
  useEffect(() => {
    if (!user) return;

    const scheduledPostsRef = collection(db, 'users', user.uid, 'scheduledPosts');
    const q = query(
      scheduledPostsRef,
      where('posted', '==', false)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const posts = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          scheduledAt: data.scheduledAt?.toDate?.() || new Date(data.scheduledAt),
        };
      });
      // クライアント側でソート（予約時刻の昇順）
      posts.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
      setScheduledPosts(posts);
    });

    return () => unsubscribe();
  }, [user]);

  // 予約時刻のチェックと通知
  useEffect(() => {
    if (scheduledPosts.length === 0) return;

    const checkInterval = setInterval(() => {
      const now = new Date();
      scheduledPosts.forEach(post => {
        const scheduledTime = new Date(post.scheduledAt);
        
        // デバッグ用ログ
        console.log('予約投稿チェック:', {
          現在時刻: now.toLocaleString('ja-JP'),
          予約時刻: scheduledTime.toLocaleString('ja-JP'),
          差分秒: Math.floor((scheduledTime.getTime() - now.getTime()) / 1000)
        });
        
        // 予約時刻の1分前から通知可能
        const notifyTime = new Date(scheduledTime.getTime() - 60000);
        
        if (now >= notifyTime && now < scheduledTime && !post.notified) {
          // 通知を送信
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('予約投稿の時刻です', {
              body: post.content.substring(0, 50) + '...',
              icon: '/next.svg',
              tag: `scheduled-post-${post.id}`,
            });
          } else if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
              if (permission === 'granted') {
                new Notification('予約投稿の時刻です', {
                  body: post.content.substring(0, 50) + '...',
                  icon: '/next.svg',
                  tag: `scheduled-post-${post.id}`,
                });
              }
            });
          }
        }

        // 予約時刻になったら自動で投稿先に投稿
        if (now >= scheduledTime && !post.posted) {
          const destinations = post.destinations || ['x'];
          
          destinations.forEach((destination: PostDestination) => {
            if (destination === 'x') {
              // Xの場合はAPI経由で投稿を試みる
              // アクセストークンがない場合はクリップボードにコピー
              const savedXToken = localStorage.getItem('x_access_token');
              if (savedXToken && user) {
                // API経由で投稿
                user.getIdToken().then((token: string) => {
                  fetch('/api/x/post', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                      content: post.content,
                      accessToken: savedXToken,
                    }),
                  }).then(response => response.json())
                    .then(data => {
                      if (data.success) {
                        if ('Notification' in window && Notification.permission === 'granted') {
                          new Notification('予約投稿が完了しました（X）', {
                            body: 'Xへの投稿が正常に完了しました。',
                            icon: '/next.svg',
                            tag: `scheduled-post-x-${post.id}`,
                          });
                        }
                      }
                    })
                    .catch(() => {
                      // API投稿に失敗した場合はクリップボードにコピー
                      navigator.clipboard.writeText(post.content).then(() => {
                        if ('Notification' in window && Notification.permission === 'granted') {
                          new Notification('予約投稿の時刻です（X）', {
                            body: '投稿内容をクリップボードにコピーしました。Xで貼り付けて投稿してください。',
                            icon: '/next.svg',
                            tag: `scheduled-post-x-${post.id}`,
                          });
                        }
                      });
                    });
                });
              } else {
                // アクセストークンがない場合はクリップボードにコピー
                navigator.clipboard.writeText(post.content).then(() => {
                  if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification('予約投稿の時刻です（X）', {
                      body: '投稿内容をクリップボードにコピーしました。Xで貼り付けて投稿してください。',
                      icon: '/next.svg',
                      tag: `scheduled-post-x-${post.id}`,
                    });
                  }
                }).catch(() => {
                  console.error('クリップボードへのコピーに失敗しました');
                });
              }
            } else if (destination === 'facebook') {
              // Facebookの場合はURLを開く（Facebook Graph APIを使う場合は別途実装）
              const postUrl = getPostUrl(destination, post.content);
              window.open(postUrl, '_blank', 'noopener,noreferrer');
            }
          });
          
          // 投稿済みフラグを更新（簡易版：実際にはAPIで更新すべき）
          const postRef = doc(db, 'users', user.uid, 'scheduledPosts', post.id);
          setDoc(postRef, { posted: true }, { merge: true });
        }
      });
    }, 10000); // 10秒ごとにチェック

    return () => clearInterval(checkInterval);
  }, [scheduledPosts, user]);

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

  // 予約投稿を保存
  const handleSchedulePost = async () => {
    if (!content || !scheduledDateTime || !user) return;

    try {
      setIsScheduling(true);
      const token = await user.getIdToken();

      // Xの文字数制限をチェック（予約投稿は常にXに投稿）
      const xCharCount = calculateXCharacterCount(content);
      if (xCharCount > X_CHARACTER_LIMIT) {
        const shouldContinue = confirm(
          `Xの文字数制限（${X_CHARACTER_LIMIT}文字）を超えています。\n` +
          `現在の文字数: ${xCharCount}文字（全角文字は2文字として計算）\n\n` +
          `このまま予約投稿すると、時刻になってもXには投稿できません。\n` +
          `予約投稿をキャンセルして書き直しますか？`
        );
        
        if (shouldContinue) {
          setIsScheduling(false);
          return;
        }
      }

      // 日時をISO形式に変換（日本時間を考慮）
      // datetime-local inputは現地時間を返すので、そのままDateオブジェクトに変換
      const scheduledDate = new Date(scheduledDateTime);
      const now = new Date();
      
      // 現在時刻との比較（1分の猶予を持たせる）
      if (scheduledDate.getTime() <= now.getTime() + 60000) {
        alert('予約時刻は現在時刻より少なくとも1分以上先の日時を指定してください');
        setIsScheduling(false);
        return;
      }

      const response = await fetch('/api/scheduled-posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          content,
          scheduledAt: scheduledDate.toISOString(),
          destinations: ['x'], // 予約投稿は常にXに投稿
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '予約投稿の保存に失敗しました');
      }

      alert('予約投稿を設定しました');
      setShowScheduleModal(false);
      setScheduledDateTime('');
    } catch (error: any) {
      console.error('Schedule post error:', error);
      alert('エラー: ' + error.message);
    } finally {
      setIsScheduling(false);
    }
  };

  // 予約投稿を削除
  const handleDeleteScheduledPost = async (postId: string) => {
    if (!user || !confirm('この予約投稿を削除しますか？')) return;

    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/scheduled-posts?id=${postId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        },
      });

      if (!response.ok) {
        throw new Error('削除に失敗しました');
      }
    } catch (error: any) {
      console.error('Delete scheduled post error:', error);
      alert('エラー: ' + error.message);
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
              <button
                onClick={() => {
                  if (!xAccessToken) {
                    setShowPostModal(false);
                    alert('X設定が必要です。設定メニューからX API認証情報を設定してください。');
                    return;
                  }
                  setShowPostModal(false);
                  setShowScheduleModal(true);
                }}
                disabled={!xAccessToken}
                className="flex-1 px-4 py-2 text-sm font-bold text-white bg-sky-500 rounded-lg hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Clock size={16} />
                予約投稿
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 予約投稿モーダル */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Clock size={20} className="text-[#066099]" />
                予約投稿を設定
              </h3>
              <button 
                onClick={() => {
                  setShowScheduleModal(false);
                  setScheduledDateTime('');
                }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <XIcon size={20} />
              </button>
            </div>
            
            <div className="space-y-4">
              {/* 投稿内容の確認 */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 flex items-center gap-1">
                  <Sparkles size={12} />
                  投稿内容（確認）
                </label>
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 max-h-48 overflow-y-auto">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{content}</p>
                </div>
                {(() => {
                  const xCharCount = calculateXCharacterCount(content);
                  return (
                    <p className={`text-xs mt-2 ${xCharCount > X_CHARACTER_LIMIT ? 'text-red-500 font-bold' : 'text-slate-500'}`}>
                      文字数: {xCharCount} / {X_CHARACTER_LIMIT}文字（Xの制限・全角は2文字）
                    </p>
                  );
                })()}
              </div>
              
              {/* 投稿日時選択 */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                  <Calendar size={12} />
                  投稿実行日時
                </label>
                <input
                  type="datetime-local"
                  value={scheduledDateTime}
                  onChange={(e) => setScheduledDateTime(e.target.value)}
                  min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                  className="w-full p-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-slate-50 focus:bg-white transition-colors text-black"
                />
                <p className="text-xs text-slate-400 mt-1">
                  予約投稿は1分以上先の時間としてください。
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  setShowScheduleModal(false);
                  setScheduledDateTime('');
                }}
                className="flex-1 px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleSchedulePost}
                disabled={!scheduledDateTime || isScheduling}
                className="flex-1 px-4 py-2 text-sm font-bold text-white bg-[#066099] rounded-lg hover:bg-[#055080] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isScheduling ? <Loader2 size={16} className="animate-spin" /> : <Clock size={16} />}
                {isScheduling ? '設定中...' : '予約投稿を設定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 予約投稿一覧 */}
      {scheduledPosts.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
              <Clock size={12} />
              予約投稿一覧 ({scheduledPosts.length})
            </h4>
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {scheduledPosts.map((post) => (
              <div key={post.id} className="bg-white rounded-lg p-3 border border-slate-200 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-slate-500">
                        {new Date(post.scheduledAt).toLocaleString('ja-JP', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      <div className="flex gap-1 flex-wrap">
                        {(post.destinations || ['x']).map((dest: PostDestination) => (
                          <span key={dest} className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                            {getDestinationLabel(dest)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="text-slate-700 line-clamp-2">{post.content}</p>
                  </div>
                  <button
                    onClick={() => handleDeleteScheduledPost(post.id)}
                    className="text-slate-400 hover:text-red-500 transition-colors p-1"
                    title="削除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
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
  
  const [csvData, setCsvData] = useState('Date,Post Content,Likes\n2023-10-01,"朝カフェ作業中。集中できる！",120\n2023-10-05,"新しいプロジェクト始動。ワクワク。",85\n2023-10-10,"【Tips】効率化の秘訣はこれだ...",350\n2023-10-15,"今日は失敗した...でもめげない！",200');
  const [csvUploadDate, setCsvUploadDate] = useState<string | null>(null);
  
  // マイ投稿分析用の状態
  const [parsedPosts, setParsedPosts] = useState<any[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sortBy, setSortBy] = useState<string>('engagement-desc');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showPostAnalysis, setShowPostAnalysis] = useState(false);
  const [excludeRTAndReplies, setExcludeRTAndReplies] = useState(false);
  const [csvImportMode, setCsvImportMode] = useState<'replace' | 'append'>('replace');
  const [showCsvImportModal, setShowCsvImportModal] = useState(false);
  const [pendingCsvData, setPendingCsvData] = useState<string>('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // CSVをパースして投稿データの配列に変換（改行を含むフィールドに対応）
  const parseCsvToPosts = (csvText: string): any[] => {
    if (!csvText) return [];
    
    // 改行を含むフィールドに対応したCSVパース
    const rows: string[] = [];
    let currentRow = '';
    let inQuotes = false;
    
    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];
      
      if (char === '"') {
        // エスケープされたダブルクォート（""）の処理
        if (inQuotes && nextChar === '"') {
          currentRow += '"';
          i++; // 次の文字をスキップ
        } else {
          inQuotes = !inQuotes;
          currentRow += char;
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
    
    // データ行をパース
    const posts: any[] = [];
    for (let i = 1; i < rows.length; i++) {
      const values = parseCsvRow(rows[i]);
      
      // オブジェクトに変換
      const post: any = {};
      headers.forEach((header: string, index: number) => {
        // 値は既にparseCsvRowで処理済み（ダブルクォートは除去済み、エスケープも処理済み）
        let value = values[index] || '';
        // 念のため、先頭と末尾のダブルクォートを除去（残っている場合）
        if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
          value = value.slice(1, -1);
        }
        // エスケープされたダブルクォート（""）を単一のダブルクォート（"）に変換
        value = value.replace(/""/g, '"');
        post[header] = value;
      });
      
      // いいね数を抽出
      let likes = 0;
      const likesKeys = ['Likes', 'likes', 'Like', 'いいね', 'Like Count', 'like_count', 'favorite_count', 'Favorite Count'];
      for (const key of likesKeys) {
        if (post[key] !== undefined && post[key] !== '') {
          const num = parseInt(post[key].toString().replace(/,/g, ''), 10);
          if (!isNaN(num)) {
            likes = num;
            break;
          }
        }
      }
      
      // ビュー数を抽出
      let views = 0;
      const viewsKeys = ['Views', 'views', 'View', 'ビュー', 'View Count', 'view_count', 'Impressions', 'impressions', 'インプレッション'];
      for (const key of viewsKeys) {
        if (post[key] !== undefined && post[key] !== '') {
          const num = parseInt(post[key].toString().replace(/,/g, ''), 10);
          if (!isNaN(num)) {
            views = num;
            break;
          }
        }
      }
      
      // エンゲージメント数値を抽出（Engagement等の列から、いいねとビューが別々の場合は合算）
      let engagement = 0;
      const engagementKeys = ['Engagement', 'engagement', 'エンゲージメント', 'Total Engagement'];
      for (const key of engagementKeys) {
        if (post[key] !== undefined && post[key] !== '') {
          const num = parseInt(post[key].toString().replace(/,/g, ''), 10);
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
      
      // 投稿内容を取得（Post Content, Content, 投稿内容等の列から、改行も含めて全部読み込む）
      const contentKeys = ['Post Content', 'Content', 'content', '投稿内容', 'Text', 'text', 'Tweet', 'tweet', '投稿', 'Post'];
      let content = '';
      for (const key of contentKeys) {
        if (post[key] !== undefined && post[key] !== '') {
          // 改行を含めて全部読み込む（toString()でそのまま取得）
          content = post[key].toString();
          break;
        }
      }
      
      // 日付を取得
      const dateKeys = ['Date', 'date', '日付', '投稿日', 'Posted At'];
      let date = '';
      for (const key of dateKeys) {
        if (post[key] !== undefined && post[key] !== '') {
          date = post[key].toString();
          break;
        }
      }
      
      if (content) {
        posts.push({
          id: `post-${i}`,
          content,
          likes,
          views,
          engagement,
          date,
          rawData: post
        });
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
    mypost: { style: '親しみやすい（です・ます調）', emoji: '要点を強調するために使用', character: '一人称は私。\nSNS初心者。\n丁寧な言葉遣いで、分かりやすく簡潔に表現する。', minLength: 50, maxLength: 150 },
    trend: { style: '親しみやすい（です・ます調）', emoji: '要点を強調するために使用', character: '一人称は私。\nSNS初心者。\n丁寧な言葉遣いで、分かりやすく簡潔に表現する。', minLength: 50, maxLength: 150 },
    rewrite: { style: '親しみやすい（です・ます調）', emoji: '要点を強調するために使用', character: '一人称は私。\nSNS初心者。\n丁寧な言葉遣いで、分かりやすく簡潔に表現する。', minLength: 50, maxLength: 150 }
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
    const parsed = parseCsvToPosts(csvText);
    
    if (mode === 'append') {
      // 追加モード：既存データに追加
      setParsedPosts(prev => [...prev, ...parsed]);
      // CSVデータも結合（ヘッダー行は最初のものを使う）
      const existingLines = csvData.split('\n');
      const newLines = csvText.split('\n');
      if (existingLines.length > 0 && newLines.length > 1) {
        const combinedCsv = existingLines[0] + '\n' + existingLines.slice(1).join('\n') + '\n' + newLines.slice(1).join('\n');
        setCsvData(combinedCsv);
      } else {
        setCsvData(csvText);
      }
    } else {
      // 書き換えモード：既存データを置き換え
      setParsedPosts(parsed);
      setCsvData(csvText);
    }
    
    const now = new Date();
    const dateStr = now.toLocaleString('ja-JP', { 
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' 
    });
    setCsvUploadDate(dateStr);
    
    if (user) {
        try {
            const finalCsvData = mode === 'append' 
              ? (csvData + '\n' + csvText.split('\n').slice(1).join('\n'))
              : csvText;
            await setDoc(doc(db, 'users', user.uid), {
                csvData: finalCsvData,
                csvUploadDate: dateStr
            }, { merge: true });
        } catch (err) {
            console.error("CSV保存失敗:", err);
        }
    }
    
    setShowCsvImportModal(false);
    setPendingCsvData('');
  };

  useEffect(() => {
    if (!user) return;
    const loadUserData = async () => {
      try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.csvData) {
            setCsvData(data.csvData);
            const parsed = parseCsvToPosts(data.csvData);
            setParsedPosts(parsed);
          }
          if (data.csvUploadDate) setCsvUploadDate(data.csvUploadDate);
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
          // パーソナリティ設定をロード
          if (data.settings) {
            setAllSettings((prev: any) => ({
              ...prev,
              ...data.settings
            }));
          }
        }
      } catch (e) {
        console.error("データの読み込みに失敗:", e);
      }
    };
    loadUserData();
  }, [user]);

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
    // 分析・更新ボタンを押したら過去の投稿分析は表示しないようにする
    if (mode === 'mypost') {
      setShowPostAnalysis(false);
    }
    try {
      const token = await user.getIdToken(); 
      const userId = user.uid;
      if (mode === 'mypost') {
        const analysisResult = await analyzeCsvAndGenerateThemes(csvData, token, userId);
        setMyPostThemes(analysisResult.themes || []); 
        if (analysisResult.settings) {
          setAllSettings(prev => ({
            ...prev,
            mypost: { ...prev.mypost, ...analysisResult.settings }
          }));
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
      const post = await generatePost(activeMode, inputSource, inputData, currentSettings, token, userId);
      setResult(post);
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
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded text-xs text-slate-600">
                      <span className="font-bold">CSV:</span>
                      {csvUploadDate ? csvUploadDate : "未取込"}
                    </div>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      className="hidden" 
                      accept=".csv, .txt" 
                    />
                    <button onClick={handleCsvImportClick} className="p-1.5 text-slate-500 hover:text-[#066099] hover:bg-slate-100 rounded transition-colors" title="CSV読込">
                      <Upload size={16} />
                    </button>
                    <div className="h-4 w-px bg-slate-300 mx-1"></div>
                    <button 
                      onClick={() => handleUpdateThemes('mypost')}
                      disabled={isThemesLoading}
                      className="text-xs bg-[#066099] hover:bg-[#055080] text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1 font-bold shadow-sm"
                    >
                      {isThemesLoading ? <Loader2 size={12} className="animate-spin"/> : <Zap size={12}/>}
                      分析・更新
                    </button>
                    {parsedPosts.length > 0 && (
                      <>
                        <div className="h-4 w-px bg-slate-300 mx-1"></div>
                        <button 
                          onClick={() => setShowPostAnalysis(!showPostAnalysis)}
                          className="text-xs bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1 font-bold shadow-sm"
                        >
                          <BarChart3 size={12} />
                          投稿分析 ({parsedPosts.length})
                        </button>
                      </>
                    )}
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
              {activeMode === 'mypost' && showPostAnalysis && parsedPosts.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <BarChart3 size={16} className="text-[#066099]" />
                      過去の投稿分析
                    </h3>
                    <button
                      onClick={() => setShowPostAnalysis(false)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <XIcon size={16} />
                    </button>
                  </div>
                  
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
                            <button
                              onClick={() => {
                                setResult(post.content);
                                // 投稿分析の一覧は閉じない
                              }}
                              className="px-3 py-1.5 text-xs font-bold text-white bg-[#066099] rounded-lg hover:bg-[#055080] transition-colors flex items-center gap-1 opacity-0 group-hover:opacity-100"
                              title="この投稿を編集（全文）"
                            >
                              <Pencil size={12} />
                              編集
                            </button>
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
                        className="flex-1 px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={() => {
                          if (pendingCsvData) {
                            applyCsvData(pendingCsvData, csvImportMode);
                          }
                        }}
                        className="flex-1 px-4 py-2 text-sm font-bold text-white bg-[#066099] rounded-lg hover:bg-[#055080] transition-colors flex items-center justify-center gap-2"
                      >
                        <Upload size={16} />
                        取込み実行
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
              {!(activeMode === 'mypost' && showPostAnalysis) && (
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