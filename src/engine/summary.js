import { computeStandings, resultKey } from './standings.js';
import { teamValue, edgeLevel } from './schedule.js';
import { scaleOf, calibrated, calibratePlayers } from './scale.js';

// English Scrabble letter values, for the last name joke.
const SCRABBLE = { a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3, n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10 };

// Comments on a name read backwards.
const BACKWARDS = ['sounds like a secret weapon.', 'a perfect name for a robot.', 'definitely a dance move.', 'clearly a spell from a wizard school.', 'the name of a planet nobody has found yet.'];

// A fun summary of the results so far: highlights like the champion, the underdog of the
// day or the upset of the tournament. Only rounds with all results entered count, as in
// the standings. Each highlight is { icon, title, text }; one only appears when there is
// something to tell. Every player is mentioned at least once.
export function tournamentSummary(t) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const name = (id) => byId.get(id).name;
  const names = (ids) => ids.map(name).join(' & ');
  // Calculations use calibrated skills (see scale.js); texts show the tournament's own.
  const scale = scaleOf(t.settings);
  const level = (id) => calibrated(byId.get(id).skill, scale);
  const value = (team) => teamValue(level(team[0]), level(team[1]));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

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
  // Once finished, the summary speaks of the result rather than of the tournament so far.
  const done = Boolean(t.finishedAt);
  const yet = done ? '' : ' yet';
  const next = done ? 'there is always the next tournament!' : 'there is always the next round!';

  // Everyone who played, including players who withdrew later.
  const rows = computeStandings(calibratePlayers(t.players, scale), t.schedule, t.results, t.scores).filter((r) => r.games > 0);
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
      `${top.map((x) => x.name).join(', ')} ${top.length === 1 ? (done ? 'wins' : 'leads') : (done ? 'share the win' : 'share first place')} with ${r.points} ${r.points === 1 ? 'point' : 'points'}`
      + ` (${plural(r.wins, 'win')} from ${plural(r.games, 'game')}).`, top.map((x) => x.id));
  }

  // Underdog of the day: most wins with a negative edge.
  const underdogs = rows.filter((r) => r.edge < 0 && r.wins > 0);
  const underdog = [...underdogs].sort((a, b) => b.wins - a.wins || shown(a.edge) - shown(b.edge))[0];
  if (underdog) {
    const all = underdogs.filter((r) => r.wins === underdog.wins && shown(r.edge) === shown(underdog.edge));
    add('🐶', 'Underdog of the day', `${and(all.map((r) => r.name))} won ${plural(underdog.wins, 'game')}${all.length > 1 ? ' each' : ''}`
      + ` although ${all.length > 1 ? 'their teams were' : 'their team was'} usually the weaker one.`, all.map((r) => r.id));
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
    add('🛡️', 'Perfect record', `${perfect.map((r) => r.name).join(', ')} won every game.`, perfect.map((r) => r.id));
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
      ? `The teams of ${and(all.map((r) => r.name))} were the strongest on average.`
      : `${lucky.name}'s teams were the strongest on average.`, all.map((r) => r.id));
  }

  // Still smiling: everyone without a win, or else the fewest wins in the most games.
  const smiling = [...rows].sort((a, b) => a.wins - b.wins || b.games - a.games)[0];
  if (smiling && !top.includes(smiling) && (smiling.wins === 0 || smiling.games >= 2)) {
    const all = smiling.wins === 0 ? rows.filter((r) => r.wins === 0)
      : rows.filter((r) => r.wins === smiling.wins && r.games === smiling.games);
    add('😄', 'Still smiling', smiling.wins === 0
      ? `${and(all.map((r) => r.name))} ${all.length > 1 ? 'have' : 'has'} no wins${yet}: ${next}`
      : `${and(all.map((r) => r.name))} played ${plural(smiling.games, 'game')}${all.length > 1 ? ' each' : ''}`
        + ` with ${plural(smiling.wins, 'win')}: ${next}`, all.map((r) => r.id));
  }

  // More properties that tell players apart. Each names everyone who has it; the rarest come
  // first, and they are added until every player is mentioned. A property shared by more
  // than a third of the players says little about them and is left out.
  const history = new Map(rows.map((r) => [r.id, []])); // each player's games, in order
  for (const m of matches) {
    for (const [team, other, won] of [[m.won, m.lost, true], [m.lost, m.won, false]]) {
      for (const id of team) history.get(id)?.push({ won, mine: value(team), theirs: value(other), opponents: other, partner: team.find((x) => x !== id) });
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
  // Rollercoaster: win and loss alternate in every game.
  const roller = rows.filter((r) => games(r).length >= 4 && games(r).every((g, i) => i === 0 || g.won !== games(r)[i - 1].won));
  offer('🎢', 'Rollercoaster', ids(roller), `${who(roller)} alternated wins and losses in every game.`);
  // Odd couple: the biggest skill difference in a winning team.
  const skillGap = (m) => Math.abs(level(m.won[0]) - level(m.won[1]));
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
  offer('🏔️', 'Toughest draw', ids(tough), `${who(tough)} faced the strongest opponents on average.`);
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
  offer('⚖️', 'Perfectly balanced', ids(balanced), `${who(balanced)} played perfectly balanced matches on average.`);
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
    offer('⚙️', 'Iron player', ids(iron), `${who(iron)} played every round without a break.`);
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
  // Youngest and oldest: the youngest and the oldest player of the tournament in one team.
  // Always told when it happens, like the main highlights.
  const withYear = rows.filter((r) => born(r.id) != null);
  if (withYear.length >= 4) {
    const years = withYear.map((r) => born(r.id));
    const youngest = withYear.filter((r) => born(r.id) === Math.max(...years));
    const oldest = withYear.filter((r) => born(r.id) === Math.min(...years));
    if (youngest.length === 1 && oldest.length === 1) {
      const [y, o] = [youngest[0].id, oldest[0].id];
      const together = matches.filter((m) => [m.won, m.lost].some((team) => team.includes(y) && team.includes(o)));
      if (together.length) {
        const result = (m) => (m.won.includes(y) ? 'won' : 'lost');
        add('🧒', 'Youngest and oldest', `${name(y)}, the youngest, and ${name(o)}, the oldest, teamed up `
          + (together.length === 1
            ? `in round ${together[0].round} and ${result(together[0])}.`
            : `${together.length === 2 ? 'twice' : `${together.length} times`}: in ${and(together.map((m) => `round ${m.round} (${result(m)})`))}.`), [y, o]);
      }
    }
  }
  const ageGap = (m) => (m.won.every((id) => born(id) != null) ? Math.abs(born(m.won[0]) - born(m.won[1])) : -1);
  const widestAge = Math.max(-1, ...matches.map(ageGap));
  if (widestAge >= 15) {
    const list = matches.filter((m) => ageGap(m) === widestAge);
    offer('👨‍👦', 'Across generations', list.flatMap((m) => m.won), `${teams(list)} won together: the biggest age difference in a winning team.`);
  }
  // Close behind: everyone on the rank right after the leaders.
  const ranked = rows.filter((r) => r.rank != null);
  const second = Math.min(...ranked.filter((r) => r.rank > 1).map((r) => r.rank));
  if (Number.isFinite(second)) {
    const list = ranked.filter((r) => r.rank === second);
    offer('🥈', 'Close behind', ids(list), `${who(list)} ${list.length > 1 ? (done ? 'finished' : 'are') : (done ? 'finished' : 'is')} right behind ${top.length > 1 ? 'the leaders' : 'the leader'}`
      + ` with ${list[0].points} ${list[0].points === 1 ? 'point' : 'points'}.`);
  }
  // Champion's partner: won a game together with one of the leaders.
  const isTop = (id) => top.some((x) => x.id === id);
  const partners = rows.filter((r) => !isTop(r.id) && games(r).some((g) => g.won && isTop(g.partner)));
  offer('🤝', "Champion's partner", ids(partners), `${who(partners)} won alongside ${top.length > 1 ? 'one of the leaders' : 'the leader'}.`);
  // Bounce back: won the game right after a loss.
  const bouncers = rows.filter((r) => games(r).some((g, i) => i > 0 && g.won && !games(r)[i - 1].won));
  offer('🔄', 'Bounce back', ids(bouncers), `${who(bouncers)} answered a loss with a win straight away.`);
  // Punching above their weight: the furthest ahead of the place their skill suggests.
  const bySkill = (r) => 1 + ranked.filter((x) => x.skill < r.skill).length; // the place by skill alone
  const ahead = (r) => bySkill(r) - r.rank;
  const furthest = Math.max(0, ...ranked.map(ahead));
  if (furthest >= 3) {
    const list = ranked.filter((r) => ahead(r) === furthest);
    offer('🧗', 'Punching above their weight', ids(list), `${and(list.map((r) => `${r.name} (skill ${byId.get(r.id).skill}) ${done ? 'finished' : 'is'} in ${ordinal(r.rank)} place`))}:`
      + ` far ahead of what the skill suggests.`);
  }
  // Toughest luck: the lowest edge, i.e. usually in the weaker team (the opposite of Luck of the draw).
  const unlucky = [...regulars].sort((a, b) => shown(a.edge) - shown(b.edge))[0];
  if (unlucky && shown(unlucky.edge) < 0) {
    const list = regulars.filter((r) => shown(r.edge) === shown(unlucky.edge));
    offer('🎲', 'Toughest luck', ids(list), list.length > 1
      ? `The teams of ${who(list)} were usually the weaker ones.`
      : `${unlucky.name}'s teams were usually the weaker ones.`);
  }

  const limit = Math.ceil(rows.length / 3);
  for (const g of pool.filter((x) => x.members.length <= limit).sort((a, b) => a.members.length - b.members.length)) {
    if (g.members.some((id) => !mentioned.has(id))) add(g.icon, g.title, g.text, g.members);
  }
  // Anyone still missing gets a friendly joke about their name, so the summary covers
  // every player. Each kind names everyone it fits; letters vs. wins fits everyone.
  const missing = () => rows.filter((r) => !mentioned.has(r.id));
  const initial = (id) => name(id).trim()[0]?.toUpperCase();
  const letters = (r) => r.name.replace(/[^\p{L}]/gu, '').length; // for Short and sweet
  // Same initial: a winning team whose names start with the same letter.
  const sameInitial = matches.filter((m) => initial(m.won[0]) === initial(m.won[1]) && m.won.some((id) => !mentioned.has(id)));
  if (sameInitial.length) {
    add('🔤', 'Same initial', `${and(sameInitial.map((m) => `${names(m.won)} won round ${m.round}: the ${initial(m.won[0])}-team strikes`))}.`, sameInitial.flatMap((m) => m.won));
  }
  // Palindrome: a name that reads the same backwards (Anna, Otto).
  const palindromes = missing().filter((r) => { const x = r.name.toLowerCase().replace(/[^\p{L}]/gu, ''); return x.length >= 3 && x === [...x].reverse().join(''); });
  if (palindromes.length) {
    add('🔁', 'Palindrome', `${who(palindromes)} ${palindromes.length > 1 ? 'read' : 'reads'} the same from both sides. Try it!`, ids(palindromes));
  }
  // Alphabet: first or last of all players.
  const alphabetical = [...rows].sort((x, y) => x.name.localeCompare(y.name));
  const [first, last] = [alphabetical[0], alphabetical.at(-1)];
  if (first && !mentioned.has(first.id)) add('🅰️', 'Alphabet', `${first.name} leads the alphabet. The table may follow.`, [first.id]);
  if (last && last !== first && !mentioned.has(last.id)) add('🔚', 'Last word', `${last.name} has the last word, at least in the alphabet.`, [last.id]);
  // Short and sweet: the shortest name with a win.
  const winnersLeft = missing().filter((r) => r.wins > 0);
  if (winnersLeft.length) {
    const shortest = Math.min(...rows.filter((r) => r.wins > 0).map(letters));
    const list = winnersLeft.filter((r) => letters(r) === shortest);
    if (list.length) add('📏', 'Short and sweet', `${who(list)}: ${shortest} letters, and every one of them a winner.`, ids(list));
  }
  // Scrabble: the highest-scoring name still missing, against the points here. Letters
  // with accents count as the plain letter.
  const tiles = (r) => [...r.name.normalize('NFD').toLowerCase()].filter((c) => SCRABBLE[c]);
  const worth = (r) => tiles(r).reduce((sum, c) => sum + SCRABBLE[c], 0);
  const wordiest = [...missing()].sort((x, y) => worth(y) - worth(x))[0];
  if (wordiest) {
    const value = worth(wordiest);
    const best = [...tiles(wordiest)].sort((x, y) => SCRABBLE[y] - SCRABBLE[x])[0];
    const tile = best && SCRABBLE[best] >= 8 ? ` The ${best.toUpperCase()} alone is worth ${SCRABBLE[best]}.` : '';
    const points = `${wordiest.points} ${wordiest.points === 1 ? 'point' : 'points'}`;
    add('🔠', 'Scrabble', value > wordiest.points
      ? `${wordiest.name} is worth ${value} points in Scrabble, but ${points} here.${done ? ' The name wins this one.' : ' The name is still ahead!'}${tile}`
      : `${wordiest.name} has ${points} here, more than the name is worth in Scrabble (${value}).${tile}`, [wordiest.id]);
  }
  // Backwards: the longest name still missing, read backwards.
  const longName = [...missing()].sort((x, y) => letters(y) - letters(x) || x.name.localeCompare(y.name))[0];
  if (longName) {
    const reversed = [...longName.name.toLowerCase()].reverse().join('');
    const comment = BACKWARDS[letters(longName) % BACKWARDS.length];
    add('🔀', 'Backwards', `${longName.name} backwards is ${reversed[0].toUpperCase()}${reversed.slice(1)}: ${comment}`, [longName.id]);
  }
  // Vowels: the most vowels among the names still missing.
  const vowels = (r) => [...r.name.normalize('NFD').toLowerCase()].filter((c) => 'aeiouy'.includes(c)).length;
  const singer = [...missing()].sort((x, y) => vowels(y) - vowels(x) || x.name.localeCompare(y.name))[0];
  if (singer && vowels(singer) >= 3) add('🔡', 'Vowels', `${singer.name} has ${vowels(singer)} vowels in one name: a voice made for cheering.`, [singer.id]);
  // Victory chant: the initials of a winning team with someone still missing.
  const chanted = matches.find((m) => m.won.some((id) => !mentioned.has(id)));
  if (chanted) {
    const [x, y] = chanted.won.map(initial);
    add('🎤', 'Victory chant', `${names(chanted.won)} (round ${chanted.round}): ${x}-${y}, ${x}-${y}, what a pair to see!`, chanted.won);
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
