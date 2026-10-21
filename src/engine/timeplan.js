export const MIN_MATCH_MINUTES = 5;

export function playersPerRound(players, courts) {
  return Math.min(4 * courts, 4 * Math.floor(players / 4));
}

export function gamesPerPlayer(players, courts, rounds) {
  const total = rounds * playersPerRound(players, courts);
  return { min: Math.floor(total / players), max: Math.ceil(total / players), even: total % players === 0 };
}

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const toTime = (minutes) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// Start time of each round ("HH:MM") so that the last match ends at `endTime`, with a
// break between rounds. Times may wrap past midnight.
export function roundStartTimes({ rounds, matchMinutes, breakMinutes, endTime }) {
  const end = toMinutes(endTime);
  return Array.from({ length: rounds }, (_, i) => toTime(end - matchMinutes - (rounds - 1 - i) * (matchMinutes + breakMinutes)));
}

// How many players get the smaller number of games (0 when the games come out even).
export function fewerGamesCount(players, courts, rounds) {
  const total = rounds * playersPerRound(players, courts);
  return total % players === 0 ? 0 : players - (total % players);
}

// Exactly how many players play how many games, e.g. "13 players play 4 games, 4 players play 3 games".
export function describeGames(players, courts, rounds) {
  const { min, max } = gamesPerPlayer(players, courts, rounds);
  const fewer = fewerGamesCount(players, courts, rounds);
  const games = (n) => `${n} game${n === 1 ? '' : 's'}`;
  const part = (count, n) => `${count} player${count === 1 ? ' plays' : 's play'} ${games(n)}`;
  return fewer === 0 ? `all ${players} players play ${games(max)}` : `${part(players - fewer, max)}, ${part(fewer, min)}`;
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
