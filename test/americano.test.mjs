import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTournament, setScore, setResult, firstRedrawableRound, swapPlayers } from '../src/engine/tournament.js';
import { computeStandings } from '../src/engine/standings.js';
import { validateTournament } from '../src/engine/validate.js';
import { tournamentSummary } from '../src/engine/summary.js';

const americano = { mode: 'americano', points: 24 };
// 5 players on 1 court: one sits out each round, so the games come out uneven.
const make = () => createTournament({ id: 't', name: 'x', seed: 2, now: new Date(),
  players: [1, 2, 3, 4, 5].map((skill, i) => ({ name: `P${i + 1}`, skill })),
  settings: { courts: 1, rounds: 3, matchMinutes: 10, breakMinutes: 2, revealBatch: 'all', scoring: americano } });

test('an Americano result is its score: points adding up to the total; equal points are a draw', () => {
  const t = make();
  assert.equal(setScore(t, 1, 1, [[15, 9]]).results['1-1'], 1);
  assert.equal(setScore(t, 1, 1, [[9, 15]]).results['1-1'], 2);
  const draw = setScore(t, 1, 1, [[12, 12]]);
  assert.equal(draw.results['1-1'], 0);
  assert.equal(validateTournament(draw).ok, true);
  assert.throws(() => setScore(t, 1, 1, [[15, 10]]), /add up to 24/);
  assert.throws(() => setScore(t, 1, 1, [[15, 9], [12, 12]]), /both teams/);
  assert.throws(() => setResult(t, 1, 1, 1), /result is its score/);
  assert.ok(!('1-1' in setResult(draw, 1, 1, null).results), 'a result can still be cleared');
  assert.equal(firstRedrawableRound(draw), 2, 'a draw counts as a result');
  const m = draw.schedule[0].matches[0];
  assert.throws(() => swapPlayers(draw, 1, m.team1[0], m.team2[0]), /already has a result/);
  assert.match(validateTournament({ ...draw, scores: { '1-1': [[12, 13]] } }).error, /Americano score/);
  assert.match(validateTournament({ ...draw, settings: { ...draw.settings, scoring: { mode: 'americano', points: 0 } } }).error, /Invalid scoring/);
});

test('Americano standings: the points scored, plus the own average for missing games', () => {
  let t = make();
  const scores = [[15, 9], [12, 12], [20, 4]];
  t.schedule.forEach((r, i) => { t = setScore(t, r.round, 1, [scores[i]]); });
  const rows = computeStandings(t.players, t.schedule, t.results, t.scores, americano);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  // Expected, from the schedule: each player's points, wins, draws and games.
  const expected = new Map(t.players.map((p) => [p.id, { points: 0, wins: 0, draws: 0, games: 0 }]));
  t.schedule.forEach((r, i) => {
    const m = r.matches[0];
    for (const [team, mine] of [[m.team1, 0], [m.team2, 1]]) for (const id of team) {
      const e = expected.get(id);
      e.points += scores[i][mine];
      e.games++;
      if (scores[i][mine] > scores[i][1 - mine]) e.wins++;
      if (scores[i][0] === scores[i][1]) e.draws++;
    }
  });
  const most = Math.max(...[...expected.values()].map((e) => e.games));
  for (const [id, e] of expected) {
    const bonus = Math.round(((e.points / e.games) * (most - e.games)) * 10) / 10;
    assert.equal(byId[id].pointsFor, e.points, id);
    assert.equal(byId[id].bonus, bonus, `${id}: average for missing games`);
    assert.equal(byId[id].points, Math.round((e.points + bonus) * 10) / 10);
    assert.deepEqual([byId[id].wins, byId[id].draws, byId[id].losses], [e.wins, e.draws, e.games - e.wins - e.draws]);
  }
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].points >= r.points), 'ranked by points');
  const summary = Object.fromEntries(tournamentSummary(t).map((x) => [x.title, x.text]));
  assert.match(summary['By the numbers'], /^3 matches played, 1 draw\./);
});
