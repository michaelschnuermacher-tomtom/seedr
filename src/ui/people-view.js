import { h, newId } from './dom.js';
import { logoDataUrl } from './logo.js';
import { sortPeople, usage, addPerson, updatePerson, deletePerson, splitPerson } from '../engine/people.js';

// The players known on this device: listed first, changed on a sub-page that Edit or Add
// opens (`peopleView.page`). Names and years of birth are shared by all tournaments.
// `peopleReturn` is the screen to go back to (the setup, when opened from there).
export function peopleScreen(ctx) {
  const view = (ctx.state.peopleView ??= { page: null, id: null });
  const people = sortPeople(ctx.people());
  const tournaments = ctx.store.list();
  const leave = () => {
    const to = ctx.state.peopleReturn ?? 'home';
    ctx.state.peopleView = null;
    ctx.state.peopleReturn = null;
    ctx.go(to);
  };
  const person = people.find((p) => p.id === view.id);
  const pages = { add: addPage, edit: editPage, split: splitPage };
  const page = pages[view.page];
  const body = page && (view.page === 'add' || person) ? page(ctx, view, person, people, tournaments) : listPage(ctx, view, people, tournaments, leave);
  return h('main', { class: 'screen' },
    h('header', { class: 'top' },
      h('div', { class: 'titles' },
        h('button', { class: 'eyebrow home-link', title: 'Back', onclick: leave }, h('img', { src: logoDataUrl(), alt: '' }), 'Seedr'),
        h('h1', {}, 'Players'))),
    body);
}

function showPage(ctx, view, page, id = null) {
  Object.assign(view, { page, id });
  ctx.state.message = null;
  ctx.render();
}

function listPeople(ctx, view) {
  Object.assign(view, { page: null, id: null });
  ctx.render();
}

function showError(ctx, error) {
  ctx.state.message = error.message;
  ctx.render();
}

const yearText = (p) => (p.birthYear ? `born ${p.birthYear}` : 'no year of birth');
const playsIn = (n) => (n === 0 ? 'no tournaments' : n === 1 ? '1 tournament' : `${n} tournaments`);

function listPage(ctx, view, people, tournaments, leave) {
  return [
    h('p', { class: 'muted' }, 'Names and years of birth are shared by all tournaments: a correction here shows everywhere. The skill is set for each tournament in its setup.'),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => showPage(ctx, view, 'add') }, 'Add player'),
      h('button', { onclick: leave }, ctx.state.peopleReturn === 'setup' ? 'Back to the setup' : 'Done')),
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, people.length === 1 ? '1 player' : `${people.length} players`),
      people.length === 0 ? h('p', { class: 'muted' }, 'No players yet.') : h('ul', { class: 'people' }, people.map((p) => h('li', {},
        h('span', { class: 'person' }, h('strong', {}, p.name), h('span', { class: 'muted' }, ` · ${yearText(p)} · ${playsIn(usage(tournaments, p.id).length)}`)),
        h('button', { class: 'small', onclick: () => showPage(ctx, view, 'edit', p.id) }, 'Edit'))))),
  ];
}

// Name and year of birth inputs; `read()` returns them, with the year as a number or null.
function personFields(person = {}) {
  const name = h('input', { type: 'text', value: person.name ?? '', placeholder: 'Name' });
  const year = h('input', { type: 'number', inputmode: 'numeric', min: 1900, step: 1, value: person.birthYear ?? '', placeholder: 'e.g. 1985 (optional)' });
  const read = () => ({ name: name.value, birthYear: year.value.trim() === '' ? null : Number(year.value) });
  return {
    fields: [h('label', { class: 'field' }, h('span', {}, 'Name'), name), h('label', { class: 'field' }, h('span', {}, 'Year of birth'), year)],
    read,
  };
}

function personPage(ctx, view, title, content, buttons) {
  return [
    h('button', { class: 'back-link', onclick: () => listPeople(ctx, view) }, '← Players'),
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, title),
      content,
      h('div', { class: 'actions' }, buttons.filter(Boolean), h('button', { onclick: () => listPeople(ctx, view) }, 'Cancel'))),
  ];
}

function addPage(ctx, view, person, people) {
  const form = personFields();
  const save = () => {
    try {
      ctx.savePeople(addPerson(people, form.read(), newId).people);
      listPeople(ctx, view);
    } catch (error) {
      showError(ctx, error);
    }
  };
  return personPage(ctx, view, 'Add player', form.fields, [h('button', { class: 'primary', onclick: save }, 'Save')]);
}

function editPage(ctx, view, person, people, tournaments) {
  const form = personFields(person);
  const used = usage(tournaments, person.id);
  const save = () => {
    try {
      ctx.savePeople(updatePerson(people, person.id, form.read()));
      listPeople(ctx, view);
    } catch (error) {
      showError(ctx, error);
    }
  };
  const remove = () => {
    if (!confirm(`Delete ${person.name}?`)) return;
    try {
      ctx.savePeople(deletePerson(people, tournaments, person.id));
      listPeople(ctx, view);
    } catch (error) {
      showError(ctx, error);
    }
  };
  return personPage(ctx, view, person.name, [
    form.fields,
    h('p', { class: 'muted' }, used.length
      ? `Plays in ${used.map((t) => t.name).join(', ')}. A change shows in ${used.length === 1 ? 'that tournament' : 'all of them'}.`
      : 'Not part of any tournament yet.'),
  ], [
    h('button', { class: 'primary', onclick: save }, 'Save'),
    used.length >= 2 ? h('button', { onclick: () => showPage(ctx, view, 'split', person.id) }, 'Split…') : null,
    used.length === 0 ? h('button', { class: 'danger', onclick: remove }, 'Delete') : null,
  ]);
}

// Two different people who share a name: the chosen tournaments get a person of their own.
function splitPage(ctx, view, person, people, tournaments) {
  const form = personFields({ name: '' });
  const chosen = new Set();
  const used = usage(tournaments, person.id);
  const save = () => {
    try {
      const result = splitPerson(people, tournaments, person.id, [...chosen], form.read(), newId);
      ctx.savePeople(result.people, result.tournaments);
      listPeople(ctx, view);
    } catch (error) {
      showError(ctx, error);
    }
  };
  return personPage(ctx, view, `Split ${person.name}`, [
    h('p', { class: 'muted' }, `For two different people who ended up as one "${person.name}". Tick the tournaments of the other person and give them their own name.`),
    form.fields,
    h('div', { class: 'options' }, used.map((t) => h('label', { class: 'option' },
      h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? chosen.add(t.id) : chosen.delete(t.id)) }),
      h('span', {}, `${t.name} · ${new Date(t.createdAt).toLocaleDateString()}`)))),
  ], [h('button', { class: 'primary', onclick: save }, 'Split off')]);
}
