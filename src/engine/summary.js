import { computeStandings, resultKey } from './standings.js';
import { teamValue } from './schedule.js';

// A fun summary of the results so far: highlights like the champion, the underdog of the
// day or the upset of the tournament. Only rounds with all results entered count, as in
// the standings. Each highlight is { icon, title, text }; one only appears when there is
// something to tell. Players without a highlight get a line of their own.
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

  const rows = computeStandings(t.players, t.schedule, t.results).filter((r) => !r.withdrawn && r.games > 0);
  // Ties: Underdog of the day and Luck of the draw name the player with the highest skill
  // number, Still smiling the one with the lowest (skill 1 is the best).
  const weakestFirst = (a, b) => b.skill - a.skill || a.name.localeCompare(b.name);
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
  const underdog = rows.filter((r) => r.edge < 0 && r.wins > 0)
    .sort((a, b) => b.wins - a.wins || a.edge - b.edge || weakestFirst(a, b))[0];
  if (underdog) {
    add('🐶', 'Underdog of the day', `${underdog.name} won ${plural(underdog.wins, 'game')} although their team was usually the weaker one`
      + ` (edge ${edge(underdog.edge)}).`, [underdog.id]);
  }

  // Dream team: the partnership with the most wins together. The draw never repeats
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
      + `although their team value was ${fmt(upset.gap)} weaker.`, [...upset.won, ...upset.lost]);
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
  const lucky = [...rows].sort((a, b) => b.edge - a.edge || weakestFirst(a, b))[0];
  if (lucky && lucky.edge > 0) {
    add('🍀', 'Luck of the draw', `${lucky.name}'s teams were the strongest on average (edge ${edge(lucky.edge)}).`, [lucky.id]);
  }

  // Still smiling: most games, fewest wins.
  const smiling = [...rows].sort((a, b) => a.wins - b.wins || b.games - a.games || a.skill - b.skill || b.edge - a.edge || a.name.localeCompare(b.name))[0];
  if (smiling && smiling !== top[0] && smiling.games >= 2) {
    add('😄', 'Still smiling', `${smiling.name} played ${plural(smiling.games, 'game')} with ${smiling.wins === 0 ? 'no wins yet' : plural(smiling.wins, 'win')}: there is always the next round!`, [smiling.id]);
  }

  // Everyone not mentioned yet lands in one of these, so the summary covers every player.
  const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]);
  const rest = rows.filter((x) => !mentioned.has(x.id));
  const winsOf = (r) => matches.filter((m) => m.won.includes(r.id));
  const partner = (r, m) => name(m.won.find((id) => id !== r.id));
  const slayers = rest.filter((r) => winsOf(r).some((m) => m.gap > 0));
  if (slayers.length) {
    const told = slayers.map((r) => {
      const m = winsOf(r).filter((x) => x.gap > 0).sort((a, b) => b.gap - a.gap)[0];
      return `${r.name} (with ${partner(r, m)} in round ${m.round})`;
    });
    add('🗡️', slayers.length === 1 ? 'Giant slayer' : 'Giant slayers',
      `${and(told)} ${slayers.length === 1 ? 'was' : 'were'} on the weaker team and won anyway.`, slayers.map((r) => r.id));
  }
  const steady = rest.filter((r) => !slayers.includes(r) && r.wins >= 2);
  if (steady.length) {
    add('💪', 'Steady hands', `${and(steady.map((r) => `${r.name} (${r.wins} of ${r.games})`))} kept the wins coming.`, steady.map((r) => r.id));
  }
  const once = rest.filter((r) => !slayers.includes(r) && r.wins === 1);
  if (once.length) {
    add('🎉', 'One to remember', `${and(once.map((r) => `${r.name} (with ${partner(r, winsOf(r)[0])} in round ${winsOf(r)[0].round})`))}`
      + ` ${once.length === 1 ? 'has' : 'each have'} a win to celebrate.`, once.map((r) => r.id));
  }
  const warming = rest.filter((r) => r.wins === 0);
  if (warming.length) {
    add('🌱', 'Saving the best for later', `${and(warming.map((r) => r.name))} ${warming.length === 1 ? 'is' : 'are'} still warming up:`
      + ' the first win is just around the corner.', warming.map((r) => r.id));
  }

  // By the numbers: how often the stronger team won.
  const decided = matches.filter((m) => m.gap !== 0);
  const favourites = decided.filter((m) => m.gap < 0).length;
  add('📊', 'By the numbers', `${matches.length} ${matches.length === 1 ? 'match' : 'matches'} played. `
    + (decided.length
      ? `The stronger team won ${favourites} of ${decided.length} (even matches not counted); ${plural(upsets.length, 'upset')}.`
      : 'All of them between teams of exactly the same value.'));
  return out;
}
