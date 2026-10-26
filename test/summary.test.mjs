import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tournamentSummary } from '../src/engine/summary.js';
import { createTournament, setResult, withdrawPlayers } from '../src/engine/tournament.js';

// Team values: Anna+Ben 12, Carla+David 10, Anna+Carla 7, Ben+Eva 13.5, David+Eva 8.5.
const players = [
  { id: 'p1', name: 'Anna', skill: 1 },
  { id: 'p2', name: 'Ben', skill: 9 },
  { id: 'p3', name: 'Carla', skill: 5 },
  { id: 'p4', name: 'David', skill: 5 },
  { id: 'p5', name: 'Eva', skill: 3 },
];
const schedule = [
  { round: 1, matches: [{ court: 1, team1: ['p1', 'p2'], team2: ['p3', 'p4'] }], sitOuts: ['p5'] },
  { round: 2, matches: [{ court: 1, team1: ['p1', 'p3'], team2: ['p2', 'p5'] }], sitOuts: ['p4'] },
  { round: 3, matches: [{ court: 1, team1: ['p1', 'p2'], team2: ['p4', 'p5'] }], sitOuts: ['p3'] },
];
// The weaker team (higher value) wins every match.
const results = { '1-1': 1, '2-1': 2, '3-1': 1 };
const summary = (r = results) => Object.fromEntries(tournamentSummary({ players, schedule, results: r }).map((x) => [x.title, x.text]));

test('the summary tells the highlights of the results', () => {
  const s = summary();
  assert.match(s.Champion, /^Ben leads with 3 points \(3 wins from 3 games\)/);
  assert.match(s['Upset of the tournament'], /Ben & Eva beat Anna & Carla in round 2, although their team was much weaker/);
  assert.match(s['Dream team'], /Anna & Ben: 2 wins in 2 games together, unbeaten/);
  assert.match(s['Perfect record'], /^Ben won every game/);
  assert.match(s.Rivals, /^Anna and David faced each other 2 times: Anna leads 2:0/);
  assert.match(s['By the numbers'], /3 matches played\. The stronger team won 0 of 3 \(even matches not counted\); 3 upsets\./);
});

test('no highlights before a round is complete', () => {
  assert.deepEqual(tournamentSummary({ players, schedule, results: {} }), []);
});

test('highlights only appear when there is something to tell', () => {
  const s = summary({ '1-1': 2 }); // only round 1: the stronger team wins
  assert.ok(!('Upset of the tournament' in s) && !('Rivals' in s) && !('Perfect record' in s));
  assert.match(s['By the numbers'], /1 match played\. The stronger team won 1 of 1 \(even matches not counted\); 0 upsets\./);
});

test('no plain edge values, and a single win together is no dream team', () => {
  const s = summary({ '1-1': 1, '2-1': 1, '3-1': 2 });
  assert.ok(!('Dream team' in s), 'no pair won twice together');
  assert.match(s['Luck of the draw'], /were the strongest on average\.$/);
  assert.ok(Object.values(s).every((text) => !/edge [+−]?\d/.test(text)), 'no edge numbers');
});

test('every player who played is mentioned at least once', () => {
  for (const r of [results, { '1-1': 2 }, { '1-1': 2, '2-1': 1 }, { '1-1': 1, '2-1': 1, '3-1': 2 }]) {
    const all = tournamentSummary({ players, schedule, results: r }).map((x) => `${x.title} ${x.text}`).join(' ');
    const played = Object.keys(r).flatMap((k) => { const m = schedule[Number(k[0]) - 1].matches[0]; return [...m.team1, ...m.team2]; });
    for (const p of players.filter((x) => played.includes(x.id))) assert.ok(all.includes(p.name), `${p.name} missing in: ${all}`);
  }
});

test('age, giant killer and late bloomer name exactly the right players', () => {
  const names = 'Markus Seb Micha Uta Vera Gesa Henri Lia Felix Jenny Mickey Ada Hugo Bianca Basti Max Anne'.split(' ');
  const skills = [1, 1, 1, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 8, 9];
  const years = [1960, 1975, 1980, 1990, 1999, 1955, 1970, 2005, 1985, 1992, 1978, 1966, 2001, 1988, 1995, 1972, 1950];
  const seen = new Set();
  for (let seed = 1; seed <= 8; seed++) {
    for (const played of [4, 6, 9]) {
      const t = createTournament({ id: 'x', name: 'x', seed, now: new Date(), players: names.map((name, i) => ({ name, skill: skills[i], birthYear: years[i] })),
        settings: { courts: 2, rounds: 9, lastRoundCourts: 1, matchMinutes: 21, breakMinutes: 5, revealBatch: 'all' } });
      let k = seed;
      const results = {};
      for (const r of t.schedule.slice(0, played)) for (const m of r.matches) { k = (k * 31 + 7) % 97; results[`${r.round}-${m.court}`] = (k % 2) + 1; }
      const s = Object.fromEntries(tournamentSummary({ ...t, results }).map((x) => [x.title, x.text]));
      // Independent count of wins and games per player.
      const byId = new Map(t.players.map((p) => [p.id, p]));
      const wins = new Map(t.players.map((p) => [p.id, 0]));
      const winning = [];
      for (const r of t.schedule.slice(0, played)) for (const m of r.matches) {
        const team = results[`${r.round}-${m.court}`] === 1 ? m.team1 : m.team2;
        team.forEach((id) => wins.set(id, wins.get(id) + 1));
        winning.push(team);
      }
      const winners = t.players.filter((p) => wins.get(p.id) > 0);
      const namedIn = (text) => names.filter((n) => new RegExp(`\\b${n}\\b`).test(text)).sort();
      if (s['Old hands']) {
        const oldest = Math.min(...winners.map((p) => p.birthYear));
        assert.deepEqual(namedIn(s['Old hands']), winners.filter((p) => p.birthYear === oldest).map((p) => p.name).sort());
        seen.add('Old hands');
      }
      if (s['Young guns']) {
        const youngest = Math.max(...winners.map((p) => p.birthYear));
        assert.deepEqual(namedIn(s['Young guns']), winners.filter((p) => p.birthYear === youngest).map((p) => p.name).sort());
        seen.add('Young guns');
      }
      if (s['Across generations']) {
        const gap = (team) => Math.abs(byId.get(team[0]).birthYear - byId.get(team[1]).birthYear);
        const widest = Math.max(...winning.map(gap));
        assert.deepEqual(namedIn(s['Across generations']), [...new Set(winning.filter((team) => gap(team) === widest).flat().map((id) => byId.get(id).name))].sort());
        seen.add('Across generations');
      }
      for (const title of ['Giant killer', 'Late bloomer']) if (s[title]) seen.add(title);
    }
  }
  assert.deepEqual([...seen].sort(), ['Across generations', 'Giant killer', 'Late bloomer', 'Old hands', 'Young guns']);
});

test('without years of birth there are no age highlights', () => {
  const s = summary();
  assert.ok(!('Old hands' in s) && !('Young guns' in s) && !('Across generations' in s));
});

test('Still smiling names everyone without a win', () => {
  assert.match(summary({ '1-1': 2, '2-1': 1 })['Still smiling'], /^Eva and Ben have no wins yet/);
});

test('players who withdrew are mentioned, and only the rounds before they left count for sitting out', () => {
  const names = 'Markus Seb Micha Uta Vera Gesa Henri Lia Felix Jenny Mickey Ada Hugo Bianca Basti Max Anne'.split(' ');
  const skills = [1, 1, 1, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 8, 9];
  let t = createTournament({ id: 'x', name: 'x', seed: 4, now: new Date(), players: names.map((name, i) => ({ name, skill: skills[i] })),
    settings: { courts: 2, rounds: 9, matchMinutes: 21, breakMinutes: 5, revealBatch: 'all' } });
  for (const r of t.schedule.slice(0, 2)) for (const m of r.matches) t = setResult(t, r.round, m.court, 1);
  const gone = t.schedule[0].matches[0].team1[0];
  t = withdrawPlayers(t, [gone], 1);
  for (const r of t.schedule.slice(2, 6)) for (const m of r.matches) t = setResult(t, r.round, m.court, 2);
  const s = tournamentSummary(t);
  const goneName = t.players.find((p) => p.id === gone).name;
  assert.ok(s.some((x) => `${x.title} ${x.text}`.includes(goneName)), `${goneName} is mentioned`);
  const bench = s.find((x) => x.title === 'Bench warmer');
  assert.ok(!bench || !bench.text.includes(goneName), 'the rounds after leaving are not sit-outs');
});

test('in a real-size tournament, every player who played is mentioned and no property names more than a third', () => {
  const fixed = new Set(['Champion', 'Champions', 'Underdog of the day', 'Dream team', 'Upset of the tournament', 'Perfect record',
    'Rivals', 'Luck of the draw', 'Still smiling', 'Win tally', 'By the numbers']);
  const names = 'Markus Seb Micha Uta Vera Gesa Henri Lia Felix Jenny Mickey Ada Hugo Bianca Basti Max Anne'.split(' ');
  const skills = [1, 1, 1, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 8, 9];
  for (const [seed, played] of [[3, 5], [8, 9], [11, 3], [5, 7]]) {
    const t = createTournament({ id: 'x', name: 'x', seed, now: new Date(), players: names.map((name, i) => ({ name, skill: skills[i] })),
      settings: { courts: 2, rounds: 9, lastRoundCourts: 1, matchMinutes: 21, breakMinutes: 5, revealBatch: 'all' } });
    let k = seed;
    const results = {};
    for (const r of t.schedule.slice(0, played)) for (const m of r.matches) { k = (k * 31 + 7) % 97; results[`${r.round}-${m.court}`] = (k % 2) + 1; }
    const s = tournamentSummary({ ...t, results });
    const text = s.map((x) => `${x.title} ${x.text}`).join(' ');
    const playedIds = new Set(t.schedule.slice(0, played).flatMap((r) => r.matches.flatMap((m) => [...m.team1, ...m.team2])));
    for (const p of t.players.filter((x) => playedIds.has(x.id))) assert.ok(text.includes(p.name), `seed ${seed}: ${p.name} missing`);
    for (const x of s.filter((y) => !fixed.has(y.title))) {
      const named = t.players.filter((p) => new RegExp(`\\b${p.name}\\b`).test(x.text)).length;
      assert.ok(named <= Math.ceil(17 / 3), `seed ${seed}: ${x.title} names ${named}`);
    }
  }
});

test('ties: players with the same statistic are named together', () => {
  // Four players, two rounds; Anna (1) and David (5) both lose twice.
  const four = [
    { id: 'a', name: 'Anna', skill: 1 },
    { id: 'b', name: 'Ben', skill: 9 },
    { id: 'c', name: 'Carla', skill: 9 },
    { id: 'd', name: 'David', skill: 5 },
  ];
  const rounds = [
    { round: 1, matches: [{ court: 1, team1: ['a', 'd'], team2: ['b', 'c'] }], sitOuts: [] },
    { round: 2, matches: [{ court: 1, team1: ['a', 'd'], team2: ['c', 'b'] }], sitOuts: [] },
  ];
  const s = Object.fromEntries(tournamentSummary({ players: four, schedule: rounds, results: { '1-1': 2, '2-1': 2 } }).map((x) => [x.title, x.text]));
  assert.match(s['Still smiling'], /^David and Anna have no wins yet/, 'in standings order');
  assert.match(s['Underdog of the day'], /^Ben and Carla won 2 games each although their teams were usually the weaker one/);
  assert.ok(!('Saving the best for later' in s), 'nobody with the same record is left over');
});

test('once finished, the summary speaks of the result', () => {
  const s = Object.fromEntries(tournamentSummary({ players, schedule, results: { '1-1': 2, '2-1': 1 }, finishedAt: '2026-10-26T20:00:00.000Z' }).map((x) => [x.title, x.text]));
  assert.match(s.Champion, /^Carla wins with 2 points/);
  assert.match(s['Still smiling'], /have no wins: there is always the next tournament!$/);
});
