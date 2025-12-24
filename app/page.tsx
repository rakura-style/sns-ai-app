'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, BarChart3, RefreshCcw, Send, Copy, Check, Sparkles, Zap,
  Loader2, Settings, Pencil, ChevronRight, Lightbulb, Upload,
  ChevronDown, User as UserIcon, MessageCircle, Smile, ExternalLink, AlignLeft, Mail, Lock, CreditCard, LogOut
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
import { doc, getDoc, setDoc } from 'firebase/firestore';

// グローバル定数: アプリID
const getAppId = () => {
  if (typeof window !== 'undefined' && (window as any).__app_id) {
    return (window as any).__app_id;
  }
  return 'default-app-id';
};

const appId = getAppId();

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
    - character: 投稿者の性格・特徴・興味をじっくり分析し、50文字以上にまとめる
      
    【タスク2: テーマ提案】
    エンゲージメントが高い投稿の傾向（勝ちパターン）じっくり分析し、
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

    【重要: 出力ルール（厳守すること）】
    1. 文字数: ${settings.minLength}文字以上、${settings.maxLength}文字以内を目安に作成してください。
    2. 禁止文字: 文中で '*'（アスタリスク）や '#'（シャープ/ハッシュ）は絶対に使用しないでください。
       - Markdownの見出し記号（#）や強調（**）は不要です。
       - 箇条書き等の装飾にもこれらを使わないでください。
    3. ハッシュタグ: 投稿の最後にハッシュタグを記載する場合のみ '#' を使用してください。文中の使用は禁止です。

    この設定になりきって投稿を作成してください。
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

// 🔥 ドロップダウンメニューコンポーネントの追加
const SettingsDropdown = ({ user, isSubscribed, onLogout, onManageSubscription, onUpgrade, isPortalLoading }: any) => {
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
            className="w-full p-2.5 pr-8 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#066099] outline-none bg-slate-50 focus:bg-white transition-colors min-h-[5rem] resize-y leading-relaxed text-black"
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

const PersistentSettings = ({ settings, setSettings, mode }: any) => {
  const handleChange = (key: string, value: string) => setSettings((prev: any) => ({ ...prev, [key]: value }));
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

const ResultCard = ({ content, isLoading, error, onChange }: any) => {
  const [copied, setCopied] = useState(false);
  const [isUpgradeLoading, setIsUpgradeLoading] = useState(false); 

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2"><Sparkles size={14} className="text-[#066099]" />生成結果</span>
        <button onClick={handleCopy} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${copied ? 'bg-green-50 text-green-600' : 'text-slate-500 hover:text-[#066099] hover:bg-sky-50'}`}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'コピー完了' : 'コピー'}</button>
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
                    <p className="text-slate-700 font-bold mb-1">Proプランにアップグレード</p>
                    <p className="text-xs text-slate-500">月額980円で無制限に使い放題</p>
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
            className="w-full h-full min-h-[400px] whitespace-pre-wrap text-slate-800 leading-relaxed font-sans text-base animate-in fade-in duration-500 bg-transparent border-none focus:ring-0 resize-none outline-none"
            value={content}
            onChange={(e) => onChange && onChange(e.target.value)}
          />
        )}
      </div>
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
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [trendThemes, setTrendThemes] = useState<string[]>([]);
  const [myPostThemes, setMyPostThemes] = useState<string[]>([]);
  
  const [isThemesLoading, setIsThemesLoading] = useState(false);
  
  const [result, setResult] = useState('');
  const [isPostLoading, setIsPostLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [allSettings, setAllSettings] = useState({
    mypost: { style: '親しみやすい（です・ます調）', emoji: '適度に使用', character: 'SNS初心者', minLength: 50, maxLength: 150 },
    trend: { style: '情報発信系（断定口調）', emoji: '要点を強調するために使用', character: '一人称は私\n誰もが感じる「弱気」を肯定した上で、それを乗り越えるための「力強い一言」で締めくくる', minLength: 50, maxLength: 150 },
    rewrite: { style: 'プロフェッショナル', emoji: '控えめ', character: '一人称は私\n誰もが感じる「弱気」を肯定した上で、それを乗り越えるための「力強い一言」で締めくくる', minLength: 50, maxLength: 150 }
  });

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
        setCsvData(text); 
        const now = new Date();
        const dateStr = now.toLocaleString('ja-JP', { 
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' 
        });
        setCsvUploadDate(dateStr);
        
        if (user) {
            try {
                await setDoc(doc(db, 'users', user.uid), {
                    csvData: text,
                    csvUploadDate: dateStr
                }, { merge: true });
            } catch (err) {
                console.error("CSV保存失敗:", err);
            }
        }

        event.target.value = ''; 
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (!user) return;
    const loadUserData = async () => {
      try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.csvData) setCsvData(data.csvData);
          if (data.csvUploadDate) setCsvUploadDate(data.csvUploadDate);
          // 🔥 修正: サブスク状態をロード
          if (data.isSubscribed) setIsSubscribed(true);
          else setIsSubscribed(false);
        }
      } catch (e) {
        console.error("データの読み込みに失敗:", e);
      }
    };
    loadUserData();
  }, [user]);

  const handleUpdateThemes = async (mode: string) => {
    if (!user) { setError("ログインが必要です"); return; }
    setIsThemesLoading(true);
    setError('');
    setManualInput('');
    setSelectedTheme('');
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
          <div className="flex items-center gap-2">
            <div className="bg-gradient-to-br from-[#066099] to-sky-600 text-white p-1.5 rounded-lg shadow-sm">
              <Send size={20} />
            </div>
            <h1 className="font-bold text-xl tracking-tight text-slate-900">SNS投稿サポーターAI</h1>
          </div>
          {user ? (
            <div className="flex items-center gap-3">
              {/* <span className="text-xs text-slate-500 hidden sm:inline">{user.email}</span> */}
              {/* <button onClick={handleLogout} className="text-xs border border-red-200 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50">ログアウト</button> */}
              <SettingsDropdown 
                user={user} 
                isSubscribed={isSubscribed} 
                onLogout={handleLogout}
                onManageSubscription={handleManageSubscription}
                onUpgrade={handleUpgradeFromMenu}
                isPortalLoading={isPortalLoading}
              />
            </div>
          ) : (
            <button onClick={handleGoogleLogin} className="text-xs bg-[#066099] text-white px-4 py-2 rounded-lg hover:bg-[#055080] font-bold">ログイン</button>
          )}
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
        </div>
      ) : (
        <main className="max-w-7xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          <div className="lg:col-span-1 space-y-6">
            <div>
              <ModeButton active={activeMode === 'trend'} onClick={() => changeMode('trend')} icon={TrendingUp} label="トレンド提案" />
              <ModeButton active={activeMode === 'mypost'} onClick={() => changeMode('mypost')} icon={BarChart3} label="マイ投稿分析" />
              <ModeButton active={activeMode === 'rewrite'} onClick={() => changeMode('rewrite')} icon={RefreshCcw} label="文章リライト" />
            </div>

            <PersistentSettings settings={currentSettings} setSettings={updateCurrentSettings} mode={activeMode} />

            {/* 🔥 追加: 契約管理エリア */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100 text-slate-700 font-bold text-sm mb-3">
                    <CreditCard size={16} className="text-[#066099]" /><span>プラン管理</span>
                </div>
                {isSubscribed ? (
                    <div className="text-center">
                        <p className="text-xs text-green-600 font-bold mb-2 flex items-center justify-center gap-1"><Check size={12}/> Proプラン契約中</p>
                        <button 
                            onClick={handleManageSubscription}
                            disabled={isPortalLoading}
                            className="w-full text-xs border border-slate-300 text-slate-600 hover:bg-slate-50 py-2 rounded-lg transition-colors flex items-center justify-center gap-1"
                        >
                            {isPortalLoading ? <Loader2 size={12} className="animate-spin"/> : <Settings size={12}/>}
                            契約内容の確認・解約
                        </button>
                    </div>
                ) : (
                    <div className="text-center">
                        <p className="text-xs text-slate-500 mb-2">無料プラン利用中</p>
                        <button 
                            onClick={handleUpgradeFromMenu}
                            disabled={isPortalLoading}
                            className="w-full text-xs bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600 py-2 rounded-lg transition-colors shadow-sm flex items-center justify-center gap-1"
                        >
                            {isPortalLoading ? <Loader2 size={12} className="animate-spin"/> : <Zap size={12} className="fill-white"/>}
                            Proプランに登録
                        </button>
                    </div>
                )}
            </div>

            <div className="text-center pt-2">
              <a href="https://rakura.net/" target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-[#066099] flex items-center justify-center gap-1 transition-colors group">
                Created by らくらスタイル
                <ExternalLink size={10} className="opacity-50 group-hover:opacity-100" />
              </a>
            </div>
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

              {isThemeMode ? (
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
              )}

              <button
                onClick={handleGeneratePost}
                disabled={isPostLoading || (!manualInput && !selectedTheme)}
                className="w-full bg-gradient-to-r from-[#066099] to-sky-600 hover:from-[#055080] hover:to-sky-700 text-white font-bold py-3 rounded-xl shadow-md shadow-sky-100 transform transition active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
              >
                {isPostLoading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                {activeMode === 'rewrite' ? 'リライトを実行' : '投稿を作成する'}
              </button>
            </div>

            <div className="flex-1 min-h-0">
               <ResultCard content={result} isLoading={isPostLoading} error={error} onChange={setResult} />
            </div>
            
          </div>

        </main>
      )}
    </div>
  );
}