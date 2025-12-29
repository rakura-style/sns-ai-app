// クライアントサイドE2E暗号化ユーティリティ

/**
 * パスワードから暗号化キーを派生
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  
  // PBKDF2でキー派生
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * データを暗号化
 */
export async function encryptData(data: string, password: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    
    // ランダムなsaltとivを生成
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // キー派生
    const key = await deriveKey(password, salt);
    
    // 暗号化
    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      dataBuffer
    );
    
    // salt + iv + 暗号化データを結合
    const encryptedArray = new Uint8Array(encryptedBuffer);
    const resultArray = new Uint8Array(salt.length + iv.length + encryptedArray.length);
    resultArray.set(salt, 0);
    resultArray.set(iv, salt.length);
    resultArray.set(encryptedArray, salt.length + iv.length);
    
    // Base64エンコード
    return btoa(String.fromCharCode(...resultArray));
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('暗号化に失敗しました');
  }
}

/**
 * データを復号化
 */
export async function decryptData(encryptedData: string, password: string): Promise<string> {
  try {
    // Base64デコード
    const encryptedArray = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    
    // salt、iv、暗号化データを分離
    const salt = encryptedArray.slice(0, 16);
    const iv = encryptedArray.slice(16, 28);
    const data = encryptedArray.slice(28);
    
    // キー派生
    const key = await deriveKey(password, salt);
    
    // 復号化
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );
    
    // デコード
    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('復号化に失敗しました。パスワードが正しいか確認してください。');
  }
}

/**
 * 複数のAPIキーを暗号化
 */
export async function encryptApiKeys(
  keys: { [key: string]: string },
  password: string
): Promise<{ [key: string]: string }> {
  const encrypted: { [key: string]: string } = {};
  
  for (const [key, value] of Object.entries(keys)) {
    if (value) {
      encrypted[key] = await encryptData(value, password);
    }
  }
  
  return encrypted;
}

/**
 * 複数のAPIキーを復号化
 */
export async function decryptApiKeys(
  encryptedKeys: { [key: string]: string },
  password: string
): Promise<{ [key: string]: string }> {
  const decrypted: { [key: string]: string } = {};
  
  for (const [key, value] of Object.entries(encryptedKeys)) {
    if (value) {
      try {
        decrypted[key] = await decryptData(value, password);
      } catch (error) {
        console.error(`Failed to decrypt ${key}`);
        // 復号化失敗した場合は空文字列
        decrypted[key] = '';
      }
    }
  }
  
  return decrypted;
}

