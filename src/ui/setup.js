import { h, newId } from './dom.js';
import { logoDataUrl } from './logo.js';
import { parsePlayers, createTournament, updateSettings, isActive } from '../engine/tournament.js';
import { recommendOptions, gamesPerPlayer, describeGames } from '../engine/timeplan.js';
import { sortPeople } from '../engine/people.js';
import { scaleOf, scaleProblem, levels, isSkill, describeScale, SCALE_LIMITS } from '../engine/scale.js';
import { newSeed } from '../engine/rng.js';

// The regular group: the first people on a new device.
export const DEFAULT_PLAYERS = `1: Markus, Seb, Micha
3: Uta, Vera
4: Gesa, Henri, Lia
5: Felix, Jenny, Mickey
6: Ada, Hugo, Bianca
7: Basti
8: Max
9: Anne`;

// The default players as people (for a device without any, and for the tests). Skills
// belong to tournaments, so the people have none.
export function defaultPeople() {
  return parsePlayers(DEFAULT_PLAYERS).players.map((p, i) => ({ id: `default-${i + 1}`, name: p.name }));
}

// The setup is a sequence of decisions; each step appears once the one before is made:
// name, skill scale, players per skill, courts and break, total time, rounds, reveal mode.
// `picks` are the chosen players in the order they were added: { personId, skill }.
// `extraLevels` are skill levels added by hand (large scales only show levels in use).
export function newDraft() {
  return {
    name: '',
    scaleMin: null,
    scaleMax: null,
    best: null,
    picks: [],
    extraLevels: [],
    courts: 2,
    totalMinutes: 240,
    breakMinutes: 5,
    selectedRounds: null,
    lastRoundCourts: null,
    revealBatch: null,
  };
}

// Setup form for changing a tournament that has not started: everything filled in. The
// total time is set so that the current rounds × match length is one of the options.
export function draftFromTournament(t) {
  const s = t.settings;
  const scale = scaleOf(s);
  return {
    ...newDraft(),
    editingId: t.id,
    name: t.name,
    scaleMin: scale.min,
    scaleMax: scale.max,
    best: scale.best,
    picks: t.players.filter(isActive).map((p) => ({ personId: p.personId ?? p.id, skill: p.skill })),
    courts: s.courts,
    breakMinutes: s.breakMinutes,
    totalMinutes: s.rounds * (s.matchMinutes + s.breakMinutes),
    selectedRounds: s.rounds,
    lastRoundCourts: s.lastRoundCourts ?? null,
    revealBatch: s.revealBatch,
  };
}

export function draftScale(d) {
  const scale = { min: d.scaleMin, max: d.scaleMax, best: d.best };
  return scaleProblem(scale) ? null : scale;
}

// Small scales show every level; larger ones only the levels in use or added by hand.
const SHOW_ALL_LEVELS = 11;

export function shownLevels(d, scale) {
  const all = levels(scale);
  if (all.length <= SHOW_ALL_LEVELS) return all;
  const used = new Set([...d.picks.map((p) => p.skill), ...d.extraLevels]);
  return all.filter((skill) => used.has(skill));
}

const isWhole = (v, min) => Number.isInteger(v) && v >= min;

// The players, the plan, what is still missing, and how far the steps are done (`steps`,
// in order; a step is shown once all before it are done).
export function evaluateDraft(d, people = []) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const scale = draftScale(d);
  const picks = scale ? d.picks.filter((p) => isSkill(p.skill, scale)) : [];
  const players = picks.map((p) => {
    const person = byId.get(p.personId);
    return { personId: p.personId, name: person?.name ?? p.personId, skill: p.skill, ...(person?.birthYear != null ? { birthYear: person.birthYear } : {}) };
  });
  const steps = { name: d.name.trim() !== '', scale: Boolean(scale), players: players.length >= 4 };
  steps.courts = isWhole(d.courts, 1) && isWhole(d.breakMinutes, 0);
  let options = [];
  let plan = null;
  if (steps.players && steps.courts && isWhole(d.totalMinutes, 1)) {
    options = recommendOptions({ players: players.length, courts: d.courts, totalMinutes: d.totalMinutes, breakMinutes: d.breakMinutes });
    const chosen = options.find((o) => o.rounds === d.selectedRounds && (o.lastRoundCourts ?? null) === (d.lastRoundCourts ?? null));
    if (chosen) plan = { rounds: chosen.rounds, matchMinutes: chosen.matchMinutes, ...(chosen.lastRoundCourts ? { lastRoundCourts: chosen.lastRoundCourts } : {}) };
  }
  steps.time = options.length > 0;
  steps.plan = Boolean(plan);
  steps.reveal = d.revealBatch != null;
  const problems = [];
  if (!steps.name) problems.push('Give the tournament a name.');
  if (!steps.scale) problems.push(scaleProblem({ min: d.scaleMin, max: d.scaleMax, best: d.best }) ?? 'Choose the skill scale.');
  if (!steps.players) problems.push('Choose at least 4 players.');
  if (!isWhole(d.courts, 1)) problems.push('Courts must be a whole number of at least 1.');
  if (!isWhole(d.breakMinutes, 0)) problems.push('Break must be a whole number of minutes (0 or more).');
  if (steps.players && steps.courts && !isWhole(d.totalMinutes, 1)) problems.push('Total time must be a whole number of minutes.');
  else if (steps.players && steps.courts && !steps.time) problems.push('Not enough time for even one round of at least 5 minutes.');
  if (steps.time && !steps.plan) problems.push('Choose rounds and match length.');
  if (!steps.reveal) problems.push('Choose how many rounds are revealed at a time.');
  const games = plan ? gamesPerPlayer(players.length, d.courts, plan.rounds, plan.lastRoundCourts) : null;
  return { players, scale, steps, problems, options, plan, games };
}

function field(label, input) {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function selectInput(value, choices, onchange) {
  const select = h('select', { onchange }, choices.map(([v, label]) => h('option', { value: v }, label)));
  select.value = String(value ?? '');
  return select;
}

// Players per skill level: one dropdown per chosen player, and an empty one to add the
// next. Only players not chosen yet are offered.
function playersStep(ctx, d, scale, people) {
  const known = sortPeople(people);
  const chosen = new Set(d.picks.map((p) => p.personId));
  const free = known.filter((p) => !chosen.has(p.id));
  const name = (id) => known.find((p) => p.id === id)?.name ?? id;
  const level = (skill) => {
    const here = d.picks.filter((p) => p.skill === skill);
    const pickSelect = (pick) => selectInput(pick.personId, [[pick.personId, name(pick.personId)], ...free.map((p) => [p.id, p.name])], (e) => {
      pick.personId = e.target.value;
      ctx.render();
    });
    const addSelect = free.length ? selectInput('', [['', here.length ? 'Add another…' : 'Add player…'], ...free.map((p) => [p.id, p.name])], (e) => {
      if (!e.target.value) return;
      d.picks.push({ personId: e.target.value, skill });
      ctx.render();
    }) : null;
    return h('div', { class: 'level' },
      h('div', { class: 'level-label' }, `Skill ${skill}`),
      h('div', { class: 'level-picks' },
        here.map((pick) => h('div', { class: 'level-pick' }, pickSelect(pick),
          h('button', { class: 'small', title: 'Remove', 'aria-label': `Remove ${name(pick.personId)}`, onclick: () => { d.picks.splice(d.picks.indexOf(pick), 1); ctx.render(); } }, '✕'))),
        addSelect));
  };
  const shown = shownLevels(d, scale);
  const missing = levels(scale).filter((skill) => !shown.includes(skill));
  const addLevel = levels(scale).length > SHOW_ALL_LEVELS && missing.length
    ? field('Add a skill level', selectInput('', [['', 'Choose…'], ...missing.map((skill) => [skill, `Skill ${skill}`])], (e) => {
      if (e.target.value === '') return;
      d.extraLevels.push(Number(e.target.value));
      ctx.render();
    }))
    : null;
  return [
    h('p', { class: 'muted' }, `${describeScale(scale)} Choose the players of each level; a new dropdown appears for the next one. ${d.picks.length} chosen.`),
    h('div', { class: 'levels' }, shown.map(level)),
    addLevel,
    h('div', { class: 'actions' },
      h('button', { class: 'small', onclick: () => { ctx.state.peopleReturn = 'setup'; ctx.go('people'); } }, 'Add or edit players…')),
  ];
}

export function setupScreen(ctx) {
  const d = (ctx.state.draft ??= newDraft());
  const people = ctx.people();
  // People deleted meanwhile drop out of the picks.
  d.picks = d.picks.filter((p) => people.some((x) => x.id === p.personId));
  const preview = h('section', { class: 'preview' });
  const planBox = h('div', {});
  const ev0 = evaluateDraft(d, people);
  const numberInput = (key, min, max) => h('input', {
    type: 'number', min, max, step: 1, inputmode: 'numeric', value: d[key] ?? '',
    oninput: (e) => { d[key] = e.target.value === '' ? null : Number(e.target.value); refresh(); },
  });

  const card = (title, color, ...children) => h('section', { class: `card accent-${color}` }, h('h2', { class: 'card-title' }, title), ...children);
  const nameCard = card('Tournament', 'ao',
    field('Name', h('input', { type: 'text', value: d.name, placeholder: 'Club night', oninput: (e) => { d.name = e.target.value; refresh(); } })));
  // The scale only takes effect when a field is left (change), so typing keeps the focus.
  const scaleInput = (key, min, max) => {
    const input = numberInput(key, min, max);
    input.addEventListener('change', () => ctx.render());
    return input;
  };
  const scaleCard = card('Skill scale', 'uso',
    h('p', { class: 'muted' }, `Any range from ${SCALE_LIMITS.min} to ${SCALE_LIMITS.max}, e.g. 1–5 or 1–10.`),
    h('div', { class: 'row' },
      field('Lowest skill', scaleInput('scaleMin', SCALE_LIMITS.min, SCALE_LIMITS.max)),
      field('Highest skill', scaleInput('scaleMax', SCALE_LIMITS.min, SCALE_LIMITS.max))),
    field('Which is better?', selectInput(d.best, [['', 'Choose…'], ['low', 'Lower is better'], ['high', 'Higher is better']], (e) => {
      d.best = e.target.value || null;
      ctx.render();
    })));
  const playersCard = card('Players', 'wim', ev0.scale ? playersStep(ctx, d, ev0.scale, people) : null);
  const courtsField = h('div', { class: 'row' },
    field('Courts', numberInput('courts', 1)),
    field('Break between rounds (min)', numberInput('breakMinutes', 0)));
  const timeField = field('Total tournament time (min)', numberInput('totalMinutes', 1));
  const timeCard = card('Courts & time', 'rg', courtsField, timeField, planBox);
  const revealCard = card('Draw', 'uso',
    field('Rounds revealed at a time', selectInput(d.revealBatch,
      [['', 'Choose…'], ['all', 'All (whole schedule in advance)'], ['1', '1 (surprise)'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']],
      (e) => { d.revealBatch = e.target.value === '' ? null : e.target.value === 'all' ? 'all' : Number(e.target.value); refresh(); })));

  // Shows each step once the ones before are done.
  const refresh = () => {
    const ev = evaluateDraft(d, people);
    const s = ev.steps;
    const order = [s.name, s.scale, s.players, s.courts, s.time, s.plan, s.reveal];
    const reached = order.findIndex((done) => !done); // the first open step (-1: all done)
    const upTo = (i) => reached === -1 || i <= reached;
    scaleCard.hidden = !upTo(1);
    playersCard.hidden = !upTo(2) || !ev.scale;
    timeCard.hidden = !upTo(3);
    timeField.hidden = !upTo(4);
    planBox.hidden = !upTo(5);
    revealCard.hidden = !upTo(6);
    planBox.replaceChildren(planField(d, ev, refresh));
    preview.replaceChildren(...setupPreview(ctx, d, ev, reached === -1));
  };

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
    h('div', { class: 'form' }, nameCard, scaleCard, playersCard, timeCard, revealCard),
    preview);
}

// Rounds and match length come only from the options that fit the total time, best first.
// An option is "rounds" or "rounds/courts in the last round".
const optionKey = (rounds, lastRoundCourts) => (lastRoundCourts ? `${rounds}/${lastRoundCourts}` : String(rounds));

function planField(d, ev, refresh) {
  const label = (o) => `${o.rounds} rounds${o.lastRoundCourts ? ` (last round on ${courtsText(o.lastRoundCourts)})` : ''}`
    + ` × ${o.matchMinutes} min + ${o.breakMinutes} min break = ${o.totalMinutes} min · `
    + describeGames(ev.players.length, d.courts, o.rounds, o.lastRoundCourts);
  const choices = [['', 'Choose…'], ...ev.options.map((o) => [optionKey(o.rounds, o.lastRoundCourts), label(o)])];
  const select = selectInput(ev.plan ? optionKey(d.selectedRounds, d.lastRoundCourts) : '', choices, (e) => {
    const [rounds, last] = e.target.value.split('/');
    d.selectedRounds = rounds ? Number(rounds) : null;
    d.lastRoundCourts = last ? Number(last) : null;
    refresh();
  });
  return field('Rounds and match length', select);
}

const courtsText = (n) => `${n} court${n === 1 ? '' : 's'}`;

// Below the steps: once all are done, what the plan means and the Draw button; Cancel always.
function setupPreview(ctx, d, ev, complete) {
  const out = [];
  if (complete && ev.games) {
    out.push(h('p', { class: 'muted' }, `${ev.players.length} players.`));
    const games = describeGames(ev.players.length, d.courts, ev.plan.rounds, ev.plan.lastRoundCourts);
    out.push(ev.games.even
      ? h('p', { class: 'ok' }, `Even: ${games}.`)
      : h('p', { class: 'warning' }, `Uneven: ${games}. Players with fewer games get 0.5 points per missing game. Who plays fewer is drawn at random; Manage → Swap players can change it later.`));
    if (ev.plan.lastRoundCourts) out.push(h('p', { class: 'muted' }, `The last round uses only ${courtsText(ev.plan.lastRoundCourts)}, so the games come out more even.`));
  } else if (d.editingId && ev.problems.length) {
    out.push(h('ul', { class: 'problems' }, ev.problems.map((p) => h('li', {}, p))));
  }
  out.push(h('div', { class: 'actions' },
    h('button', { onclick: () => cancelSetup(ctx) }, 'Cancel'),
    complete ? h('button', {
      class: 'primary',
      onclick: (e) => {
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Drawing…';
        setTimeout(() => createFromDraft(ctx, d, ev), 20); // let the browser paint "Drawing…" first
      },
    }, d.editingId ? 'Save and redraw' : 'Draw schedule') : null));
  return out;
}

function cancelSetup(ctx) {
  const editing = ctx.state.draft?.editingId && ctx.store.get(ctx.state.draft.editingId);
  ctx.state.draft = null;
  if (editing) ctx.open(editing);
  else ctx.go('home');
}

function createFromDraft(ctx, d, ev) {
  const settings = { courts: d.courts, rounds: ev.plan.rounds, matchMinutes: ev.plan.matchMinutes, breakMinutes: d.breakMinutes, revealBatch: d.revealBatch,
    scale: ev.scale, ...(ev.plan.lastRoundCourts ? { lastRoundCourts: ev.plan.lastRoundCourts } : {}) };
  const editing = d.editingId && ctx.store.get(d.editingId);
  let t;
  try {
    t = editing
      ? updateSettings(editing, { name: d.name.trim(), players: ev.players, settings }, newSeed())
      : createTournament({ id: newId(), name: d.name.trim(), players: ev.players, settings, seed: newSeed(), now: new Date() });
  } catch (e) {
    ctx.state.draft = null;
    ctx.flash(e.message); // e.g. a result was entered in another tab meanwhile
    return;
  }
  ctx.state.draft = null;
  ctx.save(t);
  ctx.open(t);
}
