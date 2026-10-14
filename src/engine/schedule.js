import { createRng, shuffle } from './rng.js';
import { playersPerRound } from './timeplan.js';

export const WEIGHTS = { partner: 10000, match: 10, balance: 3, opponent: 1 };
export const DEFAULT_ITERATIONS = 100000;
export const UNBALANCED_GAP = 3;
const RESTARTS = 4;

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

// Swaps two whole teams between matches of one round: partners stay together,
// only opponents change. Without this move the search gets stuck once every
// single-player swap would create a repeated partner.
function teamSwapMove(s, rng) {
  const teams = s.length / 2;
  const a = Math.floor(rng() * teams);
  let b = Math.floor(rng() * (teams - 1));
  if (b >= a) b++;
  if (a >> 1 === b >> 1) return null; // same match: swapping changes nothing
  const swap = () => {
    for (const k of [0, 1]) [s[2 * a + k], s[2 * b + k]] = [s[2 * b + k], s[2 * a + k]];
  };
  swap();
  return swap;
}

function playerSwapMove(s, rng) {
  const i = Math.floor(rng() * s.length);
  let j = Math.floor(rng() * (s.length - 1));
  if (j >= i) j++;
  if (i >> 1 === j >> 1) return null; // same team: swapping changes nothing
  const swap = () => { [s[i], s[j]] = [s[j], s[i]]; };
  swap();
  return swap;
}

// Simulated annealing over player swaps and team swaps. The start temperature is
// high enough to pass through partner repeats early on. Iteration count (not time)
// keeps results deterministic.
function anneal(slots, strength, n, rng, iterations) {
  const current = slots.map((s) => s.slice());
  let currentCost = evaluate(current, strength, n).cost;
  let best = current.map((s) => s.slice());
  let bestCost = currentCost;
  const startTemp = 2 * WEIGHTS.partner;
  const endTemp = 0.01;
  for (let it = 0; it < iterations; it++) {
    const temp = startTemp * Math.pow(endTemp / startTemp, it / iterations);
    const s = current[Math.floor(rng() * current.length)];
    const undo = s.length >= 8 && rng() < 0.5 ? teamSwapMove(s, rng) : playerSwapMove(s, rng);
    if (!undo) continue;
    const cost = evaluate(current, strength, n).cost;
    const delta = cost - currentCost;
    if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
      currentCost = cost;
      if (cost < bestCost) {
        bestCost = cost;
        best = current.map((x) => x.slice());
      }
    } else {
      undo();
    }
  }
  return { best, cost: bestCost };
}

export function generateSchedule({ players, courts, rounds, seed, iterations = DEFAULT_ITERATIONS }) {
  const n = players.length;
  const rng = createRng(seed);
  const strength = players.map((p) => strengthOf(p.skill));
  const sitOuts = assignSitOuts(n, playersPerRound(n, courts), rounds, rng);
  let best = null;
  let bestCost = Infinity;
  for (let restart = 0; restart < RESTARTS; restart++) {
    const slots = sitOuts.map((sitting) => shuffle(rng, [...Array(n).keys()].filter((i) => !sitting.includes(i))));
    const result = anneal(slots, strength, n, rng, Math.floor(iterations / RESTARTS));
    if (result.cost < bestCost) ({ best, cost: bestCost } = result);
  }
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
    warnings.push(`Could not avoid repeated partners: ${stats.partnerRepeats} repeated pairing(s).`);
  }
  if (stats.maxAbsDiff >= UNBALANCED_GAP) {
    warnings.push(`Some matches are unbalanced (team skill gap up to ${stats.maxAbsDiff}). With few players or very different skill levels, avoiding repeated partners limits how balanced matches can be.`);
  }
  return warnings;
}
