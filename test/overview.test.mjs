import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTournament, setResult } from '../src/engine/tournament.js';
import { teamValue } from '../src/engine/schedule.js';
import { roundsOverview, isAllRoundsPassword } from '../src/ui/tournament-view.js';

const make = (revealBatch) => createTournament({
  id: 't1', name: 'Club night', seed: 4, now: new Date('2026-10-14T18:00:00Z'),
  players: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((skill, i) => ({ name: `P${i + 1}`, skill })),
  settings: { courts: 2, rounds: 5, matchMinutes: 12, breakMinutes: 2, revealBatch },
});

test('only revealed rounds are listed', () => {
  assert.deepEqual(roundsOverview(make(2)).map((r) => r.round), [1, 2]);
  assert.deepEqual(roundsOverview(make('all')).map((r) => r.round), [1, 2, 3, 4, 5]);
});

test('each match shows names, team values and the winner', () => {
  const t = make('all');
  const m = t.schedule[0].matches[0];
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const [first] = roundsOverview(setResult(t, 1, 1, 2));
  assert.equal(first.matches[0].court, 1);
  assert.equal(first.matches[0].winner, 2);
  assert.equal(first.matches[1].winner, undefined);
  assert.equal(first.matches[0].team1.names, m.team1.map((id) => byId.get(id).name).join(' + '));
  assert.equal(first.matches[0].team1.value, teamValue(...m.team1.map((id) => byId.get(id).skill)));
  assert.equal(first.sitOuts.length, 2);
  assert.equal(first.complete, false);
});

test('a round is complete when every match has a result', () => {
  let t = make('all');
  for (const m of t.schedule[0].matches) t = setResult(t, 1, m.court, 1);
  const [first, second] = roundsOverview(t);
  assert.equal(first.complete, true);
  assert.equal(second.complete, false);
});

test('the all-rounds password is Tenerife', () => {
  assert.equal(isAllRoundsPassword('Tenerife'), true);
  assert.equal(isAllRoundsPassword(' Tenerife '), true);
  assert.equal(isAllRoundsPassword('tenerife'), false);
  assert.equal(isAllRoundsPassword(''), false);
  assert.equal(isAllRoundsPassword(null), false);
});

test('each match has team spreads and the gaps between the teams', () => {
  const t = make('all');
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const m = t.schedule[0].matches[0];
  const spread = (ids) => Math.abs(byId.get(ids[0]).skill - byId.get(ids[1]).skill);
  const value = (ids) => teamValue(byId.get(ids[0]).skill, byId.get(ids[1]).skill);
  const [first] = roundsOverview(t);
  const x = first.matches[0];
  assert.equal(x.team1.spread, spread(m.team1));
  assert.equal(x.valueGap, Math.abs(value(m.team1) - value(m.team2)));
  assert.equal(x.spreadGap, Math.abs(spread(m.team1) - spread(m.team2)));
});

test('each match knows which team has the edge (lower team value), or 0 when even', () => {
  const t = make('all');
  for (const r of roundsOverview(t)) {
    for (const m of r.matches) {
      const expected = m.team1.value < m.team2.value ? 1 : m.team2.value < m.team1.value ? 2 : 0;
      assert.equal(m.favoured, expected);
      assert.equal(m.valueGap === 0, m.favoured === 0);
    }
  }
});
