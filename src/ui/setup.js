import { h, newId } from './dom.js';
import { logoDataUrl } from './logo.js';
import { parsePlayers, createTournament, updateSettings, isActive, checkFewer } from '../engine/tournament.js';
import { recommendOptions, gamesPerPlayer, fewerGamesCount } from '../engine/timeplan.js';
import { newSeed } from '../engine/rng.js';

// The regular group, pre-filled for every new tournament.
export const DEFAULT_PLAYERS = `Jenny: 5
Basti: 6
Mickey: 7
Becci: 4
Seb: 1
Anne: 7
Henri: 3
Hugo: 5
Felix: 4
Bianca: 6
Micha: 1
Lia: 3
Ada: 6
Uta: 3
Markus: 1
Vera: 3
Gesa: 3`;

export function newDraft() {
  return {
    name: '',
    playersText: DEFAULT_PLAYERS,
    courts: 2,
    totalMinutes: 240,
    breakMinutes: 5,
    selectedRounds: null,
    revealBatch: 'all',
  };
}

// Setup form for changing a tournament that has not started. The total time is set so
// that the tournament's current rounds × match length is one of the offered options.
export function draftFromTournament(t) {
  const s = t.settings;
  return {
    ...newDraft(),
    editingId: t.id,
    name: t.name,
    playersText: t.players.filter(isActive).map((p) => `${p.name}: ${p.skill}${p.fewer ? ' *' : ''}`).join('\n'),
    courts: s.courts,
    breakMinutes: s.breakMinutes,
    totalMinutes: s.rounds * (s.matchMinutes + s.breakMinutes),
    selectedRounds: s.rounds,
    revealBatch: s.revealBatch,
  };
}

const isWhole = (v, min) => Number.isInteger(v) && v >= min;

export function evaluateDraft(d) {
  const { players, errors } = parsePlayers(d.playersText);
  const problems = [...errors];
  if (players.length < 4) problems.push('Enter at least 4 players.');
  if (!isWhole(d.courts, 1)) problems.push('Courts must be a whole number of at least 1.');
  if (!isWhole(d.breakMinutes, 0)) problems.push('Break must be a whole number of minutes (0 or more).');
  let options = [];
  let plan = null;
  if (problems.length === 0) {
    if (!isWhole(d.totalMinutes, 1)) {
      problems.push('Total time must be a whole number of minutes.');
    } else {
      options = recommendOptions({ players: players.length, courts: d.courts, totalMinutes: d.totalMinutes, breakMinutes: d.breakMinutes });
      const chosen = options.find((o) => o.rounds === d.selectedRounds);
      if (options.length === 0) problems.push('Not enough time for even one round of at least 5 minutes.');
      else if (!chosen) problems.push('Choose rounds and match length.');
      else plan = { rounds: chosen.rounds, matchMinutes: chosen.matchMinutes };
    }
  }
  if (plan) {
    const problem = checkFewer(players, { courts: d.courts, rounds: plan.rounds });
    if (problem) problems.push(problem);
  }
  const games = plan ? gamesPerPlayer(players.length, d.courts, plan.rounds) : null;
  return { players, problems, options, plan, games };
}

function field(label, input) {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function selectInput(value, choices, onchange) {
  const select = h('select', { onchange }, choices.map(([v, label]) => h('option', { value: v }, label)));
  select.value = String(value);
  return select;
}

export function setupScreen(ctx) {
  const d = (ctx.state.draft ??= newDraft());
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

  const playersBox = h('textarea', {
    rows: 10, value: d.playersText, placeholder: 'Anna: 3\nBen Miller: 7\nCarla: 1\nDavid: 5',
    oninput: (e) => { d.playersText = e.target.value; refresh(); },
  });
  const loadPlayers = async (file) => {
    if (!file) return;
    d.playersText = await file.text();
    playersBox.value = d.playersText;
    refresh();
  };

  const card = (title, color, ...children) => h('section', { class: `card accent-${color}` }, h('h2', { class: 'card-title' }, title), ...children);
  const form = h('div', { class: 'form' },
    card('Tournament', 'ao',
      field('Name', h('input', { type: 'text', value: d.name, placeholder: 'Club night', oninput: (e) => { d.name = e.target.value; } }))),
    card('Players', 'wim',
      field('One per line as "Name: skill" (skill 1–10, 1 = best); add * for fewer games', playersBox),
      h('div', { class: 'actions' },
        h('label', { class: 'button' }, 'Load players file',
          h('input', { type: 'file', accept: '.txt,text/plain', hidden: true, onchange: (e) => { loadPlayers(e.target.files[0]); e.target.value = ''; } })))),
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
      h('button', { class: 'back', onclick: () => cancelSetup(ctx) }, d.editingId ? '‹ Back' : '‹ Home'),
      h('div', { class: 'titles' }, h('span', { class: 'eyebrow' }, h('img', { src: logoDataUrl(), alt: '' }), 'Seedr'),
        h('h1', {}, d.editingId ? 'Edit tournament' : 'New tournament'))),
    form,
    preview);
}

// Rounds and match length come only from the options that fit the total time, best first.
function planField(d, ev, refresh) {
  const label = (o) => `${o.rounds} rounds × ${o.matchMinutes} min + ${o.breakMinutes} min break = ${o.totalMinutes} min · `
    + (o.even ? `everyone plays ${o.gamesMin} games` : `${o.gamesMin}–${o.gamesMax} games per player (uneven)`);
  const choices = [['', ev.options.length ? 'Choose…' : 'Enter players, courts and time first'], ...ev.options.map((o) => [o.rounds, label(o)])];
  const select = selectInput(ev.plan ? d.selectedRounds : '', choices, (e) => {
    d.selectedRounds = e.target.value === '' ? null : Number(e.target.value);
    refresh();
  });
  select.disabled = ev.options.length === 0;
  return field('Rounds and match length', select);
}

function setupPreview(ctx, d, ev) {
  const out = [h('p', { class: 'muted' }, `${ev.players.length} players entered`)];
  if (ev.games) {
    out.push(ev.games.even
      ? h('p', { class: 'ok' }, `Everyone plays ${ev.games.min} games.`)
      : h('p', { class: 'warning' }, `Uneven: players get ${ev.games.min} or ${ev.games.max} games. Players with fewer games get 0.5 points per missing game.`));
    const fewer = fewerGamesCount(ev.players.length, d.courts, ev.plan.rounds);
    const marked = ev.players.filter((p) => p.fewer).map((p) => p.name);
    if (fewer > 0) {
      out.push(h('p', { class: 'muted' }, `${fewer} player${fewer === 1 ? '' : 's'} get${fewer === 1 ? 's' : ''} ${ev.games.min} games. `,
        marked.length ? `Marked with *: ${marked.join(', ')}` : 'Add * after a skill (e.g. "Anna: 3 *") to choose who.',
        marked.length && marked.length < fewer ? `; the other ${fewer - marked.length} are drawn at random.` : marked.length ? '.' : ''));
    }
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
  const settings = { courts: d.courts, rounds: ev.plan.rounds, matchMinutes: ev.plan.matchMinutes, breakMinutes: d.breakMinutes, revealBatch: d.revealBatch };
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
  ctx.open(t);
}
