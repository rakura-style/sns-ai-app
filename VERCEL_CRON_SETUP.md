# Vercel Cron Jobs 設定ガイド

## 問題: vercel.jsonが反映されない場合

`vercel.json`がVercelに反映されない場合、以下の手順で確認・設定してください。

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

## 手動設定方法（vercel.jsonが反映されない場合）

### ステップ1: Vercel DashboardでCron Jobを作成

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

### ステップ2: 動作確認

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

