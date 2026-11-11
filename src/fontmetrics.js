// Glyph advances of the original bitmap fonts (assets/fonts/<name>.dat) and the popup-menu layout.
//
// .dat: u16 texW, u16 texH, u16 cell, u16 0, then 65536 records {u16 advance, u16 code}.
// CFontHost (sub_429A80): table[code] = advance * 2 / (texW / cell); width of a text = sum(table) * fontSize
// (sub_429FA0). The CTextElement with `autosize true` resizes its parent to exactly that width (sub_4331E0).

const cache = new Map();

/** font file used by a language pack (config_scripts.txt: @language ... #string font) */
export function fontForLang(lang) {
  return lang === 'chn' || lang === 'jap' || lang === 'kor' ? lang : 'uni';
}

export function parseFont(buf) {
  const dv = new DataView(buf);
  const texW = dv.getUint16(0, true);
  const cell = dv.getUint16(4, true) || 1;
  const k = 2 / (texW / cell);
  const table = new Float32Array(65536);
  const n = Math.min(65536, Math.floor((buf.byteLength - 8) / 4));
  for (let i = 0; i < n; i++) {
    const adv = dv.getUint16(8 + i * 4, true);
    const code = dv.getUint16(10 + i * 4, true);
    if (adv) table[code] = adv * k;
  }
  return table;
}

export async function loadFont(name) {
  if (cache.has(name)) return cache.get(name);
  const res = await fetch(`assets/fonts/${name}.dat`);
  if (!res.ok) throw new Error('font ' + name);
  const table = parseFont(await res.arrayBuffer());
  cache.set(name, table);
  return table;
}

export function loadedFont(name) { return cache.get(name) || null; }

export function textWidth(table, text, size) {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += table[text.charCodeAt(i)] || 0;
  return sum * size;
}

/**
 * CPopupMenu horizontal layout (sub_4391A0). `widths` = item sizes, `margin` = distance between item
 * edges, `popupW` = menu width, `autosize` = menu grows instead of overflowing.
 * Returns the item centres relative to the menu centre, the index of the first item that did not fit
 * (-1 = all fit) and the total width.
 */
export function layoutPopup(widths, margin, popupW, autosize = false) {
  let total = -margin;
  let overflow = -1;
  for (let i = 0; i < widths.length; i++) {
    total += margin + widths[i];
    if (!autosize && popupW < total) {
      overflow = i;
      total -= margin + widths[i];
      break;
    }
  }
  const xs = [];
  if (widths.length) {
    let x = (margin + widths[0]) * 0.5 - total * 0.5;
    xs.push(x);
    for (let i = 1; i < widths.length; i++) {
      x += (widths[i - 1] + widths[i]) * 0.5 + margin;
      xs.push(x);
    }
  }
  return { xs, overflow, total };
}
