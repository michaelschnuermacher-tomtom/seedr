import { h, newId } from './dom.js';
import { logoDataUrl } from './logo.js';
import { parsePlayers, formatPlayers, createTournament, updateSettings, isActive, checkFewer } from '../engine/tournament.js';
import { recommendOptions, gamesPerPlayer, fewerGamesCount, describeGames, roundStartTimes, TIME_PATTERN } from '../engine/timeplan.js';
import { newSeed } from '../engine/rng.js';

// The regular group, pre-filled for every new tournament: one line per skill.
export const DEFAULT_PLAYERS = `1: Markus, Seb, Micha
3: Uta, Vera
4: Gesa, Henri, Lia
5: Felix, Jenny, Mickey
6: Ada, Hugo, Bianca
7: Basti
8: Max
9: Anne`;

export function newDraft() {
  return {
    name: '',
    playersText: DEFAULT_PLAYERS,
    courts: 2,
    totalMinutes: 240,
    breakMinutes: 5,
    selectedRounds: null,
    lastRoundCourts: null,
    endTime: '',
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
    playersText: formatPlayers(t.players.filter(isActive)),
    courts: s.courts,
    breakMinutes: s.breakMinutes,
    totalMinutes: s.rounds * (s.matchMinutes + s.breakMinutes),
    selectedRounds: s.rounds,
    lastRoundCourts: s.lastRoundCourts ?? null,
    endTime: s.endTime ?? '',
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
  if (d.endTime && !TIME_PATTERN.test(d.endTime)) problems.push('End time must be a time like 18:00.');
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
  if (plan) {
    const problem = checkFewer(players, { courts: d.courts, rounds: plan.rounds, lastRoundCourts: plan.lastRoundCourts });
    if (problem) problems.push(problem);
  }
  const games = plan ? gamesPerPlayer(players.length, d.courts, plan.rounds, plan.lastRoundCourts) : null;
  const startTimes = plan && d.endTime && problems.length === 0
    ? roundStartTimes({ rounds: plan.rounds, matchMinutes: plan.matchMinutes, breakMinutes: d.breakMinutes, endTime: d.endTime })
    : null;
  return { players, problems, options, plan, games, startTimes };
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
    rows: 10, value: d.playersText, placeholder: '1: Carla\n3: Anna, David\n7: Ben Miller',
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
      field('One line per skill (1 = best, 10 = weakest), e.g. "3: Anna, Ben". If games are uneven, a * after a name picks who plays fewer, e.g. "3: Anna, Ben*". Single players as "Anna: 3" work too.', playersBox),
      h('div', { class: 'actions' },
        h('label', { class: 'button' }, 'Load players file',
          h('input', { type: 'file', accept: '.txt,text/plain', hidden: true, onchange: (e) => { loadPlayers(e.target.files[0]); e.target.value = ''; } })))),
    card('Courts & time', 'rg',
      h('div', { class: 'row' },
        field('Courts', numberInput('courts', 1)),
        field('Break between rounds (min)', numberInput('breakMinutes', 0))),
      h('div', { class: 'row' },
        field('Total tournament time (min)', numberInput('totalMinutes', 1)),
        field('End time (optional)', h('input', { type: 'time', value: d.endTime, oninput: (e) => { d.endTime = e.target.value; refresh(); } }))),
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
  const out = [h('p', { class: 'muted' }, `${ev.players.length} players entered`)];
  if (ev.games) {
    const games = describeGames(ev.players.length, d.courts, ev.plan.rounds, ev.plan.lastRoundCourts);
    out.push(ev.games.even
      ? h('p', { class: 'ok' }, `Even: ${games}.`)
      : h('p', { class: 'warning' }, `Uneven: ${games}. Players with fewer games get 0.5 points per missing game.`));
    if (ev.plan.lastRoundCourts) out.push(h('p', { class: 'muted' }, `The last round uses only ${courtsText(ev.plan.lastRoundCourts)}, so the games come out more even.`));
    const fewer = fewerGamesCount(ev.players.length, d.courts, ev.plan.rounds, ev.plan.lastRoundCourts);
    const marked = ev.players.filter((p) => p.fewer).map((p) => p.name);
    if (fewer > 0) {
      const rest = fewer - marked.length;
      out.push(h('p', { class: 'muted' }, marked.length === 0
        ? `The ${fewer} with ${ev.games.min} games are drawn at random. Add * after a name (e.g. "3: Anna, Ben*") to choose them.`
        : `${ev.games.min} games for ${marked.join(', ')}${rest ? ` and ${rest} more drawn at random` : ''}.`));
    }
  }
  if (ev.startTimes) {
    out.push(h('p', { class: 'muted' }, `Round 1 starts at ${ev.startTimes[0]}, round ${ev.startTimes.length} at ${ev.startTimes.at(-1)}; the last match ends at ${d.endTime}.`));
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
    ...(ev.plan.lastRoundCourts ? { lastRoundCourts: ev.plan.lastRoundCourts } : {}), ...(d.endTime ? { endTime: d.endTime } : {}) };
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
