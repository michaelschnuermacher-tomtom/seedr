import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveFile } from '../src/ui/export.js';

function fakeNav({ canShare = true, touch = 5, share = async () => {} } = {}) {
  const calls = [];
  return {
    calls,
    maxTouchPoints: touch,
    canShare: (data) => canShare && data.files.length === 1,
    share: async (data) => { calls.push(data); return share(data); },
  };
}

test('on a touch device that can share files, the share sheet is used', async () => {
  const nav = fakeNav();
  const downloads = [];
  const how = await saveFile('club.seedr.json', '{"a":1}', { nav, download: (f) => downloads.push(f) });
  assert.equal(how, 'shared');
  assert.equal(downloads.length, 0);
  const [file] = nav.calls[0].files;
  assert.equal(file.name, 'club.seedr.json');
  assert.equal(await file.text(), '{"a":1}');
});

test('without file sharing, or on a non-touch device, the file is downloaded', async () => {
  for (const nav of [fakeNav({ canShare: false }), fakeNav({ touch: 0 }), undefined]) {
    const downloads = [];
    const how = await saveFile('club.seedr.json', '{}', { nav, download: (f) => downloads.push(f) });
    assert.equal(how, 'downloaded');
    assert.equal(downloads[0].name, 'club.seedr.json');
  }
});

test('cancelling the share sheet does not trigger a download', async () => {
  const nav = fakeNav({ share: async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }); } });
  const downloads = [];
  assert.equal(await saveFile('x.seedr.json', '{}', { nav, download: (f) => downloads.push(f) }), 'cancelled');
  assert.equal(downloads.length, 0);
});

test('if sharing fails for another reason, the file is downloaded instead', async () => {
  const nav = fakeNav({ share: async () => { throw Object.assign(new Error('nope'), { name: 'NotAllowedError' }); } });
  const downloads = [];
  assert.equal(await saveFile('x.seedr.json', '{}', { nav, download: (f) => downloads.push(f) }), 'downloaded');
  assert.equal(downloads.length, 1);
});
