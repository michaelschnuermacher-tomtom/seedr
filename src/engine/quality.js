import { teamValue } from './schedule.js';

// Key figures of a drawn schedule, for the quality report in Manage: how even the matches
// are (team value gaps) and how varied (different partners and opponents), and how the
// sit-outs are spread.
export function drawQuality(players, schedule) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const partners = new Map();
  const opponents = new Map();
  const count = (map, a, b) => map.set(key(a, b), (map.get(key(a, b)) ?? 0) + 1);
  let matches = 0;
  let gapSum = 0;
  let worst = null;
  for (const r of schedule) {
    for (const m of r.matches) {
      const value = (team) => teamValue(byId.get(team[0]).skill, byId.get(team[1]).skill);
      const gap = Math.abs(value(m.team1) - value(m.team2));
      matches++;
      gapSum += gap;
      if (!worst || gap > worst.gap) worst = { gap, round: r.round, court: m.court };
      count(partners, ...m.team1);
      count(partners, ...m.team2);
      for (const a of m.team1) for (const b of m.team2) count(opponents, a, b);
    }
  }

  // Average number of different partners (or opponents) per player who played.
  const playing = new Set(schedule.flatMap((r) => r.matches.flatMap((m) => [...m.team1, ...m.team2])));
  // Each pair counts for both of its players.
  const distinct = (map) => (playing.size ? (2 * map.size) / playing.size : 0);
  const repeats = (map) => [...map.values()].reduce((s, c) => s + Math.max(0, c - 1), 0);
  const name = (id) => byId.get(id).name;
  const mostOpponents = [...opponents.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([k, times]) => ({ names: k.split('|').map(name).sort((a, b) => a.localeCompare(b)), times }));

  // Runs of sit-outs per player, over the rounds.
  let backToBack = 0;
  let longestRun = 0;
  for (const p of players) {
    let run = 0;
    for (const r of schedule) {
      if (r.sitOuts.includes(p.id)) {
        run++;
        if (run === 2) backToBack++;
        longestRun = Math.max(longestRun, run);
      } else {
        run = 0;
      }
    }
  }

  return {
    rounds: schedule.length,
    matches,
    avgGap: matches ? gapSum / matches : 0,
    worst,
    partners: { distinct: distinct(partners), repeats: repeats(partners) },
    opponents: {
      distinct: distinct(opponents),
      repeats: repeats(opponents),
      thirds: [...opponents.values()].reduce((s, c) => s + Math.max(0, c - 2), 0),
      most: mostOpponents,
    },
    sitOuts: { backToBack, longestRun },
  };
}
