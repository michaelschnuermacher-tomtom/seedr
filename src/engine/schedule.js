import { shuffle } from './rng.js';

export const WEIGHTS = { partner: 10000, match: 10, balance: 3, opponent: 1 };

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
