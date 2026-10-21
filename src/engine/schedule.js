import { createRng, shuffle } from './rng.js';
import { perRoundPlayers } from './timeplan.js';

export const WEIGHTS = { partner: 10000, match: 10, balance: 3, opponent: 1, spread: 5, wide: 1 };
export const DEFAULT_ITERATIONS = 100000;
// Small groups are cheap to evaluate but hard to balance, so they get more search.
export const SMALL_GROUP_ITERATIONS = 200000;
export const UNBALANCED_GAP = 3;
// Below this, avoiding repeated partners leaves too little room: the spread rule
// would cost sum balance without making spreads much more similar.
export const SPREAD_MIN_PLAYERS = 14;
const RESTARTS = 4;

export function strengthOf(skill) {
  return 11 - skill;
}

// Each round sits out the players who have sat out least so far, so nobody sits out
// twice before everyone has sat out once. Within a tie, players who sat out last round
// are avoided when there is a real choice, and the rest is random, so the groups on
// court mix. Only when avoiding back-to-back sit-outs would freeze the groups (exactly
// as many fresh candidates as places, e.g. 16 players on 2 courts) about a quarter of
// the places go to players who just sat out.
// Each round's list is in selection order (fewest sit-outs first).
// `before` continues from earlier rounds: sit-outs so far per player and who sat out last.
// `fewer` are players who should get the extra sit-outs when the games come out uneven:
// whenever only some of the players on a level sit out, they go first.
// `perRound` is the number of players on court, the same for every round or one per round.
export function assignSitOuts(playerCount, perRound, rounds, rng, before = {}, fewer = new Set()) {
  const count = before.count ? [...before.count] : new Array(playerCount).fill(0);
  let previous = new Set(before.previous);
  return Array.from({ length: rounds }, (_, r) => {
    const sitting = playerCount - (Array.isArray(perRound) ? perRound[r] : perRound);
    const order = shuffle(rng, [...Array(playerCount).keys()]);
    const levels = [...new Set(count)].sort((a, b) => a - b).map((c) => order.filter((i) => count[i] === c));
    const chosen = [];
    for (const level of levels) {
      const need = sitting - chosen.length;
      if (need === 0) break;
      if (level.length <= need) {
        chosen.push(...level);
        continue;
      }
      const marked = level.filter((i) => fewer.has(i));
      if (marked.length > need) {
        chosen.push(...pickSitOuts(marked, need, previous));
        continue;
      }
      chosen.push(...marked);
      chosen.push(...pickSitOuts(level.filter((i) => !marked.includes(i)), need - marked.length, previous));
    }
    chosen.forEach((i) => count[i]++);
    previous = new Set(chosen);
    return chosen;
  });
}

// Picks `need` of the candidates (fewer than there are), avoiding who sat out last round.
function pickSitOuts(level, need, previous) {
  if (need === 0) return [];
  const fresh = level.filter((i) => !previous.has(i));
  if (fresh.length > need) return fresh.slice(0, need);
  if (fresh.length === need) {
    // Taking exactly the fresh players would freeze the groups: let about a
    // quarter of the places go to players who just sat out, so the groups mix.
    const repeat = Math.max(1, Math.round(need / 4));
    return [...level.filter((i) => previous.has(i)).slice(0, repeat), ...fresh.slice(0, need - repeat)];
  }
  return [...fresh, ...level.filter((i) => previous.has(i)).slice(0, need - fresh.length)];
}

// Counts one meeting of x and y; returns 1 if they had met before.
function bumpPair(counts, x, y, n) {
  const key = x < y ? x * n + y : y * n + x;
  counts[key]++;
  return counts[key] > 1 ? 1 : 0;
}

// `spreadPlayers` is the number of players taking part, when n also counts players who
// only appear in earlier rounds.
export function evaluate(slots, strength, n, spreadPlayers = n) {
  const partners = new Uint16Array(n * n);
  const opponents = new Uint16Array(n * n);
  const balance = new Float64Array(n);
  let partnerRepeats = 0;
  let opponentRepeats = 0;
  let sumDiffSq = 0;
  let maxAbsDiff = 0;
  let sumSpreadGapSq = 0;
  let maxSpreadGap = 0;
  let sumWideSq = 0;
  for (const s of slots) {
    for (let m = 0; m < s.length; m += 4) {
      const [a, b, c, d] = [s[m], s[m + 1], s[m + 2], s[m + 3]];
      const diff = strength[a] + strength[b] - strength[c] - strength[d];
      sumDiffSq += diff * diff;
      maxAbsDiff = Math.max(maxAbsDiff, Math.abs(diff));
      // Both teams should be mixed alike: 1+9 vs 2+8 is fine, 1+9 vs 5+5 is not.
      const spreadGap = Math.abs(strength[a] - strength[b]) - Math.abs(strength[c] - strength[d]);
      sumSpreadGapSq += spreadGap * spreadGap;
      maxSpreadGap = Math.max(maxSpreadGap, Math.abs(spreadGap));
      // Partners far apart in skill (e.g. 1+9) are allowed, but close partners are preferred.
      sumWideSq += (strength[a] - strength[b]) ** 2 + (strength[c] - strength[d]) ** 2;
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
    + WEIGHTS.balance * sumBalanceSq + WEIGHTS.opponent * opponentRepeats
    + (spreadPlayers >= SPREAD_MIN_PLAYERS ? WEIGHTS.spread * sumSpreadGapSq + WEIGHTS.wide * sumWideSq : 0);
  return { cost, partnerRepeats, opponentRepeats, sumDiffSq, maxAbsDiff, maxAbsBalance, sumSpreadGapSq, maxSpreadGap, sumWideSq };
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
// keeps results deterministic. The first `fixed` rounds were played already: they count
// towards the cost but are never changed.
function anneal(slots, strength, n, rng, iterations, fixed, spreadPlayers) {
  const current = slots.map((s) => s.slice());
  let currentCost = evaluate(current, strength, n, spreadPlayers).cost;
  let best = current.map((s) => s.slice());
  let bestCost = currentCost;
  const startTemp = 2 * WEIGHTS.partner;
  const endTemp = 0.01;
  for (let it = 0; it < iterations; it++) {
    const temp = startTemp * Math.pow(endTemp / startTemp, it / iterations);
    const s = current[fixed + Math.floor(rng() * (current.length - fixed))];
    const undo = s.length >= 8 && rng() < 0.5 ? teamSwapMove(s, rng) : playerSwapMove(s, rng);
    if (!undo) continue;
    const cost = evaluate(current, strength, n, spreadPlayers).cost;
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

// Draws `rounds` rounds for `players`. `past` are rounds already played, possibly with
// other players (`pastPlayers`, e.g. players who withdrew): the new rounds avoid their
// partners, continue their balance and sit out whoever has played most. New rounds are
// numbered after the past ones. `lastRoundCourts` limits the courts in the tournament's
// last round, which is the last of the new rounds.
export function generateSchedule({ players, courts, rounds, seed, iterations, past = [], pastPlayers = [], lastRoundCourts = courts }) {
  const n = players.length;
  iterations ??= n < SPREAD_MIN_PLAYERS ? SMALL_GROUP_ITERATIONS : DEFAULT_ITERATIONS;
  const rng = createRng(seed);
  const ids = new Set(players.map((p) => p.id));
  const everyone = [...players, ...pastPlayers.filter((p) => !ids.has(p.id))];
  const index = new Map(everyone.map((p, i) => [p.id, i]));
  const strength = everyone.map((p) => strengthOf(p.skill));
  const history = past.map((r) => r.matches.flatMap((m) => [...m.team1, ...m.team2].map((pid) => index.get(pid))));
  const satOut = past.map((r) => r.sitOuts.map((pid) => index.get(pid)).filter((i) => i < n));
  const before = {
    count: players.map((_, i) => satOut.filter((r) => r.includes(i)).length),
    previous: satOut.at(-1) ?? [],
  };
  const fewer = new Set(players.flatMap((p, i) => (p.fewer ? [i] : [])));
  const sitOuts = assignSitOuts(n, perRoundPlayers(n, courts, rounds, lastRoundCourts), rounds, rng, before, fewer);
  let best = null;
  let bestCost = Infinity;
  for (let restart = 0; restart < RESTARTS; restart++) {
    const slots = sitOuts.map((sitting) => shuffle(rng, [...Array(n).keys()].filter((i) => !sitting.includes(i))));
    const result = anneal([...history, ...slots], strength, everyone.length, rng, Math.floor(iterations / RESTARTS), history.length, n);
    if (result.cost < bestCost) ({ best, cost: bestCost } = result);
  }
  const id = (i) => everyone[i].id;
  const schedule = best.slice(history.length).map((s, r) => ({
    round: past.length + r + 1,
    matches: Array.from({ length: s.length / 4 }, (_, k) => ({
      court: k + 1,
      team1: [id(s[4 * k]), id(s[4 * k + 1])],
      team2: [id(s[4 * k + 2]), id(s[4 * k + 3])],
    })),
    sitOuts: sitOuts[r].map(id),
  }));
  return { schedule, stats: evaluate(best, strength, everyone.length, n) };
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
