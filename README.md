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

Players are kept on the device and shared by all tournaments: **Players** on the home
screen lists them with name and (optional) year of birth. The list comes first; **Edit**
and **Add player** open a page to change them. A correction shows in every tournament of
that player, old ones included. A player can only be deleted while they are in no
tournament. If two different people ended up as one (e.g. two "Max"), **Split…** gives
the chosen tournaments a player of their own.

The skill (1 = best, 10 = weakest) belongs to each tournament: in the setup, tick who
plays and set their skill. A new tournament starts with the players of the most recent
one ticked, with their skill there; **Add or edit players…** leads to the Players page
and back.

The year of birth is only used for the tournament summary, in words ("the oldest player
to win a game"); ages and years are never printed.

## How the draw works

### Settings

| Setting | What it does |
|---|---|
| Players and skill | Skill 1 is the best, 10 the weakest. A team's *value* is the sum of both skills plus a quarter of their difference (the *spread*), since opponents can play to the weaker partner: 3 + 6 → 9.75, 1 + 9 → 12. Lower is stronger. |
| Courts | Up to 4 players per court play each round. With fewer than `4 × courts` players, only as many courts are used as there are full groups of 4. |
| Total time, break | From these, Seedr works out every number of rounds that fits: match length = total time ÷ rounds − break, rounded down, at least 5 minutes. |
| Rounds and match length | Chosen from a dropdown of these options only. Options where everyone plays the same number of games come first. If leaving courts empty in the last round means fewer players get fewer games, that is offered as an extra option, e.g. "9 rounds (last round on 1 court)". Only the number of rounds affects the draw. Match length and break are only used for the time plan. |
| Rounds revealed at a time | Only changes what is shown. The whole schedule is drawn up front, and hidden rounds are revealed in batches with **Manage → Reveal round(s)**. |

### Steps

1. **How often everyone sits out.** Each round, `players − 4 × courts used` players sit out, and everyone sits out equally often (at most one apart). When the games can't come out even, who gets fewer is drawn at random; **Manage → Swap players** can change it later (swapping a player on court with one who sits out moves a game from one to the other). These numbers never change during the draw.
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

If partners repeat or matches are unbalanced (team value gap of 3 or more), **Manage → Draw quality** shows a warning. This happens with few players or very different skill levels.

**Edge.** The same team value gap F also shows up per player in the standings. In every match it counts as an advantage for the stronger team (+F for both its players) and as a disadvantage for the weaker one (−F). A player's edge is the average of these over the games they played, i.e. their team's average head start: + means they mostly played in the stronger team, − mostly in the weaker one. Example: Anna plays one match in a team 0.25 stronger and one in a team 3.5 weaker, so her edge is (0.25 − 3.5) ÷ 2 ≈ −1.63. The draw doesn't optimize the edge directly, but since it keeps every gap F small, everyone's edge stays close to 0.

### Standings

A win gives each player in the team 1 point. Players with fewer games than the most games played get 0.5 bonus points per missing game, so sitting out more doesn't cost them. Games and bonus only count rounds where all results have been entered. Players with equal points share a rank and are listed lowest edge first (the one who won with less help from the draw), then weaker skill first. *Edge* is the average gap between the two team values in a player's games, from their side: in each match it counts as an advantage (+) for the stronger team and a disadvantage (−) for the weaker one. So + means the player mostly played in the stronger team, − mostly in the weaker one. On the round cards, each match says in words how big the edge is and which team has it: *Even* (under 0.25), *Slight* (under 0.75), *Clear* (under 1.5) or *Big* (1.5 and more; one skill step is 1.0).

### When a player leaves

If a player can't continue, open **Manage → Players → Player leaves…**, tick the players and choose **Withdraw and redraw**. All rounds up to the last one with a result stay as they are. All later rounds are drawn again without those players, using the steps above. The new draw takes the rounds already played into account:
- it avoids partners players already had;
- it counts the opponents players already met, so they meet others first;
- whoever has sat out least so far sits out first, and games stay spread out.

Withdrawn players keep their wins in the standings, but get no bonus and no rank. Before the first result, remove players with **Manage → Tournament → Edit → Change courts, rounds & times…** instead.

## Manage

Everything that changes or reveals the draw is in **Manage**, which can ask for a password every time it is opened (currently switched off: `PASSWORD_REQUIRED` in `src/ui/tournament-view.js`). The Rounds and Standings tabs only show the revealed rounds, results and standings, so the phone can be handed to players. Manage lists everything read-only, and changes happen on a sub-page that an **Edit** button opens, with Save and Cancel:

- **Finish**: when the last match is played, **Finish tournament** locks results and the draw and shows the tournament summary to everyone in the **Summary** tab; **Reopen** undoes it. Names can still be corrected.
- **Rounds**: how many rounds are revealed, with **Reveal round(s)** and **Swap players**.
- **Tournament**: name and settings; **Edit** changes the name, and before the first result also courts, rounds and times (in the setup, which draws again).
- **Players**: the players by skill; **Edit names** corrects names, **Player leaves…** withdraws players and redraws the remaining rounds.
- **Draw quality**: average and biggest edge; **Details** shows all figures and, before the first result, **Redraw schedule**.
- **Print & export**: **Print…** asks which sections go into the printout, in this order: the tournament summary (once the tournament is finished), standings, all revealed rounds and player skills. A section starts on the same page when it still fits, and **Export backup**.
- **Delete tournament**: the only place where a tournament can be deleted. The password only keeps players from peeking: it can be read in the app's source.

### Tournament summary

Fun highlights of the results (champion, underdog of the day, upset of the tournament, rivals, luck of the draw and more), mentioning every player. They would give results away, so they only appear once the tournament is finished: in the **Summary** tab for everyone (until then it says so), and as an option for the printout.

## Keeping data safe

Browser storage can be lost (clearing Safari data, a new device). **Export backup** (home
screen or Manage) saves one file with all players and all tournaments, e.g.
`seedr-backup-2026-10-26.json` (to Dropbox or iCloud Drive). **Import** on the home screen
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
