import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/engine/rng.js';
import { assignSitOuts, evaluate, strengthOf, generateSchedule, scheduleStats, drawWarnings } from '../src/engine/schedule.js';

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

test('evaluate: balanced single match', () => {
  const strength = [1, 2, 3, 4].map(strengthOf); // 10, 9, 8, 7
  const e = evaluate([[0, 3, 1, 2]], strength, 4); // 17 vs 17; spreads 3 vs 1
  assert.deepEqual(e, { cost: 0, partnerRepeats: 0, opponentRepeats: 0, sumDiffSq: 0, maxAbsDiff: 0, maxAbsBalance: 0, sumSpreadGapSq: 4, maxSpreadGap: 2 });
});

test('evaluate: 1+9 vs 5+5 is penalised for different spreads from 14 players', () => {
  const strength = [1, 9, 5, 5, ...new Array(10).fill(5)].map(strengthOf); // 10, 2, 6, 6, …
  const e = evaluate([[0, 1, 2, 3]], strength, 14); // sums 12 vs 12; spreads 8 vs 0
  assert.equal(e.sumDiffSq, 0);
  assert.equal(e.sumSpreadGapSq, 64);
  assert.equal(e.maxSpreadGap, 8);
  assert.equal(e.cost, 3 * 64);
});

test('evaluate: below 14 players the spread is reported but not penalised', () => {
  const strength = [1, 9, 5, 5, ...new Array(9).fill(5)].map(strengthOf);
  const e = evaluate([[0, 1, 2, 3]], strength, 13);
  assert.equal(e.sumSpreadGapSq, 64);
  assert.equal(e.cost, 0);
});

test('evaluate: unbalanced match and repeats', () => {
  const strength = [1, 2, 3, 4].map(strengthOf);
  const once = evaluate([[0, 1, 2, 3]], strength, 4); // 19 vs 15 → diff 4
  assert.equal(once.sumDiffSq, 16);
  assert.equal(once.maxAbsDiff, 4);
  assert.equal(once.maxAbsBalance, 4);
  assert.equal(once.cost, 10 * 16 + 3 * (4 * 16));
  const twice = evaluate([[0, 1, 2, 3], [0, 1, 2, 3]], strength, 4);
  assert.equal(twice.partnerRepeats, 2);
  assert.equal(twice.opponentRepeats, 4);
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
  assert.ok(stats.maxAbsBalance <= 3, `max player balance ${stats.maxAbsBalance}`);
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
  assert.match(drawWarnings({ ...base, partnerRepeats: 2 })[0], /repeated partners: 2/);
  assert.match(drawWarnings({ ...base, maxAbsDiff: 3 })[0], /unbalanced.*up to 3/);
});

test('small groups stay reasonably balanced (no stuck draw)', () => {
  const cases = [
    { skills: [1, 2, 3, 4, 5, 6, 7, 8], courts: 2, rounds: 7, maxGap: 6 },
    { skills: [6, 3, 10, 3, 9, 2, 2, 2, 3, 6], courts: 2, rounds: 10, maxGap: 6 },
    { skills: [8, 1, 10, 6, 7, 7, 10, 7, 10, 9, 1, 2], courts: 3, rounds: 10, maxGap: 7 },
  ];
  for (const { skills, courts, rounds, maxGap } of cases) {
    for (const seed of [1, 2, 3]) {
      const { stats } = generateSchedule({ players: makePlayers(skills), courts, rounds, seed });
      assert.equal(stats.partnerRepeats, 0, `${skills.length} players, seed ${seed}: partner repeats`);
      assert.ok(stats.maxAbsDiff <= maxGap, `${skills.length} players, seed ${seed}: max gap ${stats.maxAbsDiff} > ${maxGap}`);
    }
  }
});

test('teams in a match have similar skill spreads (no 1+9 vs 5+5)', () => {
  const players = makePlayers(SKILLS_18);
  for (const seed of [1, 2, 3]) {
    const { stats } = generateSchedule({ players, courts: 3, rounds: 9, seed });
    assert.ok(stats.maxSpreadGap <= 5, `seed ${seed}: max spread gap ${stats.maxSpreadGap}`);
    assert.ok(stats.maxAbsDiff <= 2, `seed ${seed}: max gap ${stats.maxAbsDiff}`);
    assert.equal(stats.partnerRepeats, 0);
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
    assert.ok(stats.maxAbsDiff <= 2, `seed ${seed}: max gap ${stats.maxAbsDiff}`);
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
