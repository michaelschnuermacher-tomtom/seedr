import { generateSchedule } from './schedule.js';
import { resultKey } from './standings.js';
import { fewerGamesCount } from './timeplan.js';

export const FORMAT_VERSION = 1;

// One player per line: "Name: skill". The last ":" separates, so names may contain
// spaces, commas and other punctuation. A "*" after the skill marks a player who should
// get fewer games when they cannot come out even.
export function parsePlayers(text) {
  const players = [];
  const errors = [];
  const names = new Set();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const n = index + 1;
    const colon = line.lastIndexOf(':');
    const name = colon > 0 ? line.slice(0, colon).trim() : '';
    if (!name) {
      errors.push(`Line ${n}: expected "Name: skill", e.g. "Anna: 3"`);
      return;
    }
    const rest = line.slice(colon + 1).trim();
    const fewer = rest.endsWith('*');
    const skillText = fewer ? rest.slice(0, -1).trim() : rest;
    const skill = Number(skillText);
    if (!/^\d+$/.test(skillText) || skill < 1 || skill > 10) {
      errors.push(`Line ${n}: skill must be a whole number from 1 to 10 ("${line}")`);
      return;
    }
    if (names.has(name.toLowerCase())) {
      errors.push(`Line ${n}: duplicate name "${name}"`);
      return;
    }
    names.add(name.toLowerCase());
    players.push(fewer ? { name, skill, fewer } : { name, skill });
  });
  return { players, errors };
}

// Only as many players can be marked for fewer games as there are players who get them.
export function checkFewer(players, settings) {
  const marked = players.filter((p) => p.fewer).length;
  const allowed = fewerGamesCount(players.length, settings.courts, settings.rounds, settings.lastRoundCourts);
  if (marked <= allowed) return null;
  return allowed === 0
    ? 'Everyone plays the same number of games, so no player can be marked with * for fewer games.'
    : `Only ${allowed} player${allowed === 1 ? '' : 's'} get${allowed === 1 ? 's' : ''} fewer games, but ${marked} are marked with *.`;
}

function numberPlayers(players, settings) {
  const problem = checkFewer(players, settings);
  if (problem) throw new Error(problem);
  return players.map((p, i) => ({ id: `p${i + 1}`, name: p.name, skill: p.skill, ...(p.fewer ? { fewer: true } : {}) }));
}

function initialReveal(settings) {
  return settings.revealBatch === 'all' ? settings.rounds : Math.min(settings.rounds, settings.revealBatch);
}

function drawSchedule(players, settings, seed) {
  const { courts, rounds, lastRoundCourts } = settings;
  return generateSchedule({ players, courts, rounds, lastRoundCourts, seed }).schedule;
}

export function createTournament({ id, name, players, settings, seed, now }) {
  const withIds = numberPlayers(players, settings);
  return {
    version: FORMAT_VERSION,
    id,
    name,
    createdAt: now.toISOString(),
    settings: { ...settings },
    players: withIds,
    seed,
    schedule: drawSchedule(withIds, settings, seed),
    revealedRounds: initialReveal(settings),
    results: {},
  };
}

export function revealNext(t) {
  const { rounds, revealBatch } = t.settings;
  const step = revealBatch === 'all' ? rounds : revealBatch;
  return { ...t, revealedRounds: Math.min(rounds, t.revealedRounds + step) };
}

export function hasResults(t) {
  return Object.keys(t.results).length > 0;
}

export function redraw(t, seed) {
  if (hasResults(t)) throw new Error('Cannot redraw after results have been entered');
  // Without results, players who withdrew earlier have nothing left to keep.
  const players = t.players.filter(isActive);
  return { ...t, players, seed, schedule: drawSchedule(players, t.settings, seed), revealedRounds: initialReveal(t.settings) };
}

// New name, players or settings for a tournament that has not started: draws a new
// schedule and keeps id and creation date.
export function updateSettings(t, { name, players, settings }, seed) {
  if (hasResults(t)) throw new Error('Cannot change settings after results have been entered');
  const withIds = numberPlayers(players, settings);
  return {
    ...t,
    name,
    settings: { ...settings },
    players: withIds,
    seed,
    schedule: drawSchedule(withIds, settings, seed),
    revealedRounds: initialReveal(settings),
    results: {},
  };
}

// Players who withdrew keep their entry (for the rounds they played) with
// `withdrawnAfter`: the last round they are part of.
export function isActive(player) {
  return player.withdrawnAfter == null;
}

// Rounds up to the last one with a result are kept; everything after it can be redrawn.
export function firstRedrawableRound(t) {
  const played = t.schedule.filter((r) => r.matches.some((m) => t.results[resultKey(r.round, m.court)]));
  return played.length ? played[played.length - 1].round + 1 : 1;
}

// Takes players out of a running tournament: the rounds played so far stay as they are,
// the remaining rounds are drawn again without them.
export function withdrawPlayers(t, ids, seed) {
  if (!hasResults(t)) throw new Error('Before the first result, change the players with Edit settings');
  const from = firstRedrawableRound(t);
  if (from > t.settings.rounds) throw new Error('There are no rounds left to redraw');
  const leaving = new Set(ids);
  if (leaving.size === 0) throw new Error('Choose at least one player');
  for (const id of leaving) {
    if (!t.players.some((p) => p.id === id && isActive(p))) throw new Error(`Unknown or already withdrawn player ${id}`);
  }
  const players = t.players.map((p) => (leaving.has(p.id) ? { ...p, withdrawnAfter: from - 1 } : p));
  const remaining = players.filter(isActive);
  if (remaining.length < 4) throw new Error('At least 4 players must remain');
  const past = t.schedule.slice(0, from - 1);
  const { schedule } = generateSchedule({
    players: remaining, courts: t.settings.courts, lastRoundCourts: t.settings.lastRoundCourts, rounds: t.settings.rounds - past.length, seed, past, pastPlayers: players,
  });
  return { ...t, players, schedule: [...past, ...schedule] };
}

export function setResult(t, round, court, winner) {
  const exists = t.schedule[round - 1]?.matches.some((m) => m.court === court);
  if (!exists) throw new Error(`Unknown match: round ${round}, court ${court}`);
  const results = { ...t.results };
  const key = resultKey(round, court);
  if (winner === null) delete results[key];
  else results[key] = winner;
  return { ...t, results };
}
