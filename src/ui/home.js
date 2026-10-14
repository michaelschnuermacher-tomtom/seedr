import { h } from './dom.js';
import { validateTournament } from '../engine/validate.js';

export function homeScreen(ctx) {
  const tournaments = ctx.store.list();
  return h('main', { class: 'screen' },
    h('header', { class: 'top' }, h('h1', {}, 'Seedr')),
    ctx.store.available ? null : h('p', { class: 'warning' }, 'This browser cannot save data. Use Export to keep your tournaments.'),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => ctx.go('setup') }, 'New tournament'),
      h('label', { class: 'button' }, 'Import',
        h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => importFile(ctx, e.target.files[0]) }))),
    tournaments.length === 0
      ? h('p', { class: 'muted' }, 'No tournaments saved on this device yet.')
      : h('ul', { class: 'list' }, tournaments.map((t) => h('li', {},
        h('button', { class: 'link', onclick: () => ctx.open(t) },
          h('strong', {}, t.name),
          h('span', { class: 'muted' }, ` · ${t.players?.length ?? 0} players · ${new Date(t.createdAt).toLocaleDateString()}`)),
        h('button', {
          class: 'danger small',
          onclick: () => {
            if (!confirm(`Delete "${t.name}" from this device?`)) return;
            ctx.store.remove(t.id);
            ctx.render();
          },
        }, 'Delete')))),
  );
}

async function importFile(ctx, file) {
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    ctx.flash('Import failed: this file is not a Seedr tournament file.');
    return;
  }
  const check = validateTournament(parsed);
  if (!check.ok) {
    ctx.flash(`Import failed: ${check.error}`);
    return;
  }
  if (ctx.store.get(parsed.id) && !confirm(`"${parsed.name}" already exists on this device. Replace it?`)) return;
  ctx.save(parsed);
  ctx.open(parsed);
}
