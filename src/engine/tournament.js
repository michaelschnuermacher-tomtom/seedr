import { generateSchedule } from './schedule.js';
import { resultKey } from './standings.js';

// Version 2: players link to a person (`personId`) and may have a year of birth.
export const FORMAT_VERSION = 2;

// Players as text (the default players and tests). Two kinds of lines:
// - "skill: Name, Name, ..." lists all players of one skill, e.g. "1: Markus, Micha, Seb".
// - "Name: skill" is one player. The last ":" separates, so names may contain spaces,
//   commas and other punctuation, e.g. "Müller, Jörg: 1".
// A line is the first kind when it starts with a number.
export function parsePlayers(text) {
  const players = [];
  const errors = [];
  const names = new Set();
  const skillOf = (skillText) => (/^\d+$/.test(skillText) && Number(skillText) >= 1 && Number(skillText) <= 10 ? Number(skillText) : null);
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const n = index + 1;
    const add = (name, skill) => {
      if (names.has(name.toLowerCase())) {
        errors.push(`Line ${n}: duplicate name "${name}"`);
        return;
      }
      names.add(name.toLowerCase());
      players.push({ name, skill });
    };
    const group = /^(\d+)\s*:(.*)$/.exec(line);
    if (group) {
      const skill = skillOf(group[1]);
      const entries = group[2].split(',').map((x) => x.trim()).filter(Boolean);
      if (!skill) errors.push(`Line ${n}: skill must be a whole number from 1 to 10 ("${line}")`);
      else if (entries.length === 0) errors.push(`Line ${n}: expected names after the skill, e.g. "3: Anna, Ben"`);
      else entries.forEach((name) => add(name, skill));
      return;
    }
    const colon = line.lastIndexOf(':');
    const name = colon > 0 ? line.slice(0, colon).trim() : '';
    if (!name) {
      errors.push(`Line ${n}: expected "skill: Name, Name" or "Name: skill", e.g. "3: Anna, Ben"`);
      return;
    }
    const skill = skillOf(line.slice(colon + 1).trim());
    if (!skill) {
      errors.push(`Line ${n}: skill must be a whole number from 1 to 10 ("${line}")`);
      return;
    }
    add(name, skill);
  });
  return { players, errors };
}

// Tournament players: { id, personId?, name, skill, birthYear? }; ids are p1, p2, ...
function numberPlayers(players) {
  const names = new Set();
  for (const p of players) {
    if (names.has(p.name.trim().toLowerCase())) throw new Error(`The name "${p.name}" is used twice`);
    names.add(p.name.trim().toLowerCase());
  }
  return players.map((p, i) => ({
    id: `p${i + 1}`, ...(p.personId ? { personId: p.personId } : {}), name: p.name, skill: p.skill, ...(p.birthYear != null ? { birthYear: p.birthYear } : {}),
  }));
}

function initialReveal(settings) {
  return settings.revealBatch === 'all' ? settings.rounds : Math.min(settings.rounds, settings.revealBatch);
}

function drawSchedule(players, settings, seed) {
  const { courts, rounds, lastRoundCourts } = settings;
  return generateSchedule({ players, courts, rounds, lastRoundCourts, seed }).schedule;
}

export function createTournament({ id, name, players, settings, seed, now }) {
  const withIds = numberPlayers(players);
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
  checkOpen(t);
  const { rounds, revealBatch } = t.settings;
  const step = revealBatch === 'all' ? rounds : revealBatch;
  return { ...t, revealedRounds: Math.min(rounds, t.revealedRounds + step) };
}

export function hasResults(t) {
  return Object.keys(t.results).length > 0;
}

export function redraw(t, seed) {
  checkOpen(t);
  if (hasResults(t)) throw new Error('Cannot redraw after results have been entered');
  // Without results, players who withdrew earlier have nothing left to keep.
  const players = t.players.filter(isActive);
  return { ...t, players, seed, schedule: drawSchedule(players, t.settings, seed), revealedRounds: initialReveal(t.settings) };
}

// New name, players or settings for a tournament that has not started: draws a new
// schedule and keeps id and creation date.
export function updateSettings(t, { name, players, settings }, seed) {
  checkOpen(t);
  if (hasResults(t)) throw new Error('Cannot change settings after results have been entered');
  const withIds = numberPlayers(players);
  return {
    ...t,
    version: FORMAT_VERSION,
    name,
    settings: { ...settings },
    players: withIds,
    seed,
    schedule: drawSchedule(withIds, settings, seed),
    revealedRounds: initialReveal(settings),
    results: {},
  };
}

// A finished tournament (`finishedAt`) is locked: no results, swaps, reveals, withdrawals or
// redraws until it is reopened. Names can still be corrected.
export function isFinished(t) {
  return Boolean(t.finishedAt);
}

function checkOpen(t) {
  if (isFinished(t)) throw new Error('This tournament is finished. Reopen it in Manage to change it.');
}

export function finishTournament(t, now) {
  checkOpen(t);
  return { ...t, finishedAt: now.toISOString() };
}

export function reopenTournament(t) {
  const { finishedAt, ...rest } = t;
  return rest;
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
  checkOpen(t);
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

// The tournament name can change at any time.
export function renameTournament(t, name) {
  const trimmed = String(name).trim();
  if (!trimmed) throw new Error('The tournament name cannot be empty');
  return { ...t, name: trimmed };
}

// Swaps two players within a round: between the teams of a match, between courts, or
// with a player who sits out. Matches that already have a result cannot change.
export function swapPlayers(t, round, a, b) {
  checkOpen(t);
  const r = t.schedule[round - 1];
  if (!r) throw new Error(`Unknown round ${round}`);
  if (round > t.revealedRounds) throw new Error('Only revealed rounds can be changed');
  if (a === b) throw new Error('Choose two different players');
  const where = (id) => {
    const m = r.matches.find((x) => x.team1.includes(id) || x.team2.includes(id));
    if (m) return { m };
    if (r.sitOuts.includes(id)) return { m: null };
    throw new Error(`Player ${id} is not in round ${round}`);
  };
  for (const { m } of [where(a), where(b)]) {
    if (m && t.results[resultKey(round, m.court)]) throw new Error(`Court ${m.court} already has a result`);
  }
  const swap = (id) => (id === a ? b : id === b ? a : id);
  const changed = {
    ...r,
    matches: r.matches.map((m) => ({ ...m, team1: m.team1.map(swap), team2: m.team2.map(swap) })),
    sitOuts: r.sitOuts.map(swap),
  };
  return { ...t, schedule: t.schedule.map((x, i) => (i === round - 1 ? changed : x)) };
}

// Player `a` as tapped in round `roundA` and `b` in round `roundB`: they trade places in
// both rounds, so nobody appears twice in a round. The same round is a single swap.
export function swapPlayersAcross(t, roundA, a, roundB, b) {
  const once = swapPlayers(t, roundA, a, b);
  return roundA === roundB ? once : swapPlayers(once, roundB, a, b);
}

export function setResult(t, round, court, winner) {
  checkOpen(t);
  const exists = t.schedule[round - 1]?.matches.some((m) => m.court === court);
  if (!exists) throw new Error(`Unknown match: round ${round}, court ${court}`);
  const results = { ...t.results };
  const key = resultKey(round, court);
  if (winner === null) delete results[key];
  else results[key] = winner;
  return { ...t, results };
}
