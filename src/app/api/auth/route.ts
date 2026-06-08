import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createToken, getVisitorId } from '@/lib/auth';
import { getDb } from '@/lib/db';

const ALLOWED_AVATARS = [
  '😀','😎','🤓','🧐','😏','🥳','🤩','😤','🫡','🤠',
  '🦊','🐱','🐶','🦁','🐸','🐵','🦄','🐧','🐼','🐨',
  '🦋','🐝','🐙','🦈','🐉','🦅','🐺','🦖','🐯','🐻',
  '🌟','🔥','💎','🎯','🎲','🎪','⚡','🍀','🎭','🏆',
  '👑','💫','🌸','🎸','🚀','🌊','🎵','🍕','👻','💀',
];

export async function GET() {
  const visitorId = await ensureVisitorId();

  const db = await getDb();
  const user = await db.collection('users').findOne({ _id: visitorId as any });

  return NextResponse.json({
    visitorId,
    name: user?.display_name || '',
    avatar: user?.avatar || '',
  });
}

export async function POST(request: NextRequest) {
  const visitorId = await ensureVisitorId();

  const body = await request.json();
  const { name, avatar } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const displayName = name.trim().slice(0, 20);
  const setFields: Record<string, unknown> = { display_name: displayName };

  if (avatar && ALLOWED_AVATARS.includes(avatar)) {
    setFields.avatar = avatar;
  }

  const db = await getDb();

  await db.collection('users').updateOne(
    { _id: visitorId as any },
    { $set: setFields, $setOnInsert: { created_at: new Date() } },
    { upsert: true }
  );

  return NextResponse.json({ visitorId, name: displayName, avatar: setFields.avatar || '' });
}

async function ensureVisitorId(): Promise<string> {
  const existing = await getVisitorId();
  if (existing) return existing;

  const visitorId = crypto.randomUUID();
  const token = await createToken(visitorId);
  cookies().set('visitor_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60,
    path: '/',
  });
  return visitorId;
}
