import { teamValue } from './schedule.js';

export function resultKey(round, court) {
  return `${round}-${court}`;
}

export function computeStandings(players, schedule, results) {
  const skillOf = new Map(players.map((p) => [p.id, p.skill]));
  const rows = new Map(players.map((p) => [p.id, { id: p.id, name: p.name, skill: p.skill, games: 0, wins: 0, fairnessSum: 0 }]));
  // Team value as balanced by the draw (lower = stronger).
  const value = (team) => teamValue(skillOf.get(team[0]), skillOf.get(team[1]));

  for (const round of schedule) {
    const winners = round.matches.map((m) => results[resultKey(round.round, m.court)]);
    round.matches.forEach((m, i) => {
      if (winners[i] === 1) m.team1.forEach((pid) => rows.get(pid).wins++);
      if (winners[i] === 2) m.team2.forEach((pid) => rows.get(pid).wins++);
    });
    const complete = round.matches.length > 0 && winners.every((w) => w === 1 || w === 2);
    if (!complete) continue;
    for (const m of round.matches) {
      // Match fairness from each side: the gap between the two team values, positive for
      // the stronger team (an advantage), negative for the weaker one.
      const edge = value(m.team2) - value(m.team1); // lower value = stronger
      for (const pid of m.team1) { rows.get(pid).games++; rows.get(pid).fairnessSum += edge; }
      for (const pid of m.team2) { rows.get(pid).games++; rows.get(pid).fairnessSum -= edge; }
    }
  }

  // Players who withdrew keep their wins but get no bonus for the games they missed and
  // no rank; they are listed after everyone else.
  const withdrawn = new Set(players.filter((p) => p.withdrawnAfter != null).map((p) => p.id));
  const list = [...rows.values()];
  const maxGames = Math.max(0, ...list.filter((r) => !withdrawn.has(r.id)).map((r) => r.games));
  // Edge: the average head start of a player's team per game, i.e. the match fairness
  // from their side: + = mostly in the stronger team, − = mostly in the weaker one.
  const out = list.map(({ fairnessSum, ...r }) => {
    const gone = withdrawn.has(r.id);
    const bonus = gone ? 0 : 0.5 * (maxGames - r.games);
    return { ...r, withdrawn: gone, bonus, points: r.wins + bonus, edge: r.games ? fairnessSum / r.games : null };
  });
  // On equal points the lowest edge is listed first (won with the least help from the
  // draw), then the weaker player (higher skill number). Equal points still share a rank.
  out.sort((a, b) => a.withdrawn - b.withdrawn || b.points - a.points || (a.edge ?? 0) - (b.edge ?? 0)
    || b.skill - a.skill || a.name.localeCompare(b.name));
  const ranked = out.filter((r) => !r.withdrawn);
  for (const r of out) r.rank = r.withdrawn ? null : 1 + ranked.filter((o) => o.points > r.points).length;
  return out;
}
