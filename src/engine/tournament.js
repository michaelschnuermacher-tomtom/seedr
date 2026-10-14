import { generateSchedule } from './schedule.js';
import { resultKey } from './standings.js';

export const FORMAT_VERSION = 1;

// One player per line: "Name: skill". The last ":" separates, so names may contain
// spaces, commas and other punctuation.
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
    const skillText = line.slice(colon + 1).trim();
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
    players.push({ name, skill });
  });
  return { players, errors };
}

function initialReveal(settings) {
  return settings.revealBatch === 'all' ? settings.rounds : Math.min(settings.rounds, settings.revealBatch);
}

function drawSchedule(players, settings, seed) {
  return generateSchedule({ players, courts: settings.courts, rounds: settings.rounds, seed }).schedule;
}

export function createTournament({ id, name, players, settings, seed, now }) {
  const withIds = players.map((p, i) => ({ id: `p${i + 1}`, name: p.name, skill: p.skill }));
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
  return { ...t, seed, schedule: drawSchedule(t.players, t.settings, seed), revealedRounds: initialReveal(t.settings) };
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
