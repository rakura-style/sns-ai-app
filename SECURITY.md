# セキュリティガイドライン

このドキュメントでは、アプリケーションのセキュリティ対策とベストプラクティスを説明します。

## 実装済みのセキュリティ対策

### 1. 入力値の検証

- **URL検証**: すべてのURL入力に対して、有効な形式であることを確認
- **コンテンツ長制限**: X投稿は280文字、プロンプトは50,000文字まで
- **型チェック**: すべての入力値に対して型検証を実施
- **空文字列チェック**: 必須フィールドが空でないことを確認

### 2. XSS（クロスサイトスクリプティング）対策

- **innerHTMLの回避**: `innerHTML`の代わりに`textContent`を使用
- **HTMLエンティティの適切な処理**: 安全な方法でHTMLエンティティをデコード

### 3. エラーメッセージの管理

- **情報漏洩の防止**: 詳細なエラーメッセージをクライアントに返さない
- **認証エラーのみ詳細表示**: ユーザーが対処できる認証エラーのみ詳細を表示
- **サーバー側ログ**: 詳細なエラー情報はサーバー側のログにのみ記録

### 4. CORS設定

- **適切なCORSヘッダー**: APIエンドポイントにCORSヘッダーを設定
- **プリフライトリクエストの処理**: OPTIONSリクエストを適切に処理

### 5. 認証・認可

- **Firebase Authentication**: すべてのAPIエンドポイントでFirebase IDトークンを検証
- **ユーザーIDの検証**: リクエストごとにユーザーIDを確認

### 6. レート制限

- **クライアント側**: 1日100回の制限
- **サーバー側**: 無料会員は1日5回の制限

## 推奨事項

### X API認証情報の暗号化

現在、X API認証情報（API Key、API Key Secret、Access Token、Access Token Secret）はFirestoreに平文で保存されています。

**推奨される改善策**:

1. **サーバー側での暗号化**: 認証情報を保存する前に、サーバー側で暗号化する
2. **環境変数の使用**: 可能であれば、認証情報を環境変数として管理
3. **暗号化ライブラリの使用**: Node.jsの`crypto`モジュールや専用の暗号化ライブラリを使用

**実装例**:

```typescript
import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const secretKey = process.env.ENCRYPTION_KEY; // 32バイトのキー

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(secretKey!, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, Buffer.from(secretKey!, 'hex'), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### Firebase Security Rules

Firestoreのセキュリティルールを適切に設定してください：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // ユーザーは自分のデータのみアクセス可能
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      
      // X API認証情報は書き込みのみ（読み取りはサーバー側で行う）
      match /xCredentials/{credentialId} {
        allow write: if request.auth != null && request.auth.uid == userId;
        allow read: if false; // クライアント側からの直接読み取りを禁止
      }
    }
  }
}
```

### 環境変数の管理

- **`.env.local`**: ローカル開発環境用（Gitにコミットしない）
- **`.env.example`**: 必要な環境変数のテンプレート（Gitにコミット）
- **Vercel環境変数**: 本番環境の環境変数はVercelのダッシュボードで管理

### 定期的なセキュリティ監査

1. **依存関係の更新**: `npm audit`を定期的に実行
2. **脆弱性のスキャン**: GitHubのDependabotを有効化
3. **ログの監視**: 異常なアクセスパターンを検出

## 既知の制限事項

1. **X API認証情報の平文保存**: 現在は暗号化されていません（上記の推奨事項を参照）
2. **レート制限**: クライアント側の制限のみで、サーバー側の追加制限が必要な場合がある

## セキュリティインシデント対応

セキュリティ上の問題を発見した場合：

1. すぐに該当する認証情報を無効化
2. 影響範囲を確認
3. 必要に応じてユーザーに通知
4. 問題を修正して再デプロイ
