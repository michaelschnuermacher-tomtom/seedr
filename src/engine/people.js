import { validateTournament } from './validate.js';

// The people known on this device, shared by all tournaments: { id, name, birthYear?,
// lastSkill? }. A tournament keeps a copy of name and year of birth for each player (so it
// stays readable on its own and in a backup) and a link to the person (`personId`).
// Changes to a person are copied into every tournament, old ones included.

export const BACKUP_FORMAT = 'seedr-backup';
export const BACKUP_VERSION = 2;

const key = (name) => String(name).trim().toLowerCase();
const byName = (a, b) => a.name.localeCompare(b.name);

// Problems with a person's name or year of birth, or null. Names must be unique.
export function personProblem(people, { id, name, birthYear }, now = new Date()) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'The name cannot be empty.';
  if (people.some((p) => p.id !== id && key(p.name) === key(trimmed))) return `There is already a player called "${trimmed}".`;
  if (birthYear != null && !(Number.isInteger(birthYear) && birthYear >= 1900 && birthYear <= now.getFullYear())) {
    return `The year of birth must be between 1900 and ${now.getFullYear()}.`;
  }
  return null;
}

function cleanPerson(person) {
  const { birthYear, lastSkill, ...rest } = person;
  return { ...rest, name: rest.name.trim(), ...(birthYear != null ? { birthYear } : {}), ...(lastSkill != null ? { lastSkill } : {}) };
}

export function sortPeople(people) {
  return [...people].sort(byName);
}

export function addPerson(people, { name, birthYear = null }, newId) {
  const problem = personProblem(people, { name, birthYear });
  if (problem) throw new Error(problem);
  const person = cleanPerson({ id: newId(), name, birthYear });
  return { people: [...people, person], person };
}

// The tournaments a person plays in.
export function usage(tournaments, id) {
  return tournaments.filter((t) => t.players.some((p) => p.personId === id));
}

// Copies name and year of birth of the linked people into a tournament. Returns the same
// object when nothing changes.
export function syncTournament(t, people) {
  const byId = new Map(people.map((p) => [p.id, p]));
  let changed = false;
  const players = t.players.map((p) => {
    const person = p.personId && byId.get(p.personId);
    if (!person || (person.name === p.name && person.birthYear === p.birthYear)) return p;
    changed = true;
    const { birthYear, ...rest } = p;
    return { ...rest, name: person.name, ...(person.birthYear != null ? { birthYear: person.birthYear } : {}) };
  });
  return changed ? { ...t, players } : t;
}

// New name and year of birth for a person; returns the people and the tournaments that
// changed (to be saved).
export function updatePerson(people, tournaments, id, { name, birthYear = null }) {
  if (!people.some((p) => p.id === id)) throw new Error('Unknown player');
  const problem = personProblem(people, { id, name, birthYear });
  if (problem) throw new Error(problem);
  const next = people.map((p) => (p.id === id ? cleanPerson({ ...p, name, birthYear }) : p));
  const changed = tournaments.map((t) => syncTournament(t, next)).filter((t, i) => t !== tournaments[i]);
  return { people: next, tournaments: changed };
}

// A person can only be deleted while they play in no tournament.
export function deletePerson(people, tournaments, id) {
  if (usage(tournaments, id).length) throw new Error('This player is part of a tournament and cannot be deleted.');
  return people.filter((p) => p.id !== id);
}

// Two different people who ended up as one (e.g. two "Max"): the chosen tournaments get a
// new person of their own.
export function splitPerson(people, tournaments, id, tournamentIds, { name, birthYear = null }, newId) {
  const chosen = new Set(tournamentIds);
  if (chosen.size === 0) throw new Error('Choose at least one tournament.');
  const { people: next, person } = addPerson(people, { name, birthYear }, newId);
  const changed = tournaments.filter((t) => chosen.has(t.id)).map((t) => syncTournament({
    ...t, players: t.players.map((p) => (p.personId === id ? { ...p, personId: person.id } : p)),
  }, next));
  return { people: next, person, tournaments: changed };
}

// Links the players of a tournament without a person to the person with the same name,
// or to a new one. Returns the linked tournament and the (possibly larger) people list.
export function linkTournament(t, people, newId) {
  let list = people;
  const players = t.players.map((p) => {
    if (p.personId && list.some((x) => x.id === p.personId)) return p;
    let person = list.find((x) => key(x.name) === key(p.name));
    if (!person) {
      person = cleanPerson({ id: newId(), name: p.name, birthYear: p.birthYear ?? null });
      list = [...list, person];
    }
    return { ...p, personId: person.id };
  });
  return { t: syncTournament({ ...t, players }, list), people: list };
}

// Remembers each player's skill, to suggest it for the next tournament.
export function rememberSkills(people, players) {
  const skills = new Map(players.filter((p) => p.personId).map((p) => [p.personId, p.skill]));
  return people.map((p) => (skills.has(p.id) ? { ...p, lastSkill: skills.get(p.id) } : p));
}

export function makeBackup(people, tournaments, now = new Date()) {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), people, tournaments };
}

// Reads an imported backup file.
export function readBackup(value) {
  if (value?.format !== BACKUP_FORMAT) throw new Error('This is not a Seedr backup.');
  if (value.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version: ${value.version}`);
  if (!Array.isArray(value.people) || !Array.isArray(value.tournaments)) throw new Error('This backup is incomplete.');
  const ids = new Set();
  for (const p of value.people) {
    if (typeof p?.id !== 'string' || !p.id || ids.has(p.id)) throw new Error('This backup has an invalid player entry.');
    const problem = personProblem(value.people.filter((x) => x !== p), { id: p.id, name: p.name, birthYear: p.birthYear ?? null });
    if (problem) throw new Error(`Player "${p.name}": ${problem}`);
    ids.add(p.id);
  }
  for (const t of value.tournaments) {
    const check = validateTournament(t);
    if (!check.ok) throw new Error(`Tournament "${t?.name}": ${check.error}`);
  }
  return { people: value.people.map(cleanPerson), tournaments: value.tournaments };
}

// Merges an imported backup into the device. People are matched by id, then by name;
// imported entries replace the ones on the device. Returns everything to save and how many
// existing entries are replaced.
export function mergeBackup(local, incoming, newId) {
  let people = [...local.people];
  const idMap = new Map(); // imported person id → id on this device
  let replacedPeople = 0;
  for (const p of incoming.people) {
    const same = people.find((x) => x.id === p.id) ?? people.find((x) => key(x.name) === key(p.name));
    if (!same) {
      people.push(p);
      idMap.set(p.id, p.id);
      continue;
    }
    idMap.set(p.id, same.id);
    const merged = cleanPerson({ ...same, ...p, id: same.id, birthYear: p.birthYear ?? same.birthYear ?? null });
    if (merged.name !== same.name || merged.birthYear !== same.birthYear) replacedPeople++;
    // A renamed person must not take the name of someone else.
    if (people.some((x) => x.id !== same.id && key(x.name) === key(merged.name))) continue;
    people = people.map((x) => (x.id === same.id ? merged : x));
  }
  const localIds = new Set(local.tournaments.map((t) => t.id));
  const tournaments = [];
  for (const t of incoming.tournaments) {
    const players = t.players.map(({ personId, ...p }) => (personId && idMap.has(personId) ? { ...p, personId: idMap.get(personId) } : p));
    const linked = linkTournament({ ...t, players }, people, newId);
    people = linked.people;
    tournaments.push(linked.t);
  }
  const replacedTournaments = tournaments.filter((t) => localIds.has(t.id)).length;
  // Names may have changed: copy them into the tournaments already on the device.
  for (const t of local.tournaments) {
    if (tournaments.some((x) => x.id === t.id)) continue;
    const synced = syncTournament(t, people);
    if (synced !== t) tournaments.push(synced);
  }
  return { people, tournaments, replaced: { people: replacedPeople, tournaments: replacedTournaments } };
}
