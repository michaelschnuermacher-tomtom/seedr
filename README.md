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

## Players file

On the setup screen, **Load players file** reads a plain text file (e.g. from Dropbox or
iCloud Drive) with one line per skill (1 = best, 10 = weakest) and the players of
that skill after a colon, separated by commas:

```
1: Carla
3: Anna, David
7: Ben Miller
```

A single player can also be written as name and skill, e.g. `Ben Miller: 7`. Names
that contain a comma must be written that way: `Müller, Jörg: 1`. A line counts as a
skill line when it starts with a number.

The players appear in the text box, where they can still be edited. You can also type
or paste players in the same format.

## How the draw works

### Settings

| Setting | What it does |
|---|---|
| Players and skill | Skill 1 is the best, 10 the weakest. A team's *value* is the sum of both skills plus a quarter of their difference (the *spread*), since opponents can play to the weaker partner: 3 + 6 → 9.75, 1 + 9 → 12. Lower is stronger. |
| Courts | Up to 4 players per court play each round. With fewer than `4 × courts` players, only as many courts are used as there are full groups of 4. |
| Total time, break | From these, Seedr works out every number of rounds that fits: match length = total time ÷ rounds − break, rounded down, at least 5 minutes. |
| Rounds and match length | Chosen from a dropdown of these options only. Options where everyone plays the same number of games come first. If leaving courts empty in the last round means fewer players get fewer games, that is offered as an extra option, e.g. "9 rounds (last round on 1 court)". Only the number of rounds affects the draw. Match length and break are only used for the time plan. |
| End time (optional) | The time the last match should end. Each round then shows when it must start: the last round starts one match length before the end time, and each earlier round one match plus one break before the next. |
| Rounds revealed at a time | Only changes what is shown. The whole schedule is drawn up front, and hidden rounds are revealed in batches with **Manage → Reveal round(s)**. |

### Steps

1. **How often everyone sits out.** Each round, `players − 4 × courts used` players sit out, and everyone sits out equally often (at most one apart). When the games can't come out even, players marked with `*` after their name (e.g. `4: Gesa*, Henri`, or `Gesa: 4 *` on a line of their own) are the ones who get fewer games. Only as many players can be marked as there are players who get fewer games; any extra places are drawn at random. These numbers never change during the draw.
2. **Starting draw.** A first rotation decides who sits out in which round, and each round's players are shuffled into teams and matches.
3. **Improvement.** The draw then repeatedly makes small changes: it swaps two players or two whole teams in a round, or *exchanges sit-outs* between two rounds (Anna plays in round 3 instead of round 6, Ben the other way round, so both keep their number of games). Moving sit-outs lets players meet who would otherwise never be on court in the same round. Each change is scored, and lower scores are better. F is the difference of the two team values in a match:

   | Rule | What counts | Weight |
   |---|---|---|
   | Fair matches | Σ (F² + F⁴/9) over all matches: small gaps cost about F², large ones much more | 10 |
   | Different partners | Σ (times two players were partners)² | 3 |
   | Different opponents | Σ (times two players were opponents)² | 1 |
   | Games spread out | Σ (length of each run of sit-outs)² − sit-outs: single sit-outs are free, longer runs cost more | 50 |
   | Same partner twice | per repeat (practically forbidden) | 10,000 |

   It works in two stages. **Fairness first:** 4 searches from different starts look only at fair matches (plus games spread out and no repeated partners); the fairest wins. **Then variety:** starting from it, the draw looks for different partners and opponents, but fair matches may get at most 10% worse than the best found.

   Simulated annealing makes the search: early on, worse changes are sometimes accepted, which helps it get past local dead ends. Over time it accepts fewer of them. The draw uses 100,000 steps in total (200,000 for fewer than 14 players).
4. **Seed.** All randomness comes from one seed number stored with the tournament. The same seed and settings always give the same schedule on every device. **Redraw schedule** simply uses a new seed.

If repeated partners or unbalanced matches can't be avoided (team value gap of 3 or more), **Manage → Draw quality** shows a warning. This happens with few players or very different skill levels.

**PAS (Path Advantage Score).** The same team value gap F also shows up per player in the standings. In every match it counts as an advantage for the stronger team (+F for both its players) and as a disadvantage for the weaker one (−F). A player's PAS is the average of these over the games they played: + means they mostly played in the stronger team, − mostly in the weaker one. Example: Anna plays one match in a team 0.25 stronger and one in a team 3.5 weaker, so her PAS is (0.25 − 3.5) ÷ 2 ≈ −1.63. The draw doesn't optimize PAS directly, but since it keeps every gap F small, everyone's PAS stays close to 0.

### Standings

A win gives each player in the team 1 point. Players with fewer games than the most games played get 0.5 bonus points per missing game, so sitting out more doesn't cost them. Games and bonus only count rounds where all results have been entered. Players with equal points share a rank and are listed weaker skill first, so the better player comes last. *PAS* (Path Advantage Score) is the average gap between the two team values in a player's games, from their side: in each match it counts as an advantage (+) for the stronger team and a disadvantage (−) for the weaker one. So + means the player mostly played in the stronger team, − mostly in the weaker one.

### When a player leaves

If a player can't continue, open **Manage → Player leaves**, tick the players and choose **Withdraw and redraw**. All rounds up to the last one with a result stay as they are. All later rounds are drawn again without those players, using the steps above. The new draw takes the rounds already played into account:
- it avoids partners players already had;
- it counts the opponents players already met, so they meet others first;
- whoever has sat out least so far sits out first, and games stay spread out.

Withdrawn players keep their wins in the standings, but get no bonus and no rank. Before the first result, remove players with **Edit settings** instead.

## Manage

Everything that changes or reveals the draw is in **Manage**, which asks for a password every time it is opened. The Rounds and Standings tabs only show the revealed rounds, results and standings, so the phone can be handed to players. In Manage, **Rounds & display** reveals the next round(s), switches the Rounds tab between one round and all rounds, shows or hides team values and spreads, starts swapping players, and prints the rounds or the standings. The password only keeps players from peeking: it can be read in the app's source.

## Keeping data safe

Browser storage can be lost (clearing Safari data, a new device). Use **Manage → Export**
to save a `.seedr.json` file (e.g. to Dropbox or iCloud Drive) and **Import** to load it
on any device.

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
