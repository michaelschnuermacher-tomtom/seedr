# Seedr Free Rounds (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser app, delivered as one HTML file, that draws balanced rotating 2-vs-2 teams over a fixed number of rounds on limited courts, records win/loss results and ranks players by wins.

**Architecture:** Pure engine modules (`src/engine/*`, no DOM) do the time planning, the draw (sit-out rotation + simulated annealing), the standings, the tournament model and import validation. They are unit-tested with `node --test`. Plain-JavaScript UI modules (`src/ui/*`) render screens with a tiny `h()` helper. `build.mjs` concatenates all modules in import order into one classic script, inlined into `dist/index.html`.

**Tech Stack:** JavaScript (ES modules in source), Node ≥ 22 for tests and build (`node:test`, `node:assert/strict`), no npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-seedr-free-rounds-design.md`

## Global Constraints

- No npm dependencies, at runtime or for development. Only Node built-ins.
- Skill input is 1–10 with **1 = best**. Internal strength = `11 − skill`; higher strength = stronger.
- Teams are always exactly 2 players; players on court per round `A = min(4·C, 4·floor(N/4))`.
- Minimum recommended match length: 5 minutes.
- Draw cost weights: partner 10 000, match 10, balance 3, opponent 1. Default iterations: 100 000 (fixed count, not time, for determinism).
- Win = 1 point, loss = 0, bonus = 0.5 per missing game (completed rounds only), shared ranks on equal points.
- Data format version `1`; result key `"<round>-<court>"`, value `1` or `2`.
- localStorage key `seedr.v1`; export filename `<slug>.seedr.json`.
- No timer in the app (timing is handled outside the app).
- Every source file is an ES module whose imports are single-line `import { … } from './x.js';` statements. Top-level names must be unique across all modules (the bundler checks this).
- UI must work in current Safari (iPad) and Chrome; tap targets ≥ 44 px.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Tight setups** (e.g. 8 players, 2 courts, 7 rounds), where avoiding repeated partners forces uneven matches → the app shows a warning instead of silently producing unbalanced matches (test in Task 4).
2. **More courts than players can fill** (e.g. 5 players, 3 courts) → only `floor(N/4)` courts are used and the rest sit out; nothing crashes (test in Task 4).
3. **A result is changed or cleared after a round was complete** → games, bonus and ranks are recomputed from scratch, so no stale bonus remains (test in Task 5).
4. **Importing a file exported from another device, or a hand-edited or broken file** → valid files round-trip exactly; broken references, wrong versions or bad values are rejected with a readable message (tests in Task 7).
5. **Messy player lists:** multi-word names, commas, semicolons or tabs as separators, blank lines, duplicate names differing only in case, skills like 0 or 11 → parsed or reported per line (tests in Task 6).

---

## File Structure

```
package.json                 scripts: test, build; "type": "module"
build.mjs                    bundle() + build(): src → dist/index.html, sw.js, manifest
src/engine/rng.js            seeded PRNG, shuffle, newSeed
src/engine/timeplan.js       playersPerRound, gamesPerPlayer, recommendOptions
src/engine/schedule.js       assignSitOuts, evaluate, optimize, generateSchedule, scheduleStats, drawWarnings
src/engine/standings.js      resultKey, computeStandings
src/engine/tournament.js     parsePlayers, createTournament, revealNext, redraw, setResult, hasResults
src/engine/validate.js       validateTournament
src/ui/store.js              createStore(backend): localStorage persistence
src/ui/dom.js                h(), formatSigned, slugify, newId
src/ui/home.js               homeScreen (list, delete, import)
src/ui/setup.js              newDraft, evaluateDraft, setupScreen
src/ui/tournament-view.js    tournamentScreen (rounds, standings, manage tabs, export)
src/ui/app.js                state, ctx, render, routing (entry point)
src/ui/index.html            HTML shell with /* STYLES */ and /* SCRIPT */ markers
src/ui/styles.css            styles (light + dark)
src/ui/sw.js                 service worker (network-first, offline fallback)
src/ui/manifest.webmanifest  web app manifest
test/*.test.mjs              unit tests
README.md                    usage + deployment
```

---

### Task 1: Project scaffold and seeded random numbers

**Files:**
- Create: `package.json`, `src/engine/rng.js`
- Test: `test/rng.test.mjs`

**Interfaces:**
- Produces: `createRng(seed: number) → () => number` (uniform in [0, 1)), `randomInt(rng, n) → integer in [0, n)`, `shuffle(rng, array) → new shuffled array` (input unchanged), `newSeed() → integer in [0, 2³²)`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "seedr",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test \"test/**/*.test.mjs\"",
    "build": "node build.mjs"
  }
}
```

- [ ] **Step 2: Write the failing test** `test/rng.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, randomInt, shuffle, newSeed } from '../src/engine/rng.js';

test('same seed gives the same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('different seeds give different sequences', () => {
  assert.notEqual(createRng(1)(), createRng(2)());
});

test('values are in [0, 1)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1);
  }
});

test('randomInt stays in range and hits every value', () => {
  const rng = createRng(9);
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const v = randomInt(rng, 5);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 5);
    seen.add(v);
  }
  assert.equal(seen.size, 5);
});

test('shuffle returns a permutation and leaves the input unchanged', () => {
  const input = [1, 2, 3, 4, 5, 6];
  const out = shuffle(createRng(3), input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...out].sort((x, y) => x - y), input);
});

test('newSeed is a 32-bit unsigned integer', () => {
  const s = newSeed();
  assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 32);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '.../src/engine/rng.js'`

- [ ] **Step 4: Implement** `src/engine/rng.js`

```js
// mulberry32: small, fast, seedable PRNG. Same seed → same sequence on every device.
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng, n) {
  return Math.floor(rng() * n);
}

export function shuffle(rng, array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newSeed() {
  return Math.floor(Math.random() * 4294967296);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json src/engine/rng.js test/rng.test.mjs
git commit -m "feat: project scaffold and seeded random numbers"
```

---

### Task 2: Time planning

**Files:**
- Create: `src/engine/timeplan.js`
- Test: `test/timeplan.test.mjs`

**Interfaces:**
- Produces:
  - `MIN_MATCH_MINUTES = 5`
  - `playersPerRound(players: number, courts: number) → number`
  - `gamesPerPlayer(players, courts, rounds) → { min, max, even }`
  - `recommendOptions({ players, courts, totalMinutes, breakMinutes }) → Option[]`, where `Option = { rounds, matchMinutes, breakMinutes, gamesMin, gamesMax, even, totalMinutes }`. Even options come first, then uneven; each group is sorted by `rounds`.

- [ ] **Step 1: Write the failing test** `test/timeplan.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playersPerRound, gamesPerPlayer, recommendOptions } from '../src/engine/timeplan.js';

test('players per round is limited by courts and by groups of four', () => {
  assert.equal(playersPerRound(18, 3), 12);
  assert.equal(playersPerRound(10, 3), 8);
  assert.equal(playersPerRound(5, 3), 4);
  assert.equal(playersPerRound(3, 2), 0);
});

test('games per player: even and uneven', () => {
  assert.deepEqual(gamesPerPlayer(18, 3, 9), { min: 6, max: 6, even: true });
  assert.deepEqual(gamesPerPlayer(18, 3, 8), { min: 5, max: 6, even: false });
});

test('recommendations for the spec example (18 players, 3 courts, 120 min, 2 min break)', () => {
  const options = recommendOptions({ players: 18, courts: 3, totalMinutes: 120, breakMinutes: 2 });
  const byRounds = Object.fromEntries(options.map((o) => [o.rounds, o]));
  assert.deepEqual(byRounds[6], { rounds: 6, matchMinutes: 18, breakMinutes: 2, gamesMin: 4, gamesMax: 4, even: true, totalMinutes: 120 });
  assert.deepEqual(byRounds[9], { rounds: 9, matchMinutes: 11, breakMinutes: 2, gamesMin: 6, gamesMax: 6, even: true, totalMinutes: 117 });
  assert.equal(byRounds[8].matchMinutes, 13);
  assert.equal(byRounds[8].even, false);
  assert.deepEqual(options.filter((o) => o.even).map((o) => o.rounds), [3, 6, 9, 12, 15]);
  assert.equal(options.findIndex((o) => !o.even), 5, 'even options come first');
  assert.ok(options.every((o) => o.matchMinutes >= 5 && o.totalMinutes <= 120));
  assert.equal(Math.max(...options.map((o) => o.rounds)), 17);
});

test('no options with fewer than 4 players or too little time', () => {
  assert.deepEqual(recommendOptions({ players: 3, courts: 1, totalMinutes: 60, breakMinutes: 2 }), []);
  assert.deepEqual(recommendOptions({ players: 8, courts: 2, totalMinutes: 6, breakMinutes: 2 }), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/timeplan.test.mjs`
Expected: FAIL with `Cannot find module '.../src/engine/timeplan.js'`

- [ ] **Step 3: Implement** `src/engine/timeplan.js`

```js
export const MIN_MATCH_MINUTES = 5;

export function playersPerRound(players, courts) {
  return Math.min(4 * courts, 4 * Math.floor(players / 4));
}

export function gamesPerPlayer(players, courts, rounds) {
  const total = rounds * playersPerRound(players, courts);
  return { min: Math.floor(total / players), max: Math.ceil(total / players), even: total % players === 0 };
}

export function recommendOptions({ players, courts, totalMinutes, breakMinutes }) {
  if (playersPerRound(players, courts) === 0) return [];
  const options = [];
  for (let rounds = 1; ; rounds++) {
    const matchMinutes = Math.floor(totalMinutes / rounds - breakMinutes);
    if (matchMinutes < MIN_MATCH_MINUTES) break;
    const games = gamesPerPlayer(players, courts, rounds);
    options.push({
      rounds,
      matchMinutes,
      breakMinutes,
      gamesMin: games.min,
      gamesMax: games.max,
      even: games.even,
      totalMinutes: rounds * (matchMinutes + breakMinutes),
    });
  }
  return options.sort((a, b) => (a.even === b.even ? a.rounds - b.rounds : a.even ? -1 : 1));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/timeplan.js test/timeplan.test.mjs
git commit -m "feat: time planning recommendations"
```

---

### Task 3: Sit-out rotation and schedule evaluation

**Files:**
- Create: `src/engine/schedule.js`
- Test: `test/schedule.test.mjs`

**Interfaces:**
- Consumes: `shuffle` from `rng.js`.
- Produces:
  - `WEIGHTS = { partner: 10000, match: 10, balance: 3, opponent: 1 }`
  - `strengthOf(skill) → 11 − skill`
  - `assignSitOuts(playerCount, perRound, rounds, rng) → number[][]` (player indices per round)
  - `evaluate(slots: number[][], strength: number[], n: number) → { cost, partnerRepeats, opponentRepeats, sumDiffSq, maxAbsDiff, maxAbsBalance }`. Each `slots[r]` lists the active player indices of round `r` in groups of 4: `[t1a, t1b, t2a, t2b, …]` (match k = indices `4k…4k+3`, team 1 = first two).

- [ ] **Step 1: Write the failing test** `test/schedule.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/engine/rng.js';
import { assignSitOuts, evaluate, strengthOf } from '../src/engine/schedule.js';

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
  const e = evaluate([[0, 3, 1, 2]], strength, 4); // 17 vs 17
  assert.deepEqual(e, { cost: 0, partnerRepeats: 0, opponentRepeats: 0, sumDiffSq: 0, maxAbsDiff: 0, maxAbsBalance: 0 });
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/schedule.test.mjs`
Expected: FAIL with `Cannot find module '.../src/engine/schedule.js'`

- [ ] **Step 3: Implement** `src/engine/schedule.js`

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/schedule.js test/schedule.test.mjs
git commit -m "feat: sit-out rotation and schedule evaluation"
```

---

### Task 4: Draw optimizer, schedule generation and warnings

**Files:**
- Modify: `src/engine/schedule.js` (add imports and functions)
- Test: `test/schedule.test.mjs` (append)

**Interfaces:**
- Consumes: `createRng`, `shuffle` from `rng.js`; `playersPerRound` from `timeplan.js`; `evaluate`, `assignSitOuts`, `strengthOf` (Task 3).
- Produces:
  - `DEFAULT_ITERATIONS = 100000`, `UNBALANCED_GAP = 3`
  - `generateSchedule({ players: {id, skill}[], courts, rounds, seed, iterations? }) → { schedule: Round[], stats }`, where `Round = { round: number (1-based), matches: { court: number (1-based), team1: [id, id], team2: [id, id] }[], sitOuts: id[] }` and `stats` = the result of `evaluate`.
  - `scheduleStats(players, schedule) → stats` (same shape as `evaluate`)
  - `drawWarnings(stats) → string[]`

- [ ] **Step 1: Append the failing tests** to `test/schedule.test.mjs`

Add `generateSchedule, scheduleStats, drawWarnings` to the import line from `'../src/engine/schedule.js'`, then append:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/schedule.test.mjs`
Expected: FAIL with `does not provide an export named 'generateSchedule'`

- [ ] **Step 3: Implement.** In `src/engine/schedule.js` replace the import line with:

```js
import { createRng, shuffle } from './rng.js';
import { playersPerRound } from './timeplan.js';
```

Below `WEIGHTS` add:

```js
export const DEFAULT_ITERATIONS = 100000;
export const UNBALANCED_GAP = 3;
```

Append at the end of the file:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. The whole suite should finish in under 5 seconds. If a quality threshold fails, report the measured value rather than loosening the assertion silently.

- [ ] **Step 5: Commit**

```bash
git add src/engine/schedule.js test/schedule.test.mjs
git commit -m "feat: draw optimizer, schedule generation and draw warnings"
```

---

### Task 5: Standings

**Files:**
- Create: `src/engine/standings.js`
- Test: `test/standings.test.mjs`

**Interfaces:**
- Consumes: `strengthOf` from `schedule.js`.
- Produces:
  - `resultKey(round, court) → "<round>-<court>"`
  - `computeStandings(players, schedule, results) → Row[]` sorted by points (desc), then name. `Row = { id, name, skill, games, wins, bonus, points, avgGap, rank }`. `avgGap` = average (own team strength − opponent strength) over completed-round games; positive = played in the stronger team.

- [ ] **Step 1: Write the failing test** `test/standings.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, resultKey } from '../src/engine/standings.js';

// strengths: p1 10, p2 6, p3 8, p4 7, p5 2
const players = [
  { id: 'p1', name: 'Anna', skill: 1 },
  { id: 'p2', name: 'Ben', skill: 5 },
  { id: 'p3', name: 'Carla', skill: 3 },
  { id: 'p4', name: 'David', skill: 4 },
  { id: 'p5', name: 'Eva', skill: 9 },
];
const schedule = [
  { round: 1, matches: [{ court: 1, team1: ['p1', 'p2'], team2: ['p3', 'p4'] }], sitOuts: ['p5'] },
  { round: 2, matches: [{ court: 1, team1: ['p1', 'p5'], team2: ['p2', 'p3'] }], sitOuts: ['p4'] },
];
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

test('resultKey', () => {
  assert.equal(resultKey(3, 2), '3-2');
});

test('no results: everyone at zero, all share rank 1', () => {
  const rows = computeStandings(players, schedule, {});
  rows.forEach((r) => {
    assert.equal(r.points, 0);
    assert.equal(r.rank, 1);
  });
});

test('after round 1: winners lead, sit-out gets 0.5 bonus', () => {
  const rows = byId(computeStandings(players, schedule, { '1-1': 1 }));
  assert.deepEqual([rows.p1.wins, rows.p1.games, rows.p1.points, rows.p1.rank], [1, 1, 1, 1]);
  assert.deepEqual([rows.p2.points, rows.p2.rank], [1, 1]);
  assert.deepEqual([rows.p5.games, rows.p5.bonus, rows.p5.points, rows.p5.rank], [0, 0.5, 0.5, 3]);
  assert.deepEqual([rows.p3.points, rows.p3.rank], [0, 4]);
  assert.equal(rows.p1.avgGap, 1); // 16 vs 15
  assert.equal(rows.p3.avgGap, -1);
});

test('after round 2: shared ranks and bonus for both sit-outs', () => {
  const rows = byId(computeStandings(players, schedule, { '1-1': 1, '2-1': 2 }));
  assert.deepEqual([rows.p2.points, rows.p2.rank], [2, 1]);
  assert.deepEqual([rows.p1.points, rows.p1.rank], [1, 2]);
  assert.deepEqual([rows.p3.points, rows.p3.rank], [1, 2]);
  assert.deepEqual([rows.p4.bonus, rows.p4.points, rows.p4.rank], [0.5, 0.5, 4]);
  assert.deepEqual([rows.p5.bonus, rows.p5.points, rows.p5.rank], [0.5, 0.5, 4]);
});

test('a win in an unfinished round counts, but games and bonus do not change yet', () => {
  const twoCourts = [{ round: 1, matches: [
    { court: 1, team1: ['p1', 'p2'], team2: ['p3', 'p4'] },
    { court: 2, team1: ['p5', 'p6'], team2: ['p7', 'p8'] },
  ], sitOuts: [] }];
  const eight = [...players, { id: 'p6', name: 'F', skill: 5 }, { id: 'p7', name: 'G', skill: 5 }, { id: 'p8', name: 'H', skill: 5 }];
  const rows = byId(computeStandings(eight, twoCourts, { '1-1': 1 }));
  assert.equal(rows.p1.wins, 1);
  assert.equal(rows.p1.games, 0);
  assert.equal(rows.p5.bonus, 0);
});

test('clearing a result recomputes everything (no stale bonus)', () => {
  const rows = byId(computeStandings(players, schedule, { '2-1': 2 }));
  assert.deepEqual([rows.p1.games, rows.p4.games, rows.p4.bonus, rows.p5.bonus], [1, 0, 0.5, 0]);
  assert.equal(rows.p1.wins, 0);
});

test('rows are sorted by points, then name', () => {
  const rows = computeStandings(players, schedule, { '1-1': 1 });
  assert.deepEqual(rows.map((r) => r.id), ['p1', 'p2', 'p5', 'p3', 'p4']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/standings.test.mjs`
Expected: FAIL with `Cannot find module '.../src/engine/standings.js'`

- [ ] **Step 3: Implement** `src/engine/standings.js`

```js
import { strengthOf } from './schedule.js';

export function resultKey(round, court) {
  return `${round}-${court}`;
}

export function computeStandings(players, schedule, results) {
  const skillOf = new Map(players.map((p) => [p.id, p.skill]));
  const rows = new Map(players.map((p) => [p.id, { id: p.id, name: p.name, skill: p.skill, games: 0, wins: 0, gapSum: 0 }]));
  const teamStrength = (team) => team.reduce((sum, pid) => sum + strengthOf(skillOf.get(pid)), 0);

  for (const round of schedule) {
    const winners = round.matches.map((m) => results[resultKey(round.round, m.court)]);
    round.matches.forEach((m, i) => {
      if (winners[i] === 1) m.team1.forEach((pid) => rows.get(pid).wins++);
      if (winners[i] === 2) m.team2.forEach((pid) => rows.get(pid).wins++);
    });
    const complete = round.matches.length > 0 && winners.every((w) => w === 1 || w === 2);
    if (!complete) continue;
    for (const m of round.matches) {
      const diff = teamStrength(m.team1) - teamStrength(m.team2);
      for (const pid of m.team1) { rows.get(pid).games++; rows.get(pid).gapSum += diff; }
      for (const pid of m.team2) { rows.get(pid).games++; rows.get(pid).gapSum -= diff; }
    }
  }

  const list = [...rows.values()];
  const maxGames = Math.max(0, ...list.map((r) => r.games));
  const out = list.map(({ gapSum, ...r }) => {
    const bonus = 0.5 * (maxGames - r.games);
    return { ...r, bonus, points: r.wins + bonus, avgGap: r.games ? gapSum / r.games : 0 };
  });
  out.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  for (const r of out) r.rank = 1 + out.filter((o) => o.points > r.points).length;
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/standings.js test/standings.test.mjs
git commit -m "feat: standings with bonus for missing games"
```

---

### Task 6: Tournament model and player list parsing

**Files:**
- Create: `src/engine/tournament.js`
- Test: `test/tournament.test.mjs`

**Interfaces:**
- Consumes: `generateSchedule` (Task 4), `resultKey` (Task 5).
- Produces:
  - `FORMAT_VERSION = 1`
  - `parsePlayers(text) → { players: {name, skill}[], errors: string[] }`
  - `createTournament({ id, name, players: {name, skill}[], settings: {courts, rounds, matchMinutes, breakMinutes, revealBatch}, seed, now: Date }) → Tournament` (shape as in spec §9; players get ids `p1…pN`)
  - `revealNext(t) → Tournament`
  - `hasResults(t) → boolean`
  - `redraw(t, seed) → Tournament` (throws if results exist)
  - `setResult(t, round, court, winner: 1 | 2 | null) → Tournament` (throws for an unknown match)

All functions return new objects; the input is never changed.

- [ ] **Step 1: Write the failing test** `test/tournament.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlayers, createTournament, revealNext, hasResults, redraw, setResult } from '../src/engine/tournament.js';

test('parsePlayers accepts names with spaces and several separators', () => {
  const { players, errors } = parsePlayers('Anna 3\nBen,7\n\n  Carla Maria ; 1 \nDavid\t10\n');
  assert.deepEqual(errors, []);
  assert.deepEqual(players, [
    { name: 'Anna', skill: 3 },
    { name: 'Ben', skill: 7 },
    { name: 'Carla Maria', skill: 1 },
    { name: 'David', skill: 10 },
  ]);
});

test('parsePlayers reports bad lines and keeps the good ones', () => {
  const { players, errors } = parsePlayers('Anna 0\nBen 11\nCarla\nanna 4\nAnna 5');
  assert.deepEqual(players, [{ name: 'anna', skill: 4 }]);
  assert.equal(errors.length, 4);
  assert.match(errors[0], /^Line 1: skill must be 1–10/);
  assert.match(errors[1], /^Line 2: skill must be 1–10/);
  assert.match(errors[2], /^Line 3: expected a name and a skill/);
  assert.match(errors[3], /^Line 5: duplicate name "Anna"/);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/tournament.test.mjs`
Expected: FAIL with `Cannot find module '.../src/engine/tournament.js'`

- [ ] **Step 3: Implement** `src/engine/tournament.js`

```js
import { generateSchedule } from './schedule.js';
import { resultKey } from './standings.js';

export const FORMAT_VERSION = 1;

const PLAYER_LINE = /^(.*?)[\s,;]+(\d+)$/;

export function parsePlayers(text) {
  const players = [];
  const errors = [];
  const names = new Set();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const n = index + 1;
    const match = PLAYER_LINE.exec(line);
    if (!match || !match[1].trim()) {
      errors.push(`Line ${n}: expected a name and a skill, e.g. "Anna 3"`);
      return;
    }
    const name = match[1].trim();
    const skill = Number(match[2]);
    if (skill < 1 || skill > 10) {
      errors.push(`Line ${n}: skill must be 1–10 ("${line}")`);
      return;
    }
    if (names.has(name.toLowerCase())) {
      errors.push(`Line ${n}: duplicate name "${name}"`);
      return;
    }
    names.add(name.toLowerCase());
    players.push({ name, skill });
  });
  return { players, errors };
}

function initialReveal(settings) {
  return settings.revealBatch === 'all' ? settings.rounds : Math.min(settings.rounds, settings.revealBatch);
}

function drawSchedule(players, settings, seed) {
  return generateSchedule({ players, courts: settings.courts, rounds: settings.rounds, seed }).schedule;
}

export function createTournament({ id, name, players, settings, seed, now }) {
  const withIds = players.map((p, i) => ({ id: `p${i + 1}`, name: p.name, skill: p.skill }));
  return {
    version: FORMAT_VERSION,
    id,
    name,
    createdAt: now.toISOString(),
    settings: { ...settings },
    players: withIds,
    seed,
    schedule: drawSchedule(withIds, settings, seed),
    revealedRounds: initialReveal(settings),
    results: {},
  };
}

export function revealNext(t) {
  const { rounds, revealBatch } = t.settings;
  const step = revealBatch === 'all' ? rounds : revealBatch;
  return { ...t, revealedRounds: Math.min(rounds, t.revealedRounds + step) };
}

export function hasResults(t) {
  return Object.keys(t.results).length > 0;
}

export function redraw(t, seed) {
  if (hasResults(t)) throw new Error('Cannot redraw after results have been entered');
  return { ...t, seed, schedule: drawSchedule(t.players, t.settings, seed), revealedRounds: initialReveal(t.settings) };
}

export function setResult(t, round, court, winner) {
  const exists = t.schedule[round - 1]?.matches.some((m) => m.court === court);
  if (!exists) throw new Error(`Unknown match: round ${round}, court ${court}`);
  const results = { ...t.results };
  const key = resultKey(round, court);
  if (winner === null) delete results[key];
  else results[key] = winner;
  return { ...t, results };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/tournament.js test/tournament.test.mjs
git commit -m "feat: tournament model and player list parsing"
```

---

### Task 7: Import validation

**Files:**
- Create: `src/engine/validate.js`
- Test: `test/validate.test.mjs`

**Interfaces:**
- Consumes: the tournament shape from Task 6.
- Produces: `validateTournament(value) → { ok: true, tournament } | { ok: false, error: string }`.

- [ ] **Step 1: Write the failing test** `test/validate.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTournament, setResult } from '../src/engine/tournament.js';
import { validateTournament } from '../src/engine/validate.js';

const base = () => {
  const t = createTournament({
    id: 't1', name: 'Club night', seed: 3, now: new Date('2026-10-14T18:00:00Z'),
    players: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((skill, i) => ({ name: `P${i + 1}`, skill })),
    settings: { courts: 2, rounds: 4, matchMinutes: 12, breakMinutes: 2, revealBatch: 'all' },
  });
  return JSON.parse(JSON.stringify(setResult(t, 1, 1, 2)));
};

const broken = (mutate) => {
  const t = base();
  mutate(t);
  return validateTournament(t);
};

test('a created tournament survives a JSON round trip', () => {
  const t = base();
  const result = validateTournament(JSON.parse(JSON.stringify(t)));
  assert.equal(result.ok, true);
  assert.deepEqual(result.tournament, t);
});

test('rejects things that are not tournaments', () => {
  for (const value of [null, [], 'text', 42, {}]) assert.equal(validateTournament(value).ok, false);
});

const cases = {
  'unsupported version': [(t) => { t.version = 2; }, /version/],
  'too few players': [(t) => { t.players = t.players.slice(0, 3); }, /4 players/],
  'skill out of range': [(t) => { t.players[0].skill = 11; }, /skill/],
  'duplicate name (case-insensitive)': [(t) => { t.players[1].name = t.players[0].name.toLowerCase(); }, /Duplicate player name/],
  'schedule length differs from rounds': [(t) => { t.schedule.pop(); }, /Schedule/],
  'player missing from a round': [(t) => { t.schedule[0].sitOuts = []; }, /every player/],
  'unknown player in a round': [(t) => { t.schedule[0].matches[0].team1[0] = 'ghost'; }, /Unknown player/],
  'invalid court number': [(t) => { t.schedule[0].matches[0].court = 7; }, /court/],
  'result for an unknown match': [(t) => { t.results['9-1'] = 1; }, /unknown match/],
  'invalid result value': [(t) => { t.results['1-1'] = 3; }, /Invalid result/],
  'revealed rounds out of range': [(t) => { t.revealedRounds = 5; }, /revealed/],
  'invalid reveal batch': [(t) => { t.settings.revealBatch = 0; }, /reveal batch/],
};

for (const [name, [mutate, message]] of Object.entries(cases)) {
  test(`rejects: ${name}`, () => {
    const result = broken(mutate);
    assert.equal(result.ok, false);
    assert.match(result.error, message);
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/validate.test.mjs`
Expected: FAIL with `Cannot find module '.../src/engine/validate.js'`

- [ ] **Step 3: Implement** `src/engine/validate.js`

```js
const isInt = (v) => Number.isInteger(v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function fail(message) {
  throw new Error(message);
}

export function validateTournament(value) {
  try {
    checkTournament(value);
    return { ok: true, tournament: value };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function checkTournament(t) {
  if (!isObject(t) || !('version' in t)) fail('This is not a Seedr tournament file');
  if (t.version !== 1) fail(`Unsupported file version: ${t.version}`);
  if (typeof t.id !== 'string' || !t.id) fail('Missing tournament id');
  if (typeof t.name !== 'string') fail('Missing tournament name');
  if (typeof t.createdAt !== 'string') fail('Missing creation date');
  checkSettings(t.settings);
  const ids = checkPlayers(t.players);
  if (!isInt(t.seed)) fail('Invalid seed');
  checkSchedule(t.schedule, t.settings, ids);
  if (!isInt(t.revealedRounds) || t.revealedRounds < 0 || t.revealedRounds > t.settings.rounds) fail('Invalid number of revealed rounds');
  checkResults(t.results, t.schedule);
}

function checkSettings(s) {
  if (!isObject(s)) fail('Missing settings');
  if (!isInt(s.courts) || s.courts < 1) fail('Invalid number of courts');
  if (!isInt(s.rounds) || s.rounds < 1) fail('Invalid number of rounds');
  if (!isInt(s.matchMinutes) || s.matchMinutes < 1) fail('Invalid match length');
  if (!isInt(s.breakMinutes) || s.breakMinutes < 0) fail('Invalid break length');
  if (!(s.revealBatch === 'all' || (isInt(s.revealBatch) && s.revealBatch >= 1))) fail('Invalid reveal batch');
}

function checkPlayers(players) {
  if (!Array.isArray(players) || players.length < 4) fail('At least 4 players are required');
  const ids = new Set();
  const names = new Set();
  for (const p of players) {
    if (!isObject(p) || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim()) fail('Invalid player entry');
    if (!isInt(p.skill) || p.skill < 1 || p.skill > 10) fail(`Invalid skill for ${p.name}`);
    if (ids.has(p.id)) fail(`Duplicate player id ${p.id}`);
    const key = p.name.trim().toLowerCase();
    if (names.has(key)) fail(`Duplicate player name ${p.name}`);
    ids.add(p.id);
    names.add(key);
  }
  return ids;
}

function checkSchedule(schedule, settings, ids) {
  if (!Array.isArray(schedule) || schedule.length !== settings.rounds) fail('Schedule does not match the number of rounds');
  schedule.forEach((r, i) => {
    const label = `round ${i + 1}`;
    if (!isObject(r) || r.round !== i + 1 || !Array.isArray(r.matches) || !Array.isArray(r.sitOuts)) fail(`Invalid ${label}`);
    const seen = new Set();
    const courts = new Set();
    const use = (pid) => {
      if (!ids.has(pid)) fail(`Unknown player in ${label}`);
      if (seen.has(pid)) fail(`Player appears twice in ${label}`);
      seen.add(pid);
    };
    for (const m of r.matches) {
      if (!isObject(m) || !isInt(m.court) || m.court < 1 || m.court > settings.courts || courts.has(m.court)) fail(`Invalid court in ${label}`);
      courts.add(m.court);
      if (!Array.isArray(m.team1) || m.team1.length !== 2 || !Array.isArray(m.team2) || m.team2.length !== 2) fail(`Invalid team in ${label}`);
      [...m.team1, ...m.team2].forEach(use);
    }
    r.sitOuts.forEach(use);
    if (seen.size !== ids.size) fail(`${label} does not include every player`);
  });
}

function checkResults(results, schedule) {
  if (!isObject(results)) fail('Invalid results');
  for (const [key, winner] of Object.entries(results)) {
    const m = /^(\d+)-(\d+)$/.exec(key);
    const round = m && schedule[Number(m[1]) - 1];
    if (!round || !round.matches.some((x) => x.court === Number(m[2]))) fail(`Result for unknown match ${key}`);
    if (winner !== 1 && winner !== 2) fail(`Invalid result for match ${key}`);
  }
}
```

Note: the "player missing from a round" case reports `round 1 does not include every player`, which matches `/every player/`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/validate.js test/validate.test.mjs
git commit -m "feat: validation for imported tournament files"
```

---

### Task 8: Device storage

**Files:**
- Create: `src/ui/store.js`
- Test: `test/store.test.mjs`

**Interfaces:**
- Produces: `createStore(backend: { getItem, setItem } | null) → { available: boolean (getter), list(): Tournament[] (newest first), get(id): Tournament | null, save(t): boolean, remove(id): boolean }`. When storage fails, the store keeps working in memory and `available` becomes false.

- [ ] **Step 1: Write the failing test** `test/store.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/ui/store.js';

function memoryBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); } };
}
const t = (id, createdAt) => ({ id, name: id, createdAt });

test('saved tournaments survive a new store on the same backend', () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  assert.equal(store.save(t('a', '2026-01-01')), true);
  assert.equal(store.save(t('b', '2026-02-01')), true);
  const again = createStore(backend);
  assert.deepEqual(again.list().map((x) => x.id), ['b', 'a']);
  assert.deepEqual(again.get('a'), t('a', '2026-01-01'));
  assert.equal(again.available, true);
});

test('remove deletes a tournament', () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  store.save(t('a', '2026-01-01'));
  store.remove('a');
  assert.equal(createStore(backend).get('a'), null);
});

test('without a backend it works in memory and reports unavailable', () => {
  const store = createStore(null);
  assert.equal(store.available, false);
  assert.equal(store.save(t('a', '2026-01-01')), false);
  assert.deepEqual(store.get('a'), t('a', '2026-01-01'));
});

test('a failing setItem (e.g. storage full) marks storage unavailable', () => {
  const store = createStore({ getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } });
  assert.equal(store.save(t('a', '2026-01-01')), false);
  assert.equal(store.available, false);
});

test('corrupt stored data is backed up and the store starts empty', () => {
  const backend = memoryBackend({ 'seedr.v1': '{not json' });
  const store = createStore(backend);
  assert.deepEqual(store.list(), []);
  const backups = [...backend.data.keys()].filter((k) => k.startsWith('seedr.v1.corrupt-'));
  assert.equal(backups.length, 1);
  assert.equal(backend.data.get(backups[0]), '{not json');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/store.test.mjs`
Expected: FAIL with `Cannot find module '.../src/ui/store.js'`

- [ ] **Step 3: Implement** `src/ui/store.js`

```js
const STORAGE_KEY = 'seedr.v1';

export function createStore(backend) {
  let available = Boolean(backend);
  let data = { tournaments: {} };

  if (backend) {
    try {
      const raw = backend.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.tournaments === 'object') data = parsed;
        } catch {
          backend.setItem(`${STORAGE_KEY}.corrupt-${Date.now()}`, raw);
        }
      }
    } catch {
      available = false;
    }
  }

  function persist() {
    if (!backend) return false;
    try {
      backend.setItem(STORAGE_KEY, JSON.stringify(data));
      available = true;
      return true;
    } catch {
      available = false;
      return false;
    }
  }

  return {
    get available() { return available; },
    list() {
      return Object.values(data.tournaments).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    },
    get(id) { return data.tournaments[id] ?? null; },
    save(t) { data.tournaments[t.id] = t; return persist(); },
    remove(id) { delete data.tournaments[id]; return persist(); },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/store.js test/store.test.mjs
git commit -m "feat: device storage for tournaments"
```

---

### Task 9: Build pipeline, HTML shell and home screen

**Files:**
- Create: `build.mjs`, `src/ui/index.html`, `src/ui/styles.css`, `src/ui/sw.js`, `src/ui/manifest.webmanifest`, `src/ui/dom.js`, `src/ui/home.js`, `src/ui/app.js`
- Test: `test/build.test.mjs`, `test/dom.test.mjs`
- Modify: `.gitignore` (add `dist/`)

**Interfaces:**
- Consumes: `createStore` (Task 8), `validateTournament` (Task 7).
- Produces:
  - `bundle(entryPath) → string` (one classic script, wrapped in an IIFE), `build()` writes `dist/`.
  - `dom.js`: `h(tag, props, ...children) → HTMLElement`; `formatSigned(x) → string`; `slugify(name) → string`; `newId() → string`.
  - `ctx` object passed to every screen: `{ state, store, render(), go(screen), flash(message), save(t), open(t) }`, with `state = { screen, tournament, view, draft, message }`.
  - `homeScreen(ctx) → HTMLElement`.

- [ ] **Step 1: Write the failing tests** `test/dom.test.mjs` and `test/build.test.mjs`

`test/dom.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSigned, slugify, newId } from '../src/ui/dom.js';

test('formatSigned', () => {
  assert.equal(formatSigned(1.25), '+1.3');
  assert.equal(formatSigned(-0.5), '-0.5');
  assert.equal(formatSigned(0), '0.0');
  assert.equal(formatSigned(-0.04), '0.0');
});

test('slugify', () => {
  assert.equal(slugify('Club Night 2026!'), 'club-night-2026');
  assert.equal(slugify('***'), 'tournament');
});

test('newId is unique-looking', () => {
  const a = newId();
  assert.match(a, /^t[0-9a-z]+$/);
  assert.notEqual(a, newId());
});
```

`test/build.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bundle } from '../build.mjs';

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'seedr-bundle-'));
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src);
  return dir;
}

test('bundle inlines imports in dependency order', () => {
  const dir = fixture({
    'a.js': "import { b } from './b.js';\nexport function a() { return b() + 1; }\nglobalThis.__seedrResult = a();\n",
    'b.js': 'export function b() { return 41; }\n',
  });
  const code = bundle(join(dir, 'a.js'));
  assert.doesNotMatch(code, /^\s*(import|export)\s/m);
  new Function(code)();
  assert.equal(globalThis.__seedrResult, 42);
});

test('bundle rejects the same top-level name in two modules', () => {
  const dir = fixture({
    'a.js': "import { b } from './b.js';\nfunction helper() {}\n",
    'b.js': 'export function b() {}\nfunction helper() {}\n',
  });
  assert.throws(() => bundle(join(dir, 'a.js')), /"helper" is declared in both/);
});

test('the app bundle compiles', () => {
  const code = bundle(new URL('../src/ui/app.js', import.meta.url).pathname);
  assert.doesNotThrow(() => new Function(code));
  assert.doesNotMatch(code, /<\/script/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/dom.test.mjs test/build.test.mjs`
Expected: FAIL with `Cannot find module` for `dom.js` and `build.mjs`

- [ ] **Step 3: Implement** `build.mjs`

```js
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const IMPORT_RE = /^import\s+[^;]*?from\s+['"](.+?)['"];?[ \t]*$/gm;
const DECLARATION_RE = /^(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

// Concatenates ES modules in dependency order into one classic script.
// Requires single-line imports and unique top-level names across modules.
export function bundle(entry) {
  const ordered = [];
  const done = new Set();
  const visit = (file, stack) => {
    if (done.has(file)) return;
    if (stack.includes(file)) throw new Error(`Import cycle: ${[...stack, file].join(' -> ')}`);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) visit(resolve(dirname(file), m[1]), [...stack, file]);
    done.add(file);
    ordered.push({ file, src });
  };
  visit(resolve(entry), []);

  const declaredIn = new Map();
  const parts = ordered.map(({ file, src }) => {
    const name = relative(projectRoot, file);
    const body = src.replace(IMPORT_RE, '').replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm, '');
    for (const m of body.matchAll(DECLARATION_RE)) {
      const previous = declaredIn.get(m[1]);
      if (previous) throw new Error(`"${m[1]}" is declared in both ${previous} and ${name}`);
      declaredIn.set(m[1], name);
    }
    return `// ---- ${name} ----\n${body}`;
  });
  return `(() => {\n'use strict';\n${parts.join('\n')}\n})();\n`;
}

export function build() {
  const ui = (f) => resolve(projectRoot, 'src/ui', f);
  const js = bundle(ui('app.js'));
  if (/<\/script/i.test(js)) throw new Error('Bundle contains "</script", which would break the HTML file');
  const html = readFileSync(ui('index.html'), 'utf8')
    .replace('/* STYLES */', () => readFileSync(ui('styles.css'), 'utf8'))
    .replace('/* SCRIPT */', () => js);
  const dist = resolve(projectRoot, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(resolve(dist, 'index.html'), html);
  copyFileSync(ui('sw.js'), resolve(dist, 'sw.js'));
  copyFileSync(ui('manifest.webmanifest'), resolve(dist, 'manifest.webmanifest'));
  console.log(`Built dist/index.html (${Math.round(html.length / 1024)} KB)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
```

- [ ] **Step 4: Implement** `src/ui/dom.js`

```js
// Creates an element. Props: "class", "on<event>" handlers, value/checked/disabled/selected
// as properties, everything else as attributes. null/false props and children are skipped.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function formatSigned(x) {
  const v = Math.round(x * 10) / 10;
  return (v > 0 ? '+' : '') + (v === 0 ? 0 : v).toFixed(1);
}

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tournament';
}

export function newId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
```

- [ ] **Step 5: Implement the static files**

`src/ui/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Seedr">
<title>Seedr</title>
<link rel="manifest" href="manifest.webmanifest">
<style>
/* STYLES */
</style>
</head>
<body>
<div id="app"></div>
<script>
/* SCRIPT */
</script>
</body>
</html>
```

`src/ui/styles.css`:

```css
:root {
  --bg: #f6f7f9; --card: #ffffff; --text: #1d2330; --muted: #6b7280; --border: #d0d7de;
  --primary: #1f6feb; --primary-text: #ffffff; --win: #1a7f37; --win-bg: #dafbe1; --lose-bg: #f3f4f6;
  --warn: #7d4e00; --warn-bg: #fff8c5; --danger: #cf222e;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117; --card: #161b22; --text: #e6edf3; --muted: #9198a1; --border: #30363d;
    --primary: #2f81f7; --win: #3fb950; --win-bg: #12361f; --lose-bg: #1c2128;
    --warn: #e3b341; --warn-bg: #3b2e00; --danger: #f85149;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-size: 17px; -webkit-text-size-adjust: 100%; }
.screen { max-width: 880px; margin: 0 auto; padding: max(16px, env(safe-area-inset-top)) 16px 48px; }
.top { display: flex; align-items: center; gap: 12px; }
h1 { font-size: 1.6rem; margin: 8px 0 16px; }
h2 { font-size: 1.25rem; margin: 20px 0 8px; }
button, .button {
  font: inherit; min-height: 44px; padding: 8px 16px; border-radius: 10px; border: 1px solid var(--border);
  background: var(--card); color: var(--text); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
button:disabled { opacity: .45; cursor: default; }
button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-text); }
button.danger { color: var(--danger); }
button.small { min-height: 36px; padding: 4px 12px; }
button.link { border: none; background: none; flex: 1; justify-content: flex-start; text-align: left; padding-left: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.list { list-style: none; padding: 0; margin: 0; }
.list li { display: flex; align-items: center; gap: 8px; padding: 6px 12px; margin-bottom: 8px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; }
.muted { color: var(--muted); }
.ok { color: var(--win); }
.warning { background: var(--warn-bg); color: var(--warn); padding: 10px 12px; border-radius: 10px; }
.problems { color: var(--danger); }
.banner { position: sticky; top: 0; z-index: 10; background: var(--warn-bg); color: var(--warn); padding: 12px 16px; text-align: center; cursor: pointer; }
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.field > span { font-weight: 600; font-size: .95rem; }
input, select, textarea { font: inherit; width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--card); color: var(--text); }
textarea { font-family: ui-monospace, Menlo, monospace; }
.options { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
.option { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; }
.option input { width: auto; }
.option.uneven { color: var(--muted); }
.tabs, .round-nav { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.tabs button.current, .round-nav button.current { background: var(--primary); border-color: var(--primary); color: var(--primary-text); }
.round-nav button { min-width: 44px; }
.round-nav button.complete:not(.current) { background: var(--win-bg); }
.matches { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); margin: 12px 0; }
.match { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 14px; }
.court { font-weight: 700; color: var(--muted); }
.vs { text-align: center; color: var(--muted); font-size: .85rem; }
.team { min-height: 56px; justify-content: space-between; text-align: left; }
.team .sum { color: var(--muted); font-size: .9rem; white-space: nowrap; }
.team.winner { background: var(--win-bg); border-color: var(--win); font-weight: 700; }
.team.winner::after { content: "✓"; color: var(--win); }
.team.loser { background: var(--lose-bg); color: var(--muted); }
.reveal { width: 100%; margin-top: 8px; }
.table-wrap { overflow-x: auto; }
table.standings { width: 100%; border-collapse: collapse; background: var(--card); }
.standings th, .standings td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; }
.standings td.points { font-weight: 700; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; }
```

`src/ui/sw.js` (network first, cache as offline fallback; only registered over https):

```js
const CACHE = 'seedr-v1';
const FILES = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
```

`src/ui/manifest.webmanifest`:

```json
{
  "name": "Seedr",
  "short_name": "Seedr",
  "start_url": "./",
  "display": "standalone",
  "background_color": "#f6f7f9",
  "theme_color": "#1f6feb"
}
```

- [ ] **Step 6: Implement** `src/ui/home.js`

```js
import { h } from './dom.js';
import { validateTournament } from '../engine/validate.js';

export function homeScreen(ctx) {
  const tournaments = ctx.store.list();
  return h('main', { class: 'screen' },
    h('header', { class: 'top' }, h('h1', {}, 'Seedr')),
    ctx.store.available ? null : h('p', { class: 'warning' }, 'This browser cannot save data. Use Export to keep your tournaments.'),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => ctx.go('setup') }, 'New tournament'),
      h('label', { class: 'button' }, 'Import',
        h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => importFile(ctx, e.target.files[0]) }))),
    tournaments.length === 0
      ? h('p', { class: 'muted' }, 'No tournaments saved on this device yet.')
      : h('ul', { class: 'list' }, tournaments.map((t) => h('li', {},
        h('button', { class: 'link', onclick: () => ctx.open(t) },
          h('strong', {}, t.name),
          h('span', { class: 'muted' }, ` · ${t.players?.length ?? 0} players · ${new Date(t.createdAt).toLocaleDateString()}`)),
        h('button', {
          class: 'danger small',
          onclick: () => {
            if (!confirm(`Delete "${t.name}" from this device?`)) return;
            ctx.store.remove(t.id);
            ctx.render();
          },
        }, 'Delete')))),
  );
}

async function importFile(ctx, file) {
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    ctx.flash('Import failed: this file is not a Seedr tournament file.');
    return;
  }
  const check = validateTournament(parsed);
  if (!check.ok) {
    ctx.flash(`Import failed: ${check.error}`);
    return;
  }
  if (ctx.store.get(parsed.id) && !confirm(`"${parsed.name}" already exists on this device. Replace it?`)) return;
  ctx.save(parsed);
  ctx.open(parsed);
}
```

- [ ] **Step 7: Implement** `src/ui/app.js`

```js
import { h } from './dom.js';
import { createStore } from './store.js';
import { validateTournament } from '../engine/validate.js';
import { homeScreen } from './home.js';

const SCREENS = { home: homeScreen };

const appRoot = document.getElementById('app');
const store = createStore(safeLocalStorage());
const state = { screen: 'home', tournament: null, view: null, draft: null, message: null };

function safeLocalStorage() {
  try {
    const storage = window.localStorage;
    storage.getItem('seedr.probe');
    return storage;
  } catch {
    return null;
  }
}

const ctx = {
  state,
  store,
  render,
  go(screen) {
    state.screen = screen;
    state.message = null;
    render();
  },
  flash(message) {
    state.message = message;
    render();
  },
  save(t) {
    state.tournament = t;
    if (!store.save(t)) state.message = 'Could not save on this device. Use Export to keep your data.';
  },
  open(t) {
    const check = validateTournament(t);
    if (!check.ok) {
      ctx.flash(`Cannot open this tournament: ${check.error}`);
      return;
    }
    state.tournament = t;
    state.view = null;
    ctx.go('tournament');
  },
};

function render() {
  const screen = SCREENS[state.screen] ?? homeScreen;
  const banner = state.message
    ? h('div', { class: 'banner', onclick: () => { state.message = null; render(); } }, state.message)
    : null;
  appRoot.replaceChildren(...[banner, screen(ctx)].filter(Boolean));
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
```

Note: `New tournament` and opening a tournament fall back to the home screen until Tasks 10 and 11 register those screens.

- [ ] **Step 8: Ignore build output**

Append `dist/` to `.gitignore`.

- [ ] **Step 9: Run the tests and the build**

Run: `npm test && npm run build`
Expected: all tests PASS; prints `Built dist/index.html (… KB)`

- [ ] **Step 10: Smoke check in a browser**

Open `dist/index.html` directly (file://) in Chrome. Expected: the "Seedr" heading, the "New tournament" and "Import" buttons, and "No tournaments saved on this device yet." The DevTools console shows no errors (a failed manifest fetch on file:// is acceptable).

- [ ] **Step 11: Commit**

```bash
git add .gitignore build.mjs src/ui test/build.test.mjs test/dom.test.mjs
git commit -m "feat: single-file build, HTML shell and home screen"
```

---

### Task 10: Setup screen

**Files:**
- Create: `src/ui/setup.js`
- Modify: `src/ui/app.js` (register the screen)
- Test: `test/setup.test.mjs`

**Interfaces:**
- Consumes: `parsePlayers`, `createTournament` (Task 6); `recommendOptions`, `gamesPerPlayer` (Task 2); `newSeed` (Task 1); `h`, `newId` (Task 9); `ctx` (Task 9).
- Produces:
  - `newDraft() → Draft` where `Draft = { name, playersText, courts, planning: 'recommended' | 'manual', totalMinutes, breakMinutes, selectedRounds: number | null, rounds, matchMinutes, revealBatch: 'all' | number }`
  - `evaluateDraft(draft) → { players, problems: string[], options: Option[], plan: { rounds, matchMinutes } | null, games: { min, max, even } | null }`
  - `setupScreen(ctx) → HTMLElement`

- [ ] **Step 1: Write the failing test** `test/setup.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, evaluateDraft } from '../src/ui/setup.js';

const SKILLS_18 = [1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10];
const text18 = SKILLS_18.map((s, i) => `P${i + 1} ${s}`).join('\n');

test('recommended planning requires choosing an option', () => {
  const ev = evaluateDraft({ ...newDraft(), playersText: text18 });
  assert.equal(ev.players.length, 18);
  assert.ok(ev.options.length > 0);
  assert.equal(ev.plan, null);
  assert.ok(ev.problems.some((p) => /Choose one of the options/.test(p)));
});

test('a chosen option becomes the plan', () => {
  const ev = evaluateDraft({ ...newDraft(), playersText: text18, selectedRounds: 9 });
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 9, matchMinutes: 11 });
  assert.deepEqual(ev.games, { min: 6, max: 6, even: true });
});

test('manual planning reports uneven games', () => {
  const ev = evaluateDraft({ ...newDraft(), playersText: text18, planning: 'manual', rounds: 8, matchMinutes: 13 });
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.games, { min: 5, max: 6, even: false });
});

test('problems: too few players, invalid courts, parse errors', () => {
  assert.ok(evaluateDraft({ ...newDraft(), playersText: 'A 1\nB 2\nC 3' }).problems.some((p) => /at least 4 players/.test(p)));
  assert.ok(evaluateDraft({ ...newDraft(), playersText: text18, courts: NaN }).problems.some((p) => /Courts/.test(p)));
  assert.ok(evaluateDraft({ ...newDraft(), playersText: `${text18}\nBroken` }).problems.some((p) => /^Line 19/.test(p)));
});

test('not enough time for one round', () => {
  const ev = evaluateDraft({ ...newDraft(), playersText: text18, totalMinutes: 6 });
  assert.ok(ev.problems.some((p) => /Not enough time/.test(p)));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/setup.test.mjs`
Expected: FAIL with `Cannot find module '.../src/ui/setup.js'`

- [ ] **Step 3: Implement** `src/ui/setup.js`

```js
import { h, newId } from './dom.js';
import { parsePlayers, createTournament } from '../engine/tournament.js';
import { recommendOptions, gamesPerPlayer } from '../engine/timeplan.js';
import { newSeed } from '../engine/rng.js';

export function newDraft() {
  return {
    name: '',
    playersText: '',
    courts: 3,
    planning: 'recommended',
    totalMinutes: 120,
    breakMinutes: 2,
    selectedRounds: null,
    rounds: 6,
    matchMinutes: 15,
    revealBatch: 'all',
  };
}

const isWhole = (v, min) => Number.isInteger(v) && v >= min;

export function evaluateDraft(d) {
  const { players, errors } = parsePlayers(d.playersText);
  const problems = [...errors];
  if (players.length < 4) problems.push('Enter at least 4 players.');
  if (!isWhole(d.courts, 1)) problems.push('Courts must be a whole number of at least 1.');
  if (!isWhole(d.breakMinutes, 0)) problems.push('Break must be a whole number of minutes (0 or more).');
  let options = [];
  let plan = null;
  if (problems.length === 0) {
    if (d.planning === 'recommended') {
      if (!isWhole(d.totalMinutes, 1)) {
        problems.push('Total time must be a whole number of minutes.');
      } else {
        options = recommendOptions({ players: players.length, courts: d.courts, totalMinutes: d.totalMinutes, breakMinutes: d.breakMinutes });
        const chosen = options.find((o) => o.rounds === d.selectedRounds);
        if (options.length === 0) problems.push('Not enough time for even one round of at least 5 minutes.');
        else if (!chosen) problems.push('Choose one of the options below.');
        else plan = { rounds: chosen.rounds, matchMinutes: chosen.matchMinutes };
      }
    } else if (!isWhole(d.rounds, 1) || !isWhole(d.matchMinutes, 1)) {
      problems.push('Rounds and match length must be whole numbers of at least 1.');
    } else {
      plan = { rounds: d.rounds, matchMinutes: d.matchMinutes };
    }
  }
  const games = plan ? gamesPerPlayer(players.length, d.courts, plan.rounds) : null;
  return { players, problems, options, plan, games };
}

function field(label, input) {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function selectInput(value, choices, onchange) {
  const select = h('select', { onchange }, choices.map(([v, label]) => h('option', { value: v }, label)));
  select.value = String(value);
  return select;
}

export function setupScreen(ctx) {
  const d = (ctx.state.draft ??= newDraft());
  const preview = h('section', { class: 'preview' });
  const refresh = () => preview.replaceChildren(...setupPreview(ctx, d, refresh));
  const numberInput = (key, min) => h('input', {
    type: 'number', min, step: 1, inputmode: 'numeric', value: d[key],
    oninput: (e) => { d[key] = e.target.value === '' ? NaN : Number(e.target.value); refresh(); },
  });

  const recommendedBox = h('div', {},
    field('Total tournament time (minutes)', numberInput('totalMinutes', 1)));
  const manualBox = h('div', {},
    field('Number of rounds', numberInput('rounds', 1)),
    field('Match length (minutes)', numberInput('matchMinutes', 1)));
  const showPlanning = () => {
    recommendedBox.hidden = d.planning !== 'recommended';
    manualBox.hidden = d.planning !== 'manual';
  };
  showPlanning();

  const form = h('section', { class: 'form' },
    field('Tournament name', h('input', { type: 'text', value: d.name, placeholder: 'Club night', oninput: (e) => { d.name = e.target.value; } })),
    field('Players: one per line, name and skill 1–10 (1 = best)', h('textarea', {
      rows: 10, value: d.playersText, placeholder: 'Anna 3\nBen 7\nCarla 1\nDavid 5',
      oninput: (e) => { d.playersText = e.target.value; refresh(); },
    })),
    field('Courts', numberInput('courts', 1)),
    field('Break between rounds (minutes)', numberInput('breakMinutes', 0)),
    field('Rounds revealed at a time', selectInput(d.revealBatch,
      [['all', 'All (whole schedule in advance)'], ['1', '1 (surprise)'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']],
      (e) => { d.revealBatch = e.target.value === 'all' ? 'all' : Number(e.target.value); })),
    field('Planning', selectInput(d.planning,
      [['recommended', 'Recommend from total time'], ['manual', 'Enter rounds and match length']],
      (e) => { d.planning = e.target.value; showPlanning(); refresh(); })),
    recommendedBox,
    manualBox,
  );

  refresh();
  return h('main', { class: 'screen' },
    h('header', { class: 'top' }, h('h1', {}, 'New tournament')),
    form,
    preview);
}

function setupPreview(ctx, d, refresh) {
  const ev = evaluateDraft(d);
  const out = [h('p', { class: 'muted' }, `${ev.players.length} players entered`)];
  if (d.planning === 'recommended' && ev.options.length) {
    out.push(h('div', { class: 'options' }, ev.options.map((o) => h('label', { class: `option${o.even ? '' : ' uneven'}` },
      h('input', { type: 'radio', name: 'plan', checked: o.rounds === d.selectedRounds, onchange: () => { d.selectedRounds = o.rounds; refresh(); } }),
      h('span', {}, `${o.rounds} rounds × ${o.matchMinutes} min + ${o.breakMinutes} min break = ${o.totalMinutes} min · `,
        o.even ? `everyone plays ${o.gamesMin} games` : `${o.gamesMin}–${o.gamesMax} games per player (uneven)`)))));
  }
  if (ev.games) {
    out.push(ev.games.even
      ? h('p', { class: 'ok' }, `Everyone plays ${ev.games.min} games.`)
      : h('p', { class: 'warning' }, `Uneven: players get ${ev.games.min} or ${ev.games.max} games. Players with fewer games get 0.5 points per missing game.`));
  }
  if (ev.problems.length) out.push(h('ul', { class: 'problems' }, ev.problems.map((p) => h('li', {}, p))));
  out.push(h('div', { class: 'actions' },
    h('button', { onclick: () => { ctx.state.draft = null; ctx.go('home'); } }, 'Cancel'),
    h('button', {
      class: 'primary',
      disabled: ev.problems.length > 0,
      onclick: (e) => {
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Drawing…';
        setTimeout(() => createFromDraft(ctx, d, ev), 20); // let the browser paint "Drawing…" first
      },
    }, 'Draw schedule')));
  return out;
}

function createFromDraft(ctx, d, ev) {
  const t = createTournament({
    id: newId(),
    name: d.name.trim() || 'Tournament',
    players: ev.players,
    settings: { courts: d.courts, rounds: ev.plan.rounds, matchMinutes: ev.plan.matchMinutes, breakMinutes: d.breakMinutes, revealBatch: d.revealBatch },
    seed: newSeed(),
    now: new Date(),
  });
  ctx.state.draft = null;
  ctx.save(t);
  ctx.open(t);
}
```

- [ ] **Step 4: Register the screen in** `src/ui/app.js`

Add the import below the `homeScreen` import:

```js
import { setupScreen } from './setup.js';
```

and change the screen map to:

```js
const SCREENS = { home: homeScreen, setup: setupScreen };
```

- [ ] **Step 5: Run the tests and the build**

Run: `npm test && npm run build`
Expected: PASS; build succeeds

- [ ] **Step 6: Smoke check in a browser**

Open `dist/index.html` and click "New tournament". Paste 18 players (`P1 1` … `P18 10`), set courts to 3, keep 120 min and a 2 min break. Expected: options appear with even ones first, e.g. "9 rounds × 11 min + 2 min break = 117 min · everyone plays 6 games". Typing in fields keeps focus. "Draw schedule" stays disabled until an option is chosen; afterwards it shows "Drawing…" and returns to the home screen (the tournament screen comes in Task 11). The new tournament is listed on the home screen.

- [ ] **Step 7: Commit**

```bash
git add src/ui/setup.js src/ui/app.js test/setup.test.mjs
git commit -m "feat: setup screen with time planning options"
```

---

### Task 11: Tournament screen (rounds, results, standings, manage, export)

**Files:**
- Create: `src/ui/tournament-view.js`
- Modify: `src/ui/app.js` (register the screen)

**Interfaces:**
- Consumes: `revealNext`, `redraw`, `setResult`, `hasResults` (Task 6); `resultKey`, `computeStandings` (Task 5); `scheduleStats`, `drawWarnings` (Task 4); `newSeed` (Task 1); `h`, `formatSigned`, `slugify` (Task 9); `ctx` (Task 9). `ctx.state.view = { tab: 'rounds' | 'standings' | 'manage', round: number }`, reset to `null` by `ctx.open`.
- Produces: `tournamentScreen(ctx) → HTMLElement`.

The pure logic behind this screen is already covered by engine tests. This task is checked by the browser walkthrough in Step 4.

- [ ] **Step 1: Implement** `src/ui/tournament-view.js`

```js
import { h, formatSigned, slugify } from './dom.js';
import { revealNext, redraw, setResult, hasResults } from '../engine/tournament.js';
import { resultKey, computeStandings } from '../engine/standings.js';
import { scheduleStats, drawWarnings } from '../engine/schedule.js';
import { newSeed } from '../engine/rng.js';

const TABS = [['rounds', 'Rounds'], ['standings', 'Standings'], ['manage', 'Manage']];

function roundComplete(t, round) {
  return round.matches.every((m) => t.results[resultKey(round.round, m.court)]);
}

function firstOpenRound(t) {
  const open = t.schedule.slice(0, t.revealedRounds).find((r) => !roundComplete(t, r));
  return open ? open.round : Math.max(1, t.revealedRounds);
}

export function tournamentScreen(ctx) {
  const t = ctx.state.tournament;
  const view = (ctx.state.view ??= { tab: 'rounds', round: firstOpenRound(t) });
  view.round = Math.min(Math.max(1, view.round), Math.max(1, t.revealedRounds));
  const body = view.tab === 'standings' ? standingsTab(t)
    : view.tab === 'manage' ? manageTab(ctx, t)
      : roundsTab(ctx, t, view);
  return h('main', { class: 'screen' },
    h('header', { class: 'top' },
      h('button', { onclick: () => ctx.go('home') }, '‹ Home'),
      h('h1', {}, t.name)),
    h('nav', { class: 'tabs' }, TABS.map(([key, label]) =>
      h('button', { class: view.tab === key ? 'current' : '', onclick: () => { view.tab = key; ctx.render(); } }, label))),
    drawWarnings(scheduleStats(t.players, t.schedule)).map((w) => h('p', { class: 'warning' }, w)),
    body);
}

function roundsTab(ctx, t, view) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const names = (ids) => ids.map((id) => byId.get(id).name).join(' + ');
  const skillSum = (ids) => ids.reduce((sum, id) => sum + byId.get(id).skill, 0);
  const round = t.schedule[view.round - 1];

  const nav = h('nav', { class: 'round-nav' }, t.schedule.slice(0, t.revealedRounds).map((r) => h('button', {
    class: [r.round === view.round ? 'current' : '', roundComplete(t, r) ? 'complete' : ''].join(' ').trim(),
    onclick: () => { view.round = r.round; ctx.render(); },
  }, String(r.round))));

  const matches = round.matches.map((m) => {
    const winner = t.results[resultKey(round.round, m.court)];
    const side = (n, team) => h('button', {
      class: ['team', winner === n ? 'winner' : '', winner && winner !== n ? 'loser' : ''].join(' ').trim(),
      onclick: () => {
        ctx.save(setResult(t, round.round, m.court, winner === n ? null : n));
        ctx.render();
      },
    }, h('span', { class: 'names' }, names(team)), h('span', { class: 'sum' }, `Σ ${skillSum(team)}`));
    return h('div', { class: 'match' },
      h('div', { class: 'court' }, `Court ${m.court}`),
      side(1, m.team1),
      h('div', { class: 'vs' }, 'vs'),
      side(2, m.team2));
  });

  const hidden = t.settings.rounds - t.revealedRounds;
  const step = t.settings.revealBatch === 'all' ? hidden : Math.min(t.settings.revealBatch, hidden);
  const from = t.revealedRounds + 1;
  const revealLabel = step === 1 ? `Reveal round ${from}` : `Reveal rounds ${from}–${from + step - 1}`;

  return [
    nav,
    h('h2', {}, `Round ${round.round} of ${t.settings.rounds}`),
    h('p', { class: 'muted' }, 'Tap the winning team. Tap again to clear. Σ = sum of skills (lower = stronger).'),
    h('div', { class: 'matches' }, matches),
    round.sitOuts.length ? h('p', { class: 'muted' }, `Sitting out: ${round.sitOuts.map((id) => byId.get(id).name).join(', ')}`) : null,
    hidden > 0 ? h('button', {
      class: 'reveal primary',
      onclick: () => {
        ctx.save(revealNext(t));
        view.round = from;
        ctx.render();
      },
    }, revealLabel) : null,
  ];
}

function standingsTab(t) {
  const rows = computeStandings(t.players, t.schedule, t.results);
  const headers = ['#', 'Player', 'Skill', 'Games', 'Wins', 'Bonus', 'Points', 'Avg. advantage'];
  return [
    h('div', { class: 'table-wrap' }, h('table', { class: 'standings' },
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, r.rank),
        h('td', {}, r.name),
        h('td', {}, r.skill),
        h('td', {}, r.games),
        h('td', {}, r.wins),
        h('td', {}, r.bonus ? `+${r.bonus}` : ''),
        h('td', { class: 'points' }, r.points),
        h('td', {}, formatSigned(r.avgGap))))))),
    h('p', { class: 'muted' },
      'Games and bonus count only rounds with all results entered. Bonus: 0.5 points per game fewer than the most games played. ',
      'Avg. advantage: average difference in team strength per game (positive = played in the stronger team).'),
  ];
}

function exportTournament(t) {
  const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: `${slugify(t.name)}.seedr.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fact(label, value) {
  return [h('dt', {}, label), h('dd', {}, String(value))];
}

function manageTab(ctx, t) {
  const s = t.settings;
  const locked = hasResults(t);
  return [
    h('dl', { class: 'facts' },
      fact('Players', t.players.length),
      fact('Courts', s.courts),
      fact('Rounds', s.rounds),
      fact('Match length', `${s.matchMinutes} min`),
      fact('Break', `${s.breakMinutes} min`),
      fact('Rounds revealed at a time', s.revealBatch === 'all' ? 'All' : s.revealBatch)),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => exportTournament(t) }, 'Export (.seedr.json)'),
      h('button', {
        disabled: locked,
        onclick: () => {
          if (!confirm('Draw a completely new schedule?')) return;
          ctx.save(redraw(t, newSeed()));
          ctx.state.view.round = 1;
          ctx.render();
        },
      }, 'Redraw schedule'),
      h('button', {
        class: 'danger',
        onclick: () => {
          if (!confirm(`Delete "${t.name}" from this device? Export it first if you want to keep it.`)) return;
          ctx.store.remove(t.id);
          ctx.state.tournament = null;
          ctx.go('home');
        },
      }, 'Delete tournament')),
    locked ? h('p', { class: 'muted' }, 'Redraw is only possible before the first result is entered.') : null,
  ];
}
```

- [ ] **Step 2: Register the screen in** `src/ui/app.js`

Add the import below the `setupScreen` import:

```js
import { tournamentScreen } from './tournament-view.js';
```

and change the screen map to:

```js
const SCREENS = { home: homeScreen, setup: setupScreen, tournament: tournamentScreen };
```

- [ ] **Step 3: Run the tests and the build**

Run: `npm test && npm run build`
Expected: PASS (the build test also checks the bundle for duplicate top-level names); build succeeds

- [ ] **Step 4: Browser walkthrough** (Chrome, `dist/index.html` via file://)

1. Create an 18-player tournament with 3 courts, the 9-round option and "Rounds revealed at a time" = 3. Expected: the Rounds tab shows round 1 with 3 courts, team names with Σ values within 2 of each other, 6 players sitting out, round buttons 1–3 and "Reveal rounds 4–6".
2. Tap team 1 on court 1. Expected: green with ✓, the other team greyed. Tap again: cleared. Tap team 2: team 2 wins.
3. Enter all results of round 1. Expected: round button 1 turns green. Standings: winners have 1 point; the 6 sit-outs have bonus +0.5.
4. Reload the page. Expected: the tournament is still listed; opening it shows the same schedule and results.
5. Manage → Export. Expected: a `<name>.seedr.json` download. Delete the tournament, then Home → Import the file. Expected: it comes back identically. Import it again: "already exists … Replace it?" prompt.
6. Import a text file renamed to `.json`. Expected: banner "Import failed: …"; nothing changes.
7. Redraw is disabled while results exist. Create a new tournament without results: Redraw gives a different schedule.
8. Create 8 players (skills 1 1 2 3 8 9 10 10), 2 courts, manual 7 rounds. Expected: the yellow "Some matches are unbalanced" warning.
9. Narrow the window to iPad portrait width (768 px) and phone width (375 px). Expected: no horizontal scrolling except inside the standings table.

- [ ] **Step 5: Commit**

```bash
git add src/ui/tournament-view.js src/ui/app.js
git commit -m "feat: tournament screen with results, standings and export"
```

---

### Task 12: README and iPad deployment check

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write** `README.md`

````markdown
# Seedr

Draws balanced, rotating 2-vs-2 teams for a fixed number of rounds on a limited number of
courts, records wins and ranks players. Runs completely in the browser and works offline.

## Use on a laptop

```bash
npm run build
```

Open `dist/index.html` in a browser (double-click works). Data is saved in that browser.

## Use on an iPad

1. Run `npm run build`, then upload the three files in `dist/` (`index.html`, `sw.js`,
   `manifest.webmanifest`) to a static host, e.g. drag the `dist` folder onto
   https://app.netlify.com/drop or push it to GitHub Pages.
2. Open the URL in Safari, tap **Share → Add to Home Screen**.
3. Start Seedr from the home screen. After the first start it also works offline.

Tournament data stays on the device. The host only serves the empty app.

## Keeping data safe

Browser storage can be lost (clearing Safari data, a new device). Use **Manage → Export**
to save a `.seedr.json` file (e.g. to Dropbox or iCloud Drive) and **Import** to load it
on any device.

## Development

```bash
npm test        # engine and build tests (node --test)
npm run build   # writes dist/
```

Source: `src/engine` (pure logic, tested), `src/ui` (screens). Design:
`docs/superpowers/specs/2026-10-14-seedr-free-rounds-design.md`.
````

- [ ] **Step 2: Deployment check** (needs a person with an iPad, so it can be done after merging)

Deploy `dist/` to Netlify Drop, open it on the iPad in Safari, add it to the Home Screen, start it, create a tournament, switch on flight mode and restart the app. Expected: it starts, and the tournament is still there.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with usage and iPad deployment"
```
