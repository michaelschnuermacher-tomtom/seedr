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

  // Players who withdrew keep their wins but get no bonus for the games they missed and
  // no rank; they are listed after everyone else.
  const withdrawn = new Set(players.filter((p) => p.withdrawnAfter != null).map((p) => p.id));
  const list = [...rows.values()];
  const maxGames = Math.max(0, ...list.filter((r) => !withdrawn.has(r.id)).map((r) => r.games));
  const out = list.map(({ gapSum, ...r }) => {
    const gone = withdrawn.has(r.id);
    const bonus = gone ? 0 : 0.5 * (maxGames - r.games);
    return { ...r, withdrawn: gone, bonus, points: r.wins + bonus, avgGap: r.games ? gapSum / r.games : 0 };
  });
  out.sort((a, b) => a.withdrawn - b.withdrawn || b.points - a.points || a.name.localeCompare(b.name));
  const ranked = out.filter((r) => !r.withdrawn);
  for (const r of out) r.rank = r.withdrawn ? null : 1 + ranked.filter((o) => o.points > r.points).length;
  return out;
}
