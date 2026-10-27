import { h, newId } from './dom.js';
import { logoDataUrl } from './logo.js';
import { parsePlayers, createTournament, updateSettings, isActive, hasResults, renameTournament, setSkills, withdrawPlayers, redrawRemaining, firstRedrawableRound } from '../engine/tournament.js';
import { planMatrix, gamesPerPlayer, describeGames, BREAK_CHOICES, MATRIX_MIN_MATCH_MINUTES } from '../engine/timeplan.js';
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
// name, scoring, skill scale, players, a skill for each player, courts and break, total
// time, rounds.
// `picks` are the chosen players in the order they were added: { personId, skill }, with
// skill null until it is set.
export function newDraft() {
  return {
    name: '',
    scaleMin: null,
    scaleMax: null,
    best: null,
    scoring: null, // 'wins', 'sets' (scores required) or 'americano'
    americanoPoints: null,
    picks: [],
    courts: 2,
    totalMinutes: 240,
    breakMinutes: null, // chosen in the matrix, with the rounds
    selectedRounds: null,
    lastRoundCourts: null,
  };
}

// Setup form for changing a tournament: everything filled in. The total time is set so that
// the current rounds × match length is one of the options. Once results are in (`started`),
// only the name, the skills and who still plays can change.
export function draftFromTournament(t) {
  const s = t.settings;
  const scale = scaleOf(s);
  return {
    ...newDraft(),
    editingId: t.id,
    started: hasResults(t),
    name: t.name,
    scaleMin: scale.min,
    scaleMax: scale.max,
    best: scale.best,
    scoring: s.scoring?.mode ?? 'wins',
    americanoPoints: s.scoring?.points ?? null,
    picks: t.players.filter(isActive).map((p) => ({ personId: p.personId ?? p.id, skill: p.skill })),
    courts: s.courts,
    breakMinutes: s.breakMinutes,
    totalMinutes: s.rounds * (s.matchMinutes + s.breakMinutes),
    selectedRounds: s.rounds,
    lastRoundCourts: s.lastRoundCourts ?? null,
  };
}

// What saving a started tournament changes: the players who leave (by tournament player id)
// and the new skills; `from` is the first round that can be drawn again (beyond the last
// round: none).
export function startedChanges(t, d) {
  const playing = new Map(t.players.filter(isActive).map((p) => [p.personId ?? p.id, p]));
  const kept = new Set(d.picks.map((p) => p.personId));
  const leaving = [...playing].filter(([personId]) => !kept.has(personId)).map(([, p]) => p.id);
  const skills = {};
  for (const pick of d.picks) {
    const p = playing.get(pick.personId);
    if (p && pick.skill !== p.skill) skills[p.id] = pick.skill;
  }
  return { leaving, skills, from: firstRedrawableRound(t), last: t.settings.rounds, renamed: d.name.trim() !== t.name };
}

// Saves a started tournament: the name, the skills, and the players who leave (they are
// withdrawn, which draws the remaining rounds again). New skills alone redraw only on request.
export function saveStarted(t, d, seed, redrawToo = false) {
  const { leaving, skills, renamed } = startedChanges(t, d);
  let next = renamed ? renameTournament(t, d.name) : t;
  if (Object.keys(skills).length) next = setSkills(next, skills);
  if (leaving.length) next = withdrawPlayers(next, leaving, seed);
  else if (redrawToo) next = redrawRemaining(next, seed);
  return next;
}

export function draftScale(d) {
  const scale = { min: d.scaleMin, max: d.scaleMax, best: d.best };
  return scaleProblem(scale) ? null : scale;
}

const isWhole = (v, min) => Number.isInteger(v) && v >= min;

// The players, the plan, what is still missing, and how far the steps are done (`steps`,
// in order; a step is shown once all before it are done).
export function evaluateDraft(d, people = []) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const scale = draftScale(d);
  // Skills outside the scale (e.g. after it changed) count as not set.
  const skilled = scale ? d.picks.filter((p) => isSkill(p.skill, scale)) : [];
  const players = skilled.map((p) => {
    const person = byId.get(p.personId);
    return { personId: p.personId, name: person?.name ?? p.personId, skill: p.skill, ...(person?.birthYear != null ? { birthYear: person.birthYear } : {}) };
  });
  const scoringDone = d.scoring === 'wins' || d.scoring === 'sets' || (d.scoring === 'americano' && isWhole(d.americanoPoints, 1));
  const steps = { name: d.name.trim() !== '', scale: Boolean(scale), scoring: scoringDone, players: d.picks.length > 0,
    // Skills can be set from the first player on; going on needs at least 4 players.
    skills: d.picks.length >= 4 && skilled.length === d.picks.length };
  steps.courts = isWhole(d.courts, 1);
  // Rounds × break: the columns are the usual breaks, plus the tournament's own when editing.
  const breaks = [...new Set([...BREAK_CHOICES, ...(isWhole(d.breakMinutes, 0) ? [d.breakMinutes] : [])])].sort((a, b) => a - b);
  let matrix = [];
  let plan = null;
  if (steps.skills && steps.courts && isWhole(d.totalMinutes, 1)) {
    matrix = planMatrix({ players: players.length, courts: d.courts, totalMinutes: d.totalMinutes, breaks });
    const row = matrix.find((o) => o.rounds === d.selectedRounds && (o.lastRoundCourts ?? null) === (d.lastRoundCourts ?? null));
    const cell = row?.cells[breaks.indexOf(d.breakMinutes)];
    if (cell) plan = { rounds: row.rounds, matchMinutes: cell.matchMinutes, ...(row.lastRoundCourts ? { lastRoundCourts: row.lastRoundCourts } : {}) };
  }
  steps.time = matrix.length > 0;
  steps.plan = Boolean(plan);
  const problems = [];
  if (!steps.name) problems.push('Give the tournament a name.');
  if (!steps.scale) problems.push(scaleProblem({ min: d.scaleMin, max: d.scaleMax, best: d.best }) ?? 'Choose the skill scale.');
  if (!steps.scoring) problems.push(d.scoring === 'americano' ? 'Points per match must be a whole number of at least 1.' : 'Choose how matches are scored.');
  if (d.picks.length < 4) problems.push('Choose at least 4 players.');
  else if (!steps.skills) problems.push('Give every player a skill.');
  if (!isWhole(d.courts, 1)) problems.push('Courts must be a whole number of at least 1.');
  if (steps.skills && steps.courts && !isWhole(d.totalMinutes, 1)) problems.push('Total time must be a whole number of minutes.');
  else if (steps.skills && steps.courts && !steps.time) problems.push(`Not enough time for even one round of at least ${MATRIX_MIN_MATCH_MINUTES} minutes.`);
  if (steps.time && !steps.plan) problems.push('Choose rounds and break in the table.');
  const games = plan ? gamesPerPlayer(players.length, d.courts, plan.rounds, plan.lastRoundCourts) : null;
  const scoring = !steps.scoring ? null
    : d.scoring === 'americano' ? { mode: 'americano', points: d.americanoPoints }
      : d.scoring === 'sets' ? { mode: 'sets' } : null;
  return { players, scale, scoring, steps, problems, matrix, breaks, plan, games };
}

function field(label, input) {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function selectInput(value, choices, onchange) {
  const select = h('select', { onchange }, choices.map(([v, label]) => h('option', { value: v }, label)));
  select.value = String(value ?? '');
  return select;
}

// The players: one dropdown per chosen player, and an empty one to add the next. Only
// players not chosen yet are offered.
function playersStep(ctx, d, people, canLeave = true) {
  const known = sortPeople(people);
  const started = Boolean(d.started);
  const chosen = new Set(d.picks.map((p) => p.personId));
  const free = known.filter((p) => !chosen.has(p.id));
  const name = (id) => known.find((p) => p.id === id)?.name ?? id;
  const pickSelect = (pick) => {
    const select = selectInput(pick.personId, [[pick.personId, name(pick.personId)], ...free.map((p) => [p.id, p.name])], (e) => {
      pick.personId = e.target.value;
      ctx.render();
    });
    select.disabled = started;
    return select;
  };
  const addSelect = free.length && !started ? selectInput('', [['', d.picks.length ? 'Add another…' : 'Add player…'], ...free.map((p) => [p.id, p.name])], (e) => {
    if (!e.target.value) return;
    d.picks.push({ personId: e.target.value, skill: null });
    ctx.render();
  }) : null;
  return [
    h('p', { class: 'muted' }, !started ? `Choose who plays; a new dropdown appears for the next one. ${d.picks.length} chosen.`
      : canLeave ? `Results are in, so no one can join. ✕ takes out a player who cannot go on: they keep their results and the rounds without results are drawn again without them. ${d.picks.length} playing.`
        : `All rounds have results, so the players stay as they are. ${d.picks.length} playing.`),
    h('div', { class: 'level-picks' },
      d.picks.map((pick) => h('div', { class: 'level-pick' }, pickSelect(pick),
        canLeave ? h('button', { class: 'small', title: 'Remove', 'aria-label': `Remove ${name(pick.personId)}`, onclick: () => { d.picks.splice(d.picks.indexOf(pick), 1); ctx.render(); } }, '✕') : null)),
      addSelect),
    h('div', { class: 'actions' },
      h('button', { class: 'small', onclick: () => { ctx.state.peopleReturn = 'setup'; ctx.go('people'); } }, 'Add or edit players…')),
  ];
}

// A skill for each chosen player. Players with a skill are sorted by it (best first);
// the ones still without follow in the order they were chosen.
export function skillOrder(picks, scale) {
  const rank = new Map(levels(scale).map((skill, i) => [skill, i]));
  const set = picks.filter((p) => isSkill(p.skill, scale)).sort((a, b) => rank.get(a.skill) - rank.get(b.skill));
  return [...set, ...picks.filter((p) => !isSkill(p.skill, scale))];
}

function skillsStep(ctx, d, scale, people) {
  const name = (id) => people.find((p) => p.id === id)?.name ?? id;
  const choices = [['', 'Choose…'], ...levels(scale).map((skill) => [skill, `Skill ${skill}`])];
  const missing = d.picks.filter((p) => !isSkill(p.skill, scale)).length;
  return [
    h('p', { class: 'muted' }, `${describeScale(scale)} ${missing ? `${missing} still without a skill.` : 'Every player has a skill.'}`),
    h('div', { class: 'skill-list' }, skillOrder(d.picks, scale).map((pick) => h('label', { class: 'skill-row' },
      h('span', {}, name(pick.personId)),
      selectInput(isSkill(pick.skill, scale) ? pick.skill : '', choices, (e) => {
        pick.skill = e.target.value === '' ? null : Number(e.target.value);
        ctx.render();
      })))),
  ];
}

export function setupScreen(ctx) {
  const d = (ctx.state.draft ??= newDraft());
  const people = ctx.people();
  const started = d.started ? ctx.store.get(d.editingId) : null;
  if (d.started && !started) ctx.state.draft = null; // deleted meanwhile
  const changes = started ? startedChanges(started, d) : null;
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
    field('Name', h('input', { type: 'text', value: d.name, placeholder: 'Club night', oninput: (e) => { d.name = e.target.value; refresh(); } })),
    started ? h('p', { class: 'muted' }, 'Results are in: scoring, skill scale, courts and times stay as they are. The name and the skills can change, and players who cannot go on can be taken out.') : null);
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
  const pointsField = field('Points per match (both teams together, e.g. 24)', numberInput('americanoPoints', 1));
  const scoringCard = card('Scoring', 'rg',
    field('How are matches scored?', selectInput(d.scoring, [['', 'Choose…'], ['wins', 'Wins (scores optional)'], ['sets', 'Matches, then sets, then points/games (scores required)'], ['americano', 'Americano: total points win']], (e) => {
      d.scoring = e.target.value || null;
      refresh();
    })),
    pointsField);
  const playersCard = card('Players', 'wim', playersStep(ctx, d, people, !changes || changes.from <= changes.last));
  const skillsCard = card('Skills', 'ao', ev0.scale ? skillsStep(ctx, d, ev0.scale, people) : null);
  const courtsField = field('Courts', numberInput('courts', 1));
  const timeField = field('Total tournament time (min)', numberInput('totalMinutes', 1));
  const timeCard = started ? card('Courts & time', 'rg', fixedPlan(started.settings)) : card('Courts & time', 'rg', courtsField, timeField, planBox);
  // Once results are in, scoring and skill scale are shown but cannot change.
  if (started) for (const input of [...scoringCard.querySelectorAll('input, select'), ...scaleCard.querySelectorAll('input, select')]) input.disabled = true;
  // Shows each step once the ones before are done.
  const refresh = () => {
    if (started) {
      pointsField.hidden = d.scoring !== 'americano';
      preview.replaceChildren(...startedPreview(ctx, d, started));
      return;
    }
    const ev = evaluateDraft(d, people);
    const s = ev.steps;
    const order = [s.name, s.scoring, s.scale, s.players, s.skills, s.courts, s.time, s.plan];
    const reached = order.findIndex((done) => !done); // the first open step (-1: all done)
    const upTo = (i) => reached === -1 || i <= reached;
    scoringCard.hidden = !upTo(1);
    scaleCard.hidden = !upTo(2);
    pointsField.hidden = d.scoring !== 'americano';
    playersCard.hidden = !upTo(3);
    skillsCard.hidden = !upTo(4) || !ev.scale;
    timeCard.hidden = !upTo(5);
    timeField.hidden = !upTo(6);
    planBox.hidden = !upTo(7);
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
    h('div', { class: 'form' }, nameCard, scoringCard, scaleCard, playersCard, skillsCard, timeCard),
    preview);
}

// Rounds × break: each cell is the match length that fits the total time; a tap chooses
// rounds and break together. Rows where everyone plays the same number of games stand out.
function planField(d, ev, refresh) {
  const games = (row) => (row.even ? `${row.gamesMax} games each` : `${row.gamesMin}–${row.gamesMax} games`);
  const chosen = (row, cell) => cell && row.rounds === d.selectedRounds && (row.lastRoundCourts ?? null) === (d.lastRoundCourts ?? null) && cell.breakMinutes === d.breakMinutes;
  return h('div', { class: 'field' },
    h('span', {}, 'Rounds and break'),
    h('p', { class: 'muted' }, `Each cell is the match length in minutes. Tap one to choose rounds and break; rows in green give everyone the same number of games.`),
    h('div', { class: 'matrix-wrap' }, h('table', { class: 'matrix' },
      h('thead', {},
        h('tr', {}, h('th', { rowspan: 2 }, 'Rounds'), h('th', { colspan: ev.breaks.length }, 'Break (min)')),
        h('tr', {}, ev.breaks.map((b) => h('th', {}, b)))),
      h('tbody', {}, ev.matrix.map((row) => h('tr', { class: row.even ? 'even' : '' },
        h('th', {}, h('strong', {}, row.rounds), row.lastRoundCourts ? h('span', { class: 'muted' }, ` (last: ${courtsText(row.lastRoundCourts)})`) : null,
          h('span', { class: 'matrix-games' }, games(row))),
        row.cells.map((cell) => h('td', {}, cell ? h('button', {
          class: chosen(row, cell) ? 'primary' : '',
          title: `${row.rounds} × ${cell.matchMinutes} min + ${cell.breakMinutes} min break = ${cell.totalMinutes} min`,
          onclick: () => {
            Object.assign(d, { selectedRounds: row.rounds, lastRoundCourts: row.lastRoundCourts ?? null, breakMinutes: cell.breakMinutes });
            refresh();
          },
        }, cell.matchMinutes) : '–'))))))));
}

const courtsText = (n) => `${n} court${n === 1 ? '' : 's'}`;

// Courts and times of a started tournament, which stay as they are.
function fixedPlan(s) {
  return h('p', {}, `${courtsText(s.courts)}${s.lastRoundCourts ? ` (last round: ${s.lastRoundCourts})` : ''} · ${s.rounds} rounds of ${s.matchMinutes} min · ${s.breakMinutes ? `${s.breakMinutes} min break` : 'no break'}`);
}

// Below the steps of a started tournament: what saving does, and the buttons.
function startedPreview(ctx, d, t) {
  const c = startedChanges(t, d);
  const scale = scaleOf(t.settings);
  const problems = [];
  if (!d.name.trim()) problems.push('Give the tournament a name.');
  if (d.picks.length < 4) problems.push('At least 4 players must remain.');
  if (d.picks.some((p) => !isSkill(p.skill, scale))) problems.push('Give every player a skill.');
  const rounds = c.from === c.last ? `round ${c.last}` : `rounds ${c.from}–${c.last}`;
  const skillsChanged = Object.keys(c.skills).length > 0;
  const changed = c.renamed || skillsChanged || c.leaving.length > 0;
  const save = (redrawToo) => (e) => {
    const names = t.players.filter((p) => c.leaving.includes(p.id)).map((p) => p.name).join(', ');
    if (c.leaving.length && !confirm(`Withdraw ${names} and draw ${rounds} again? Rounds with results stay as they are. This cannot be undone.`)) return;
    if (!c.leaving.length && redrawToo && !confirm(`Save and draw ${rounds} again? Rounds with results stay as they are.`)) return;
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = redrawToo || c.leaving.length ? 'Drawing…' : 'Saving…';
    setTimeout(() => { // let the browser paint "Drawing…" first
      let next;
      try {
        next = saveStarted(t, d, newSeed(), redrawToo);
      } catch (error) {
        ctx.flash(error.message);
        return;
      }
      ctx.state.draft = null;
      ctx.save(next);
      ctx.open(next);
    }, 20);
  };
  const canRedraw = c.from <= c.last;
  const out = [];
  if (problems.length) out.push(h('ul', { class: 'problems' }, problems.map((p) => h('li', {}, p))));
  else if (c.leaving.length) out.push(h('p', { class: 'warning' }, `Saving withdraws ${c.leaving.length === 1 ? '1 player' : `${c.leaving.length} players`} and draws ${rounds} again.`));
  else if (skillsChanged && canRedraw) out.push(h('p', { class: 'muted' }, `The schedule was drawn for the old skills: ${rounds} can be drawn again (rounds with results stay).`));
  const ok = !problems.length && changed;
  out.push(h('div', { class: 'actions' },
    h('button', { onclick: () => cancelSetup(ctx) }, 'Cancel'),
    ok && c.leaving.length ? h('button', { class: 'primary', onclick: save(true) }, `Save and redraw ${rounds}`) : null,
    ok && !c.leaving.length && skillsChanged && canRedraw ? h('button', { onclick: save(true) }, `Save and redraw ${rounds}`) : null,
    ok && !c.leaving.length ? h('button', { class: 'primary', onclick: save(false) }, 'Save') : null));
  return out;
}

// Below the steps: once all are done, what the plan means and the Draw button; Cancel always.
function setupPreview(ctx, d, ev, complete) {
  const out = [];
  if (complete && ev.games) {
    out.push(h('p', { class: 'muted' }, `${ev.players.length} players.`));
    const games = describeGames(ev.players.length, d.courts, ev.plan.rounds, ev.plan.lastRoundCourts);
    out.push(ev.games.even
      ? h('p', { class: 'ok' }, `Even: ${games}.`)
      : h('p', { class: 'warning' }, `Uneven: ${games}. Players with fewer games get 0.5 points per missing game. Who plays fewer is drawn at random; Manage → Rounds → View can change it later.`));
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
  const settings = { courts: d.courts, rounds: ev.plan.rounds, matchMinutes: ev.plan.matchMinutes, breakMinutes: d.breakMinutes,
    scale: ev.scale, ...(ev.scoring ? { scoring: ev.scoring } : {}), ...(ev.plan.lastRoundCourts ? { lastRoundCourts: ev.plan.lastRoundCourts } : {}) };
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
