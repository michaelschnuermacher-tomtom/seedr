import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printHeaderCss, printHeaderImages } from '../src/ui/print-header.js';

test('the print header puts the stripe and the logo in the top page margin', () => {
  const css = printHeaderCss();
  assert.match(css, /@media print \{ @page \{ @top-left \{/);
  assert.match(css, /SEEDR/);
  const { stripe, logo } = printHeaderImages();
  assert.ok(css.includes(stripe) && css.includes(logo));
});

test('the logo is a single SVG with a print size, not an image inside an image', () => {
  const svg = decodeURIComponent(printHeaderImages().logo.slice('data:image/svg+xml,'.length));
  assert.match(svg, /^<svg width="5mm" height="5mm" xmlns=/);
  assert.doesNotMatch(svg, /<image/);
});
