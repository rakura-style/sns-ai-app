# セットアップガイド

このアプリケーションを動作させるためのセットアップ手順です。

## 1. 依存関係のインストール

```bash
npm install
```

## 2. 環境変数の設定

プロジェクトのルートディレクトリに `.env.local` ファイルを作成し、以下の環境変数を設定してください。

### Firebase クライアント側の設定（NEXT_PUBLIC_プレフィックスが必要）

Firebase Console (https://console.firebase.google.com/) から取得してください。

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

### Firebase Admin SDK（サーバー側）の設定

Firebase Console → プロジェクト設定 → サービスアカウント から取得してください。

```env
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=your_service_account_email@your_project_id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n"
```

**注意**: `FIREBASE_PRIVATE_KEY` は改行文字 `\n` を含む必要があります。JSONファイルから取得した場合は、そのままコピーして使用できます。

### Google Gemini API

https://makersuite.google.com/app/apikey から取得してください。

```env
GEMINI_API_KEY=your_gemini_api_key
```

または

```env
GOOGLE_GEMINI_API_KEY=your_gemini_api_key
```

### Stripe 設定

https://dashboard.stripe.com/apikeys から取得してください。

```env
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

### 予約投稿機能用（オプション）

外部Cronサービスを使用する場合のセキュリティ用です。

```env
CRON_SECRET=your_random_secret_string
```

## 3. アプリケーションの起動

開発サーバーを起動します：

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてアプリケーションにアクセスできます。

## 4. ビルドと本番環境での起動

本番環境用にビルドする場合：

```bash
npm run build
npm start
```

## トラブルシューティング

### Firebase Admin SDK の初期化エラー

`FIREBASE_PRIVATE_KEY` が正しく設定されていない場合、サーバー側の機能が動作しません。以下の点を確認してください：

1. プライベートキーが完全にコピーされているか
2. 改行文字 `\n` が正しく含まれているか
3. ダブルクォートで囲まれているか

### 環境変数が読み込まれない

- `.env.local` ファイルがプロジェクトのルートディレクトリに配置されているか確認
- サーバーを再起動してください（環境変数の変更は再起動が必要です）
- `NEXT_PUBLIC_` プレフィックスがクライアント側の環境変数に付いているか確認

### 依存関係のエラー

```bash
rm -rf node_modules package-lock.json
npm install
```

## 次のステップ

- [README.md](./README.md) を参照して、予約投稿機能の設定方法を確認してください
- [VERCEL_CRON_SETUP.md](./VERCEL_CRON_SETUP.md) を参照して、Vercelでのデプロイ方法を確認してください
