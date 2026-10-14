import { h } from './dom.js';

// On touch devices (iPad) a download link may do nothing in home-screen mode, so the
// system share sheet ("Save to Files", Dropbox, AirDrop) is used when it supports files.
export async function saveFile(name, text, { nav, download }) {
  const file = new File([text], name, { type: 'application/json' });
  if (nav?.maxTouchPoints > 0 && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  download(file);
  return 'downloaded';
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = h('a', { href: url, download: file.name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
