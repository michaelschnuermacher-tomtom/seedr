// Renders the app icons from src/ui/logo.js with headless Chrome.
// Run after changing the logo:  node tools/make-icons.mjs
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOGO_SVG, logoDataUrl } from '../src/ui/logo.js';

const out = new URL('../src/ui/icons/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'logo.svg'), `${LOGO_SVG}\n`);

const work = mkdtempSync(join(tmpdir(), 'seedr-icons-'));
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  const page = join(work, `${size}.html`);
  // Full-bleed white square: iOS and Android round the corners themselves.
  writeFileSync(page, `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:#fff;display:grid;place-items:center"><img src="${logoDataUrl()}" style="width:${Math.round(size * 0.78)}px"></body></html>`);
  execFileSync('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${join(work, 'profile')}`,
    '--hide-scrollbars', `--window-size=${size},${size}`, `--screenshot=${join(out, name)}`, `file://${page}`], { stdio: 'ignore', timeout: 60000 });
  console.log(`wrote src/ui/icons/${name}`);
}
