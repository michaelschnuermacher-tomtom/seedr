import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, rmSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const IMPORT_RE = /^import\s+[^;]*?from\s+['"](.+?)['"];?[ \t]*$/gm;
const DECLARATION_RE = /^(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

// Concatenates ES modules in dependency order into one classic script.
// Requires single-line imports and unique top-level names across modules.
export function bundle(entry) {
  const ordered = [];
  const done = new Set();
  const visit = (file, stack) => {
    if (done.has(file)) return;
    if (stack.includes(file)) throw new Error(`Import cycle: ${[...stack, file].join(' -> ')}`);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) visit(resolve(dirname(file), m[1]), [...stack, file]);
    done.add(file);
    ordered.push({ file, src });
  };
  visit(resolve(entry), []);

  const declaredIn = new Map();
  const parts = ordered.map(({ file, src }) => {
    const name = relative(projectRoot, file);
    const body = src.replace(IMPORT_RE, '').replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm, '');
    for (const m of body.matchAll(DECLARATION_RE)) {
      const previous = declaredIn.get(m[1]);
      if (previous) throw new Error(`"${m[1]}" is declared in both ${previous} and ${name}`);
      declaredIn.set(m[1], name);
    }
    return `// ---- ${name} ----\n${body}`;
  });
  return `(() => {\n'use strict';\n${parts.join('\n')}\n})();\n`;
}

// Writes the app to `dist` (default: ./dist). Tests pass their own folder so parallel
// test files never overwrite each other's output.
export function build(dist = resolve(projectRoot, 'dist')) {
  const ui = (f) => resolve(projectRoot, 'src/ui', f);
  const js = bundle(ui('app.js'));
  if (/<\/script/i.test(js)) throw new Error('Bundle contains "</script", which would break the HTML file');
  const html = readFileSync(ui('index.html'), 'utf8')
    .replace('/* STYLES */', () => readFileSync(ui('styles.css'), 'utf8'))
    .replace('/* SCRIPT */', () => js);
  mkdirSync(dist, { recursive: true });
  writeFileSync(resolve(dist, 'index.html'), html);
  // Icons stay separate files (manifest, home screen); the service worker precaches them.
  rmSync(resolve(dist, 'photos'), { recursive: true, force: true }); // left over from older builds
  rmSync(resolve(dist, 'icons'), { recursive: true, force: true });
  cpSync(ui('icons'), resolve(dist, 'icons'), { recursive: true });
  const icons = ['icons/logo.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];
  const iconList = icons.map((p) => `'./${p}'`).join(', ');
  writeFileSync(resolve(dist, 'sw.js'), readFileSync(ui('sw.js'), 'utf8').replace('/* ICONS */', () => iconList));
  copyFileSync(ui('manifest.webmanifest'), resolve(dist, 'manifest.webmanifest'));
  console.log(`Built dist/index.html (${Math.round(html.length / 1024)} KB)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
