import { teamValue } from './schedule.js';

export function resultKey(round, court) {
  return `${round}-${court}`;
}

// A match has a result: 1 or 2 (the winning team), or 0 for a draw (Americano only).
export function hasResult(results, key) {
  return results[key] === 0 || results[key] === 1 || results[key] === 2;
}

// Americano: every match is played to a fixed total of points (`scoring.points`), and the
// ranking is by the points a player's teams scored. Otherwise matches are won or lost.
export function isAmericano(scoring) {
  return scoring?.mode === 'americano';
}

// What a score says: sets won by each team and points of each team. A set goes to the
// team with more points. `sets` is [[team 1 points, team 2 points], …].
export function scoreTotals(sets) {
  const totals = { sets: [0, 0], points: [0, 0] };
  for (const [a, b] of sets) {
    totals.points[0] += a;
    totals.points[1] += b;
    if (a !== b) totals.sets[a > b ? 0 : 1]++;
  }
  return totals;
}

// The winner a score shows (1 or 2): more sets, then more points; null when both are equal.
export function scoreWinner(sets) {
  const { sets: [s1, s2], points: [p1, p2] } = scoreTotals(sets);
  if (s1 !== s2) return s1 > s2 ? 1 : 2;
  if (p1 !== p2) return p1 > p2 ? 1 : 2;
  return null;
}

// `scores` (optional) maps a match key to its sets; they add sets and points for the
// tie-breakers. With Americano `scoring`, the points scored are the ranking.
export function computeStandings(players, schedule, results, scores = {}, scoring = null) {
  const americano = isAmericano(scoring);
  const skillOf = new Map(players.map((p) => [p.id, p.skill]));
  const rows = new Map(players.map((p) => [p.id, {
    id: p.id, name: p.name, skill: p.skill, games: 0, wins: 0, draws: 0, fairnessSum: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0,
  }]));
  // Team value as balanced by the draw (lower = stronger).
  const value = (team) => teamValue(skillOf.get(team[0]), skillOf.get(team[1]));

  for (const round of schedule) {
    const winners = round.matches.map((m) => results[resultKey(round.round, m.court)]);
    round.matches.forEach((m, i) => {
      if (winners[i] === 1) m.team1.forEach((pid) => rows.get(pid).wins++);
      if (winners[i] === 2) m.team2.forEach((pid) => rows.get(pid).wins++);
      if (winners[i] === 0) [...m.team1, ...m.team2].forEach((pid) => rows.get(pid).draws++);
    });
    const complete = round.matches.length > 0 && round.matches.every((m) => hasResult(results, resultKey(round.round, m.court)));
    if (!complete) continue;
    for (const m of round.matches) {
      // Match fairness from each side: the gap between the two team values, positive for
      // the stronger team (an advantage), negative for the weaker one.
      const edge = value(m.team2) - value(m.team1); // lower value = stronger
      for (const pid of m.team1) { rows.get(pid).games++; rows.get(pid).fairnessSum += edge; }
      for (const pid of m.team2) { rows.get(pid).games++; rows.get(pid).fairnessSum -= edge; }
      const sets = scores[resultKey(round.round, m.court)];
      if (!sets) continue;
      const { sets: won, points } = scoreTotals(sets);
      for (const [team, mine, theirs] of [[m.team1, 0, 1], [m.team2, 1, 0]]) {
        for (const pid of team) {
          const r = rows.get(pid);
          r.setsWon += won[mine];
          r.setsLost += won[theirs];
          r.pointsFor += points[mine];
          r.pointsAgainst += points[theirs];
        }
      }
    }
  }

  // Players who withdrew keep their wins but get no bonus for the games they missed and
  // no rank; they are listed after everyone else.
  const withdrawn = new Set(players.filter((p) => p.withdrawnAfter != null).map((p) => p.id));
  const list = [...rows.values()];
  const maxGames = Math.max(0, ...list.filter((r) => !withdrawn.has(r.id)).map((r) => r.games));
  // Edge: the average head start of a player's team per game, i.e. the match fairness
  // from their side: + = mostly in the stronger team, − = mostly in the weaker one.
  // Bonus for games fewer than the most played: 0.5 points per game, or in Americano the
  // player's own average points per game (one decimal).
  const out = list.map(({ fairnessSum, ...r }) => {
    const gone = withdrawn.has(r.id);
    const missing = gone ? 0 : maxGames - r.games;
    const bonus = americano ? Math.round(((r.games ? r.pointsFor / r.games : 0) * missing) * 10) / 10 : 0.5 * missing;
    const points = americano ? Math.round((r.pointsFor + bonus) * 10) / 10 : r.wins + bonus;
    return { ...r, withdrawn: gone, bonus, points, losses: r.games - r.wins - r.draws, edge: r.games ? fairnessSum / r.games : null };
  });
  // Rank: points, then set difference, then point difference (both 0 without scores);
  // in Americano points, then point difference, then wins.
  // Players equal in all three share a rank; among them the lowest edge is listed first
  // (won with the least help from the draw), then the weaker player (higher skill number).
  const sets = (r) => r.setsWon - r.setsLost;
  const diff = (r) => r.pointsFor - r.pointsAgainst;
  // Americano: points, then point difference, then wins.
  const ahead = (a, b) => (americano
    ? b.points - a.points || diff(b) - diff(a) || b.wins - a.wins
    : b.points - a.points || sets(b) - sets(a) || diff(b) - diff(a));
  out.sort((a, b) => a.withdrawn - b.withdrawn || ahead(a, b) || (a.edge ?? 0) - (b.edge ?? 0)
    || b.skill - a.skill || a.name.localeCompare(b.name));
  const ranked = out.filter((r) => !r.withdrawn);
  for (const r of out) r.rank = r.withdrawn ? null : 1 + ranked.filter((o) => ahead(o, r) < 0).length;
  return out;
}
