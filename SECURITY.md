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
- **サーバー側**: 無料会員は本番投稿が1日2回まで

## 推奨事項

### X API認証情報の暗号化

現在、X API認証情報（API Key、API Key Secret、Access Token、Access Token Secret）はFirestoreに平文で保存されています。これは、データベースにアクセスできる人（例：Firebase管理者、データベース侵害時）が認証情報を読み取れるリスクがあります。

#### なぜ暗号化が必要か？

- **データベース侵害時の保護**: 万が一Firestoreが侵害されても、暗号化されていれば認証情報は読み取れません
- **管理者による誤アクセスの防止**: Firebase管理者が誤って認証情報を閲覧することを防ぎます
- **コンプライアンス**: 多くのセキュリティ規格で、認証情報の暗号化が推奨されています

#### 実装手順（ステップバイステップ）

##### ステップ1: 暗号化用のライブラリを作成

プロジェクトルートに`lib/encryption.ts`ファイルを作成します：

```typescript
// lib/encryption.ts
import crypto from 'crypto';

// 暗号化アルゴリズム（AES-256-GCMは安全性が高い）
const algorithm = 'aes-256-gcm';
// 環境変数から暗号化キーを取得（32バイト = 64文字の16進数）
const secretKey = process.env.ENCRYPTION_KEY;

if (!secretKey || secretKey.length !== 64) {
  throw new Error('ENCRYPTION_KEY環境変数が正しく設定されていません（64文字の16進数が必要）');
}

/**
 * テキストを暗号化する
 * @param text 暗号化するテキスト
 * @returns 暗号化された文字列（形式: "IV:AuthTag:EncryptedData"）
 */
export function encrypt(text: string): string {
  // 初期化ベクトル（IV）をランダム生成（毎回異なる値）
  const iv = crypto.randomBytes(16);
  
  // 暗号化器を作成
  const cipher = crypto.createCipheriv(
    algorithm,
    Buffer.from(secretKey, 'hex'), // 16進数文字列をバイナリに変換
    iv
  );
  
  // テキストを暗号化
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // 認証タグを取得（改ざん検出用）
  const authTag = cipher.getAuthTag();
  
  // IV、認証タグ、暗号化データを結合して返す
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * 暗号化されたテキストを復号化する
 * @param encryptedText 暗号化された文字列（形式: "IV:AuthTag:EncryptedData"）
 * @returns 復号化されたテキスト
 */
export function decrypt(encryptedText: string): string {
  // 文字列を分割
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  
  // 16進数文字列をバイナリに変換
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  // 復号化器を作成
  const decipher = crypto.createDecipheriv(
    algorithm,
    Buffer.from(secretKey, 'hex'),
    iv
  );
  
  // 認証タグを設定（改ざん検出）
  decipher.setAuthTag(authTag);
  
  // 復号化
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
```

##### ステップ2: 暗号化キーを生成

ターミナルで以下のコマンドを実行して、暗号化キーを生成します：

```bash
# Node.jsで実行
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

出力例：
```
a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567890
```

##### ステップ3: 環境変数を設定

**ローカル開発環境（`.env.local`）**:
```bash
# .env.local（Gitにコミットしない）
ENCRYPTION_KEY=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567890
```

**本番環境（Vercel）**:
1. Vercelダッシュボードにログイン
2. プロジェクトを選択
3. 「Settings」→「Environment Variables」を開く
4. 以下の環境変数を追加：
   - Key: `ENCRYPTION_KEY`
   - Value: ステップ2で生成したキー
   - Environment: Production, Preview, Development すべてにチェック

##### ステップ4: 認証情報を保存するAPIルートを作成

`app/api/x/credentials/route.ts`ファイルを作成します：

```typescript
// app/api/x/credentials/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';
import { encrypt, decrypt } from '@/lib/encryption';
import { getFirestore } from 'firebase-admin/firestore';

// 認証情報を保存（暗号化して保存）
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;
    
    const { apiKey, apiKeySecret, accessToken, accessTokenSecret } = await request.json();
    
    // 入力値の検証
    if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
      return NextResponse.json({ error: 'All credentials are required' }, { status: 400 });
    }
    
    // 暗号化
    const encryptedApiKey = encrypt(apiKey);
    const encryptedApiKeySecret = encrypt(apiKeySecret);
    const encryptedAccessToken = encrypt(accessToken);
    const encryptedAccessTokenSecret = encrypt(accessTokenSecret);
    
    // Firestoreに保存
    const db = getFirestore();
    await db.collection('users').doc(userId).set({
      xApiKey: encryptedApiKey,
      xApiKeySecret: encryptedApiKeySecret,
      xAccessToken: encryptedAccessToken,
      xAccessTokenSecret: encryptedAccessTokenSecret,
    }, { merge: true });
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Credentials save error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

// 認証情報を取得（復号化して返す）
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;
    
    // Firestoreから取得
    const db = getFirestore();
    const userDoc = await db.collection('users').doc(userId).get();
    const data = userDoc.data();
    
    if (!data || !data.xApiKey) {
      return NextResponse.json({ error: 'Credentials not found' }, { status: 404 });
    }
    
    // 復号化
    const decrypted = {
      apiKey: decrypt(data.xApiKey),
      apiKeySecret: decrypt(data.xApiKeySecret),
      accessToken: decrypt(data.xAccessToken),
      accessTokenSecret: decrypt(data.xAccessTokenSecret),
    };
    
    return NextResponse.json(decrypted);
  } catch (error: any) {
    console.error('Credentials get error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
```

##### ステップ5: クライアント側のコードを更新

`app/page.tsx`の`saveXApiCredentials`関数を更新します：

```typescript
// 暗号化はサーバー側で行うため、APIルートを呼び出す
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
      const error = await response.json();
      throw new Error(error.error || '保存に失敗しました');
    }
    
    alert('X API認証情報を保存しました');
    setShowXSettings(false);
  } catch (error: any) {
    console.error("X API認証情報の保存に失敗:", error);
    alert(`保存に失敗しました: ${error.message}`);
  }
};
```

認証情報を読み込む際も、APIルート経由で取得するように変更します：

```typescript
// 認証情報を読み込む（既存のuseEffect内で）
useEffect(() => {
  if (!user) return;
  
  const loadCredentials = async () => {
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/x/credentials', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const credentials = await response.json();
        setXApiKey(credentials.apiKey || '');
        setXApiKeySecret(credentials.apiKeySecret || '');
        setXAccessToken(credentials.accessToken || '');
        setXAccessTokenSecret(credentials.accessTokenSecret || '');
      }
    } catch (error) {
      console.error('認証情報の読み込みに失敗:', error);
    }
  };
  
  loadCredentials();
}, [user]);
```

##### ステップ6: 動作確認

1. **暗号化の確認**: 認証情報を保存後、Firebaseコンソールで確認し、平文ではなく暗号化された文字列が保存されていることを確認
2. **復号化の確認**: アプリを再読み込みし、認証情報が正しく表示されることを確認
3. **投稿機能の確認**: Xへの投稿が正常に動作することを確認

#### 注意事項

- **暗号化キーの管理**: 暗号化キーは絶対にGitにコミットしないでください
- **キーのローテーション**: 定期的に暗号化キーを変更する場合は、既存のデータも再暗号化する必要があります
- **バックアップ**: 暗号化キーは安全な場所にバックアップしてください（キーを失うとデータを復号化できません）

### Firebase Security Rules

Firestoreのセキュリティルールは、誰がどのデータにアクセスできるかを制御する重要なセキュリティ機能です。適切に設定することで、不正アクセスを防ぎます。

#### なぜSecurity Rulesが必要か？

- **不正アクセスの防止**: 他のユーザーがあなたのデータにアクセスすることを防ぎます
- **データの保護**: クライアント側からの直接アクセスを制限し、サーバー側API経由でのみアクセス可能にします
- **コンプライアンス**: セキュリティ規格に準拠するために必要です

#### 実装手順（ステップバイステップ）

##### ステップ1: Firestoreセキュリティルールファイルを作成

プロジェクトルートに`firestore.rules`ファイルを作成します：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // ユーザーコレクション
    match /users/{userId} {
      // ユーザーは自分のデータのみ読み書き可能
      // request.auth != null: ログインしている
      // request.auth.uid == userId: 自分のユーザーIDと一致
      allow read, write: if request.auth != null && request.auth.uid == userId;
      
      // X API認証情報のサブコレクション（もし使用する場合）
      match /xCredentials/{credentialId} {
        // 書き込みは可能（保存時）
        allow write: if request.auth != null && request.auth.uid == userId;
        // 読み取りは禁止（サーバー側API経由でのみ取得）
        allow read: if false;
      }
    }
    
    // その他のコレクション（例：artifacts）
    match /artifacts/{appId} {
      match /users/{userId} {
        match /daily_usage/{date} {
          // ユーザーは自分の利用状況のみ読み取り可能
          allow read: if request.auth != null && request.auth.uid == userId;
          // 書き込みはサーバー側のみ（クライアントからは不可）
          allow write: if false;
        }
      }
    }
    
    // デフォルト: すべてのアクセスを拒否
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

##### ステップ2: Firebase CLIをインストール（未インストールの場合）

```bash
# Firebase CLIをインストール
npm install -g firebase-tools

# インストール確認
firebase --version
```

##### ステップ3: Firebaseにログイン

```bash
# Firebaseにログイン
firebase login

# ブラウザが開くので、Googleアカウントでログイン
```

##### ステップ4: Firebaseプロジェクトを初期化（未初期化の場合）

```bash
# プロジェクトルートで実行
firebase init firestore

# 対話形式で設定：
# - Use an existing project: 既存のプロジェクトを選択
# - What file should be used for Firestore Rules?: firestore.rules（デフォルト）
# - What file should be used for Firestore indexes?: firestore.indexes.json（デフォルト）
```

##### ステップ5: ルールをデプロイ

```bash
# ルールのみをデプロイ
firebase deploy --only firestore:rules

# または、すべてをデプロイ
firebase deploy
```

デプロイが成功すると、以下のようなメッセージが表示されます：
```
✔  Deploy complete!
```

##### ステップ6: Firebaseコンソールで確認（代替方法）

Firebase CLIを使用しない場合は、Firebaseコンソールから直接設定できます：

1. [Firebase Console](https://console.firebase.google.com/)にアクセス
2. プロジェクトを選択
3. 左メニューから「Firestore Database」を選択
4. 「ルール」タブをクリック
5. 上記のルールをコピー＆ペースト
6. 「公開」ボタンをクリック

#### ルールの説明

##### 基本的なルール構文

```javascript
allow read, write: if request.auth != null && request.auth.uid == userId;
```

- `allow read, write`: 読み取りと書き込みを許可
- `request.auth != null`: ログインしている（認証済み）
- `request.auth.uid == userId`: リクエストのユーザーIDが、アクセス対象のドキュメントのユーザーIDと一致

##### 読み取りを禁止するルール

```javascript
allow read: if false;
```

- 常に`false`なので、読み取りを禁止
- サーバー側API経由でのみ取得可能（Firebase Admin SDKはルールをバイパス）

##### 書き込みを禁止するルール

```javascript
allow write: if false;
```

- クライアント側からの書き込みを禁止
- サーバー側API経由でのみ書き込み可能

#### 動作確認

##### 1. ルールプレイグラウンドでテスト

Firebaseコンソールの「ルールプレイグラウンド」機能を使用：

1. Firebaseコンソール → Firestore Database → ルールタブ
2. 「ルールプレイグラウンド」をクリック
3. 以下の設定でテスト：
   - **場所**: `users/{userId}`
   - **認証**: 有効なユーザーIDを入力
   - **操作**: 読み取り/書き込み
4. 「実行」をクリックして結果を確認

##### 2. 実際のアプリで確認

- **自分のデータ**: 正常に読み書きできることを確認
- **他のユーザーのデータ**: アクセスできないことを確認（エラーが表示される）

#### よくある問題と解決方法

##### 問題1: ルールが適用されない

**原因**: ルールが正しくデプロイされていない

**解決方法**:
```bash
# ルールを再デプロイ
firebase deploy --only firestore:rules
```

##### 問題2: すべてのアクセスが拒否される

**原因**: ルールの条件が厳しすぎる

**解決方法**: ルールを確認し、`request.auth.uid == userId`の条件が正しいか確認

##### 問題3: サーバー側APIからアクセスできない

**原因**: Firebase Admin SDKはルールをバイパスするため、問題ありません。クライアント側からのアクセスのみルールが適用されます。

#### セキュリティベストプラクティス

1. **最小権限の原則**: 必要最小限の権限のみを付与
2. **デフォルト拒否**: 明示的に許可しない限り、すべてのアクセスを拒否
3. **定期的な監査**: ルールを定期的に見直し、不要な権限を削除
4. **テスト**: ルールプレイグラウンドで十分にテストしてからデプロイ

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
