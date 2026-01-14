import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { decrypt, encrypt } from '@/lib/encryption';

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token || !adminAuth || !adminDb) return jsonError('Unauthorized', 401);

    const decoded = await adminAuth.verifyIdToken(token);
    const userId = decoded.uid;

    const body = await req.json();
    const apiKey = body?.apiKey;
    const apiKeySecret = body?.apiKeySecret;
    const accessToken = body?.accessToken;
    const accessTokenSecret = body?.accessTokenSecret;

    if (
      !apiKey || !apiKeySecret || !accessToken || !accessTokenSecret ||
      typeof apiKey !== 'string' || typeof apiKeySecret !== 'string' ||
      typeof accessToken !== 'string' || typeof accessTokenSecret !== 'string'
    ) {
      return jsonError('All credentials are required', 400);
    }

    const payload = {
      xApiKey: encrypt(apiKey),
      xApiKeySecret: encrypt(apiKeySecret),
      xAccessToken: encrypt(accessToken),
      xAccessTokenSecret: encrypt(accessTokenSecret),
    };

    await adminDb.collection('users').doc(userId).set(payload, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('X credentials POST error:', error);
    return jsonError('Internal server error', 500);
  }
}

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token || !adminAuth || !adminDb) return jsonError('Unauthorized', 401);

    const decoded = await adminAuth.verifyIdToken(token);
    const userId = decoded.uid;

    const snap = await adminDb.collection('users').doc(userId).get();
    if (!snap.exists) return jsonError('Credentials not found', 404);

    const data = snap.data() || {};
    if (!data.xApiKey || !data.xApiKeySecret || !data.xAccessToken || !data.xAccessTokenSecret) {
      return jsonError('Credentials not found', 404);
    }

    return NextResponse.json({
      apiKey: decrypt(String(data.xApiKey)),
      apiKeySecret: decrypt(String(data.xApiKeySecret)),
      accessToken: decrypt(String(data.xAccessToken)),
      accessTokenSecret: decrypt(String(data.xAccessTokenSecret)),
    });
  } catch (error: any) {
    console.error('X credentials GET error:', error);
    // decrypt may throw if old plaintext data exists; return 404 to force re-save
    return jsonError('Credentials not found', 404);
  }
}

