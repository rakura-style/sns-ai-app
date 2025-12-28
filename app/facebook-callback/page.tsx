'use client';

import { useEffect } from 'react';

export default function FacebookCallback() {
  useEffect(() => {
    // URLからアクセストークンを取得
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get('access_token');

    if (accessToken) {
      // 親ウィンドウにアクセストークンを送信
      if (window.opener) {
        window.opener.postMessage(
          { type: 'FACEBOOK_ACCESS_TOKEN', token: accessToken },
          window.location.origin
        );
        window.close();
      } else {
        // ポップアップが開いていない場合、localStorageに保存
        localStorage.setItem('facebook_access_token', accessToken);
        window.location.href = '/';
      }
    } else {
      // エラーの場合
      const error = params.get('error');
      if (window.opener) {
        window.opener.postMessage(
          { type: 'FACEBOOK_AUTH_ERROR', error: error || '認証に失敗しました' },
          window.location.origin
        );
        window.close();
      } else {
        alert('Facebook認証に失敗しました: ' + (error || '不明なエラー'));
        window.location.href = '/';
      }
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <p className="text-slate-600">認証処理中...</p>
      </div>
    </div>
  );
}


