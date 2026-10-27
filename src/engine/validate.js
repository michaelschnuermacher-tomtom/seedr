import { scaleOf, scaleProblem, isSkill } from './scale.js';

const isInt = (v) => Number.isInteger(v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function fail(message) {
  throw new Error(message);
}

export function validateTournament(value) {
  try {
    checkTournament(value);
    return { ok: true, tournament: value };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function checkTournament(t) {
  if (!isObject(t) || !('version' in t)) fail('This is not a Seedr tournament file');
  // Tournaments linked to people in place kept version 1; their content is the same as 2.
  if (t.version !== 1 && t.version !== 2) fail(`Unsupported file version: ${t.version}`);
  if (typeof t.id !== 'string' || !t.id) fail('Missing tournament id');
  if (typeof t.name !== 'string') fail('Missing tournament name');
  if (typeof t.createdAt !== 'string') fail('Missing creation date');
  if ('finishedAt' in t && typeof t.finishedAt !== 'string') fail('Invalid finishing date');
  checkSettings(t.settings);
  const ids = checkPlayers(t.players, scaleOf(t.settings));
  if (!isInt(t.seed)) fail('Invalid seed');
  checkSchedule(t.schedule, t.settings, ids);
  if (!isInt(t.revealedRounds) || t.revealedRounds < 0 || t.revealedRounds > t.settings.rounds) fail('Invalid number of revealed rounds');
  checkResults(t.results, t.schedule);
  if ('scores' in t) checkScores(t.scores, t.results);
}

function checkSettings(s) {
  if (!isObject(s)) fail('Missing settings');
  if (!isInt(s.courts) || s.courts < 1) fail('Invalid number of courts');
  if (!isInt(s.rounds) || s.rounds < 1) fail('Invalid number of rounds');
  if (!isInt(s.matchMinutes) || s.matchMinutes < 1) fail('Invalid match length');
  if (!isInt(s.breakMinutes) || s.breakMinutes < 0) fail('Invalid break length');
  if (!(s.revealBatch === 'all' || (isInt(s.revealBatch) && s.revealBatch >= 1))) fail('Invalid reveal batch');
  if ('scale' in s && scaleProblem(s.scale)) fail(scaleProblem(s.scale));
  if ('lastRoundCourts' in s && (!isInt(s.lastRoundCourts) || s.lastRoundCourts < 1 || s.lastRoundCourts >= s.courts)) fail('Invalid number of courts in the last round');
}

function checkPlayers(players, scale) {
  if (!Array.isArray(players) || players.length < 4) fail('At least 4 players are required');
  // A player refers to a person (personId); name and year of birth belong to the person.
  // Players without a person (tests) have a name instead.
  const ids = new Map();
  const people = new Set();
  const names = new Set();
  for (const p of players) {
    if (!isObject(p) || typeof p.id !== 'string') fail('Invalid player entry');
    const label = p.name ?? p.id;
    if ('personId' in p && (typeof p.personId !== 'string' || !p.personId)) fail(`Invalid player link for ${label}`);
    if (!p.personId && (typeof p.name !== 'string' || !p.name.trim())) fail('Invalid player entry');
    if (!isSkill(p.skill, scale)) fail(`Invalid skill for ${label}`);
    if (ids.has(p.id)) fail(`Duplicate player id ${p.id}`);
    if (p.personId && people.has(p.personId)) fail(`The same player appears twice (${label})`);
    if (!p.personId) {
      const key = p.name.trim().toLowerCase();
      if (names.has(key)) fail(`Duplicate player name ${p.name}`);
      names.add(key);
    }
    if ('birthYear' in p && (!isInt(p.birthYear) || p.birthYear < 1900 || p.birthYear > 2100)) fail(`Invalid year of birth for ${label}`);
    if ('withdrawnAfter' in p &&(!isInt(p.withdrawnAfter) || p.withdrawnAfter < 0)) fail(`Invalid withdrawal for ${label}`);
    ids.set(p.id, p.withdrawnAfter ?? Infinity);
    if (p.personId) people.add(p.personId);
  }
  return ids;
}

// `lastRound` maps each player id to the last round the player is part of.
function checkSchedule(schedule, settings, lastRound) {
  if (!Array.isArray(schedule) || schedule.length !== settings.rounds) fail('Schedule does not match the number of rounds');
  schedule.forEach((r, i) => {
    const label = `round ${i + 1}`;
    if (!isObject(r) || r.round !== i + 1 || !Array.isArray(r.matches) || !Array.isArray(r.sitOuts)) fail(`Invalid ${label}`);
    const ids = new Set([...lastRound].filter(([, last]) => last > i).map(([id]) => id));
    const seen = new Set();
    const courts = new Set();
    const use = (pid) => {
      if (!lastRound.has(pid)) fail(`Unknown player in ${label}`);
      if (!ids.has(pid)) fail(`Withdrawn player in ${label}`);
      if (seen.has(pid)) fail(`Player appears twice in ${label}`);
      seen.add(pid);
    };
    const maxCourt = i === schedule.length - 1 ? settings.lastRoundCourts ?? settings.courts : settings.courts;
    for (const m of r.matches) {
      if (!isObject(m) || !isInt(m.court) || m.court < 1 || m.court > maxCourt || courts.has(m.court)) fail(`Invalid court in ${label}`);
      courts.add(m.court);
      if (!Array.isArray(m.team1) || m.team1.length !== 2 || !Array.isArray(m.team2) || m.team2.length !== 2) fail(`Invalid team in ${label}`);
      [...m.team1, ...m.team2].forEach(use);
    }
    r.sitOuts.forEach(use);
    if (seen.size !== ids.size) fail(`${label} does not include every player`);
  });
}

// Scores belong to matches with a result: sets of two whole numbers, not equal.
function checkScores(scores, results) {
  if (!isObject(scores)) fail('Invalid scores');
  for (const [key, sets] of Object.entries(scores)) {
    if (!(key in results)) fail(`Score for a match without a result ${key}`);
    if (!Array.isArray(sets) || sets.length === 0) fail(`Invalid score for match ${key}`);
    for (const set of sets) {
      if (!Array.isArray(set) || set.length !== 2 || !set.every((x) => isInt(x) && x >= 0) || set[0] === set[1]) fail(`Invalid set in match ${key}`);
    }
  }
}

function checkResults(results, schedule) {
  if (!isObject(results)) fail('Invalid results');
  for (const [key, winner] of Object.entries(results)) {
    const m = /^(\d+)-(\d+)$/.exec(key);
    const round = m && schedule[Number(m[1]) - 1];
    if (!round || !round.matches.some((x) => x.court === Number(m[2]))) fail(`Result for unknown match ${key}`);
    if (winner !== 1 && winner !== 2) fail(`Invalid result for match ${key}`);
  }
}
