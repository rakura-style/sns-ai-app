# 予約投稿の定期チェック設定ガイド

## 重要: Vercel Cron Jobsについて

Vercel Cron Jobsは**有料プラン（Pro以上）**でのみ利用可能です。無料プランの場合は、以下の代替案を使用してください。

## 代替案: 外部Cronサービスを使用（無料プラン対応）

無料プランでも予約投稿機能を利用するには、外部のCronサービスを使用します。

## 確認事項

### 1. vercel.jsonの配置場所
- ✅ プロジェクトのルートディレクトリに配置されているか
- ✅ ファイル名は`vercel.json`（小文字）か

### 2. デプロイの確認
- ✅ `vercel.json`を変更した後、新しいデプロイを実行したか
- ✅ Gitにコミット・プッシュされているか

### 3. Vercel Dashboardでの確認
1. Vercel Dashboardにログイン
2. プロジェクトを選択
3. 「Settings」→「Cron Jobs」に移動
4. Cron Jobsが表示されているか確認

## 方法1: 外部Cronサービスを使用（推奨・無料プラン対応）

### cron-job.orgを使用する場合

1. [cron-job.org](https://cron-job.org/)に無料アカウントを作成
2. 「Create cronjob」をクリック
3. 以下の設定を入力：
   - **Title**: `予約投稿チェック`
   - **Address**: `https://your-domain.vercel.app/api/scheduled-posts/check`
   - **Schedule**: `Every minute` または `*/1 * * * *`
   - **Request method**: `GET`
   - **Request headers**: 
     - `Authorization: Bearer YOUR_CRON_SECRET` (オプション、セキュリティのため推奨)
4. 「Create cronjob」をクリック

### EasyCronを使用する場合

1. [EasyCron](https://www.easycron.com/)に無料アカウントを作成
2. 「Add Cron Job」をクリック
3. 以下の設定を入力：
   - **Cron Job Title**: `予約投稿チェック`
   - **URL**: `https://your-domain.vercel.app/api/scheduled-posts/check`
   - **Schedule Type**: `Every minute`
   - **HTTP Method**: `GET`
   - **HTTP Headers**: `Authorization: Bearer YOUR_CRON_SECRET` (オプション)
4. 「Save」をクリック

### 環境変数の設定（セキュリティ強化）

外部Cronサービスを使用する場合、セキュリティのため環境変数`CRON_SECRET`を設定することを推奨します：

1. Vercel Dashboard → プロジェクト → Settings → Environment Variables
2. 以下の環境変数を追加：
   - **Name**: `CRON_SECRET`
   - **Value**: ランダムな文字列（例: `your-secret-key-here`）
3. 外部Cronサービスの設定で、この値を`Authorization: Bearer YOUR_CRON_SECRET`として使用

## 方法2: Vercel DashboardでCron Jobを作成（有料プランの場合）

1. Vercel Dashboardにログイン
2. プロジェクトを選択
3. 「Settings」タブをクリック
4. 左メニューから「Cron Jobs」を選択
5. 「Create Cron Job」ボタンをクリック
6. 以下の情報を入力：
   - **Path**: `/api/scheduled-posts/check`
   - **Schedule**: `* * * * *` (1分ごと)
   - **Timezone**: `Asia/Tokyo` (オプション)
7. 「Save」をクリック

## 動作確認

### 外部Cronサービスを使用している場合

1. Cronサービスのダッシュボードで実行履歴を確認
2. Vercel Dashboardの「Functions」タブでログを確認
3. エラーが発生している場合は、ログを確認

### Vercel Cron Jobsを使用している場合

1. 「Cron Jobs」セクションで作成したCron Jobを確認
2. 「Run History」で実行履歴を確認
3. エラーが発生している場合は、ログを確認

## トラブルシューティング

### Cron Jobが実行されない場合

1. **認証エラーの確認**
   - APIエンドポイントが`x-vercel-cron`ヘッダーを正しくチェックしているか確認
   - 環境変数`CRON_SECRET`が設定されている場合は、認証ヘッダーも確認

2. **APIエンドポイントの確認**
   - `/api/scheduled-posts/check`が正しくデプロイされているか確認
   - ブラウザで直接アクセスして動作確認（認証エラーが返ることを確認）

3. **ログの確認**
   - Vercel Dashboardの「Functions」タブでログを確認
   - エラーメッセージを確認して修正

### よくあるエラー

- **401 Unauthorized**: 認証ヘッダーのチェックが失敗している
- **503 Service Unavailable**: データベースの初期化に失敗している
- **500 Internal Server Error**: APIエンドポイント内でエラーが発生している

## 参考リンク

- [Vercel Cron Jobs Documentation](https://vercel.com/docs/cron-jobs)
- [Vercel Cron Jobs Configuration](https://vercel.com/docs/cron-jobs/configuration)

