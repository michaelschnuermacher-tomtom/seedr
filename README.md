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
| Players and skill | Skill 1 is the best, 10 the weakest. For the draw it becomes a *strength* of `11 − skill`, so 1 → 10 and 10 → 1. A team's strength is the sum of its two players' strengths. |
| Courts | Up to 4 players per court play each round. With fewer than `4 × courts` players, only as many courts are used as there are full groups of 4. |
| Total time, break | From these, Seedr works out every number of rounds that fits: match length = total time ÷ rounds − break, rounded down, at least 5 minutes. |
| Rounds and match length | Chosen from a dropdown of these options only. Options where everyone plays the same number of games come first. If leaving courts empty in the last round means fewer players get fewer games, that is offered as an extra option, e.g. "9 rounds (last round on 1 court)". Only the number of rounds affects the draw. Match length and break are only used for the time plan. |
| End time (optional) | The time the last match should end. Each round then shows when it must start: the last round starts one match length before the end time, and each earlier round one match plus one break before the next. |
| Rounds revealed at a time | Only changes what is shown. The whole schedule is drawn up front, and hidden rounds are revealed in batches. |

### Steps

1. **Who sits out.** Each round, `players − 4 × courts used` players sit out. The players who have sat out least so far sit out first, so nobody sits out twice before everyone has sat out once. Among equals, players who sat out in the previous round are skipped where possible, and the rest are chosen at random. When the games can't come out even, players marked with `*` after their name (e.g. `4: Gesa*, Henri`, or `Gesa: 4 *` on a line of their own) are the ones who get fewer games. Only as many players can be marked as there are players who get fewer games; any extra places are drawn at random.
2. **Starting teams.** Each round's players are shuffled into teams of two and paired into matches.
3. **Improvement.** The draw then repeatedly makes small changes: it swaps two players, or two whole teams between courts in the same round. Each change is scored, and lower scores are better:

   | Rule | Weight |
   |---|---|
   | Same partner twice | 10,000 per repeat (practically forbidden) |
   | Unequal teams in a match | 10 × (strength difference)² |
   | One player always in the stronger or weaker team | 3 × (that player's total advantage)² |
   | Teams mixed differently, e.g. 1+9 vs 5+5 (14+ players only) | 5 × (difference in spread)² |
   | Partners far apart in skill, e.g. 1+9 (14+ players only) | 1 × (spread)² per team |
   | Same opponent twice | 1 per repeat |

   Simulated annealing makes the search: early on, worse changes are sometimes accepted, which helps it get past local dead ends. Over time it accepts fewer of them. The draw runs 4 times from different starts, with 100,000 steps in total (200,000 for fewer than 14 players), and the best result wins.
4. **Seed.** All randomness comes from one seed number stored with the tournament. The same seed and settings always give the same schedule on every device. **Redraw schedule** simply uses a new seed.

If repeated partners or unbalanced matches can't be avoided (team strength gap of 3 or more), the tournament screen shows a warning. This happens with few players or very different skill levels.

### Standings

A win gives each player in the team 1 point. Players with fewer games than the most games played get 0.5 bonus points per missing game, so sitting out more doesn't cost them. Games and bonus only count rounds where all results have been entered. *Avg. advantage* shows whether a player mostly played in the stronger (+) or weaker (−) team.

### When a player leaves

If a player can't continue, open **Manage → Player leaves**, tick the players and choose **Withdraw and redraw**. All rounds up to the last one with a result stay as they are. All later rounds are drawn again without those players, using the steps above. The new draw takes the rounds already played into account:
- it avoids partners players already had;
- it continues each player's balance of stronger and weaker teams;
- whoever has sat out least so far sits out first.

Withdrawn players keep their wins in the standings, but get no bonus and no rank. Before the first result, remove players with **Edit settings** instead.

## Keeping data safe

Browser storage can be lost (clearing Safari data, a new device). Use **Manage → Export**
to save a `.seedr.json` file (e.g. to Dropbox or iCloud Drive) and **Import** to load it
on any device.

## Photos and logo

The tournament screen shows a rotating photo banner. The originals live in `img/`
(not committed); after adding or changing photos run

```bash
python3 tools/optimize-photos.py   # needs Pillow; writes src/ui/photos and the photo list
```

It shrinks them to 1200 px and removes all metadata, including GPS locations. Photo 13 is
the first banner image. The logo lives in `src/ui/logo.js`; after changing it run
`node tools/make-icons.mjs` (needs Google Chrome) to render the app icons.

The build writes `dist/index.html`, `sw.js`, `manifest.webmanifest`, `photos/` and `icons/`.
Keep the `dist` folder together, and upload all of it when hosting.

## Development

```bash
npm test        # engine and build tests (node --test)
npm run build   # writes dist/
```

Source: `src/engine` (pure logic, tested), `src/ui` (screens). Design:
`docs/superpowers/specs/2026-10-14-seedr-free-rounds-design.md`.
