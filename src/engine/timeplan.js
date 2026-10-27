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

// Breaks offered in the setup, in minutes.
export const BREAK_CHOICES = [0, 1, 2, 3, 4, 5];
// Shorter matches are hardly worth playing, longer ones are unusual: such cells stay empty.
export const MATRIX_MIN_MATCH_MINUTES = 8;
export const MATRIX_MAX_MATCH_MINUTES = 60;

// Rounds × break: one row per number of rounds (and per "last round on fewer courts"
// option), one column per break; each cell is the match length that follows from the total
// time, or null when it would be shorter than MATRIX_MIN_MATCH_MINUTES or longer than
// MATRIX_MAX_MATCH_MINUTES. Rows without any
// cell are left out. Rows are in order of rounds.
export function planMatrix({ players, courts, totalMinutes, breaks = BREAK_CHOICES }) {
  const used = playersPerRound(players, courts) / 4;
  const lastCourts = (o) => o.lastRoundCourts ?? used;
  return recommendOptions({ players, courts, totalMinutes, breakMinutes: 0 })
    .sort((a, b) => a.rounds - b.rounds || lastCourts(b) - lastCourts(a))
    .map((o) => ({
      rounds: o.rounds,
      ...(o.lastRoundCourts ? { lastRoundCourts: o.lastRoundCourts } : {}),
      gamesMin: o.gamesMin,
      gamesMax: o.gamesMax,
      even: o.even,
      cells: breaks.map((breakMinutes) => {
        const matchMinutes = Math.floor(totalMinutes / o.rounds - breakMinutes);
        return matchMinutes >= MATRIX_MIN_MATCH_MINUTES && matchMinutes <= MATRIX_MAX_MATCH_MINUTES ? { breakMinutes, matchMinutes, totalMinutes: o.rounds * (matchMinutes + breakMinutes) } : null;
      }),
    }))
    .filter((row) => row.cells.some(Boolean));
}
