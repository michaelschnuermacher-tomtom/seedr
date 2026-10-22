import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlayers, formatPlayers, renamePlayers, swapPlayers, createTournament, revealNext, hasResults, redraw, setResult, updateSettings, withdrawPlayers, firstRedrawableRound, isActive } from '../src/engine/tournament.js';
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
  assert.equal(t.version, 1);
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
  assert.equal(new Set(pairs).size, pairs.length, 'no partner repeats across old and new rounds');
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

test('parsePlayers reads a * after the skill as "fewer games"', () => {
  const { players, errors } = parsePlayers('Gesa: 3 *\nVera: 3*\nUta: 3\nBad: *');
  assert.deepEqual(players, [{ name: 'Gesa', skill: 3, fewer: true }, { name: 'Vera', skill: 3, fewer: true }, { name: 'Uta', skill: 3 }]);
  assert.equal(errors.length, 1);
});

test('marked players play fewer games, and no more can be marked than play fewer', () => {
  const group = (marks) => [5, 6, 7, 4, 1, 7, 3, 5, 4, 6, 1, 3, 6, 3, 1, 3, 3]
    .map((skill, i) => ({ name: `P${i + 1}`, skill, ...(marks.includes(i) ? { fewer: true } : {}) }));
  const settings = { ...SETTINGS, rounds: 8 }; // 17 players, 2 courts: 4 get 3 games
  const t = createTournament({ id: 't', name: 'x', players: group([1, 4, 8, 15]), settings, seed: 11, now: new Date() });
  const games = new Map(t.players.map((p) => [p.id, 0]));
  t.schedule.forEach((r) => r.matches.forEach((m) => [...m.team1, ...m.team2].forEach((id) => games.set(id, games.get(id) + 1))));
  assert.deepEqual(t.players.filter((p) => games.get(p.id) === 3).map((p) => p.id), ['p2', 'p5', 'p9', 'p16']);
  assert.ok(t.players.filter((p) => !p.fewer).every((p) => games.get(p.id) === 4));
  assert.throws(() => createTournament({ id: 't', name: 'x', players: group([0, 1, 2, 3, 4]), settings, seed: 1, now: new Date() }), /Only 4 players get fewer games, but 5/);
  const even = createTournament({ id: 't', name: 'x', players: PLAYERS, settings: { ...SETTINGS, rounds: 5 }, seed: 1, now: new Date() });
  assert.throws(() => updateSettings(even, { name: 'x', players: PLAYERS.map((p, i) => (i ? p : { ...p, fewer: true })), settings: { ...SETTINGS, rounds: 5 } }, 1), /same number of games/);
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
  const { players, errors } = parsePlayers('1: Markus, Micha ,Seb*\n4: Gesa *, Henri\nMüller, Jörg: 2\n11: Zoe\n3:\n5: Anna, *\n6: Markus');
  assert.deepEqual(players, [
    { name: 'Markus', skill: 1 }, { name: 'Micha', skill: 1 }, { name: 'Seb', skill: 1, fewer: true },
    { name: 'Gesa', skill: 4, fewer: true }, { name: 'Henri', skill: 4 },
    { name: 'Müller, Jörg', skill: 2 }, { name: 'Anna', skill: 5 },
  ]);
  assert.equal(errors.length, 4);
  assert.match(errors[0], /^Line 4: skill must be/);
  assert.match(errors[1], /^Line 5: expected names after the skill/);
  assert.match(errors[2], /^Line 6: "\*" without a name/);
  assert.match(errors[3], /^Line 7: duplicate name "Markus"/);
});

test('formatPlayers writes one line per skill and reads back the same players', () => {
  const players = [
    { name: 'Seb', skill: 1, fewer: true }, { name: 'Ada', skill: 6 }, { name: 'Markus', skill: 1 },
    { name: 'Müller, Jörg', skill: 2, fewer: true },
  ];
  const text = formatPlayers(players);
  assert.equal(text, '1: Seb*, Markus\n6: Ada\nMüller, Jörg: 2 *');
  assert.deepEqual(new Set(parsePlayers(text).players.map((p) => JSON.stringify(p))), new Set(players.map((p) => JSON.stringify(p))));
});

test('renamePlayers changes names at any time and keeps the draw and results', () => {
  const t = setResult(make(), 1, 1, 1);
  const r = renamePlayers(t, { p1: '  Anna ', p2: 'P1' });
  assert.deepEqual(r.players.slice(0, 2).map((p) => p.name), ['Anna', 'P1']);
  assert.deepEqual([r.schedule, r.results], [t.schedule, t.results]);
  assert.deepEqual(renamePlayers(t, { p1: 'P2', p2: 'P1' }).players.slice(0, 2).map((p) => p.name), ['P2', 'P1'], 'names can be swapped');
  assert.throws(() => renamePlayers(t, { p1: '' }), /empty/);
  assert.throws(() => renamePlayers(t, { p1: 'p3' }), /used twice/);
  assert.throws(() => renamePlayers(t, { p1: '7' }), /read as a skill/);
  assert.throws(() => renamePlayers(t, { p1: 'Anna*' }), /end with \*/);
  assert.throws(() => renamePlayers(t, { x: 'Anna' }), /Unknown player/);
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
