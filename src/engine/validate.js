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
  if (t.version !== 1) fail(`Unsupported file version: ${t.version}`);
  if (typeof t.id !== 'string' || !t.id) fail('Missing tournament id');
  if (typeof t.name !== 'string') fail('Missing tournament name');
  if (typeof t.createdAt !== 'string') fail('Missing creation date');
  checkSettings(t.settings);
  const ids = checkPlayers(t.players);
  if (!isInt(t.seed)) fail('Invalid seed');
  checkSchedule(t.schedule, t.settings, ids);
  if (!isInt(t.revealedRounds) || t.revealedRounds < 0 || t.revealedRounds > t.settings.rounds) fail('Invalid number of revealed rounds');
  checkResults(t.results, t.schedule);
}

function checkSettings(s) {
  if (!isObject(s)) fail('Missing settings');
  if (!isInt(s.courts) || s.courts < 1) fail('Invalid number of courts');
  if (!isInt(s.rounds) || s.rounds < 1) fail('Invalid number of rounds');
  if (!isInt(s.matchMinutes) || s.matchMinutes < 1) fail('Invalid match length');
  if (!isInt(s.breakMinutes) || s.breakMinutes < 0) fail('Invalid break length');
  if (!(s.revealBatch === 'all' || (isInt(s.revealBatch) && s.revealBatch >= 1))) fail('Invalid reveal batch');
}

function checkPlayers(players) {
  if (!Array.isArray(players) || players.length < 4) fail('At least 4 players are required');
  const ids = new Map();
  const names = new Set();
  for (const p of players) {
    if (!isObject(p) || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim()) fail('Invalid player entry');
    if (!isInt(p.skill) || p.skill < 1 || p.skill > 10) fail(`Invalid skill for ${p.name}`);
    if (ids.has(p.id)) fail(`Duplicate player id ${p.id}`);
    const key = p.name.trim().toLowerCase();
    if (names.has(key)) fail(`Duplicate player name ${p.name}`);
    if ('withdrawnAfter' in p && (!isInt(p.withdrawnAfter) || p.withdrawnAfter < 0)) fail(`Invalid withdrawal for ${p.name}`);
    ids.set(p.id, p.withdrawnAfter ?? Infinity);
    names.add(key);
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
    for (const m of r.matches) {
      if (!isObject(m) || !isInt(m.court) || m.court < 1 || m.court > settings.courts || courts.has(m.court)) fail(`Invalid court in ${label}`);
      courts.add(m.court);
      if (!Array.isArray(m.team1) || m.team1.length !== 2 || !Array.isArray(m.team2) || m.team2.length !== 2) fail(`Invalid team in ${label}`);
      [...m.team1, ...m.team2].forEach(use);
    }
    r.sitOuts.forEach(use);
    if (seen.size !== ids.size) fail(`${label} does not include every player`);
  });
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
