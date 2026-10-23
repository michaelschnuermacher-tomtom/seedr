import { logoDataUrl } from './logo.js';

// Header for every printed page: the Grand Slam stripe and the Seedr logo in the top page
// margin (a CSS page margin box), so it repeats on each page without covering content.
const SLAM = ['#2596be', '#1f3c88', '#c8553d', '#006633']; // AO, US Open, Roland Garros, Wimbledon

const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

export function printHeaderCss() {
  const stripe = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="186mm" height="1.5mm" viewBox="0 0 4 1" preserveAspectRatio="none">${
    SLAM.map((c, i) => `<rect x="${i}" width="1" height="1" fill="${c}"/>`).join('')}</svg>`);
  const logo = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="5mm" height="5mm"><image href="${logoDataUrl()}" width="100%" height="100%"/></svg>`);
  return `@media print { @page { @top-left {
  content: ${stripe} "\\A\\A" ${logo} "  SEEDR";
  white-space: pre; vertical-align: bottom; padding-bottom: 3mm;
  font: 600 8pt system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: .12em; color: #2596be;
} } }`;
}

export function installPrintHeader(doc = document) {
  const style = doc.createElement('style');
  style.textContent = printHeaderCss();
  doc.head.append(style);
}
