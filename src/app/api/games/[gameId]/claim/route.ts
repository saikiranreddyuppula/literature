import { NextRequest, NextResponse } from 'next/server';
import { getVisitorId } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getHalfSuitCards, getHalfSuitDisplayName, getAllHalfSuits, playerTeam } from '@/lib/game-logic';

export async function POST(
  request: NextRequest,
  { params }: { params: { gameId: string } }
) {
  const visitorId = await getVisitorId();
  if (!visitorId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { halfSuit, assignments } = await request.json();
  if (!halfSuit || !assignments) {
    return NextResponse.json({ error: 'Missing halfSuit or assignments' }, { status: 400 });
  }

  if (!getAllHalfSuits().includes(halfSuit)) {
    return NextResponse.json({ error: 'Invalid half-suit' }, { status: 400 });
  }

  const db = await getDb();
  const game = await db.collection('games').findOne({
    $or: [{ code: params.gameId }, { _id: params.gameId as any }],
  });

  if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  if (game.status !== 'playing') return NextResponse.json({ error: 'Game not in progress' }, { status: 400 });
  if (game.current_turn_player_id !== visitorId) {
    return NextResponse.json({ error: 'Not your turn' }, { status: 400 });
  }

  // Check if half-suit already claimed
  const existingClaim = await db.collection('game_claims').findOne({
    game_id: game._id,
    half_suit: halfSuit,
  });
  if (existingClaim) {
    return NextResponse.json({ error: 'Half-suit already claimed' }, { status: 400 });
  }

  const hsCards = getHalfSuitCards(halfSuit);

  if (Object.keys(assignments).length !== 6) {
    return NextResponse.json({ error: 'Must assign all 6 cards' }, { status: 400 });
  }
  for (const card of hsCards) {
    if (!assignments[card]) {
      return NextResponse.json({ error: `Missing assignment for ${card}` }, { status: 400 });
    }
  }

  const players = await db
    .collection('game_players')
    .find({ game_id: game._id })
    .toArray();

  const playerIds = new Set(players.map((p) => p.player_id));
  const claimerSeat = players.find((p) => p.player_id === visitorId);
  if (!claimerSeat) {
    return NextResponse.json({ error: 'You are not seated in this game' }, { status: 403 });
  }
  const claimerTeam = playerTeam(claimerSeat.seat_position);

  // Validate all assigned players are in the game
  for (const playerId of Object.values(assignments) as string[]) {
    const assignedSeat = players.find((p) => p.player_id === playerId);
    if (!playerIds.has(playerId) || !assignedSeat) {
      return NextResponse.json({ error: 'Can only assign cards to players in the game' }, { status: 400 });
    }
    if (playerTeam(assignedSeat.seat_position) !== claimerTeam) {
      return NextResponse.json({ error: 'Can only assign cards to your team' }, { status: 400 });
    }
  }

  // Get actual card holders
  const actualCards = await db
    .collection('game_cards')
    .find({ game_id: game._id, card: { $in: hsCards } })
    .toArray();

  const actualMap: Record<string, string> = {};
  for (const c of actualCards) {
    actualMap[c.card] = c.holder_id;
  }
  const holderTeams = new Map(
    players.map((p) => [p.player_id, playerTeam(p.seat_position)])
  );
  const anyOpponentCard = hsCards.some((card) => {
    const holderId = actualMap[card];
    return holderId && holderTeams.get(holderId) !== claimerTeam;
  });

  const claimerUser = await db.collection('users').findOne({ _id: visitorId as any });
  const claimerName = claimerUser?.display_name || '';
  const hsName = getHalfSuitDisplayName(halfSuit);

  // Check if all assignments are correct
  let allCorrect = true;
  for (const card of hsCards) {
    if (actualMap[card] !== assignments[card]) {
      allCorrect = false;
      break;
    }
  }

  let result: 'correct' | 'forfeited';
  let claimedBy: string | null;
  let claimedTeam: number | null;

  if (allCorrect) {
    result = 'correct';
    claimedBy = visitorId;
    claimedTeam = claimerTeam;
  } else {
    result = 'forfeited';
    claimedBy = null;
    claimedTeam = anyOpponentCard ? 1 - claimerTeam : null;
  }

  // Record the claim
  await db.collection('game_claims').insertOne({
    game_id: game._id,
    half_suit: halfSuit,
    claimed_by: claimedBy,
    claimed_team: claimedTeam,
    claimed_at: new Date(),
  });

  // Remove cards from game
  await db.collection('game_cards').deleteMany({
    game_id: game._id,
    card: { $in: hsCards },
  });

  // Check if all 8 half-suits claimed
  const claimCount = await db.collection('game_claims').countDocuments({ game_id: game._id });

  // On correct claim, same player keeps turn (if they have cards); on forfeit, move to next
  const claimerHasCards = allCorrect
    ? (await db.collection('game_cards').countDocuments({ game_id: game._id, holder_id: visitorId })) > 0
    : false;
  const nextTurnPlayer = claimerHasCards
    ? visitorId
    : await findNextPlayerWithCards(db, game._id, players, visitorId);

  let logMessage = '';
  if (result === 'correct') {
    logMessage = `${claimerName} correctly claimed ${hsName}!`;
  } else if (claimedTeam !== null) {
    logMessage = `${claimerName} claimed ${hsName}, but the other team had at least one card. Team ${claimedTeam + 1} gets the set.`;
  } else {
    logMessage = `${claimerName} claimed ${hsName} but got the distribution wrong. Set is voided!`;
  }

  await db.collection('game_log').insertOne({
    game_id: game._id,
    action: 'claim',
    player_id: visitorId,
    details: { halfSuit, result, claimedBy, claimedTeam, claimerName, message: logMessage },
    created_at: new Date(),
  });

  if (claimCount >= 8) {
    // Game over - find winner by most claims
    const allClaims = await db.collection('game_claims').find({ game_id: game._id }).toArray();
    const scores: Record<string, number> = {};
    const teamScores: Record<string, number> = { '0': 0, '1': 0 };
    for (const p of players) {
      scores[p.player_id] = 0;
    }
    for (const c of allClaims) {
      if (c.claimed_by) {
        scores[c.claimed_by] = (scores[c.claimed_by] || 0) + 1;
      }
      if (c.claimed_team === 0 || c.claimed_team === 1) {
        teamScores[String(c.claimed_team)] = (teamScores[String(c.claimed_team)] || 0) + 1;
      }
    }

    const winner = teamScores['0'] === teamScores['1'] ? 'tie' : (teamScores['0'] > teamScores['1'] ? '0' : '1');

    await db.collection('games').updateOne(
      { _id: game._id },
      { $set: { status: 'finished', winner, current_turn_player_id: null, updated_at: new Date() } }
    );

    await db.collection('game_log').insertOne({
      game_id: game._id,
      action: 'game_over',
      player_id: null,
      details: {
        message: winner === 'tie' ? "Game over! It's a tie!" : `Game over! Team ${Number(winner) + 1} wins!`,
        scores,
        teamScores,
      },
      created_at: new Date(),
    });
  } else if (nextTurnPlayer) {
    await db.collection('games').updateOne(
      { _id: game._id },
      { $set: { current_turn_player_id: nextTurnPlayer, updated_at: new Date() } }
    );
  } else {
    await db.collection('games').updateOne(
      { _id: game._id },
      { $set: { updated_at: new Date() } }
    );
  }

  return NextResponse.json({ ok: true, result });
}

async function findNextPlayerWithCards(
  db: any,
  gameId: any,
  players: any[],
  currentPlayerId: string
): Promise<string | null> {
  const sorted = [...players].sort((a, b) => a.seat_position - b.seat_position);
  const currentIdx = sorted.findIndex((p) => p.player_id === currentPlayerId);

  for (let i = 1; i <= sorted.length; i++) {
    const nextIdx = (currentIdx + i) % sorted.length;
    const nextPlayer = sorted[nextIdx];
    const cardCount = await db.collection('game_cards').countDocuments({
      game_id: gameId,
      holder_id: nextPlayer.player_id,
    });
    if (cardCount > 0) {
      return nextPlayer.player_id;
    }
  }

  return null;
}
