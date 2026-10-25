import { createRng, shuffle } from './rng.js';
import { perRoundPlayers } from './timeplan.js';

// The draw, in two stages (see generateSchedule):
// - handicap: share of a team's skill spread added to its skill sum (opponents can play
//   to the weaker partner);
// - fairness: weight of Σ (F² + F⁴/9) over all matches;
// - partner: cost of a repeated partner (practically forbidden);
// - teammates, opponents: weights of Σ T² and Σ O² in the variety stage;
// - rest: weight of how unevenly each player's games are spread over the rounds;
// - tolerance: how much the fairness may get worse in the variety stage (share of the
//   best fairness found), at least minSlack;
// - fairnessShare: share of the search steps spent on the fairness stage;
// - varietyTemp: start temperature of the variety stage;
// - exchangeShare: share of search steps that exchange sit-outs between rounds.
export const DRAW = {
  handicap: 0.25, fairness: 10, partner: 10000, teammates: 3, opponents: 1, rest: 50,
  tolerance: 0.1, minSlack: 10, fairnessShare: 0.7, varietyTemp: 20, exchangeShare: 0.3,
};
export const DEFAULT_ITERATIONS = 100000;
// Small groups are cheap to evaluate but hard to balance, so they get more search.
export const SMALL_GROUP_ITERATIONS = 200000;
export const SMALL_GROUP_PLAYERS = 14;
export const UNBALANCED_GAP = 3;
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

// Counts one meeting of x and y and returns how often they have met now.
function meet(counts, x, y, n) {
  const key = x < y ? x * n + y : y * n + x;
  return ++counts[key];
}

// Team value on the skill scale (lower = stronger): the sum of both skills plus a share
// of their spread, since opponents can play to the weaker partner. 3 + 6 → 9.75.
export function teamValue(skillA, skillB) {
  return skillA + skillB + DRAW.handicap * Math.abs(skillA - skillB);
}

// The same in strength terms (11 − skill, higher = stronger): the sum minus the share.
function strengthValue(strength, x, y) {
  return strength[x] + strength[y] - DRAW.handicap * Math.abs(strength[x] - strength[y]);
}

// Scores a schedule in parts, as used by the stages of the draw:
// - fairness: Σ (F² + F⁴/9) over all matches (× DRAW.fairness), F = difference of the two
//   team values: small gaps cost about F², large ones much more (F = 3 twice F², F = 6
//   five times), so no single match gets far off;
// - variety: Σ T² over all pairs of partners and Σ O² over all pairs of opponents, so
//   meeting someone a third time costs more than two different players a second time;
// - rest: how unevenly the current players' games are spread over the rounds:
//   Σ (length of each run of sit-outs)² minus the number of sit-outs, so single
//   sit-outs cost nothing and long runs cost more and more.
// `current` is the number of players taking part now (the first `current` indices).
export function evaluate(slots, strength, n, current = n) {
  const partners = new Uint16Array(n * n);
  const opponents = new Uint16Array(n * n);
  const balance = new Float64Array(n);
  let partnerRepeats = 0;
  let opponentRepeats = 0;
  let opponentThirds = 0;
  let sumDiffSq = 0;
  let maxAbsDiff = 0;
  let gapCost = 0;
  let partnerSq = 0;
  let opponentSq = 0;
  const run = new Uint16Array(current);
  const playing = new Uint8Array(current);
  let rest = 0;
  for (const s of slots) {
    playing.fill(0);
    for (const i of s) if (i < current) playing[i] = 1;
    for (let i = 0; i < current; i++) {
      if (playing[i]) run[i] = 0;
      else rest += 2 * run[i]++; // (k + 1)² − k² − 1
    }
    for (let m = 0; m < s.length; m += 4) {
      const [a, b, c, d] = [s[m], s[m + 1], s[m + 2], s[m + 3]];
      const diff = strengthValue(strength, a, b) - strengthValue(strength, c, d);
      sumDiffSq += diff * diff;
      gapCost += diff * diff + diff ** 4 / 9;
      maxAbsDiff = Math.max(maxAbsDiff, Math.abs(diff));
      balance[a] += diff;
      balance[b] += diff;
      balance[c] -= diff;
      balance[d] -= diff;
      for (const [x, y] of [[a, b], [c, d]]) {
        const t = meet(partners, x, y, n);
        partnerSq += 2 * t - 1; // t² − (t − 1)²
        if (t > 1) partnerRepeats++;
      }
      for (const [x, y] of [[a, c], [a, d], [b, c], [b, d]]) {
        const o = meet(opponents, x, y, n);
        opponentSq += 2 * o - 1;
        if (o > 1) opponentRepeats++;
        if (o > 2) opponentThirds++;
      }
    }
  }
  let maxAbsBalance = 0;
  for (let i = 0; i < n; i++) maxAbsBalance = Math.max(maxAbsBalance, Math.abs(balance[i]));
  const fairness = DRAW.fairness * gapCost;
  const variety = DRAW.teammates * partnerSq + DRAW.opponents * opponentSq;
  return {
    fairness, variety, rest, partnerRepeats, opponentRepeats, opponentThirds, partnerSq, opponentSq,
    sumDiffSq, maxAbsDiff, maxAbsBalance,
  };
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

// Two players trade a round on court for a round sitting out: A plays in round r and sits
// out in round s, B the other way round; afterwards B plays in r and A in s. Everyone keeps
// the same number of games and sit-outs, but who is on court together changes.
function sitOutExchangeMove(slots, sits, r, s, rng) {
  const as = slots[r].filter((i) => sits[s].includes(i));
  const bs = sits[r].filter((i) => slots[s].includes(i));
  if (!as.length || !bs.length) return null;
  const a = as[Math.floor(rng() * as.length)];
  const b = bs[Math.floor(rng() * bs.length)];
  const [pa, pb] = [slots[r].indexOf(a), slots[s].indexOf(b)];
  const [qb, qa] = [sits[r].indexOf(b), sits[s].indexOf(a)];
  const set = (x, y) => {
    slots[r][pa] = x; sits[r][qb] = y;
    slots[s][pb] = y; sits[s][qa] = x;
  };
  set(b, a);
  return () => set(a, b);
}

// Simulated annealing over player swaps, team swaps and sit-out exchanges, minimizing
// `costOf(stats)`. Iteration count (not time) keeps results deterministic. The first
// `fixed` rounds were played already: they count towards the cost but are never changed.
function anneal(start, strength, n, current, rng, iterations, fixed, costOf, startTemp) {
  const slots = start.slots.map((s) => s.slice());
  const sits = start.sits.map((s) => s.slice());
  let currentCost = costOf(evaluate(slots, strength, n, current));
  let best = { slots: slots.map((s) => s.slice()), sits: sits.map((s) => s.slice()) };
  let bestCost = currentCost;
  const endTemp = 0.01;
  const open = slots.length - fixed;
  for (let it = 0; it < iterations; it++) {
    const temp = startTemp * Math.pow(endTemp / startTemp, it / iterations);
    const r = fixed + Math.floor(rng() * open);
    let undo;
    if (open > 1 && sits[r].length && rng() < DRAW.exchangeShare) {
      let s = fixed + Math.floor(rng() * (open - 1));
      if (s >= r) s++;
      undo = sitOutExchangeMove(slots, sits, r, s, rng);
    } else {
      undo = slots[r].length >= 8 && rng() < 0.5 ? teamSwapMove(slots[r], rng) : playerSwapMove(slots[r], rng);
    }
    if (!undo) continue;
    const cost = costOf(evaluate(slots, strength, n, current));
    const delta = cost - currentCost;
    if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
      currentCost = cost;
      if (cost < bestCost) {
        bestCost = cost;
        best = { slots: slots.map((s) => s.slice()), sits: sits.map((s) => s.slice()) };
      }
    } else {
      undo();
    }
  }
  return { best, cost: bestCost };
}

// Draws `rounds` rounds for `players` in two stages:
// A. fairness: the fairest draw without repeated partners (several restarts);
// B. variety: starting from it, the most different partners and opponents while the
//    fairness stays within DRAW.tolerance of the best found in stage A.
// Both stages may also move sit-outs between rounds (everyone keeps the same number),
// so players who would otherwise never be on court together can meet; DRAW.rest keeps
// each player's games spread over the tournament.
// `past` are rounds already played, possibly with other players (`pastPlayers`, e.g.
// players who withdrew): they count but never change. New rounds are numbered after
// them. `lastRoundCourts` limits the courts in the tournament's last round.
export function generateSchedule({ players, courts, rounds, seed, iterations, past = [], pastPlayers = [], lastRoundCourts = courts }) {
  const n = players.length;
  iterations ??= n < SMALL_GROUP_PLAYERS ? SMALL_GROUP_ITERATIONS : DEFAULT_ITERATIONS;
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
  const total = everyone.length;
  const fixed = history.length;

  // Stage A: fairness.
  const fairCost = (st) => DRAW.partner * st.partnerRepeats + st.fairness + DRAW.rest * st.rest;
  const stageA = Math.floor((iterations * DRAW.fairnessShare) / RESTARTS);
  let best = null;
  let bestCost = Infinity;
  for (let restart = 0; restart < RESTARTS; restart++) {
    const start = {
      slots: [...history, ...sitOuts.map((sitting) => shuffle(rng, [...Array(n).keys()].filter((i) => !sitting.includes(i))))],
      sits: [...satOut, ...sitOuts.map((s) => s.slice())],
    };
    const result = anneal(start, strength, total, n, rng, stageA, fixed, fairCost, 2 * DRAW.partner);
    if (result.cost < bestCost) ({ best, cost: bestCost } = result);
  }

  // Stage B: variety, with fairness at most (1 + tolerance) × the best found.
  const a = evaluate(best.slots, strength, total, n);
  const limit = a.fairness + Math.max(DRAW.tolerance * a.fairness, DRAW.minSlack);
  const varietyCost = (st) => DRAW.partner * Math.max(0, st.partnerRepeats - a.partnerRepeats)
    + st.variety + DRAW.rest * st.rest + (st.fairness > limit ? DRAW.partner * (1 + st.fairness - limit) : 0);
  const stageB = iterations - stageA * RESTARTS;
  ({ best } = anneal(best, strength, total, n, rng, stageB, fixed, varietyCost, DRAW.varietyTemp));

  const id = (i) => everyone[i].id;
  const schedule = best.slots.slice(fixed).map((s, r) => ({
    round: past.length + r + 1,
    matches: Array.from({ length: s.length / 4 }, (_, k) => ({
      court: k + 1,
      team1: [id(s[4 * k]), id(s[4 * k + 1])],
      team2: [id(s[4 * k + 2]), id(s[4 * k + 3])],
    })),
    sitOuts: best.sits[fixed + r].map(id),
  }));
  return { schedule, stats: evaluate(best.slots, strength, total, n) };
}

export function scheduleStats(players, schedule) {
  const index = new Map(players.map((p, i) => [p.id, i]));
  const strength = players.map((p) => strengthOf(p.skill));
  const slots = schedule.map((r) => r.matches.flatMap((m) => [...m.team1, ...m.team2].map((pid) => index.get(pid))));
  return evaluate(slots, strength, players.length);
}

// Team values come in quarter steps: 9.75, 10.5, 11.
export function formatValue(x) {
  return String(Math.round(x * 100) / 100);
}

// How big an edge is, in words: one skill step is 1.0, and team values move in quarter
// steps. Under 0.25 even, under 0.75 slight, under 1.5 clear, from 1.5 big.
export function edgeLevel(gap) {
  const x = Math.abs(gap);
  return x < 0.25 ? 'even' : x < 0.75 ? 'slight' : x < 1.5 ? 'clear' : 'big';
}

export function drawWarnings(stats) {
  const warnings = [];
  if (stats.partnerRepeats > 0) {
    warnings.push(`Could not avoid repeated partners: ${stats.partnerRepeats} repeated pairing(s).`);
  }
  if (stats.maxAbsDiff >= UNBALANCED_GAP) {
    warnings.push(`Some matches are unbalanced (team value gap up to ${formatValue(stats.maxAbsDiff)}). With few players or very different skill levels, avoiding repeated partners limits how balanced matches can be.`);
  }
  return warnings;
}
