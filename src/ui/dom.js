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

export function formatSigned(x) {
  const v = Math.round(x * 10) / 10;
  // A real minus sign (−), as wide as the plus, so signed numbers line up.
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
}

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tournament';
}

export function newId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
