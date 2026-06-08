import { NextRequest, NextResponse } from 'next/server';
import { getVisitorId } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { createDeck, shuffleDeck } from '@/lib/game-logic';

// Determine the best seat count (6, 8, or 12) for a given number of players.
// Picks the largest valid seat count that is <= playerCount.
function determineSeatCount(playerCount: number): number | null {
  const validCounts = [12, 8, 6]; // descending
  for (const count of validCounts) {
    if (playerCount >= count) return count;
  }
  return null; // not enough players
}

export async function POST(
  _request: NextRequest,
  { params }: { params: { gameId: string } }
) {
  const visitorId = await getVisitorId();
  if (!visitorId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const db = await getDb();
  const game = await db.collection('games').findOne({
    $or: [{ code: params.gameId }, { _id: params.gameId as any }],
  });

  if (!game) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }
  if (game.created_by !== visitorId) {
    return NextResponse.json({ error: 'Only the host can start the game' }, { status: 403 });
  }
  if (game.status !== 'waiting') {
    return NextResponse.json({ error: 'Game already started' }, { status: 400 });
  }

  const players = await db
    .collection('game_players')
    .find({ game_id: game._id })
    .sort({ seat_position: 1 })
    .toArray();

  const seatCount = game.max_players || determineSeatCount(players.length);

  if (!seatCount) {
    return NextResponse.json(
      { error: `Need at least 6 players to start (currently ${players.length})` },
      { status: 400 }
    );
  }
  if (game.max_players && players.length !== game.max_players) {
    return NextResponse.json(
      { error: `Need exactly ${game.max_players} players to start` },
      { status: 400 }
    );
  }

  // First seatCount players are primary seat holders
  const primaryPlayers = players.slice(0, seatCount);
  const extraPlayers = players.slice(seatCount);

  // Pair extra players with random primary players
  if (extraPlayers.length > 0) {
    const shuffledPrimaries = [...primaryPlayers].sort(() => Math.random() - 0.5);
    for (let i = 0; i < extraPlayers.length; i++) {
      const partner = shuffledPrimaries[i % shuffledPrimaries.length];
      await db.collection('game_players').updateOne(
        { game_id: game._id, player_id: extraPlayers[i].player_id },
        { $set: { paired_with: partner.player_id } }
      );
    }
  }

  const deck = shuffleDeck(createDeck());

  // Deal cards only to primary seated players
  const cardDocs = deck.map((card, i) => ({
    game_id: game._id,
    card,
    holder_id: primaryPlayers[i % seatCount].player_id,
  }));

  await db.collection('game_cards').insertMany(cardDocs);

  // Store the determined seat count as max_players
  await db.collection('games').updateOne(
    { _id: game._id },
    {
      $set: {
        status: 'playing',
        max_players: seatCount,
        current_turn_player_id: primaryPlayers[0].player_id,
        updated_at: new Date(),
      },
    }
  );

  await db.collection('game_log').insertOne({
    game_id: game._id,
    action: 'game_started',
    player_id: visitorId,
    details: {
      message: `Game started with ${players.length} players in ${seatCount} seats!`,
      seatCount,
      totalPlayers: players.length,
      pairedPlayers: extraPlayers.length > 0
        ? extraPlayers.map((ep) => ep.player_id)
        : undefined,
    },
    created_at: new Date(),
  });

  return NextResponse.json({ ok: true });
}
