This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 予約投稿機能の設定

予約投稿機能は、アプリが閉じていても動作するようにサーバー側で定期チェックを行います。

### Vercel Cron Jobsの設定

#### 方法1: vercel.jsonを使用（推奨）

1. `vercel.json`にCron Jobsの設定が含まれています（1分ごとに実行）
2. Vercelにデプロイすると、自動的にCron Jobsが有効になります
3. Vercel DashboardでCron Jobsの実行状況を確認できます

#### 方法2: Vercel Dashboardで手動設定

`vercel.json`が反映されない場合は、Vercel Dashboardで手動で設定してください：

1. Vercel Dashboardにログイン
2. プロジェクトを選択
3. 「Settings」→「Cron Jobs」に移動
4. 「Create Cron Job」をクリック
5. 以下の設定を入力：
   - **Path**: `/api/scheduled-posts/check`
   - **Schedule**: `* * * * *` (1分ごと)
6. 「Save」をクリック

#### 確認方法

- Vercel Dashboardの「Cron Jobs」セクションで実行ログを確認
- エラーが発生している場合は、ログを確認して修正

### Firestoreインデックスの設定（必要に応じて）

以下の複合インデックスが必要な場合があります：

- Collection: `users/{userId}/scheduledPosts`
- Fields: `posted` (Ascending), `scheduledAt` (Ascending)

Firestore Consoleでインデックスを作成するか、エラーメッセージに従って自動的に作成してください。

### 動作確認

1. 予約投稿を作成
2. Vercel DashboardのCron Jobsセクションで実行ログを確認
3. 指定時刻にXへの投稿が自動実行されることを確認
