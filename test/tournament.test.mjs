import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlayers, renameTournament, swapPlayers, swapPlayersAcross, createTournament, revealNext, hasResults, redraw, setResult, updateSettings, withdrawPlayers, firstRedrawableRound, isActive, isFinished, finishTournament, reopenTournament, setSkills, redrawRemaining, setScore } from '../src/engine/tournament.js';
import { validateTournament } from '../src/engine/validate.js';

test('parsePlayers reads "Name: skill" lines', () => {
  const { players, errors } = parsePlayers('Anna: 3\nBen Miller: 7\n\n  Müller, Jörg : 1 \r\nDavid:10\n');
  assert.deepEqual(errors, []);
  assert.deepEqual(players, [
    { name: 'Anna', skill: 3 },
    { name: 'Ben Miller', skill: 7 },
    { name: 'Müller, Jörg', skill: 1 },
    { name: 'David', skill: 10 },
  ]);
});

test('parsePlayers reports bad lines and keeps the good ones', () => {
  const { players, errors } = parsePlayers('Anna: 0\nBen: 11\nCarla 3\nanna: 4\nAnna: 5\n: 4\nHans: 3.5\nIda:');
  assert.deepEqual(players, [{ name: 'anna', skill: 4 }]);
  assert.equal(errors.length, 7);
  assert.match(errors[0], /^Line 1: skill must be a whole number from 1 to 10/);
  assert.match(errors[1], /^Line 2: skill must be a whole number from 1 to 10/);
  assert.match(errors[2], /^Line 3: expected "skill: Name, Name" or "Name: skill"/);
  assert.match(errors[3], /^Line 5: duplicate name "Anna"/);
  assert.match(errors[4], /^Line 6: expected "skill: Name, Name" or "Name: skill"/);
  assert.match(errors[5], /^Line 7: skill must be a whole number from 1 to 10/);
  assert.match(errors[6], /^Line 8: skill must be a whole number from 1 to 10/);
});

const SETTINGS = { courts: 2, rounds: 6, matchMinutes: 12, breakMinutes: 2, revealBatch: 2 };
const PLAYERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((skill, i) => ({ name: `P${i + 1}`, skill }));
const make = (settings = SETTINGS) => createTournament({
  id: 't1', name: 'Club night', players: PLAYERS, settings, seed: 11, now: new Date('2026-10-14T18:00:00Z'),
});

test('createTournament builds a complete tournament', () => {
  const t = make();
  assert.equal(t.version, 2);
  assert.equal(t.id, 't1');
  assert.equal(t.createdAt, '2026-10-14T18:00:00.000Z');
  assert.deepEqual(t.players[0], { id: 'p1', name: 'P1', skill: 1 });
  assert.equal(t.schedule.length, 6);
  assert.equal(t.revealedRounds, 2);
  assert.deepEqual(t.results, {});
  assert.equal(t.seed, 11);
});

test('revealNext reveals batches until all rounds are visible', () => {
  let t = make();
  t = revealNext(t); assert.equal(t.revealedRounds, 4);
  t = revealNext(t); assert.equal(t.revealedRounds, 6);
  t = revealNext(t); assert.equal(t.revealedRounds, 6);
  assert.equal(make({ ...SETTINGS, revealBatch: 'all' }).revealedRounds, 6);
});

test('setResult sets, changes and clears a result without changing the input', () => {
  const t = make();
  const a = setResult(t, 1, 1, 2);
  assert.deepEqual(a.results, { '1-1': 2 });
  assert.deepEqual(t.results, {});
  assert.equal(hasResults(a), true);
  assert.deepEqual(setResult(a, 1, 1, null).results, {});
  assert.throws(() => setResult(t, 1, 9, 1), /Unknown match/);
});

test('redraw creates a new schedule, but not after results were entered', () => {
  const t = make();
  const r = redraw(t, 99);
  assert.equal(r.seed, 99);
  assert.notDeepEqual(r.schedule, t.schedule);
  assert.throws(() => redraw(setResult(t, 1, 1, 1), 5), /results/);
});

test('updateSettings changes a tournament that has not started and draws a new schedule', () => {
  const t = make();
  const players = [...PLAYERS.slice(0, 8), { name: 'New Player', skill: 2 }];
  const u = updateSettings(t, { name: 'Renamed', players, settings: { ...SETTINGS, courts: 1, rounds: 4, revealBatch: 'all' } }, 77);
  assert.equal(u.id, t.id);
  assert.equal(u.createdAt, t.createdAt);
  assert.equal(u.name, 'Renamed');
  assert.equal(u.seed, 77);
  assert.deepEqual(u.players.map((p) => p.id), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
  assert.equal(u.players[8].name, 'New Player');
  assert.equal(u.schedule.length, 4);
  u.schedule.forEach((r) => assert.equal(r.matches.length, 1));
  assert.equal(u.revealedRounds, 4);
  assert.deepEqual(u.results, {});
  assert.equal(t.name, 'Club night', 'input unchanged');
});

test('updateSettings is refused once a result has been entered', () => {
  const started = setResult(make(), 1, 1, 1);
  assert.throws(() => updateSettings(started, { name: 'x', players: PLAYERS, settings: SETTINGS }, 1), /results/);
});

const pairsOf = (rounds) => rounds.flatMap((r) => r.matches.flatMap((m) => [m.team1, m.team2].map((x) => [...x].sort().join('+'))));

test('withdrawPlayers keeps the played rounds and redraws the rest without the players', () => {
  let t = setResult(setResult(make(), 1, 1, 1), 2, 2, 2); // round 2 partly entered
  assert.equal(firstRedrawableRound(t), 3);
  const w = withdrawPlayers(t, ['p3', 'p7'], 5);
  assert.deepEqual(w.schedule.slice(0, 2), t.schedule.slice(0, 2));
  assert.deepEqual(w.results, t.results);
  assert.equal(w.schedule.length, 6);
  assert.deepEqual(w.players.filter((p) => !isActive(p)).map((p) => [p.id, p.withdrawnAfter]), [['p3', 2], ['p7', 2]]);
  for (const r of w.schedule.slice(2)) {
    const ids = [...r.matches.flatMap((m) => [...m.team1, ...m.team2]), ...r.sitOuts];
    assert.equal(ids.length, 8);
    assert.ok(!ids.includes('p3') && !ids.includes('p7'));
    assert.equal(r.matches.length, 2);
    assert.deepEqual(r.sitOuts, []);
  }
  assert.deepEqual(w.schedule.map((r) => r.round), [1, 2, 3, 4, 5, 6]);
  const pairs = pairsOf(w.schedule);
  assert.ok(pairs.length - new Set(pairs).size <= 2, 'old rounds count: at most a couple of partners repeat');
  assert.equal(t.players.every(isActive), true, 'input unchanged');
});

test('withdrawPlayers sits out the players who have played most so far', () => {
  const players = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2].map((skill, i) => ({ name: `P${i + 1}`, skill }));
  const t = createTournament({ id: 't', name: 'x', players, settings: { ...SETTINGS, rounds: 4 }, seed: 3, now: new Date() });
  const played = setResult(t, 1, 1, 1);
  const w = withdrawPlayers(played, ['p1'], 4); // 11 left on 2 courts: 3 sit out per round
  const satOut = new Set(t.schedule[0].sitOuts);
  const next = w.schedule[1].sitOuts;
  assert.equal(next.length, 3);
  assert.ok(next.every((id) => !satOut.has(id)), 'who sat out in round 1 plays in round 2');
});

test('withdrawPlayers refuses impossible requests', () => {
  const t = make();
  assert.throws(() => withdrawPlayers(t, ['p1'], 1), /Edit settings/);
  const started = setResult(t, 1, 1, 1);
  assert.throws(() => withdrawPlayers(started, [], 1), /at least one/);
  assert.throws(() => withdrawPlayers(started, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], 1), /At least 4/);
  const w = withdrawPlayers(started, ['p1'], 1);
  assert.throws(() => withdrawPlayers(setResult(w, 2, 1, 1), ['p1'], 1), /already withdrawn/);
  let done = t;
  for (let r = 1; r <= 6; r++) done = setResult(done, r, 1, 1);
  assert.throws(() => withdrawPlayers(done, ['p1'], 1), /no rounds left/);
});

test('redraw before any result drops players who withdrew earlier', () => {
  const w = withdrawPlayers(setResult(make(), 1, 1, 1), ['p2'], 1);
  const r = redraw(setResult(w, 1, 1, null), 9);
  assert.deepEqual(r.players.map((p) => p.id), ['p1', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']);
  assert.ok(r.schedule.every((round) => !JSON.stringify(round).includes('"p2"')));
});

test('players keep the link to their person and their year of birth', () => {
  const players = PLAYERS.map((p, i) => ({ ...p, personId: `person-${i}`, ...(i === 0 ? { birthYear: 1980 } : {}) }));
  const t = createTournament({ id: 't', name: 'x', players, settings: SETTINGS, seed: 1, now: new Date() });
  assert.equal(t.version, 2);
  assert.deepEqual(t.players[0], { id: 'p1', personId: 'person-0', name: players[0].name, skill: players[0].skill, birthYear: 1980 });
  assert.deepEqual(t.players[1], { id: 'p2', personId: 'person-1', name: players[1].name, skill: players[1].skill });
  assert.throws(() => createTournament({ id: 't', name: 'x', players: [...PLAYERS, { ...PLAYERS[0] }], settings: SETTINGS, seed: 1, now: new Date() }), /used twice/);
});

test('the last round can use fewer courts, also after a withdrawal', () => {
  const players = [5, 9, 8, 6, 1, 9, 4, 6, 5, 7, 1, 4, 6, 3, 1, 3, 4].map((skill, i) => ({ name: `P${i + 1}`, skill }));
  const settings = { ...SETTINGS, rounds: 9, lastRoundCourts: 1 };
  const t = createTournament({ id: 't', name: 'x', players, settings, seed: 2, now: new Date() });
  assert.deepEqual(t.schedule.map((r) => r.matches.length), [2, 2, 2, 2, 2, 2, 2, 2, 1]);
  assert.equal(t.schedule[8].sitOuts.length, 13);
  const games = new Map();
  t.schedule.forEach((r) => r.matches.forEach((m) => [...m.team1, ...m.team2].forEach((id) => games.set(id, (games.get(id) ?? 0) + 1))));
  assert.deepEqual([...new Set(games.values())], [4]);
  const w = withdrawPlayers(setResult(t, 1, 1, 1), ['p1'], 3);
  assert.equal(w.schedule[8].matches.length, 1);
});

test('parsePlayers reads "skill: Name, Name" lines, also mixed with "Name: skill"', () => {
  const { players, errors } = parsePlayers('1: Markus, Micha ,Seb\n4: Gesa, Henri\nMüller, Jörg: 2\n11: Zoe\n3:\n6: Markus');
  assert.deepEqual(players, [
    { name: 'Markus', skill: 1 }, { name: 'Micha', skill: 1 }, { name: 'Seb', skill: 1 },
    { name: 'Gesa', skill: 4 }, { name: 'Henri', skill: 4 }, { name: 'Müller, Jörg', skill: 2 },
  ]);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /^Line 4: skill must be/);
  assert.match(errors[1], /^Line 5: expected names after the skill/);
  assert.match(errors[2], /^Line 6: duplicate name "Markus"/);
});

test('swapPlayers swaps two players within a round, also with a sit-out', () => {
  const t = setResult(make(), 1, 1, 1); // 10 players, 2 courts: 2 sit out
  const [m1, m2] = t.schedule[1].matches;
  const [out] = t.schedule[1].sitOuts;
  const a = m1.team1[0];
  const b = m2.team2[1];
  const s = swapPlayers(t, 2, a, b);
  assert.equal(s.schedule[1].matches[0].team1[0], b);
  assert.equal(s.schedule[1].matches[1].team2[1], a);
  assert.deepEqual(s.schedule[0], t.schedule[0], 'other rounds unchanged');
  const o = swapPlayers(t, 2, a, out);
  assert.equal(o.schedule[1].matches[0].team1[0], out);
  assert.ok(o.schedule[1].sitOuts.includes(a));
  assert.equal(validateTournament(JSON.parse(JSON.stringify(o))).ok, true);
});

test('swapPlayers refuses matches with a result, hidden rounds and unknown players', () => {
  const t = setResult(make(), 1, 1, 1); // revealBatch 2: rounds 1–2 revealed
  const [m1, m2] = t.schedule[0].matches;
  assert.throws(() => swapPlayers(t, 1, m1.team1[0], m2.team1[0]), /Court 1 already has a result/);
  assert.equal(swapPlayers(t, 1, m2.team1[0], m2.team2[0]).schedule[0].matches[1].team1[0], m2.team2[0]);
  assert.throws(() => swapPlayers(t, 3, 'p1', 'p2'), /revealed/);
  assert.throws(() => swapPlayers(t, 2, 'p1', 'p1'), /two different/);
  assert.throws(() => swapPlayers(t, 2, 'p1', 'zz'), /not in round 2/);
});

test('swapPlayersAcross: two players in different rounds trade places in both rounds', () => {
  const t = make(); // revealBatch 2: rounds 1–2 revealed
  const s = swapPlayersAcross(t, 1, 'p1', 2, 'p2');
  const back = (round) => JSON.parse(JSON.stringify(round).replace(/"p[12]"/g, (x) => (x === '"p1"' ? '"p2"' : '"p1"')));
  assert.notDeepEqual(s.schedule[0], t.schedule[0]);
  assert.deepEqual(s.schedule.slice(0, 2).map(back), t.schedule.slice(0, 2), 'p1 and p2 traded places in rounds 1 and 2');
  assert.deepEqual(s.schedule.slice(2), t.schedule.slice(2), 'other rounds unchanged');
  assert.equal(validateTournament(JSON.parse(JSON.stringify(s))).ok, true);
  assert.deepEqual(swapPlayersAcross(t, 2, 'p1', 2, 'p2'), swapPlayers(t, 2, 'p1', 'p2'));
  const court = t.schedule[0].matches.find((m) => [...m.team1, ...m.team2].includes('p1')).court;
  assert.throws(() => swapPlayersAcross(setResult(t, 1, court, 1), 2, 'p1', 1, 'p2'), /already has a result/);
});

test('renameTournament changes the name at any time but not to an empty one', () => {
  const t = setResult(make(), 1, 1, 1);
  assert.equal(renameTournament(t, '  Tenerife Cup ').name, 'Tenerife Cup');
  assert.deepEqual(renameTournament(t, 'x').schedule, t.schedule);
  assert.throws(() => renameTournament(t, '   '), /cannot be empty/);
});

test('a finished tournament is locked until it is reopened', () => {
  const t = setResult(make(), 1, 1, 1);
  const done = finishTournament(t, new Date('2026-10-26T20:00:00Z'));
  assert.equal(done.finishedAt, '2026-10-26T20:00:00.000Z');
  assert.ok(isFinished(done) && !isFinished(t));
  assert.equal(validateTournament(done).ok, true);
  for (const change of [() => setResult(done, 1, 2, 1), () => revealNext(done), () => redraw(done, 2), () => withdrawPlayers(done, ['p1'], 2),
    () => swapPlayers(done, 1, 'p1', 'p2'), () => finishTournament(done, new Date())]) {
    assert.throws(change, /finished/);
  }
  assert.equal(renameTournament(done, 'Final').name, 'Final', 'names can still be corrected');
  const open = reopenTournament(done);
  assert.ok(!('finishedAt' in open));
  assert.deepEqual(setResult(open, 1, 2, 2).results, { '1-1': 1, '1-2': 2 });
});

test('skills can change while the tournament runs; the remaining rounds can be drawn again', () => {
  const t = setResult(make(), 1, 1, 1); // round 1 partly played
  const changed = setSkills(t, { p1: 9, p2: 2 });
  assert.deepEqual(changed.players.slice(0, 2).map((p) => p.skill), [9, 2]);
  assert.deepEqual(changed.schedule, t.schedule, 'the draw stays without redrawing');
  assert.throws(() => setSkills(t, { p1: 11 }), /1 to 10/);
  assert.throws(() => setSkills(t, { x: 3 }), /Unknown player/);
  const redrawn = redrawRemaining(changed, 9);
  assert.deepEqual(redrawn.schedule[0], t.schedule[0], 'the round with a result stays');
  assert.notDeepEqual(redrawn.schedule.slice(1), t.schedule.slice(1));
  assert.equal(validateTournament(redrawn).ok, true);
  const fresh = redrawRemaining(setSkills(make(), { p1: 9 }), 3);
  assert.equal(fresh.seed, 3, 'before the first result the whole schedule is new');
  assert.throws(() => setSkills(finishTournament(t, new Date()), { p1: 2 }), /finished/);
});

test('a score decides the winner: more sets, then more points; equal ones need a choice', () => {
  const t = make();
  const scored = setScore(t, 1, 1, [[21, 15], [18, 21], [21, 19]]);
  assert.equal(scored.results['1-1'], 1);
  assert.deepEqual(scored.scores['1-1'], [[21, 15], [18, 21], [21, 19]]);
  assert.equal(setScore(t, 1, 1, [[10, 21]]).results['1-1'], 2);
  assert.equal(setScore(t, 1, 1, [[21, 19], [19, 22]]).results['1-1'], 2, 'one set each: more points win');
  assert.throws(() => setScore(t, 1, 1, [[21, 19], [19, 21]]), /choose the winner/);
  assert.equal(setScore(t, 1, 1, [[21, 19], [19, 21]], 2).results['1-1'], 2);
  assert.throws(() => setScore(t, 1, 1, []), /at least one set/);
  assert.throws(() => setScore(t, 1, 1, [[21, 21]]), /cannot be equal/);
  assert.throws(() => setScore(t, 1, 1, [[21, -1]]), /whole numbers/);
  assert.equal(validateTournament(scored).ok, true);
  const noScore = setScore(scored, 1, 1, null);
  assert.equal(noScore.results['1-1'], 1, 'removing the score keeps the winner');
  assert.ok(!('1-1' in noScore.scores));
  const cleared = setResult(scored, 1, 1, null);
  assert.ok(!('1-1' in cleared.results) && !('1-1' in cleared.scores), 'clearing the result removes its score');
  assert.ok(!('1-1' in setResult(scored, 1, 1, 2).scores), 'another winner drops a score that says otherwise');
  assert.match(validateTournament({ ...scored, scores: { '1-2': [[21, 10]] } }).error, /without a result/);
  assert.match(validateTournament({ ...scored, scores: { '1-1': [[21, 21]] } }).error, /Invalid set/);
});
