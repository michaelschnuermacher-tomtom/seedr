import { createRng, shuffle } from './rng.js';
import { playersPerRound } from './timeplan.js';

export const WEIGHTS = { partner: 10000, match: 10, balance: 3, opponent: 1 };
export const DEFAULT_ITERATIONS = 100000;
export const UNBALANCED_GAP = 3;

export function strengthOf(skill) {
  return 11 - skill;
}

// Cyclic rotation: round r sits out the next S players of one shuffled order,
// so nobody sits out twice before everyone has sat out once.
export function assignSitOuts(playerCount, perRound, rounds, rng) {
  const sitting = playerCount - perRound;
  const order = shuffle(rng, [...Array(playerCount).keys()]);
  return Array.from({ length: rounds }, (_, r) =>
    Array.from({ length: sitting }, (_, i) => order[(r * sitting + i) % playerCount]));
}

// Counts one meeting of x and y; returns 1 if they had met before.
function bumpPair(counts, x, y, n) {
  const key = x < y ? x * n + y : y * n + x;
  counts[key]++;
  return counts[key] > 1 ? 1 : 0;
}

export function evaluate(slots, strength, n) {
  const partners = new Uint16Array(n * n);
  const opponents = new Uint16Array(n * n);
  const balance = new Float64Array(n);
  let partnerRepeats = 0;
  let opponentRepeats = 0;
  let sumDiffSq = 0;
  let maxAbsDiff = 0;
  for (const s of slots) {
    for (let m = 0; m < s.length; m += 4) {
      const [a, b, c, d] = [s[m], s[m + 1], s[m + 2], s[m + 3]];
      const diff = strength[a] + strength[b] - strength[c] - strength[d];
      sumDiffSq += diff * diff;
      maxAbsDiff = Math.max(maxAbsDiff, Math.abs(diff));
      balance[a] += diff;
      balance[b] += diff;
      balance[c] -= diff;
      balance[d] -= diff;
      partnerRepeats += bumpPair(partners, a, b, n) + bumpPair(partners, c, d, n);
      opponentRepeats += bumpPair(opponents, a, c, n) + bumpPair(opponents, a, d, n)
        + bumpPair(opponents, b, c, n) + bumpPair(opponents, b, d, n);
    }
  }
  let sumBalanceSq = 0;
  let maxAbsBalance = 0;
  for (let i = 0; i < n; i++) {
    sumBalanceSq += balance[i] * balance[i];
    maxAbsBalance = Math.max(maxAbsBalance, Math.abs(balance[i]));
  }
  const cost = WEIGHTS.partner * partnerRepeats + WEIGHTS.match * sumDiffSq
    + WEIGHTS.balance * sumBalanceSq + WEIGHTS.opponent * opponentRepeats;
  return { cost, partnerRepeats, opponentRepeats, sumDiffSq, maxAbsDiff, maxAbsBalance };
}

// Simulated annealing. A move swaps two active players of one round who are not
// already partners. Iteration count (not time) keeps results deterministic.
function optimize(slots, strength, n, rng, iterations) {
  const current = slots.map((s) => s.slice());
  let currentCost = evaluate(current, strength, n).cost;
  let best = current.map((s) => s.slice());
  let bestCost = currentCost;
  const startTemp = 50;
  const endTemp = 0.01;
  for (let it = 0; it < iterations; it++) {
    const temp = startTemp * Math.pow(endTemp / startTemp, it / iterations);
    const s = current[Math.floor(rng() * current.length)];
    const i = Math.floor(rng() * s.length);
    let j = Math.floor(rng() * (s.length - 1));
    if (j >= i) j++;
    if (i >> 1 === j >> 1) continue; // same team: swapping changes nothing
    [s[i], s[j]] = [s[j], s[i]];
    const cost = evaluate(current, strength, n).cost;
    const delta = cost - currentCost;
    if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
      currentCost = cost;
      if (cost < bestCost) {
        bestCost = cost;
        best = current.map((x) => x.slice());
      }
    } else {
      [s[i], s[j]] = [s[j], s[i]];
    }
  }
  return best;
}

export function generateSchedule({ players, courts, rounds, seed, iterations = DEFAULT_ITERATIONS }) {
  const n = players.length;
  const rng = createRng(seed);
  const strength = players.map((p) => strengthOf(p.skill));
  const sitOuts = assignSitOuts(n, playersPerRound(n, courts), rounds, rng);
  const slots = sitOuts.map((sitting) => shuffle(rng, [...Array(n).keys()].filter((i) => !sitting.includes(i))));
  const best = optimize(slots, strength, n, rng, iterations);
  const id = (i) => players[i].id;
  const schedule = best.map((s, r) => ({
    round: r + 1,
    matches: Array.from({ length: s.length / 4 }, (_, k) => ({
      court: k + 1,
      team1: [id(s[4 * k]), id(s[4 * k + 1])],
      team2: [id(s[4 * k + 2]), id(s[4 * k + 3])],
    })),
    sitOuts: sitOuts[r].map(id),
  }));
  return { schedule, stats: evaluate(best, strength, n) };
}

export function scheduleStats(players, schedule) {
  const index = new Map(players.map((p, i) => [p.id, i]));
  const strength = players.map((p) => strengthOf(p.skill));
  const slots = schedule.map((r) => r.matches.flatMap((m) => [...m.team1, ...m.team2].map((pid) => index.get(pid))));
  return evaluate(slots, strength, players.length);
}

export function drawWarnings(stats) {
  const warnings = [];
  if (stats.partnerRepeats > 0) {
    warnings.push(`Not enough players to avoid repeated partners: ${stats.partnerRepeats} repeated pairing(s).`);
  }
  if (stats.maxAbsDiff >= UNBALANCED_GAP) {
    warnings.push(`Some matches are unbalanced (team skill gap up to ${stats.maxAbsDiff}). This happens with few players or very different skill levels.`);
  }
  return warnings;
}
