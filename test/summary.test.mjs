import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tournamentSummary } from '../src/engine/summary.js';

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
  assert.match(s['Upset of the tournament'], /Ben & Eva beat Anna & Carla in round 2, although their team value was 6.5 weaker/);
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

test('edges are shown like in the standings, and a single win together is no dream team', () => {
  const s = summary({ '1-1': 1, '2-1': 1, '3-1': 2 });
  assert.ok(!('Dream team' in s), 'no pair won twice together');
  assert.match(s['Luck of the draw'] ?? '', /edge \+\d\.\d\)/);
});

test('every player who played is mentioned at least once', () => {
  for (const r of [results, { '1-1': 2 }, { '1-1': 2, '2-1': 1 }, { '1-1': 1, '2-1': 1, '3-1': 2 }]) {
    const all = tournamentSummary({ players, schedule, results: r }).map((x) => `${x.title} ${x.text}`).join(' ');
    const played = Object.keys(r).flatMap((k) => { const m = schedule[Number(k[0]) - 1].matches[0]; return [...m.team1, ...m.team2]; });
    for (const p of players.filter((x) => played.includes(x.id))) assert.ok(all.includes(p.name), `${p.name} missing in: ${all}`);
  }
});

test('players without a highlight are grouped into fun categories', () => {
  const s = summary({ '1-1': 2, '2-1': 1 });
  assert.match(s['One to remember'], /^David \(with Carla in round 1\) and Anna \(with Carla in round 2\) each have a win to celebrate\./);
  assert.match(s['Saving the best for later'], /^Eva is still warming up/);
});

test('ties: Still smiling names the lowest skill number, Underdog of the day the highest', () => {
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
  assert.match(s['Still smiling'], /^Anna played 2 games with no wins yet/, 'Anna (skill 1) rather than David (skill 5)');
  assert.match(s['Underdog of the day'], /^Ben won 2 games/, 'Ben and Carla tie; skill 9 both, then by name');
});
