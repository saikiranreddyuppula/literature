import { NextRequest, NextResponse } from 'next/server';
import { getVisitorId } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function POST(
  _request: NextRequest,
  { params }: { params: { gameId: string } }
) {
  const visitorId = await getVisitorId();
  if (!visitorId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const db = await getDb();
  const user = await db.collection('users').findOne({ _id: visitorId as any });
  if (!user || !user.display_name) {
    return NextResponse.json({ error: 'Please set your name first' }, { status: 400 });
  }

  const game = await db.collection('games').findOne({
    $or: [{ code: params.gameId }, { _id: params.gameId as any }],
  });

  if (!game) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }
  if (game.status !== 'waiting') {
    return NextResponse.json({ error: 'Game already started' }, { status: 400 });
  }

  const existing = await db.collection('game_players').findOne({
    game_id: game._id,
    player_id: visitorId,
  });
  if (existing) {
    return NextResponse.json({ ok: true, message: 'Already in game' });
  }

  const playerCount = await db.collection('game_players').countDocuments({ game_id: game._id });

  // Fixed-size mobile rooms stop at their requested table size. Web rooms
  // without max_players keep the flexible pairing behavior.
  const playerLimit = game.max_players || 24;
  if (playerCount >= playerLimit) {
    return NextResponse.json({ error: 'Game is full' }, { status: 400 });
  }

  await db.collection('game_players').insertOne({
    game_id: game._id,
    player_id: visitorId,
    seat_position: playerCount,
  });

  await db.collection('games').updateOne(
    { _id: game._id },
    { $set: { updated_at: new Date() } }
  );

  return NextResponse.json({ ok: true });
}
