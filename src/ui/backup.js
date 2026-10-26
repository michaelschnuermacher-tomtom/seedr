import { saveFile, downloadFile } from './export.js';
import { makeBackup, readBackup, mergeBackup } from '../engine/people.js';

// One file with all players and all tournaments on this device.
export function exportBackup(ctx) {
  const date = new Date().toISOString().slice(0, 10);
  const text = JSON.stringify(makeBackup(ctx.people(), ctx.store.list()), null, 2);
  saveFile(`seedr-backup-${date}.json`, text, { nav: navigator, download: downloadFile });
}

// Merges a backup into this device. Existing players and tournaments are only replaced
// after a confirmation.
export async function importBackup(ctx, file) {
  if (!file) return;
  let incoming;
  try {
    incoming = readBackup(JSON.parse(await file.text()));
  } catch (error) {
    ctx.flash(`Import failed: ${error instanceof SyntaxError ? 'this file is not a Seedr file.' : error.message}`);
    return;
  }
  const merged = mergeBackup({ people: ctx.people(), tournaments: ctx.store.list() }, incoming);
  const { people, tournaments } = merged.replaced;
  const replacing = [tournaments ? `${tournaments} tournament${tournaments === 1 ? '' : 's'}` : '', people ? `${people} player${people === 1 ? '' : 's'}` : ''].filter(Boolean);
  if (replacing.length && !confirm(`This replaces ${replacing.join(' and ')} on this device. Continue?`)) return;
  ctx.savePeople(merged.people, merged.tournaments);
  const imported = merged.tournaments.filter((t) => incoming.tournaments.some((x) => x.id === t.id));
  if (incoming.people.length === 0 && imported.length === 1) {
    ctx.open(imported[0]);
    return;
  }
  ctx.flash(`Imported ${imported.length} tournament${imported.length === 1 ? '' : 's'} and ${incoming.people.length} player${incoming.people.length === 1 ? '' : 's'}.`);
}
