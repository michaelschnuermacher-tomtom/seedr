export const MIN_MATCH_MINUTES = 5;

export function playersPerRound(players, courts) {
  return Math.min(4 * courts, 4 * Math.floor(players / 4));
}

export function gamesPerPlayer(players, courts, rounds) {
  const total = rounds * playersPerRound(players, courts);
  return { min: Math.floor(total / players), max: Math.ceil(total / players), even: total % players === 0 };
}

// How many players get the smaller number of games (0 when the games come out even).
export function fewerGamesCount(players, courts, rounds) {
  const total = rounds * playersPerRound(players, courts);
  return total % players === 0 ? 0 : players - (total % players);
}

export function recommendOptions({ players, courts, totalMinutes, breakMinutes }) {
  if (playersPerRound(players, courts) === 0) return [];
  const options = [];
  for (let rounds = 1; ; rounds++) {
    const matchMinutes = Math.floor(totalMinutes / rounds - breakMinutes);
    if (matchMinutes < MIN_MATCH_MINUTES) break;
    const games = gamesPerPlayer(players, courts, rounds);
    options.push({
      rounds,
      matchMinutes,
      breakMinutes,
      gamesMin: games.min,
      gamesMax: games.max,
      even: games.even,
      totalMinutes: rounds * (matchMinutes + breakMinutes),
    });
  }
  return options.sort((a, b) => (a.even === b.even ? a.rounds - b.rounds : a.even ? -1 : 1));
}
