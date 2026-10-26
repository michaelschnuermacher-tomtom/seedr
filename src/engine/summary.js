import { computeStandings, resultKey } from './standings.js';
import { teamValue, edgeLevel } from './schedule.js';

// A fun summary of the results so far: highlights like the champion, the underdog of the
// day or the upset of the tournament. Only rounds with all results entered count, as in
// the standings. Each highlight is { icon, title, text }; one only appears when there is
// something to tell. Every player is mentioned at least once.
export function tournamentSummary(t) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const name = (id) => byId.get(id).name;
  const names = (ids) => ids.map(name).join(' & ');
  const value = (team) => teamValue(byId.get(team[0]).skill, byId.get(team[1]).skill);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const fmt = (x) => (Math.round(x * 100) / 100).toString();
  // Edge as in the standings: one decimal, with + or a real minus sign.
  const edge = (x) => { const v = Math.round(x * 10) / 10; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1); };

  // Matches of complete rounds, with winner and loser.
  const matches = [];
  for (const r of t.schedule) {
    const winners = r.matches.map((m) => t.results[resultKey(r.round, m.court)]);
    if (!r.matches.length || !winners.every((w) => w === 1 || w === 2)) continue;
    r.matches.forEach((m, i) => {
      const [won, lost] = winners[i] === 1 ? [m.team1, m.team2] : [m.team2, m.team1];
      matches.push({ round: r.round, court: m.court, won, lost, gap: value(won) - value(lost) }); // gap > 0: the weaker team won
    });
  }
  if (matches.length === 0) return [];

  // Everyone who played, including players who withdrew later.
  const rows = computeStandings(t.players, t.schedule, t.results).filter((r) => r.games > 0);
  // A highlight about a statistic names everyone who shares it; edges count as equal when
  // they show the same in the standings.
  const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]);
  const shown = (x) => Math.round(x * 10);
  const out = [];
  const mentioned = new Set();
  const add = (icon, title, text, ids = []) => { out.push({ icon, title, text }); ids.forEach((id) => mentioned.add(id)); };

  // Champion(s)
  const top = rows.filter((r) => r.rank === 1);
  if (top.length) {
    const r = top[0];
    add('🏆', top.length === 1 ? 'Champion' : 'Champions',
      `${top.map((x) => x.name).join(', ')} ${top.length === 1 ? 'leads' : 'share first place'} with ${r.points} ${r.points === 1 ? 'point' : 'points'}`
      + ` (${plural(r.wins, 'win')} from ${plural(r.games, 'game')}).`, top.map((x) => x.id));
  }

  // Underdog of the day: most wins with a negative edge.
  const underdogs = rows.filter((r) => r.edge < 0 && r.wins > 0);
  const underdog = [...underdogs].sort((a, b) => b.wins - a.wins || shown(a.edge) - shown(b.edge))[0];
  if (underdog) {
    const all = underdogs.filter((r) => r.wins === underdog.wins && shown(r.edge) === shown(underdog.edge));
    add('🐶', 'Underdog of the day', `${and(all.map((r) => r.name))} won ${plural(underdog.wins, 'game')}${all.length > 1 ? ' each' : ''}`
      + ` although ${all.length > 1 ? 'their teams were' : 'their team was'} usually the weaker one (edge ${edge(underdog.edge)}).`, all.map((r) => r.id));
  }

  // Dream team: the partnership with the most wins together. The draw rarely repeats
  // partners, so this needs at least two wins together (e.g. after swapping players).
  const pairs = new Map();
  for (const m of matches) {
    for (const [team, won] of [[m.won, true], [m.lost, false]]) {
      const key = [...team].sort().join('|');
      const p = pairs.get(key) ?? { team, games: 0, wins: 0 };
      p.games++;
      if (won) p.wins++;
      pairs.set(key, p);
    }
  }
  const dream = [...pairs.values()].filter((p) => p.wins >= 2).sort((a, b) => b.wins - a.wins || a.games - b.games)[0];
  if (dream) {
    add('🤝', 'Dream team', dream.wins === dream.games
      ? `${names(dream.team)}: ${plural(dream.wins, 'win')} in ${plural(dream.games, 'game')} together, unbeaten.`
      : `${names(dream.team)}: ${plural(dream.wins, 'win')} in ${plural(dream.games, 'game')} together.`, dream.team);
  }

  // Upset of the tournament: the biggest win of a weaker team.
  const upsets = matches.filter((m) => m.gap > 0);
  const upset = [...upsets].sort((a, b) => b.gap - a.gap)[0];
  if (upset) {
    add('💥', 'Upset of the tournament', `${names(upset.won)} beat ${names(upset.lost)} in round ${upset.round}, `
      + `although their team was ${{ slight: 'slightly', clear: 'clearly', big: 'much' }[edgeLevel(upset.gap)]} weaker.`, [...upset.won, ...upset.lost]);
  }

  // Perfect record: won every game, at least two.
  const perfect = rows.filter((r) => r.games >= 2 && r.wins === r.games);
  if (perfect.length) {
    add('🛡️', 'Perfect record', `${perfect.map((r) => r.name).join(', ')} won every game so far.`, perfect.map((r) => r.id));
  }

  // Rivals: the two players who faced each other most often.
  const faced = new Map();
  for (const m of matches) {
    for (const a of m.won) for (const b of m.lost) {
      const key = [a, b].sort().join('|');
      const f = faced.get(key) ?? { ids: [a, b].sort(), times: 0, wins: new Map() };
      f.times++;
      f.wins.set(a, (f.wins.get(a) ?? 0) + 1);
      faced.set(key, f);
    }
  }
  const rivals = [...faced.values()].filter((f) => f.times >= 2).sort((a, b) => b.times - a.times || a.ids.join().localeCompare(b.ids.join()))[0];
  if (rivals) {
    const [a, b] = rivals.ids;
    const wa = rivals.wins.get(a) ?? 0;
    const wb = rivals.wins.get(b) ?? 0;
    add('🔁', 'Rivals', `${name(a)} and ${name(b)} faced each other ${rivals.times} times: `
      + (wa === wb ? `${wa}:${wb}, all square.` : `${wa > wb ? name(a) : name(b)} leads ${Math.max(wa, wb)}:${Math.min(wa, wb)}.`), rivals.ids);
  }

  // Luck of the draw: the strongest teams on average.
  const lucky = [...rows].sort((a, b) => shown(b.edge) - shown(a.edge))[0];
  if (lucky && shown(lucky.edge) > 0) {
    const all = rows.filter((r) => shown(r.edge) === shown(lucky.edge));
    add('🍀', 'Luck of the draw', all.length > 1
      ? `The teams of ${and(all.map((r) => r.name))} were the strongest on average (edge ${edge(lucky.edge)}).`
      : `${lucky.name}'s teams were the strongest on average (edge ${edge(lucky.edge)}).`, all.map((r) => r.id));
  }

  // Still smiling: everyone without a win, or else the fewest wins in the most games.
  const smiling = [...rows].sort((a, b) => a.wins - b.wins || b.games - a.games)[0];
  if (smiling && !top.includes(smiling) && smiling.games >= 2) {
    const all = smiling.wins === 0 ? rows.filter((r) => r.wins === 0)
      : rows.filter((r) => r.wins === smiling.wins && r.games === smiling.games);
    add('😄', 'Still smiling', smiling.wins === 0
      ? `${and(all.map((r) => r.name))} ${all.length > 1 ? 'have' : 'has'} no wins yet: there is always the next round!`
      : `${and(all.map((r) => r.name))} played ${plural(smiling.games, 'game')}${all.length > 1 ? ' each' : ''}`
        + ` with ${plural(smiling.wins, 'win')}: there is always the next round!`, all.map((r) => r.id));
  }

  // More properties that tell players apart. Each names everyone who has it; the rarest come
  // first, and they are added until every player is mentioned. A property shared by more
  // than a third of the players says little about them and is left out.
  const history = new Map(rows.map((r) => [r.id, []])); // each player's games, in order
  for (const m of matches) {
    for (const [team, other, won] of [[m.won, m.lost, true], [m.lost, m.won, false]]) {
      for (const id of team) history.get(id)?.push({ won, mine: value(team), theirs: value(other), opponents: other, court: m.court });
    }
  }
  const games = (r) => history.get(r.id);
  const who = (list) => and(list.map((r) => r.name));
  const ids = (list) => list.map((r) => r.id);
  const teams = (list) => and(list.map((m) => `${names(m.won)} (round ${m.round})`));
  const pool = [];
  const offer = (icon, title, members, text) => { if (members.length) pool.push({ icon, title, members: [...new Set(members)], text }); };

  // Hot streak: the most wins in a row.
  const streak = (r) => { let best = 0; let run = 0; for (const g of games(r)) { run = g.won ? run + 1 : 0; best = Math.max(best, run); } return best; };
  const longest = Math.max(0, ...rows.map(streak));
  if (longest >= 2) {
    const list = rows.filter((r) => streak(r) === longest);
    offer('🔥', 'Hot streak', ids(list), `${who(list)} won ${longest} games in a row.`);
  }
  // Comeback: lost the first game, won the last one.
  const comeback = rows.filter((r) => games(r).length >= 2 && !games(r)[0].won && games(r).at(-1).won);
  offer('📈', 'Comeback', ids(comeback), `${who(comeback)} lost the first game and won the last one.`);
  // Flying start: won the first game.
  const flying = rows.filter((r) => games(r)[0]?.won);
  offer('🌅', 'Flying start', ids(flying), `${who(flying)} won the very first game.`);
  // Strong finish: won in the latest round played.
  const lastRound = Math.max(...matches.map((m) => m.round));
  const finish = matches.filter((m) => m.round === lastRound);
  offer('🎬', 'Strong finish', finish.flatMap((m) => m.won), `${and(finish.map((m) => names(m.won)))} won in round ${lastRound}, the latest round.`);
  // Rollercoaster: win and loss alternate in every game.
  const roller = rows.filter((r) => games(r).length >= 4 && games(r).every((g, i) => i === 0 || g.won !== games(r)[i - 1].won));
  offer('🎢', 'Rollercoaster', ids(roller), `${who(roller)} alternated wins and losses in every game.`);
  // Odd couple: the biggest skill difference in a winning team.
  const skillGap = (m) => Math.abs(byId.get(m.won[0]).skill - byId.get(m.won[1]).skill);
  const widest = Math.max(0, ...matches.map(skillGap));
  if (widest >= 3) {
    const list = matches.filter((m) => skillGap(m) === widest);
    offer('🎓', 'Odd couple', list.flatMap((m) => m.won), `${and(list.map((m) => `${names(m.won)} (skills ${m.won.map((id) => byId.get(id).skill).join(' and ')})`))}`
      + ' won together: the biggest skill difference in a winning team.');
  }
  // Toughest draw: the strongest opponents on average (lowest team value).
  const against = (r) => shown(games(r).reduce((sum, g) => sum + g.theirs, 0) / games(r).length);
  const regulars = rows.filter((r) => games(r).length >= 2);
  const toughest = Math.min(...regulars.map(against));
  const tough = regulars.filter((r) => against(r) === toughest);
  offer('🏔️', 'Toughest draw', ids(tough), `${who(tough)} faced the strongest opponents on average (team value ${fmt(toughest / 10)}).`);
  // Champion beater: beat a team with one of the leaders.
  if (top.length < rows.length) {
    const beaters = rows.filter((r) => !top.includes(r) && matches.some((m) => m.won.includes(r.id) && m.lost.some((id) => top.some((x) => x.id === id))));
    offer('👑', 'Champion beater', ids(beaters), `${who(beaters)} beat ${top.length > 1 ? 'one of the leaders' : 'the leader'}.`);
  }
  // Nemesis: lost to the same player more than once.
  const losses = new Map();
  for (const m of matches) for (const a of m.lost) for (const b of m.won) losses.set(`${a}|${b}`, (losses.get(`${a}|${b}`) ?? 0) + 1);
  const nemeses = [...losses].filter(([, n]) => n >= 2).map(([key, n]) => [...key.split('|'), n]).filter(([a]) => history.has(a));
  offer('😈', 'Nemesis', nemeses.flatMap(([a, b]) => [a, b]),
    `${and(nemeses.map(([a, b, n]) => `${name(a)} lost ${n === 2 ? 'twice' : `${n} times`} against ${name(b)}`))}.`);
  // Unshakable: won every game against a stronger team.
  const unshakable = rows.filter((r) => games(r).length >= 2 && games(r).some((g) => g.mine > g.theirs) && games(r).every((g) => g.mine <= g.theirs || g.won));
  offer('🧱', 'Unshakable', ids(unshakable), `${who(unshakable)} won every game against a stronger team.`);
  // Overachiever: more wins as the weaker team than losses as the stronger one.
  const over = rows.filter((r) => {
    const up = games(r).filter((g) => g.won && g.mine > g.theirs).length;
    return up > 0 && up > games(r).filter((g) => !g.won && g.mine < g.theirs).length;
  });
  offer('🚀', 'Overachiever', ids(over), `${who(over)} won more games as the weaker team than they lost as the stronger one.`);
  // So close: lost although their team was the stronger one.
  const close = upsets.map((m) => ({ ...m, won: m.lost }));
  offer('😬', 'So close', close.flatMap((m) => m.won), `${teams(close)} lost although their team was the stronger one.`);
  // Perfectly balanced: their matches were even on average.
  const balanced = regulars.filter((r) => shown(r.edge) === 0);
  offer('⚖️', 'Perfectly balanced', ids(balanced), `${who(balanced)} played perfectly balanced matches on average (edge 0.0).`);
  // Bench warmer and iron player: sat out the most rounds, or none at all.
  // Rounds a player could have played: players who withdrew only count until they left.
  const roundsDone = [...new Set(matches.map((m) => m.round))];
  const played = roundsDone.length;
  const rested = (r) => roundsDone.filter((n) => n <= (byId.get(r.id).withdrawnAfter ?? Infinity)).length - games(r).length;
  const most = Math.max(...rows.map(rested));
  if (most > 0) {
    const bench = rows.filter((r) => rested(r) === most);
    offer('🪑', 'Bench warmer', ids(bench), `${who(bench)} sat out ${plural(most, 'round')}: well rested for what comes next!`);
    const iron = played >= 2 ? rows.filter((r) => rested(r) === 0) : [];
    offer('⚙️', 'Iron player', ids(iron), `${who(iron)} played every round so far without a break.`);
  }
  // Giant killer: beat the strongest team anyone has beaten (lowest team value).
  const strongest = Math.min(...matches.map((m) => value(m.lost)));
  const giants = matches.filter((m) => value(m.lost) === strongest);
  offer('🗡️', 'Giant killer', giants.flatMap((m) => m.won), `${and(giants.map((m) => `${names(m.won)} beat ${names(m.lost)} in round ${m.round}`))}:`
    + ` the strongest team anyone has beaten.`);
  // Late bloomer: more wins in the second half of their games than in the first.
  const bloomers = rows.filter((r) => {
    const g = games(r);
    const half = Math.floor(g.length / 2);
    return g.length >= 4 && g.slice(-half).filter((x) => x.won).length > g.slice(0, half).filter((x) => x.won).length;
  });
  offer('🌱', 'Late bloomer', ids(bloomers), `${who(bloomers)} won more games in the second half than in the first.`);
  // Court regular: the most games on one and the same court.
  if (new Set(matches.map((m) => m.court)).size > 1) {
    const favourite = (r) => {
      const counts = new Map();
      for (const g of games(r)) counts.set(g.court, (counts.get(g.court) ?? 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [0, 0];
    };
    const most = Math.max(...rows.map((r) => favourite(r)[1]));
    if (most >= 3) {
      const list = rows.filter((r) => favourite(r)[1] === most);
      offer('📍', 'Court regular', ids(list), `${and(list.map((r) => `${r.name} (court ${favourite(r)[0]})`))} played ${most} games on the same court.`);
    }
  }
  // Age, in words only: the oldest and youngest players with a win, and the winning team
  // with the biggest age difference. Only players with a year of birth count.
  const born = (id) => byId.get(id).birthYear;
  const aged = rows.filter((r) => r.wins > 0 && born(r.id) != null);
  if (aged.length >= 3) {
    const years = aged.map((r) => born(r.id));
    const [oldest, youngest] = [Math.min(...years), Math.max(...years)];
    if (oldest !== youngest) {
      const old = aged.filter((r) => born(r.id) === oldest);
      const young = aged.filter((r) => born(r.id) === youngest);
      offer('🧓', 'Old hands', ids(old), `${who(old)} ${old.length > 1 ? 'were the oldest players' : 'was the oldest player'} to win a game.`);
      offer('🐣', 'Young guns', ids(young), `${who(young)} ${young.length > 1 ? 'were the youngest players' : 'was the youngest player'} to win a game.`);
    }
  }
  const ageGap = (m) => (m.won.every((id) => born(id) != null) ? Math.abs(born(m.won[0]) - born(m.won[1])) : -1);
  const widestAge = Math.max(-1, ...matches.map(ageGap));
  if (widestAge >= 15) {
    const list = matches.filter((m) => ageGap(m) === widestAge);
    offer('👨‍👦', 'Across generations', list.flatMap((m) => m.won), `${teams(list)} won together: the biggest age difference in a winning team.`);
  }

  const limit = Math.ceil(rows.length / 3);
  for (const g of pool.filter((x) => x.members.length <= limit).sort((a, b) => a.members.length - b.members.length)) {
    if (g.members.some((id) => !mentioned.has(id))) add(g.icon, g.title, g.text, g.members);
  }
  // Anyone still missing gets the win tally, so the summary covers every player.
  const left = rows.filter((r) => !mentioned.has(r.id));
  if (left.length) add('🎾', 'Win tally', `${and(left.map((r) => `${r.name} ${plural(r.wins, 'win')}`))}.`, ids(left));

  // By the numbers: how often the stronger team won.
  const decided = matches.filter((m) => m.gap !== 0);
  const favourites = decided.filter((m) => m.gap < 0).length;
  add('📊', 'By the numbers', `${matches.length} ${matches.length === 1 ? 'match' : 'matches'} played. `
    + (decided.length
      ? `The stronger team won ${favourites} of ${decided.length} (even matches not counted); ${plural(upsets.length, 'upset')}.`
      : 'All of them between teams of exactly the same value.'));
  return out;
}
