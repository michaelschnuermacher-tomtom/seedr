import { h, newId } from './dom.js';
import { logoDataUrl } from './logo.js';
import { parsePlayers, createTournament, updateSettings, isActive } from '../engine/tournament.js';
import { recommendOptions, gamesPerPlayer, describeGames } from '../engine/timeplan.js';
import { sortPeople, rememberSkills } from '../engine/people.js';
import { newSeed } from '../engine/rng.js';

// The regular group: the first people on a new device, one line per skill.
export const DEFAULT_PLAYERS = `1: Markus, Seb, Micha
3: Uta, Vera
4: Gesa, Henri, Lia
5: Felix, Jenny, Mickey
6: Ada, Hugo, Bianca
7: Basti
8: Max
9: Anne`;

// The default players as people (for a device without any, and for the tests).
export function defaultPeople() {
  return parsePlayers(DEFAULT_PLAYERS).players.map((p, i) => ({ id: `default-${i + 1}`, name: p.name, lastSkill: p.skill }));
}

const DEFAULT_SKILL = 5;

// One row per known person: ticked when they play, with their skill for this tournament.
// `chosen` maps person id → skill.
function rowsFor(people, chosen) {
  return sortPeople(people).map((p) => ({
    personId: p.id, name: p.name, birthYear: p.birthYear ?? null,
    skill: chosen.get(p.id) ?? p.lastSkill ?? DEFAULT_SKILL, selected: chosen.has(p.id),
  }));
}

// A new tournament ticks the players of the most recent one, with their skill there;
// without one, everyone with their last skill.
export function newDraft(people = defaultPeople(), recent = null) {
  const chosen = recent
    ? new Map(recent.players.filter((p) => isActive(p) && p.personId).map((p) => [p.personId, p.skill]))
    : new Map(people.map((p) => [p.id, p.lastSkill ?? DEFAULT_SKILL]));
  return {
    name: '',
    rows: rowsFor(people, chosen),
    courts: 2,
    totalMinutes: 240,
    breakMinutes: 5,
    selectedRounds: null,
    lastRoundCourts: null,
    revealBatch: 'all',
  };
}

// Setup form for changing a tournament that has not started. The total time is set so
// that the tournament's current rounds × match length is one of the offered options.
export function draftFromTournament(t, people = []) {
  const s = t.settings;
  const active = t.players.filter(isActive);
  // Without people (tests), the tournament's own players are the list.
  const known = people.length ? people : t.players.map((p) => ({ id: p.personId ?? p.id, name: p.name, birthYear: p.birthYear }));
  return {
    ...newDraft(known),
    rows: rowsFor(known, new Map(active.map((p) => [p.personId ?? p.id, p.skill]))),
    editingId: t.id,
    name: t.name,
    courts: s.courts,
    breakMinutes: s.breakMinutes,
    totalMinutes: s.rounds * (s.matchMinutes + s.breakMinutes),
    selectedRounds: s.rounds,
    lastRoundCourts: s.lastRoundCourts ?? null,
    revealBatch: s.revealBatch,
  };
}

// Keeps the rows in step with the people (e.g. after adding a player on the Players page):
// names follow, people who are new are added ticked, deleted ones disappear.
export function syncRows(d, people) {
  const old = new Map(d.rows.map((r) => [r.personId, r]));
  d.rows = sortPeople(people).map((p) => {
    const r = old.get(p.id);
    return { personId: p.id, name: p.name, birthYear: p.birthYear ?? null, skill: r?.skill ?? p.lastSkill ?? DEFAULT_SKILL, selected: r ? r.selected : true };
  });
}

const isWhole = (v, min) => Number.isInteger(v) && v >= min;

export function evaluateDraft(d) {
  const players = d.rows.filter((r) => r.selected).map((r) => ({
    personId: r.personId, name: r.name, skill: r.skill, ...(r.birthYear != null ? { birthYear: r.birthYear } : {}),
  }));
  const problems = [];
  if (players.length < 4) problems.push('Tick at least 4 players.');
  if (!isWhole(d.courts, 1)) problems.push('Courts must be a whole number of at least 1.');
  if (!isWhole(d.breakMinutes, 0)) problems.push('Break must be a whole number of minutes (0 or more).');
  let options = [];
  let plan = null;
  if (problems.length === 0) {
    if (!isWhole(d.totalMinutes, 1)) {
      problems.push('Total time must be a whole number of minutes.');
    } else {
      options = recommendOptions({ players: players.length, courts: d.courts, totalMinutes: d.totalMinutes, breakMinutes: d.breakMinutes });
      const chosen = options.find((o) => o.rounds === d.selectedRounds && (o.lastRoundCourts ?? null) === (d.lastRoundCourts ?? null));
      if (options.length === 0) problems.push('Not enough time for even one round of at least 5 minutes.');
      else if (!chosen) problems.push('Choose rounds and match length.');
      else plan = { rounds: chosen.rounds, matchMinutes: chosen.matchMinutes, ...(chosen.lastRoundCourts ? { lastRoundCourts: chosen.lastRoundCourts } : {}) };
    }
  }
  const games = plan ? gamesPerPlayer(players.length, d.courts, plan.rounds, plan.lastRoundCourts) : null;
  return { players, problems, options, plan, games };
}

const SKILLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function field(label, input) {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function selectInput(value, choices, onchange) {
  const select = h('select', { onchange }, choices.map(([v, label]) => h('option', { value: v }, label)));
  select.value = String(value);
  return select;
}

export function setupScreen(ctx) {
  const d = (ctx.state.draft ??= newDraft(ctx.people(), ctx.store.list()[0] ?? null));
  syncRows(d, ctx.people());
  const preview = h('section', { class: 'preview' });
  const planBox = h('div', {});
  const refresh = () => {
    const ev = evaluateDraft(d);
    planBox.replaceChildren(planField(d, ev, refresh));
    preview.replaceChildren(...setupPreview(ctx, d, ev));
  };
  const numberInput = (key, min) => h('input', {
    type: 'number', min, step: 1, inputmode: 'numeric', value: d[key],
    oninput: (e) => { d[key] = e.target.value === '' ? NaN : Number(e.target.value); refresh(); },
  });

  const count = h('span', {});
  const showCount = () => { count.textContent = `${d.rows.filter((r) => r.selected).length} of ${d.rows.length} ticked.`; };
  const pickList = h('div', { class: 'pick-list' }, d.rows.map((row) => {
    const line = h('div', { class: `pick${row.selected ? ' on' : ''}` },
      h('label', { class: 'pick-name' },
        h('input', { type: 'checkbox', checked: row.selected, onchange: (e) => { row.selected = e.target.checked; line.classList.toggle('on', row.selected); showCount(); refresh(); } }),
        h('span', {}, row.name)),
      selectInput(row.skill, SKILLS.map((n) => [String(n), `Skill ${n}`]), (e) => { row.skill = Number(e.target.value); refresh(); }));
    return line;
  }));
  const tickAll = (on) => { d.rows.forEach((r) => { r.selected = on; }); ctx.render(); };
  showCount();

  const card = (title, color, ...children) => h('section', { class: `card accent-${color}` }, h('h2', { class: 'card-title' }, title), ...children);
  const form = h('div', { class: 'form' },
    card('Tournament', 'ao',
      field('Name', h('input', { type: 'text', value: d.name, placeholder: 'Club night', oninput: (e) => { d.name = e.target.value; } }))),
    card('Players', 'wim',
      h('p', { class: 'muted' }, 'Tick who plays and set their skill for this tournament (1 = best, 10 = weakest). ', count),
      pickList,
      h('div', { class: 'actions' },
        h('button', { class: 'small', onclick: () => tickAll(true) }, 'Tick all'),
        h('button', { class: 'small', onclick: () => tickAll(false) }, 'Tick none'),
        h('button', { class: 'small', onclick: () => { ctx.state.peopleReturn = 'setup'; ctx.go('people'); } }, 'Add or edit players…'))),
    card('Courts & time', 'rg',
      h('div', { class: 'row' },
        field('Courts', numberInput('courts', 1)),
        field('Break between rounds (min)', numberInput('breakMinutes', 0))),
      field('Total tournament time (min)', numberInput('totalMinutes', 1)),
      planBox),
    card('Draw', 'uso',
      field('Rounds revealed at a time', selectInput(d.revealBatch,
        [['all', 'All (whole schedule in advance)'], ['1', '1 (surprise)'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']],
        (e) => { d.revealBatch = e.target.value === 'all' ? 'all' : Number(e.target.value); }))),
  );

  refresh();
  return h('main', { class: 'screen' },
    h('header', { class: 'top' },
      h('div', { class: 'titles' },
        h('button', {
          class: 'eyebrow home-link',
          title: 'Home',
          onclick: () => {
            ctx.state.draft = null;
            ctx.go('home');
          },
        }, h('img', { src: logoDataUrl(), alt: '' }), 'Seedr'),
        h('h1', {}, d.editingId ? 'Edit tournament' : 'New tournament'))),
    form,
    preview);
}

// Rounds and match length come only from the options that fit the total time, best first.
// An option is "rounds" or "rounds/courts in the last round".
const optionKey = (rounds, lastRoundCourts) => (lastRoundCourts ? `${rounds}/${lastRoundCourts}` : String(rounds));

function planField(d, ev, refresh) {
  const label = (o) => `${o.rounds} rounds${o.lastRoundCourts ? ` (last round on ${courtsText(o.lastRoundCourts)})` : ''}`
    + ` × ${o.matchMinutes} min + ${o.breakMinutes} min break = ${o.totalMinutes} min · `
    + describeGames(ev.players.length, d.courts, o.rounds, o.lastRoundCourts);
  const choices = [['', ev.options.length ? 'Choose…' : 'Enter players, courts and time first'],
    ...ev.options.map((o) => [optionKey(o.rounds, o.lastRoundCourts), label(o)])];
  const select = selectInput(ev.plan ? optionKey(d.selectedRounds, d.lastRoundCourts) : '', choices, (e) => {
    const [rounds, last] = e.target.value.split('/');
    d.selectedRounds = rounds ? Number(rounds) : null;
    d.lastRoundCourts = last ? Number(last) : null;
    refresh();
  });
  select.disabled = ev.options.length === 0;
  return field('Rounds and match length', select);
}

const courtsText = (n) => `${n} court${n === 1 ? '' : 's'}`;

function setupPreview(ctx, d, ev) {
  const out = [h('p', { class: 'muted' }, `${ev.players.length} players ticked`)];
  if (ev.games) {
    const games = describeGames(ev.players.length, d.courts, ev.plan.rounds, ev.plan.lastRoundCourts);
    out.push(ev.games.even
      ? h('p', { class: 'ok' }, `Even: ${games}.`)
      : h('p', { class: 'warning' }, `Uneven: ${games}. Players with fewer games get 0.5 points per missing game. Who plays fewer is drawn at random; Manage → Swap players can change it later.`));
    if (ev.plan.lastRoundCourts) out.push(h('p', { class: 'muted' }, `The last round uses only ${courtsText(ev.plan.lastRoundCourts)}, so the games come out more even.`));
  }
  if (ev.problems.length) out.push(h('ul', { class: 'problems' }, ev.problems.map((p) => h('li', {}, p))));
  out.push(h('div', { class: 'actions' },
    h('button', { onclick: () => cancelSetup(ctx) }, 'Cancel'),
    h('button', {
      class: 'primary',
      disabled: ev.problems.length > 0,
      onclick: (e) => {
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Drawing…';
        setTimeout(() => createFromDraft(ctx, d, ev), 20); // let the browser paint "Drawing…" first
      },
    }, d.editingId ? 'Save and redraw' : 'Draw schedule')));
  return out;
}

function cancelSetup(ctx) {
  const editing = ctx.state.draft?.editingId && ctx.store.get(ctx.state.draft.editingId);
  ctx.state.draft = null;
  if (editing) ctx.open(editing);
  else ctx.go('home');
}

function createFromDraft(ctx, d, ev) {
  const name = d.name.trim() || 'Tournament';
  const settings = { courts: d.courts, rounds: ev.plan.rounds, matchMinutes: ev.plan.matchMinutes, breakMinutes: d.breakMinutes, revealBatch: d.revealBatch,
    ...(ev.plan.lastRoundCourts ? { lastRoundCourts: ev.plan.lastRoundCourts } : {}) };
  const editing = d.editingId && ctx.store.get(d.editingId);
  let t;
  try {
    t = editing
      ? updateSettings(editing, { name, players: ev.players, settings }, newSeed())
      : createTournament({ id: newId(), name, players: ev.players, settings, seed: newSeed(), now: new Date() });
  } catch (e) {
    ctx.state.draft = null;
    ctx.flash(e.message); // e.g. a result was entered in another tab meanwhile
    return;
  }
  ctx.state.draft = null;
  ctx.save(t);
  ctx.savePeople(rememberSkills(ctx.people(), t.players)); // suggested for the next tournament
  ctx.open(t);
}
