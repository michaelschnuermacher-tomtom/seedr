import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/engine/rng.js';
import { DRAW, assignSitOuts, evaluate, strengthOf, teamValue, formatValue, generateSchedule, scheduleStats, drawWarnings } from '../src/engine/schedule.js';

test('strength is 11 minus skill', () => {
  assert.equal(strengthOf(1), 10);
  assert.equal(strengthOf(10), 1);
});

test('sit-outs are spread evenly', () => {
  const rounds = assignSitOuts(18, 12, 8, createRng(1));
  assert.equal(rounds.length, 8);
  rounds.forEach((r) => assert.equal(r.length, 6));
  const counts = new Array(18).fill(0);
  rounds.flat().forEach((i) => counts[i]++);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
});

test('nobody sits out twice before everyone has sat out once', () => {
  const rounds = assignSitOuts(10, 8, 12, createRng(2));
  const flat = rounds.flat();
  for (let start = 0; start < flat.length; start += 10) {
    const block = flat.slice(start, start + 10);
    assert.equal(new Set(block).size, block.length);
  }
});

test('nobody sits out when everyone fits on court', () => {
  assert.deepEqual(assignSitOuts(8, 8, 3, createRng(3)), [[], [], []]);
});

test('team value: sum of skills plus a quarter of the spread (lower = stronger)', () => {
  assert.equal(teamValue(3, 6), 9.75);
  assert.equal(teamValue(1, 9), 12);
  assert.equal(teamValue(5, 5), 10);
  assert.equal(formatValue(9.75), '9.75');
  assert.equal(formatValue(10), '10');
});

const strengths = (skills) => skills.map(strengthOf);

test('evaluate: fairness is Σ (F² + F⁴/9) of the team value gaps, variety Σ T² + Σ O²', () => {
  const e = evaluate([[0, 1, 2, 3]], strengths([2, 6, 4, 5]), 4); // 9 vs 9.25 → F = 0.25
  assert.equal(e.sumDiffSq, 0.0625);
  assert.equal(e.maxAbsDiff, 0.25);
  assert.equal(e.fairness, DRAW.fairness * (0.0625 + 0.25 ** 4 / 9));
  assert.deepEqual([e.partnerSq, e.opponentSq], [2, 4]);
  assert.equal(e.variety, DRAW.teammates * 2 + DRAW.opponents * 4);
});

test('evaluate: a big spread makes a team weaker: 1+9 vs 5+5 is 12 vs 10', () => {
  const e = evaluate([[0, 1, 2, 3]], strengths([1, 9, 5, 5]), 4);
  assert.equal(e.maxAbsDiff, 2);
});

test('evaluate: large gaps cost much more than small ones (F = 3: twice F², F = 6: five times)', () => {
  const cost = (skills) => evaluate([[0, 1, 2, 3]], strengths(skills), 4).fairness / DRAW.fairness;
  assert.equal(cost([3, 7, 4, 4]), 9 + 81 / 9); // 11 vs 8
  assert.equal(cost([1, 9, 3, 3]), 36 + 1296 / 9); // 12 vs 6
});

test('evaluate: rest counts runs of sit-outs: single sit-outs are free, longer runs cost more', () => {
  const rounds = (sitting) => sitting.map((out) => [0, 1, 2, 3, 4].filter((i) => i !== out).slice(0, 4));
  const rest = (sitting) => evaluate(rounds(sitting), strengths([5, 5, 5, 5, 5]), 5).rest;
  assert.equal(rest([4, 3, 4, 3]), 0); // players 3 and 4 sit out every other round
  assert.equal(rest([4, 4, 3, 3]), 4); // two runs of 2: (4 − 2) × 2
  assert.equal(rest([4, 4, 4, 3]), 6); // a run of 3: 9 − 3
});

test('evaluate: repeated partners and opponents', () => {
  const twice = evaluate([[0, 1, 2, 3], [0, 1, 2, 3]], strengths([5, 5, 5, 5]), 4);
  assert.deepEqual([twice.partnerRepeats, twice.opponentRepeats], [2, 4]);
  assert.deepEqual([twice.partnerSq, twice.opponentSq], [8, 16]); // each pair met twice: 2²
  const third = evaluate([[0, 1, 2, 3], [0, 4, 2, 5], [0, 6, 2, 7]], strengths(new Array(8).fill(5)), 8);
  assert.deepEqual([third.opponentRepeats, third.opponentThirds], [2, 1]);
  assert.equal(third.opponentSq, 9 + 9, '0 meets 2 three times (3²), nine other pairs once');
});

const SKILLS_18 = [1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10];
const makePlayers = (skills) => skills.map((skill, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, skill }));

function assertValidSchedule(players, courts, rounds, schedule) {
  assert.equal(schedule.length, rounds);
  const ids = players.map((p) => p.id).sort();
  schedule.forEach((r, i) => {
    assert.equal(r.round, i + 1);
    assert.ok(r.matches.length <= courts);
    r.matches.forEach((m, k) => {
      assert.equal(m.court, k + 1);
      assert.equal(m.team1.length, 2);
      assert.equal(m.team2.length, 2);
    });
    const everyone = [...r.matches.flatMap((m) => [...m.team1, ...m.team2]), ...r.sitOuts].sort();
    assert.deepEqual(everyone, ids, `round ${r.round} contains every player exactly once`);
  });
}

test('18 players, 3 courts, 9 rounds: valid, no repeated partners, balanced', () => {
  const players = makePlayers(SKILLS_18);
  const { schedule, stats } = generateSchedule({ players, courts: 3, rounds: 9, seed: 1 });
  assertValidSchedule(players, 3, 9, schedule);
  assert.equal(stats.partnerRepeats, 0);
  assert.ok(stats.maxAbsDiff <= 2, `max gap ${stats.maxAbsDiff}`);
  assert.ok(stats.sumDiffSq / 27 <= 1, `mean squared gap ${stats.sumDiffSq / 27}`);
  assert.ok(stats.maxAbsBalance <= 4, `max player balance ${stats.maxAbsBalance}`);
  assert.deepEqual(drawWarnings(stats), []);
});

test('12 players, 2 courts, 8 rounds: valid, no repeated partners', () => {
  const players = makePlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 5, 5]);
  const { schedule, stats } = generateSchedule({ players, courts: 2, rounds: 8, seed: 2 });
  assertValidSchedule(players, 2, 8, schedule);
  assert.equal(stats.partnerRepeats, 0);
  assert.ok(stats.maxAbsDiff <= 3, `max gap ${stats.maxAbsDiff}`);
});

test('same seed gives the same schedule, different seed a different one', () => {
  const players = makePlayers(SKILLS_18);
  const a = generateSchedule({ players, courts: 3, rounds: 6, seed: 5, iterations: 20000 });
  const b = generateSchedule({ players, courts: 3, rounds: 6, seed: 5, iterations: 20000 });
  const c = generateSchedule({ players, courts: 3, rounds: 6, seed: 6, iterations: 20000 });
  assert.deepEqual(a.schedule, b.schedule);
  assert.notDeepEqual(a.schedule, c.schedule);
});

test('more courts than players can fill: 5 players, 3 courts', () => {
  const players = makePlayers([1, 3, 5, 7, 9]);
  const { schedule } = generateSchedule({ players, courts: 3, rounds: 5, seed: 3, iterations: 5000 });
  assertValidSchedule(players, 3, 5, schedule);
  schedule.forEach((r) => {
    assert.equal(r.matches.length, 1);
    assert.equal(r.sitOuts.length, 1);
  });
  assert.equal(new Set(schedule.flatMap((r) => r.sitOuts)).size, 5, 'everyone sits out once');
});

test('tight setup (8 players, 2 courts, 7 rounds) produces a warning', () => {
  const players = makePlayers([1, 1, 2, 3, 8, 9, 10, 10]);
  const { schedule, stats } = generateSchedule({ players, courts: 2, rounds: 7, seed: 4 });
  assertValidSchedule(players, 2, 7, schedule);
  assert.ok(drawWarnings(stats).length >= 1);
});

test('scheduleStats recomputes the stats of a stored schedule', () => {
  const players = makePlayers(SKILLS_18);
  const { schedule, stats } = generateSchedule({ players, courts: 3, rounds: 4, seed: 8, iterations: 20000 });
  assert.deepEqual(scheduleStats(players, schedule), stats);
});

test('drawWarnings', () => {
  const base = { partnerRepeats: 0, maxAbsDiff: 2 };
  assert.deepEqual(drawWarnings(base), []);
  assert.match(drawWarnings({ ...base, partnerRepeats: 2 })[0], /team up twice \(2 repeated pairing/);
  assert.match(drawWarnings({ ...base, maxAbsDiff: 3 })[0], /unbalanced.*up to 3\)/);
  assert.match(drawWarnings({ ...base, maxAbsDiff: 3.25 })[0], /up to 3.25/);
});

test('small groups stay reasonably balanced (no stuck draw)', () => {
  // Worst team value gap, averaged over three draws: groups with extreme skills cannot be
  // even, and now and then a single draw is a little worse.
  const cases = [
    // A few partners repeat where avoiding them all would force a big mismatch.
    { skills: [1, 2, 3, 4, 5, 6, 7, 8], courts: 2, rounds: 7, maxMean: 3.5, maxRepeats: 4 },
    { skills: [6, 3, 10, 3, 9, 2, 2, 2, 3, 6], courts: 2, rounds: 10, maxMean: 3, maxRepeats: 3 },
    { skills: [8, 1, 10, 6, 7, 7, 10, 7, 10, 9, 1, 2], courts: 3, rounds: 10, maxMean: 3.5, maxRepeats: 6 },
  ];
  for (const { skills, courts, rounds, maxMean, maxRepeats } of cases) {
    const worst = [1, 2, 3].map((seed) => {
      const { stats } = generateSchedule({ players: makePlayers(skills), courts, rounds, seed });
      assert.ok(stats.partnerRepeats <= maxRepeats, `${skills.length} players, seed ${seed}: ${stats.partnerRepeats} partner repeats`);
      return stats.maxAbsDiff;
    });
    const mean = worst.reduce((a, b) => a + b) / worst.length;
    assert.ok(mean <= maxMean, `${skills.length} players: worst gaps ${worst.join(', ')}`);
  }
});

// The 8-player example: two skill-1 players and two skill-4 players would otherwise face
// each other in every round, and over 7+ rounds the skill-1 players had to team up.
const EIGHT = [['Seb', 1], ['Micha', 1], ['Henri', 4], ['Lia', 4], ['Felix', 5], ['Ada', 6], ['Hugo', 6], ['Bianca', 6]]
  .map(([name, skill]) => ({ id: name, name, skill }));
const meetings = (schedule, x, y) => {
  const count = { opponents: 0, partners: 0 };
  for (const r of schedule) for (const m of r.matches) {
    if ([m.team1, m.team2].some((t) => t.includes(x) && t.includes(y))) count.partners++;
    else if ([...m.team1, ...m.team2].includes(x) && [...m.team1, ...m.team2].includes(y)) count.opponents++;
  }
  return count;
};

test('two players are opponents in at most two-thirds of the rounds', () => {
  for (const rounds of [5, 6]) {
    for (const seed of [1, 2, 3]) {
      const { schedule, stats } = generateSchedule({ players: EIGHT, courts: 2, rounds, seed });
      const cap = Math.floor((2 * rounds) / 3);
      assert.equal(stats.overMeet, 0, `${rounds} rounds, seed ${seed}`);
      assert.ok(meetings(schedule, 'Seb', 'Micha').opponents <= cap, `${rounds} rounds, seed ${seed}: Seb & Micha`);
      assert.ok(meetings(schedule, 'Henri', 'Lia').opponents <= cap, `${rounds} rounds, seed ${seed}: Henri & Lia`);
    }
  }
});

test('with 8 players a partner repeats rather than a big mismatch', () => {
  for (const rounds of [7, 9]) {
    for (const seed of [1, 2, 3]) {
      const { schedule, stats } = generateSchedule({ players: EIGHT, courts: 2, rounds, seed });
      assert.equal(meetings(schedule, 'Seb', 'Micha').partners, 0, `${rounds} rounds, seed ${seed}: Seb & Micha never team up`);
      assert.ok(stats.maxAbsDiff <= 3, `${rounds} rounds, seed ${seed}: worst edge ${stats.maxAbsDiff}`);
    }
  }
});

test('18 players: few repeated opponents and rarely a third meeting', () => {
  const players = makePlayers(SKILLS_18);
  for (const seed of [1, 2, 3]) {
    const { stats } = generateSchedule({ players, courts: 3, rounds: 9, seed });
    assert.equal(stats.partnerRepeats, 0);
    assert.ok(stats.opponentThirds <= 4, `seed ${seed}: ${stats.opponentThirds} third meetings`);
    assert.ok(stats.maxAbsDiff <= 2, `seed ${seed}: max gap ${stats.maxAbsDiff}`);
  }
});

test('sit-out groups mix: 16 players on 2 courts are not split into two fixed groups', () => {
  for (const seed of [1, 2, 3]) {
    const rounds = assignSitOuts(16, 8, 12, createRng(seed));
    const key = (r) => [...r].sort((a, b) => a - b).join(',');
    const distinct = new Set(rounds.map(key));
    assert.ok(distinct.size > 2, `seed ${seed}: only ${distinct.size} different sit-out groups`);
  }
});

test('nobody sits out in two consecutive rounds when it can be avoided (18 players, 12 on court)', () => {
  for (const seed of [1, 2, 3]) {
    const rounds = assignSitOuts(18, 12, 12, createRng(seed));
    for (let r = 1; r < rounds.length; r++) {
      const before = new Set(rounds[r - 1]);
      assert.ok(rounds[r].every((i) => !before.has(i)), `seed ${seed}: someone sat out in rounds ${r} and ${r + 1}`);
    }
  }
});

test('16 players, 2 courts, 12 rounds: balanced matches', () => {
  const players = makePlayers([5, 6, 4, 1, 7, 3, 5, 4, 6, 1, 3, 3, 1, 3, 3, 4]);
  for (const seed of [1, 2, 3]) {
    const { schedule, stats } = generateSchedule({ players, courts: 2, rounds: 12, seed });
    assertValidSchedule(players, 2, 12, schedule);
    assert.equal(stats.partnerRepeats, 0);
    assert.ok(stats.maxAbsDiff < 3, `seed ${seed}: max gap ${stats.maxAbsDiff}`);
  }
});

test('16 players on 2 courts: at most 2 back-to-back sit-outs per round', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const rounds = assignSitOuts(16, 8, 12, createRng(seed));
    for (let r = 1; r < rounds.length; r++) {
      const before = new Set(rounds[r - 1]);
      const repeated = rounds[r].filter((i) => before.has(i)).length;
      assert.ok(repeated <= 2, `seed ${seed}, round ${r + 1}: ${repeated} players sat out twice in a row`);
    }
  }
});

test('marked players get the extra sit-outs when games are uneven', () => {
  const fewer = new Set([0, 5, 9, 16]);
  for (let seed = 1; seed <= 50; seed++) {
    const sitOuts = assignSitOuts(17, 8, 8, createRng(seed), {}, fewer); // 72 sit-outs: 4 players sit 5×
    const count = new Array(17).fill(0);
    sitOuts.flat().forEach((i) => count[i]++);
    const most = count.flatMap((c, i) => (c === 5 ? [i] : []));
    assert.deepEqual(most, [0, 5, 9, 16], `seed ${seed}`);
    assert.ok(count.every((c) => c === 4 || c === 5));
  }
});

test('with fewer marked players than extra sit-outs, all marked ones get one', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const sitOuts = assignSitOuts(17, 8, 8, createRng(seed), {}, new Set([3]));
    const count = new Array(17).fill(0);
    sitOuts.flat().forEach((i) => count[i]++);
    assert.equal(count[3], 5, `seed ${seed}`);
    assert.equal(count.filter((c) => c === 5).length, 4);
  }
});

test('without marked players, sit-outs are unchanged', () => {
  assert.deepEqual(assignSitOuts(17, 8, 8, createRng(7)), assignSitOuts(17, 8, 8, createRng(7), {}, new Set()));
});

