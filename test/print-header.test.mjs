import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printHeaderCss, printHeaderImages } from '../src/ui/print-header.js';

test('the print header puts the stripe and the logo in the top page margin', () => {
  const css = printHeaderCss();
  assert.match(css, /@media print \{ @page \{ @top-left \{/);
  assert.match(css, /SEEDR/);
  assert.ok(css.includes(printHeaderImages().logo));
  // The stripe stretches with the margin box (A4 or Letter): four equal colors.
  assert.match(css, /width: 100%/);
  assert.match(css, /linear-gradient\(to right, #2596be 0% 25%, #1f3c88 25% 50%, #c8553d 50% 75%, #006633 75% 100%\) left 9\.5mm \/ 100% 1\.5mm no-repeat/);
});

test('the logo is a single SVG with a print size, not an image inside an image', () => {
  const svg = decodeURIComponent(printHeaderImages().logo.slice('data:image/svg+xml,'.length));
  assert.match(svg, /^<svg width="5mm" height="5mm" xmlns=/);
  assert.doesNotMatch(svg, /<image/);
});
