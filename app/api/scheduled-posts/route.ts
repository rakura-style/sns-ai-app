import { NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebaseAdmin';
import * as admin from 'firebase-admin';

// 予約投稿の取得
export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];

    if (!token || !adminAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;

    if (!adminDb || typeof adminDb.collection !== 'function') {
      return NextResponse.json({ error: 'Database not initialized' }, { status: 503 });
    }

    // ユーザーの予約投稿一覧を取得（未投稿のみ、投稿時刻でソート）
    const scheduledPostsRef = adminDb.collection('users').doc(userId).collection('scheduledPosts');
    const snapshot = await scheduledPostsRef
      .where('posted', '==', false)
      .orderBy('scheduledAt', 'asc')
      .get();

    const posts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      scheduledAt: doc.data().scheduledAt?.toDate?.()?.toISOString() || doc.data().scheduledAt,
    }));

    return NextResponse.json({ posts });
  } catch (error: any) {
    console.error('Get scheduled posts error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 予約投稿の作成
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];

    if (!token || !adminAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;

    const { content, scheduledAt, destination } = await req.json();

    if (!content || !scheduledAt) {
      return NextResponse.json({ error: 'Content and scheduledAt are required' }, { status: 400 });
    }

    // 予約時刻が過去でないかチェック
    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate <= new Date()) {
      return NextResponse.json({ error: 'Scheduled time must be in the future' }, { status: 400 });
    }

    if (!adminDb || typeof adminDb.collection !== 'function') {
      return NextResponse.json({ error: 'Database not initialized' }, { status: 503 });
    }

    // 予約投稿を保存
    const scheduledPostsRef = adminDb.collection('users').doc(userId).collection('scheduledPosts');
    const docRef = await scheduledPostsRef.add({
      content,
      scheduledAt: admin.firestore.Timestamp.fromDate(scheduledDate),
      destination: destination || 'x', // デフォルトはX
      posted: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: docRef.id, success: true });
  } catch (error: any) {
    console.error('Create scheduled post error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 予約投稿の削除
export async function DELETE(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];

    if (!token || !adminAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;

    const { searchParams } = new URL(req.url);
    const postId = searchParams.get('id');

    if (!postId) {
      return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
    }

    if (!adminDb || typeof adminDb.collection !== 'function') {
      return NextResponse.json({ error: 'Database not initialized' }, { status: 503 });
    }

    // 予約投稿を削除
    const postRef = adminDb.collection('users').doc(userId).collection('scheduledPosts').doc(postId);
    await postRef.delete();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete scheduled post error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

