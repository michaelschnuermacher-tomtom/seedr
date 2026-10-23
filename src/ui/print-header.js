import { LOGO_SVG } from './logo.js';

// Header for every printed page: the Grand Slam stripe and the Seedr logo in the top page
// margin (a CSS page margin box), so it repeats on each page without covering content.
const SLAM = ['#2596be', '#1f3c88', '#c8553d', '#006633']; // AO, US Open, Roland Garros, Wimbledon

const dataUrl = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

// The two pictures of the header. The logo is used directly with a print size, not wrapped
// in another SVG: an image inside an SVG image loads separately, and printing can start
// before it has (no logo on paper).
export function printHeaderImages() {
  return {
    stripe: dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="186mm" height="1.5mm" viewBox="0 0 4 1" preserveAspectRatio="none">${
      SLAM.map((c, i) => `<rect x="${i}" width="1" height="1" fill="${c}"/>`).join('')}</svg>`),
    logo: dataUrl(LOGO_SVG.replace('<svg ', '<svg width="5mm" height="5mm" ')),
  };
}

export function printHeaderCss() {
  const { stripe, logo } = printHeaderImages();
  return `@media print { @page { @top-left {
  content: url("${stripe}") "\\A\\A" url("${logo}") "  SEEDR";
  white-space: pre; vertical-align: bottom; padding-bottom: 3mm;
  font: 600 8pt system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: .12em; color: #2596be;
} } }`;
}

// Kept so the browser holds the decoded pictures: they are only used when printing, and a
// first print right after starting the app should not have to wait for them.
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
