import { NextRequest, NextResponse } from 'next/server';
import { getVisitorId } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(
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

  const players = await db
    .collection('game_players')
    .aggregate([
      { $match: { game_id: game._id } },
      {
        $lookup: {
          from: 'users',
          localField: 'player_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $project: {
          player_id: 1,
          seat_position: 1,
          paired_with: 1,
          display_name: '$user.display_name',
          avatar: '$user.avatar',
        },
      },
      { $sort: { seat_position: 1 } },
    ])
    .toArray();

  const isPlayer = players.some((p) => p.player_id === visitorId);

  const allCards = await db
    .collection('game_cards')
    .find({ game_id: game._id })
    .toArray();

  // If current player is paired with someone, show partner's cards
  const myPlayerRecord = players.find((p) => p.player_id === visitorId);
  const myCardHolder = myPlayerRecord?.paired_with || visitorId;

  const myCards = allCards.filter((c) => c.holder_id === myCardHolder).map((c) => c.card);
  const cardCounts: Record<string, number> = {};
  for (const p of players) {
    // For paired players, show same card count as their partner
    const holderId = p.paired_with || p.player_id;
    cardCounts[p.player_id] = allCards.filter((c) => c.holder_id === holderId).length;
  }

  const claims = await db
    .collection('game_claims')
    .find({ game_id: game._id })
    .toArray();

  const showLog = game.show_log !== false;
  const logs = await db
    .collection('game_log')
    .find({ game_id: game._id })
    .sort({ _id: -1 })
    .limit(showLog ? 50 : 2)
    .toArray();

  // Compute individual scores from claims
  const scores: Record<string, number> = {};
  const teamScores: Record<string, number> = { '0': 0, '1': 0 };
  const playerTeams: Record<string, number> = {};
  for (const p of players) {
    scores[p.player_id] = 0;
    playerTeams[p.player_id] = p.seat_position % 2;
  }
  for (const c of claims) {
    if (c.claimed_by) {
      scores[c.claimed_by] = (scores[c.claimed_by] || 0) + 1;
    }
    const team = c.claimed_team ?? (c.claimed_by ? playerTeams[c.claimed_by] : null);
    if (team === 0 || team === 1) {
      teamScores[String(team)] = (teamScores[String(team)] || 0) + 1;
    }
  }

  // For waiting games, compute what the seat count would be
  const validCounts = [12, 8, 6];
  const computedSeatCount = game.max_players || (validCounts.find(c => players.length >= c) || 6);

  return NextResponse.json({
    id: game._id,
    code: game.code,
    status: game.status,
    maxPlayers: computedSeatCount,
    isFlexible: game.max_players == null,
    currentTurnPlayerId: game.current_turn_player_id,
    createdBy: game.created_by,
    scores,
    teamScores,
    winner: game.winner,
    showLog,
    updatedAt: game.updated_at,
    isPlayer,
    myPlayerId: visitorId,
    myCards,
    players: players.map((p) => ({
      id: p.player_id,
      name: p.display_name,
      avatar: p.avatar || '',
      seatPosition: p.seat_position,
      team: p.seat_position % 2,
      cardCount: cardCounts[p.player_id] || 0,
      pairedWith: p.paired_with || null,
    })),
    claims: claims.map((c) => ({
      half_suit: c.half_suit,
      claimed_by: c.claimed_by || null,
      claimed_team: c.claimed_team ?? (c.claimed_by ? playerTeams[c.claimed_by] : null),
    })),
    logs: Buffer.from(JSON.stringify(logs.map((l) => ({
      action: l.action,
      playerId: l.player_id,
      details: l.details ? (typeof l.details === 'string' ? JSON.parse(l.details) : l.details) : null,
      createdAt: l.created_at,
    })))).toString('base64'),
  });
}
