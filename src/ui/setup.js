import { h, newId } from './dom.js';
import { parsePlayers, createTournament } from '../engine/tournament.js';
import { recommendOptions, gamesPerPlayer } from '../engine/timeplan.js';
import { newSeed } from '../engine/rng.js';

export function newDraft() {
  return {
    name: '',
    playersText: '',
    courts: 3,
    planning: 'recommended',
    totalMinutes: 120,
    breakMinutes: 2,
    selectedRounds: null,
    rounds: 6,
    matchMinutes: 15,
    revealBatch: 'all',
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
    if (d.planning === 'recommended') {
      if (!isWhole(d.totalMinutes, 1)) {
        problems.push('Total time must be a whole number of minutes.');
      } else {
        options = recommendOptions({ players: players.length, courts: d.courts, totalMinutes: d.totalMinutes, breakMinutes: d.breakMinutes });
        const chosen = options.find((o) => o.rounds === d.selectedRounds);
        if (options.length === 0) problems.push('Not enough time for even one round of at least 5 minutes.');
        else if (!chosen) problems.push('Choose one of the options below.');
        else plan = { rounds: chosen.rounds, matchMinutes: chosen.matchMinutes };
      }
    } else if (!isWhole(d.rounds, 1) || !isWhole(d.matchMinutes, 1)) {
      problems.push('Rounds and match length must be whole numbers of at least 1.');
    } else {
      plan = { rounds: d.rounds, matchMinutes: d.matchMinutes };
    }
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
  const refresh = () => preview.replaceChildren(...setupPreview(ctx, d, refresh));
  const numberInput = (key, min) => h('input', {
    type: 'number', min, step: 1, inputmode: 'numeric', value: d[key],
    oninput: (e) => { d[key] = e.target.value === '' ? NaN : Number(e.target.value); refresh(); },
  });

  const recommendedBox = h('div', {},
    field('Total tournament time (minutes)', numberInput('totalMinutes', 1)));
  const manualBox = h('div', {},
    field('Number of rounds', numberInput('rounds', 1)),
    field('Match length (minutes)', numberInput('matchMinutes', 1)));
  const showPlanning = () => {
    recommendedBox.hidden = d.planning !== 'recommended';
    manualBox.hidden = d.planning !== 'manual';
  };
  showPlanning();

  const form = h('section', { class: 'form' },
    field('Tournament name', h('input', { type: 'text', value: d.name, placeholder: 'Club night', oninput: (e) => { d.name = e.target.value; } })),
    field('Players: one per line, name and skill 1–10 (1 = best)', h('textarea', {
      rows: 10, value: d.playersText, placeholder: 'Anna 3\nBen 7\nCarla 1\nDavid 5',
      oninput: (e) => { d.playersText = e.target.value; refresh(); },
    })),
    field('Courts', numberInput('courts', 1)),
    field('Break between rounds (minutes)', numberInput('breakMinutes', 0)),
    field('Rounds revealed at a time', selectInput(d.revealBatch,
      [['all', 'All (whole schedule in advance)'], ['1', '1 (surprise)'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']],
      (e) => { d.revealBatch = e.target.value === 'all' ? 'all' : Number(e.target.value); })),
    field('Planning', selectInput(d.planning,
      [['recommended', 'Recommend from total time'], ['manual', 'Enter rounds and match length']],
      (e) => { d.planning = e.target.value; showPlanning(); refresh(); })),
    recommendedBox,
    manualBox,
  );

  refresh();
  return h('main', { class: 'screen' },
    h('header', { class: 'top' }, h('h1', {}, 'New tournament')),
    form,
    preview);
}

function setupPreview(ctx, d, refresh) {
  const ev = evaluateDraft(d);
  const out = [h('p', { class: 'muted' }, `${ev.players.length} players entered`)];
  if (d.planning === 'recommended' && ev.options.length) {
    out.push(h('div', { class: 'options' }, ev.options.map((o) => h('label', { class: `option${o.even ? '' : ' uneven'}` },
      h('input', { type: 'radio', name: 'plan', checked: o.rounds === d.selectedRounds, onchange: () => { d.selectedRounds = o.rounds; refresh(); } }),
      h('span', {}, `${o.rounds} rounds × ${o.matchMinutes} min + ${o.breakMinutes} min break = ${o.totalMinutes} min · `,
        o.even ? `everyone plays ${o.gamesMin} games` : `${o.gamesMin}–${o.gamesMax} games per player (uneven)`)))));
  }
  if (ev.games) {
    out.push(ev.games.even
      ? h('p', { class: 'ok' }, `Everyone plays ${ev.games.min} games.`)
      : h('p', { class: 'warning' }, `Uneven: players get ${ev.games.min} or ${ev.games.max} games. Players with fewer games get 0.5 points per missing game.`));
  }
  if (ev.problems.length) out.push(h('ul', { class: 'problems' }, ev.problems.map((p) => h('li', {}, p))));
  out.push(h('div', { class: 'actions' },
    h('button', { onclick: () => { ctx.state.draft = null; ctx.go('home'); } }, 'Cancel'),
    h('button', {
      class: 'primary',
      disabled: ev.problems.length > 0,
      onclick: (e) => {
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Drawing…';
        setTimeout(() => createFromDraft(ctx, d, ev), 20); // let the browser paint "Drawing…" first
      },
    }, 'Draw schedule')));
  return out;
}

function createFromDraft(ctx, d, ev) {
  const t = createTournament({
    id: newId(),
    name: d.name.trim() || 'Tournament',
    players: ev.players,
    settings: { courts: d.courts, rounds: ev.plan.rounds, matchMinutes: ev.plan.matchMinutes, breakMinutes: d.breakMinutes, revealBatch: d.revealBatch },
    seed: newSeed(),
    now: new Date(),
  });
  ctx.state.draft = null;
  ctx.save(t);
  ctx.open(t);
}
