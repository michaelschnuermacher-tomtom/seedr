// Creates an element. Props: "class", "on<event>" handlers, value/checked/disabled/selected
// as properties, everything else as attributes. null/false props and children are skipped.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// A window of the app itself (not the browser's, which names the website): a title, a
// line of text, and two buttons. Resolves with true when confirmed, false when cancelled
// (Cancel, Escape or a tap outside).
export function confirmAsk({ title, text = '', ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const dialog = h('dialog', { class: 'ask' },
      h('form', {
        onsubmit: (e) => {
          e.preventDefault();
          result = true;
          dialog.close();
        },
      },
      h('h2', {}, title),
      text ? h('p', {}, text) : null,
      h('div', { class: 'actions' },
        h('button', { type: 'submit', class: danger ? 'danger-solid' : 'primary' }, ok),
        h('button', { type: 'button', onclick: () => dialog.close() }, cancel))));
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // a tap outside
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('button[type=submit]').focus();
  });
}

// Says why something cannot be changed (yet or any more), right where it would be changed.
export function lockedNote(text) {
  return h('p', { class: 'locked-note' }, h('span', { 'aria-hidden': 'true' }, '🔒 '), text);
}

export function formatSigned(x) {
  const v = Math.round(x * 10) / 10;
  // A real minus sign (−), as wide as the plus, so signed numbers line up.
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
}

export function newId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
