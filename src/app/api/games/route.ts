import { NextRequest, NextResponse } from 'next/server';
import { getVisitorId } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { generateGameCode } from '@/lib/game-logic';

export async function POST(request: NextRequest) {
  const visitorId = await getVisitorId();
  if (!visitorId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const db = await getDb();
  const user = await db.collection('users').findOne({ _id: visitorId as any });
  if (!user || !user.display_name) {
    return NextResponse.json({ error: 'Please set your name first' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const fixedCounts = [6, 8];
  const maxPlayers = fixedCounts.includes(body.maxPlayers) ? body.maxPlayers : null;
  const showLog = body.showLog !== false;

  let code = generateGameCode();
  while (await db.collection('games').findOne({ code })) {
    code = generateGameCode();
  }

  const gameId = crypto.randomUUID();
  const now = new Date();

  await db.collection('games').insertOne({
    _id: gameId as any,
    code,
    status: 'waiting',
    max_players: maxPlayers,
    current_turn_player_id: null,
    created_by: visitorId,
    winner: null,
    show_log: showLog,
    created_at: now,
    updated_at: now,
  });

  await db.collection('game_players').insertOne({
    game_id: gameId,
    player_id: visitorId,
    seat_position: 0,
  });

  return NextResponse.json({ gameId, code, isFlexible: maxPlayers === null });
}
