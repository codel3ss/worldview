/**
 * Icons are generated as data-URI SVGs so there is nothing to fetch and the
 * colour can follow the layer. Every glyph points "up" (0 deg = north) — the
 * renderer rotates it into the world heading.
 */

const cache = new Map();

function svg(body, { size = 32, color = '#50e3c2' } = {}) {
  const doc =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">` +
    body.replaceAll('{c}', color) +
    '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(doc)}`;
}

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

const GLYPHS = {
  // Planform silhouette: nose up, swept wings, tailplane.
  aircraft:
    '<path d="M16 2 L18.1 11.4 L29 18.2 L29 20.8 L18.1 17.6 L18.1 25.2 L21.6 28.1 L21.6 30 L16 28.4 L10.4 30 L10.4 28.1 L13.9 25.2 L13.9 17.6 L3 20.8 L3 18.2 L13.9 11.4 Z" fill="{c}" stroke="rgba(0,0,0,0.55)" stroke-width="0.7"/>',
  // Hull outline with a pointed bow.
  vessel:
    '<path d="M16 2 L20.5 12 L20.5 24 L16 30 L11.5 24 L11.5 12 Z" fill="{c}" stroke="rgba(0,0,0,0.55)" stroke-width="0.8"/>',
  // Bus + two panels.
  satellite:
    '<g stroke="rgba(0,0,0,0.5)" stroke-width="0.6"><rect x="13" y="11" width="6" height="10" rx="1" fill="{c}"/><rect x="3" y="13" width="8.5" height="6" fill="{c}" opacity="0.8"/><rect x="20.5" y="13" width="8.5" height="6" fill="{c}" opacity="0.8"/></g>',
  quake:
    '<g fill="none" stroke="{c}" stroke-width="2.4"><circle cx="16" cy="16" r="5"/><circle cx="16" cy="16" r="10.5" opacity="0.55"/></g>',
  fire:
    '<path d="M16 3 C19 9 24 11 24 18 a8 8 0 0 1 -16 0 C8 13 12 12 13 8 c2 3 1 5 3 6 1.5 -2 0.5 -7 0 -11 Z" fill="{c}" stroke="rgba(0,0,0,0.5)" stroke-width="0.6"/>',
  launch:
    '<path d="M16 2 c4 5 5.5 10 5.5 15 l3 6 -5 -2 -3.5 6 -3.5 -6 -5 2 3 -6 C10.5 12 12 7 16 2 Z" fill="{c}" stroke="rgba(0,0,0,0.5)" stroke-width="0.6"/>',
  bike:
    '<g stroke="{c}" stroke-width="2.2" fill="none"><circle cx="8.5" cy="21" r="5"/><circle cx="23.5" cy="21" r="5"/><path d="M8.5 21 L14 11 L20 21 M14 11 L19 11 M23.5 21 L18.5 12"/></g>',
  radio:
    '<g stroke="{c}" stroke-width="2" fill="none"><path d="M16 22 L16 8"/><circle cx="16" cy="24" r="3" fill="{c}"/><path d="M10 12 a8 8 0 0 1 12 0" opacity="0.8"/><path d="M7 8 a13 13 0 0 1 18 0" opacity="0.5"/></g>',
  camera:
    '<g><rect x="5" y="12" width="15" height="9" rx="1.5" fill="{c}"/><path d="M20 15 L27 11 L27 22 L20 18 Z" fill="{c}" opacity="0.8"/></g>',
  contact:
    '<circle cx="16" cy="16" r="6" fill="{c}" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>',
};

export function icon(kind, color, size = 32) {
  const body = GLYPHS[kind] ?? GLYPHS.contact;
  return cached(`${kind}|${color}|${size}`, () => svg(body, { color, size }));
}

/** A hollow tactical bracket used to mark the selected contact. */
export function selectionBracket(color = '#50e3c2', size = 64) {
  return cached(`bracket|${color}|${size}`, () =>
    svg(
      '<g fill="none" stroke="{c}" stroke-width="1.6">' +
        '<path d="M4 11 L4 4 L11 4 M21 4 L28 4 L28 11 M28 21 L28 28 L21 28 M11 28 L4 28 L4 21"/>' +
        '<circle cx="16" cy="16" r="1.4" fill="{c}" stroke="none"/>' +
        '</g>',
      { color, size },
    ),
  );
}
