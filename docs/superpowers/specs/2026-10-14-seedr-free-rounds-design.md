# Seedr – Free Rounds with Rotating Doubles (v1) – Design

Date: 2026-10-14
Status: draft for review

## 1. Goal

A browser app for running one specific kind of tournament: players with a skill
number are drawn into fresh 2-vs-2 teams every round, matches are as balanced as
possible, and players are ranked by wins. It runs offline from a single HTML file
on a laptop or iPad. The architecture leaves room for more formats later, but v1
implements only what is described here.

## 2. Scope

### In scope (v1)

- Players with a name and a skill from 1 to 10 (1 = best).
- Teams of exactly 2 players, drawn fresh every round.
- A fixed number of courts (parallel matches); players who don't fit sit out.
- Time planning: total time, break between rounds and courts produce recommended
  round counts and match lengths.
- Draw optimization: even sit-outs, no repeated partners, balanced matches,
  balanced across the tournament, varied opponents.
- Draw visibility: reveal rounds in batches of k (k = all → in advance, k = 1 → surprise).
- Results: win/loss only, entered with one tap.
- Standings per player: wins + 0.5 per missing game, shared ranks on ties.
- Autosave on the device; JSON export and import.

### Out of scope (v1)

A round timer (timing is handled outside the app), fixed teams, other formats (round robin, knockout, groups, Swiss), scores or sets,
draws (tied results), other rating modes, late arrivals or players leaving
mid-tournament, manual schedule edits, printing, multiple devices or live sync.

## 3. Setup

The organizer enters:

| Field | Rules |
|---|---|
| Tournament name | free text |
| Players | name + skill 1–10; at least 4 players; names must be unique (case-insensitive). Entered as lines `Name: skill` (the last `:` separates), typed or loaded from a text file ("Load players file") into an editable box |
| Courts | integer ≥ 1 |
| Rounds revealed at a time (k) | integer ≥ 1 or "all"; default "all" |
| Time planning | either **recommended** (see §4) or **manual** (number of rounds + match length) |

Derived values:

- Players on court per round: `A = min(4·C, 4·floor(N/4))`
- Players sitting out per round: `S = N − A`

## 4. Time planning

Inputs: total time `T` (minutes, default 240), break between rounds `b` (default 5 min), courts `C` (default 2), players `N`.

For each round count `R = 1, 2, …`:

- Match length `m = floor(T / R − b)`; only options with `m ≥ 5` minutes are kept.
- Total games played `R · A`; games per player are `R·A / N`.
- **Even** if `R·A` is divisible by `N` (everyone gets the same number of games).
  Otherwise **uneven**: the players get `floor(R·A/N)` or `ceil(R·A/N)` games.

The app shows the options as a list: even options first (by round count), then
uneven ones, each marked as such. Each row shows: rounds, match length, break,
games per player, and total time used `R·(m + b)`.

Example: N = 18, C = 3, T = 120, b = 2 → A = 12.
- 6 rounds × 18 min → everyone plays 4 games (even)
- 9 rounds × 11 min → everyone plays 6 games (even)
- 8 rounds × 13 min → 5 or 6 games (uneven)

In manual mode the organizer enters `R` and `m` directly; the same even/uneven
note is shown.

## 5. Draw

The whole schedule is generated at the start, from a random seed that is stored
with the tournament (so the same schedule comes back after reloading).

### 5.1 Sit-outs (hard rule)

Each round, the players who have sat out least so far sit out, so nobody sits out a
second time until everyone has sat out once. Within a tie, players who sat out in the
previous round are avoided when there is a real choice; the rest is random. This keeps
the groups on court mixing: a fixed cycle would split e.g. 16 players on 2 courts into
two groups of 8 that never meet. Only when avoiding back-to-back sit-outs would freeze
the groups (exactly as many fresh candidates as places), about a quarter of the places
go to players who just sat out (e.g. 2 of 8), which is enough for the groups to mix.

### 5.2 Matches (optimization)

Within each round, the `A` active players are split into `C' = A/4` matches of
2 vs. 2, numbered by court. Internal strength = `11 − skill` (higher = stronger).
Team strength = sum of its two players' strengths.

For a match: `diff = strength(team 1) − strength(team 2)`.
For a player: `balance = Σ over their games (own team strength − opponent team strength)`.

Cost function over the whole schedule, in decreasing priority:

1. **Partner repeats** (hard where possible): each repeated partner pairing adds a very large penalty.
2. **Match balance:** `Σ diff²` over all matches.
3. **Tournament balance:** `Σ balance²` over all players.
4. **Similar team spreads:** `Σ (spread(team 1) − spread(team 2))²` over all matches, where
   spread = strength difference of the two partners. Both teams in a match should be mixed
   alike: 1+9 vs 2+8 is fine, 1+9 vs 5+5 is not. Weight 3, applied from 14 players only;
   in smaller groups it would cost sum balance without making spreads much more similar.
5. **Opponent variety:** `Σ (times faced − 1)` over every pair of players who faced each other more than once.

The weights are constants in the engine: 10 000 / 10 / 3 / 3 / 1. They are
tuned in tests so that priority holds in practice.

Search: simulated annealing over the full schedule. A move swaps either two active
players or two whole teams (partners stay together, only opponents change) within the
same round. The start temperature is high enough to pass through partner repeats, and
the search runs 4 restarts from random draws. It runs a fixed number of iterations (100 000, or 200 000 below 14 players; about 0.3 s on a laptop) so that the
same seed gives the same schedule on every device, and keeps the best schedule found.
Skill pairing within a team is not restricted: a 1 and a 9 is just as valid as two 5s.

If partner repeats remain (too few players for the number of games), the app shows a
warning with the number of repeats. If any match has a team skill gap of 3 or more, the
app warns that some matches are unbalanced. This happens with few players (avoiding
repeated partners then forces uneven matches, e.g. 8 players, 2 courts, 7 rounds) or with
very different skill levels.

### 5.3 Edit settings

Before the first result is entered, "Edit settings" (Manage tab) reopens the setup form
pre-filled with the tournament's name, players, courts, break, planning and reveal
setting. "Save and redraw" keeps the tournament's id and creation date and draws a new
schedule. Once a result exists, editing is locked.

### 5.4 Redraw

"Redraw" generates a new schedule from a new seed. It is only allowed before any
result has been entered.

## 6. Visibility

With setting `k`: rounds `1…k` are visible at the start. "Reveal next rounds" shows
the next `k`. The organizer may reveal at any time. In "all" mode everything is
visible from the start. Hidden rounds are already fixed internally (§5) and only
hidden in the UI.

## 7. During the tournament

- **Round screen:** for each court, both teams (names + team strength shown as the
  skill sum on the 1–10 scale), and the list of sit-outs.
- **Result:** tap the winning team. Tapping again changes or clears the result.
- Navigation between visible rounds; finished rounds are marked.

## 8. Standings

Per player:

- `wins` = number of matches won.
- `games` = number of matches played in rounds whose results are all entered.
- `bonus = 0.5 · (G_max − games)`, where `G_max` = the most games any player has
  played in those completed rounds.
- `points = wins + bonus`.

Ranked by `points`, descending; equal points share a rank (1, 2, 2, 4). Columns:
rank, name, skill, games, wins, bonus, points, plus an optional "balance" column
(average rating gap per game) to show that the draw was fair.

## 9. Data and storage

The tournament is stored as one JSON object:

```json
{
  "version": 1,
  "id": "uuid",
  "name": "Club night",
  "createdAt": "ISO-8601",
  "settings": { "courts": 3, "rounds": 9, "matchMinutes": 11, "breakMinutes": 2, "revealBatch": "all" },
  "players": [{ "id": "p1", "name": "Anna", "skill": 3 }],
  "seed": 123456789,
  "schedule": [
    { "round": 1,
      "matches": [{ "court": 1, "team1": ["p1","p7"], "team2": ["p3","p9"] }],
      "sitOuts": ["p5"] }
  ],
  "revealedRounds": 3,
  "results": { "1-1": 1 }
}
```

`results` key = `"<round>-<court>"`, value = winning team (1 or 2).

- **Autosave** to `localStorage` after every change. The home screen lists all
  tournaments saved on this device (open, delete).
- **Export:** download the tournament as `<name>.seedr.json` (for Dropbox or anywhere else).
- **Import:** load a `.seedr.json` file. The file is validated (version, references,
  value ranges); invalid files show an error and don't change anything.
- If `localStorage` isn't available, the app still works and shows a warning that only
  export saves the data.

## 10. Architecture

No dependencies. Development happens in modules, and a build script inlines everything
into one file.

```
src/
  engine/      pure functions, no DOM
    rng.js         seeded random numbers
    timeplan.js    §4 recommendations
    schedule.js    §5 sit-outs + annealing
    standings.js   §8
    validate.js    import validation
  ui/
    index.html, styles.css, app.js   screens: home, setup, rounds, standings
build.mjs       → dist/index.html (single file, inline JS/CSS)
                  + dist/sw.js, dist/manifest.webmanifest (only used when hosted over
                    https: offline start from the iPad home screen)
test/           node --test unit tests for the engine
```

The UI is plain JavaScript with simple render functions. It should be easy to use
on an iPad with touch (large tap areas) and work in Safari and Chrome.

## 11. Testing

Engine unit tests (`node --test`):

- Time planning: the example from §4; edge cases (N < 4·C, N not divisible by 4, no valid options).
- Sit-outs: counts differ by at most 1; nobody sits out twice before everyone has sat out once.
- Schedule: every round is valid (each active player exactly once, team size 2, courts ≤ C).
- No partner repeats for typical sizes (e.g. 18 players, 3 courts, 9 rounds; 12 players, 2 courts, 8 rounds).
- Balance: for those cases the average |diff| per match ≤ 1 and player balance stays small (thresholds set once the first results are measured).
- Determinism: same seed → same schedule.
- Standings: bonus calculation, shared ranks.
- Import validation: valid and broken files.

UI: manual check in Chrome and Safari (iPad), including offline use after "Add to Home Screen".
