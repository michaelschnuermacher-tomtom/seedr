export const MIN_MATCH_MINUTES = 5;

export function playersPerRound(players, courts) {
  return Math.min(4 * courts, 4 * Math.floor(players / 4));
}

// Players on court in each round. Every round uses `courts`, except that the last round
// may use only `lastRoundCourts` when that makes the games come out more even.
export function perRoundPlayers(players, courts, rounds, lastRoundCourts = courts) {
  return Array.from({ length: rounds }, (_, i) => playersPerRound(players, i === rounds - 1 ? lastRoundCourts : courts));
}

function totalPlaces(players, courts, rounds, lastRoundCourts) {
  return perRoundPlayers(players, courts, rounds, lastRoundCourts).reduce((a, b) => a + b, 0);
}

export function gamesPerPlayer(players, courts, rounds, lastRoundCourts = courts) {
  const total = totalPlaces(players, courts, rounds, lastRoundCourts);
  return { min: Math.floor(total / players), max: Math.ceil(total / players), even: total % players === 0 };
}

// How many players get the smaller number of games (0 when the games come out even).
export function fewerGamesCount(players, courts, rounds, lastRoundCourts = courts) {
  const total = totalPlaces(players, courts, rounds, lastRoundCourts);
  return total % players === 0 ? 0 : players - (total % players);
}

// Exactly how many players play how many games, e.g. "13 players play 4 games, 4 players play 3 games".
export function describeGames(players, courts, rounds, lastRoundCourts = courts) {
  const { min, max } = gamesPerPlayer(players, courts, rounds, lastRoundCourts);
  const fewer = fewerGamesCount(players, courts, rounds, lastRoundCourts);
  const games = (n) => `${n} game${n === 1 ? '' : 's'}`;
  const part = (count, n) => `${count} player${count === 1 ? ' plays' : 's play'} ${games(n)}`;
  return fewer === 0 ? `all ${players} players play ${games(max)}` : `${part(players - fewer, max)}, ${part(fewer, min)}`;
}

// Every number of rounds that fits the total time. When leaving courts empty in the last
// round means fewer players get fewer games, that is offered as an extra option
// (`lastRoundCourts`) right after the one with all courts.
export function recommendOptions({ players, courts, totalMinutes, breakMinutes }) {
  if (playersPerRound(players, courts) === 0) return [];
  const used = playersPerRound(players, courts) / 4;
  const options = [];
  for (let rounds = 1; ; rounds++) {
    const matchMinutes = Math.floor(totalMinutes / rounds - breakMinutes);
    if (matchMinutes < MIN_MATCH_MINUTES) break;
    const option = (lastRoundCourts) => {
      const games = gamesPerPlayer(players, courts, rounds, lastRoundCourts);
      return {
        rounds,
        ...(lastRoundCourts < used ? { lastRoundCourts } : {}),
        matchMinutes,
        breakMinutes,
        gamesMin: games.min,
        gamesMax: games.max,
        even: games.even,
        totalMinutes: rounds * (matchMinutes + breakMinutes),
      };
    };
    options.push(option(used));
    let best = { last: used, fewer: fewerGamesCount(players, courts, rounds) };
    for (let last = used - 1; last >= 1; last--) {
      const fewer = fewerGamesCount(players, courts, rounds, last);
      if (fewer < best.fewer) best = { last, fewer };
    }
    if (best.last < used) options.push(option(best.last));
  }
  const lastCourts = (o) => o.lastRoundCourts ?? used;
  return options.sort((a, b) => (a.even === b.even ? a.rounds - b.rounds || lastCourts(b) - lastCourts(a) : a.even ? -1 : 1));
}
