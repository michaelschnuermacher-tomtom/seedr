# Seedr

Draws balanced, rotating 2-vs-2 teams for a fixed number of rounds on a limited number of
courts, records wins and ranks players. Runs completely in the browser and works offline.

## Use on a laptop

```bash
npm run build
```

Open `dist/index.html` in a browser (double-click works). Data is saved in that browser.

## Use on an iPad

1. Run `npm run build`, then upload the whole `dist/` folder to a static host, e.g. drag the `dist` folder onto
   https://app.netlify.com/drop or push it to GitHub Pages.
2. Open the URL in Safari, tap **Share → Add to Home Screen**.
3. Start Seedr from the home screen. After the first start it also works offline.

Tournament data stays on the device. The host only serves the empty app.

## Players

Players are kept on the device and shared by all tournaments. A tournament only refers to its players (by an internal id) and keeps what belongs to the tournament, the skill; name and year of birth are always taken from the player: the **Players** tab of the home
screen lists them with name and (optional) year of birth. The list comes first; **Edit**
and **Add player** open a page to change them. A correction shows in every tournament of
that player, old ones included. A player can only be deleted while they are in no
tournament. If two different people ended up as one (e.g. two "Max"), **Split…** gives
the chosen tournaments a player of their own.

## Setting up a tournament

The setup is a sequence of decisions, and each step appears once the one before is made:
name, scoring, skill scale, players, a skill for each player, courts and break, total time, rounds and match length, and finally **Draw schedule**.

- **Skill scale**: any whole-number range from 0 to 100 (e.g. 1–5 or 1–10), and whether
  a lower or a higher skill is better. The draw is calibrated for 1–10 (1 = best); every
  scale is mapped onto it, so all scales draw alike. Skills, edges and gaps are always
  shown in the tournament's own scale and steps.
- **Players per skill**: one dropdown per player at each skill level, and an empty one to
  add the next; only players not chosen yet are offered. Scales with up to 11 levels show
  every level; larger ones show the levels in use, and **Add a skill level** adds one.
  There are no default skills: they are set here, or later with Info → **Edit**.
  **Add or edit players…** leads to the Players page and back.

The year of birth is only used for the tournament summary, in words ("the oldest player
to win a game"); ages and years are never printed.

## How the draw works

### Settings

| Setting | What it does |
|---|---|
| Players and skill | On the calibrated scale skill 1 is the best, 10 the weakest (see Setting up a tournament). A team's *value* is the sum of both skills plus a quarter of their difference (the *spread*), since opponents can play to the weaker partner: 3 + 6 → 9.75, 1 + 9 → 12. Lower is stronger. |
| Courts | Up to 4 players per court play each round. With fewer than `4 × courts` players, only as many courts are used as there are full groups of 4. |
| Total time, break | From these, Seedr works out every number of rounds that fits: match length = total time ÷ rounds − break, rounded down, at least 5 minutes. |
| Rounds and break | Chosen in a table: one row per number of rounds, one column per break (0–5 minutes); each cell is the match length that fits the total time (only 8 to 60 minutes are offered). Rows where everyone plays the same number of games are green. If leaving courts empty in the last round means fewer players get fewer games, that is a row of its own, e.g. "9 (last: 1 court)". Only the number of rounds affects the draw; match length and break are only used for the time plan. |
| Rounds shown | The whole schedule is drawn up front. The Rounds tab shows every complete round and the next one: as soon as a round has all its results, the next appears. Rounds → **Edit** shows the whole schedule. |

### Steps

1. **How often everyone sits out.** Each round, `players − 4 × courts used` players sit out, and everyone sits out equally often (at most one apart). When the games can't come out even, who gets fewer is drawn at random; **Rounds → Edit** can change it later by swapping players (swapping a player on court with one who sits out moves a game from one to the other). These numbers never change during the draw.
2. **Starting draw.** A first rotation decides who sits out in which round, and each round's players are shuffled into teams and matches.
3. **Improvement.** The draw then repeatedly makes small changes: it swaps two players or two whole teams in a round, or *exchanges sit-outs* between two rounds (Anna plays in round 3 instead of round 6, Ben the other way round, so both keep their number of games). Moving sit-outs lets players meet who would otherwise never be on court in the same round. Each change is scored, and lower scores are better. F is the difference of the two team values in a match:

   | Rule | What counts | Weight |
   |---|---|---|
   | Fair matches | Σ (F² + F⁴/9) over all matches: small gaps cost about F², large ones much more | 10 |
   | Different partners | Σ (times two players were partners)² | 3 |
   | Different opponents | Σ (times two players were opponents)² | 1 |
   | Games spread out | Σ (length of each run of sit-outs)² − sit-outs: single sit-outs are free, longer runs cost more | 50 |
   | Same partner twice | per repeat: more than any normal mismatch, less than a big one (edge about 4 or more) | 300 |
   | Opponents too often | per meeting beyond two-thirds of the rounds (at least 1) | 300 |

   The last two rules matter mostly with few players. Take 8 players with two of skill 1 (Seb, Micha) and two of skill 4 (Henri, Lia): the fairest round always puts Seb against Micha and Henri against Lia, so they would face each other every round, and over 7 rounds everyone would have to team up with everyone once, including Seb with Micha (an edge of 6). Now no two players face each other in more than two-thirds of the rounds, and a partner repeats rather than creating such a mismatch.

   It works in two stages. **Fairness first:** 4 searches from different starts look only at fair matches (plus games spread out, repeated partners and opponents meeting too often); the fairest wins. **Then variety:** starting from it, the draw looks for different partners and opponents, but fair matches may get at most 10% worse than the best found.

   Simulated annealing makes the search: early on, worse changes are sometimes accepted, which helps it get past local dead ends. Over time it accepts fewer of them. The draw uses 100,000 steps in total (200,000 for fewer than 14 players).
4. **Seed.** All randomness comes from one seed number stored with the tournament. The same seed and settings always give the same schedule on every device. **Redraw schedule** simply uses a new seed.

If partners repeat or matches are unbalanced (team value gap of 3 or more), the **Draw quality** card in Info shows a warning. This happens with few players or very different skill levels.

**Edge.** The same team value gap F also shows up per player in the standings. In every match it counts as an advantage for the stronger team (+F for both its players) and as a disadvantage for the weaker one (−F). A player's edge is the average of these over the games they played, i.e. their team's average head start: + means they mostly played in the stronger team, − mostly in the weaker one. Example: Anna plays one match in a team 0.25 stronger and one in a team 3.5 weaker, so her edge is (0.25 − 3.5) ÷ 2 ≈ −1.63. The draw doesn't optimize the edge directly, but since it keeps every gap F small, everyone's edge stays close to 0.

### Results and scores

Tap the winning team on a round card; tap again to clear. A score is optional: **Add score** under a match opens a page with one row per set (the points of both teams, any number of sets). The winner follows from the score: more sets, then more points; when both are equal, the page asks who won. Once a match has a score, tapping a team opens the score page, so winner and score always agree. The standings then show **Sets** (won:lost) and **+/−** (point difference).

### Americano

In the setup, **Scoring** chooses between *Wins (scores optional)*, *Matches, then sets, then points/games (scores required)* — like the first, but every result needs its score, so tapping a match opens the score page — and *Americano: total points win*; only Americano asks for the points per match, e.g. 24 (15:9, 12:12 …). In Americano every result is its score: tapping a match opens the score page, where typing one team's points fills in the other; equal points are a draw. The standings rank by the points a player's teams scored, then point difference, then wins, and show W–D–L. For each game fewer than the most played, a player gets their own average points per game as a bonus (none before their first game). The draw itself is the same: balanced by skill, with partners rotating.

### Standings

A win gives each player in the team 1 point. Players with fewer games than the most games played get 0.5 bonus points per missing game, so sitting out more doesn't cost them. Games and bonus only count rounds where all results have been entered. On equal points, set difference and then point difference decide the rank (matches without a score count 0:0); players equal in all of these share a rank and are listed lowest edge first (the one who won with less help from the draw), then weaker skill first. *Edge* is the average gap between the two team values in a player's games, from their side: in each match it counts as an advantage (+) for the stronger team and a disadvantage (−) for the weaker one. So + means the player mostly played in the stronger team, − mostly in the weaker one. On the round cards, each match says in words how big the edge is and which team has it: *Even* (under 0.25), *Slight* (under 0.75), *Clear* (under 1.5) or *Big* (1.5 and more; one skill step is 1.0).

### When a player leaves

If a player can't continue, open Info → **Edit**, take the players out with ✕ in **Players** and choose **Save and redraw**. All rounds up to the last one with a result stay as they are. All later rounds are drawn again without those players, using the steps above. The new draw takes the rounds already played into account:
- it avoids partners players already had;
- it counts the opponents players already met, so they meet others first;
- whoever has sat out least so far sits out first, and games stay spread out.

Withdrawn players keep their wins in the standings, but get no bonus and no rank. Before the first result, removing a player there simply draws a new schedule without them.

## The tournament tabs

- **Info**: the most important facts (status, players, courts, rounds, match length, break, playing time, games and sit-outs per player, scoring, skill scale, rounds shown), the players by skill, and **Draw quality** last: edges, partners, opponents and sit-outs over the rounds shown so far (hidden rounds would otherwise be given away), with warnings about the whole draw. **Edit** opens the same page as for a new tournament (the setup), filled in. Before the first result everything can change, and saving draws again. Once results are in, scoring, skill scale, courts and times are locked; the name and the skills can still change (**Save**, or **Save and redraw** for the rounds without results), and ✕ next to a player withdraws them (they keep their results; the rounds without results are drawn again). No one can join a started tournament. Once finished, the page only shows the settings (**Done**). **Delete tournament** is at the bottom of this page, the only place where a tournament can be deleted. Names and years of birth are only changed on the Players page.
- **Rounds**: every complete round and the next one, where results are entered. **Edit** shows the whole schedule, where two players can be swapped (tap one, then the other) in any round without results, and, before the first result, **Redraw schedule**; **Done** goes back. Not once finished.
- **Standings**: points, games, bonus, scores and edges.
- **Summary**: the tournament summary once finished; **Finish tournament** and **Reopen** (see below).
- **Print**: asks which sections go into the printout, in this order: the tournament summary (once the tournament is finished), standings, the rounds shown so far (all of them once finished) and the player skills. A section starts on the same page when it still fits.

Skills and edges are always shown. Where the tournament's progress locks something (e.g. scoring once results are in, everything once finished), a 🔒 note says so right there. Editing (Info → Edit, Rounds → Edit, finishing and reopening) can ask for a password every time (currently switched off: `PASSWORD_REQUIRED` in `src/ui/tournament-view.js`). The password only keeps players from peeking: it can be read in the app's source. A finished tournament shows **Finished** next to its name.

### Tournament summary

Fun highlights of the results (champion, underdog of the day, upset of the tournament, rivals, luck of the draw and more), mentioning every player. They would give results away, so they only appear once the tournament is finished: in the **Summary** tab for everyone (until then it says so), and as an option for the printout. The Summary tab also has **Finish tournament**: once every match has a result, it locks results and the draw and shows the summary (it asks for the password when that is switched on); **Reopen** undoes it.

## Keeping data safe

Browser storage can be lost (clearing Safari data, a new device). **Export backup** (Backup tab of the home screen) saves one file with all players and all tournaments, e.g.
`seedr-backup-2026-10-26.json` (to Dropbox or iCloud Drive). **Import** in the **Backup** tab of the home screen
merges it into any device: players are matched by id, then by name, and existing players
and tournaments are only replaced after a confirmation.

## Logo

The logo lives in `src/ui/logo.js`; after changing it run `node tools/make-icons.mjs`
(needs Google Chrome) to render the app icons.

The build writes `dist/index.html`, `sw.js`, `manifest.webmanifest` and `icons/`.
Keep the `dist` folder together, and upload all of it when hosting.

## Development

```bash
npm test        # engine and build tests (node --test)
npm run build   # writes dist/
```

Source: `src/engine` (pure logic, tested), `src/ui` (screens). Design:
`docs/superpowers/specs/2026-10-14-seedr-free-rounds-design.md`.
