import { LOGO_SVG } from './logo.js';

// Header for every printed page: the Grand Slam stripe and the Seedr logo in the top page
// margin (a CSS page margin box), so it repeats on each page without covering content.
const SLAM = ['#2596be', '#1f3c88', '#c8553d', '#006633']; // AO, US Open, Roland Garros, Wimbledon

const dataUrl = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

// The stripe is the background of the margin box, so it is always as wide as the printed
// area, on A4 as on Letter paper: four equal colors.
const STRIPE = `linear-gradient(to right, ${SLAM.map((c, i) => `${c} ${i * 25}% ${(i + 1) * 25}%`).join(', ')})`;

// The logo is used directly with a print size, not wrapped in another SVG: an image inside
// an SVG image loads separately, and printing can start before it has (no logo on paper).
export function printHeaderImages() {
  return { logo: dataUrl(LOGO_SVG.replace('<svg ', '<svg width="5mm" height="5mm" ')) };
}

export function printHeaderCss() {
  const { logo } = printHeaderImages();
  return `@media print { @page { @top-left {
  width: 100%; content: url("${logo}") "  SEEDR";
  background: ${STRIPE} left 9.5mm / 100% 1.5mm no-repeat;
  white-space: pre; vertical-align: bottom; padding-bottom: 3mm;
  font: 600 8pt system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: .12em; color: #2596be;
} } }`;
}

// Kept so the browser holds the decoded logo: it is only used when printing, and a first
// print right after starting the app should not have to wait for it.
const preloaded = [];

export function installPrintHeader(doc = document) {
  const style = doc.createElement('style');
  style.textContent = printHeaderCss();
  doc.head.append(style);
  for (const src of Object.values(printHeaderImages())) {
    const img = new Image();
    img.src = src;
    img.decode?.().catch(() => {});
    preloaded.push(img);
  }
}
