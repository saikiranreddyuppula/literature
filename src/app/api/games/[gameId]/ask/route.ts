import { NextRequest, NextResponse } from 'next/server';
import { getVisitorId } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getHalfSuit, getHalfSuitCards, getHalfSuitDisplayName, isValidCard, playerTeam } from '@/lib/game-logic';

export async function POST(
  request: NextRequest,
  { params }: { params: { gameId: string } }
) {
  const visitorId = await getVisitorId();
  if (!visitorId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { targetPlayerId, card } = await request.json();
  if (!targetPlayerId || !card) {
    return NextResponse.json({ error: 'Missing targetPlayerId or card' }, { status: 400 });
  }
  if (!isValidCard(card)) {
    return NextResponse.json({ error: 'Invalid card' }, { status: 400 });
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

  const players = await db
    .collection('game_players')
    .find({ game_id: game._id })
    .toArray();

  const asker = players.find((p) => p.player_id === visitorId);
  if (!asker) {
    return NextResponse.json({ error: 'You are not seated in this game' }, { status: 403 });
  }

  const target = players.find((p) => p.player_id === targetPlayerId);
  if (!target) return NextResponse.json({ error: 'Target player not found' }, { status: 400 });
  if (targetPlayerId === visitorId) {
    return NextResponse.json({ error: 'Cannot ask yourself' }, { status: 400 });
  }
  if (playerTeam(target.seat_position) === playerTeam(asker.seat_position)) {
    return NextResponse.json({ error: 'You can only ask an opponent' }, { status: 400 });
  }

  // Check target has at least one card
  const targetCardCount = await db.collection('game_cards').countDocuments({
    game_id: game._id,
    holder_id: targetPlayerId,
  });
  if (targetCardCount === 0) {
    return NextResponse.json({ error: 'Target player has no cards' }, { status: 400 });
  }

  // Validate: asker must have another card in the same half-suit
  const askerCards = await db
    .collection('game_cards')
    .find({ game_id: game._id, holder_id: visitorId })
    .toArray();
  const askerCardList = askerCards.map((c) => c.card);

  if (askerCardList.includes(card)) {
    return NextResponse.json({ error: 'You already have this card' }, { status: 400 });
  }

  const requestedHalfSuit = getHalfSuit(card);
  const hasCardInHalfSuit = askerCardList.some((c) => getHalfSuit(c) === requestedHalfSuit);
  if (!hasCardInHalfSuit) {
    return NextResponse.json({ error: 'You must hold a card in the same half-suit' }, { status: 400 });
  }

  // Check if target has the card
  const targetHasCard = await db.collection('game_cards').findOne({
    game_id: game._id,
    card,
    holder_id: targetPlayerId,
  });

  const askerUser = await db.collection('users').findOne({ _id: visitorId as any });
  const targetUser = await db.collection('users').findOne({ _id: targetPlayerId as any });
  const askerName = askerUser?.display_name || '';
  const targetName = targetUser?.display_name || '';

  if (targetHasCard) {
    // Transfer card
    await db.collection('game_cards').updateOne(
      { game_id: game._id, card },
      { $set: { holder_id: visitorId } }
    );

    await db.collection('games').updateOne(
      { _id: game._id },
      { $set: { updated_at: new Date() } }
    );

    await db.collection('game_log').insertOne({
      game_id: game._id,
      action: 'ask_success',
      player_id: visitorId,
      details: { target: targetPlayerId, targetName, card, askerName, message: `${askerName} asked ${targetName} for ${card} - Got it!` },
      created_at: new Date(),
    });

    // Auto-claim: check if asker now holds all 6 cards of the half-suit
    const hs = getHalfSuit(card);
    const hsCards = getHalfSuitCards(hs);
    const askerHsCards = await db.collection('game_cards').find({
      game_id: game._id,
      card: { $in: hsCards },
      holder_id: visitorId,
    }).toArray();

    if (askerHsCards.length === 6) {
      // Check not already claimed
      const existingClaim = await db.collection('game_claims').findOne({
        game_id: game._id,
        half_suit: hs,
      });

      if (!existingClaim) {
        const hsName = getHalfSuitDisplayName(hs);

        // Record claim
        await db.collection('game_claims').insertOne({
          game_id: game._id,
          half_suit: hs,
          claimed_by: visitorId,
          claimed_team: playerTeam(asker.seat_position),
          claimed_at: new Date(),
        });

        // Remove cards from game
        await db.collection('game_cards').deleteMany({
          game_id: game._id,
          card: { $in: hsCards },
        });

        await db.collection('game_log').insertOne({
          game_id: game._id,
          action: 'auto_claim',
          player_id: visitorId,
          details: { halfSuit: hs, result: 'correct', claimedBy: visitorId, claimerName: askerName, message: `${askerName} collected all cards and auto-claimed ${hsName}!` },
          created_at: new Date(),
        });

        // Check if all 8 half-suits claimed
        const claimCount = await db.collection('game_claims').countDocuments({ game_id: game._id });
        if (claimCount >= 8) {
          const allClaims = await db.collection('game_claims').find({ game_id: game._id }).toArray();
          const scores: Record<string, number> = {};
          const teamScores: Record<string, number> = { '0': 0, '1': 0 };
          for (const p of players) scores[p.player_id] = 0;
          for (const c of allClaims) {
            if (c.claimed_by) scores[c.claimed_by] = (scores[c.claimed_by] || 0) + 1;
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
            details: { message: winner === 'tie' ? "Game over! It's a tie!" : `Game over! Team ${Number(winner) + 1} wins!`, scores, teamScores },
            created_at: new Date(),
          });
        } else {
          // Check if current player still has cards
          const remainingCards = await db.collection('game_cards').countDocuments({
            game_id: game._id,
            holder_id: visitorId,
          });
          if (remainingCards === 0) {
            // Find next player with cards
            const sorted = [...players].sort((a, b) => a.seat_position - b.seat_position);
            const currentIdx = sorted.findIndex(p => p.player_id === visitorId);
            let nextPlayer: string | null = null;
            for (let i = 1; i <= sorted.length; i++) {
              const nextIdx = (currentIdx + i) % sorted.length;
              const np = sorted[nextIdx];
              const cc = await db.collection('game_cards').countDocuments({
                game_id: game._id, holder_id: np.player_id,
              });
              if (cc > 0) { nextPlayer = np.player_id; break; }
            }
            if (nextPlayer) {
              await db.collection('games').updateOne(
                { _id: game._id },
                { $set: { current_turn_player_id: nextPlayer, updated_at: new Date() } }
              );
            }
          } else {
            await db.collection('games').updateOne(
              { _id: game._id },
              { $set: { updated_at: new Date() } }
            );
          }
        }
      }
    }

    return NextResponse.json({ ok: true, gotCard: true });
  } else {
    // Turn passes to target
    await db.collection('games').updateOne(
      { _id: game._id },
      { $set: { current_turn_player_id: targetPlayerId, updated_at: new Date() } }
    );

    await db.collection('game_log').insertOne({
      game_id: game._id,
      action: 'ask_fail',
      player_id: visitorId,
      details: { target: targetPlayerId, targetName, card, askerName, message: `${askerName} asked ${targetName} for ${card} - Nope!` },
      created_at: new Date(),
    });

    return NextResponse.json({ ok: true, gotCard: false });
  }
}
