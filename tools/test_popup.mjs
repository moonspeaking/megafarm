// Checks the CPopupMenu layout (src/fontmetrics.js) against values derived from the original exe
// and measured on a screenshot of the original game (English tabs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFont, textWidth, layoutPopup } from '../src/fontmetrics.js';

const buf = readFileSync(new URL('../assets/fonts/uni.dat', import.meta.url));
const table = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const words = ['SUPPLIES', 'BUILDINGS', 'SEEDS', 'PLANTS', 'TREES', 'WORKERS'];
const w = words.map((s) => textWidth(table, s, 12));
// widths measured on the original screenshot: 73, 86, 49, 61, 47 (+- 1)
[73, 86.8, 48.5, 60.6, 47.6].forEach((v, i) => assert.ok(Math.abs(w[i] - v) < 1, `${words[i]} ${w[i]}`));

// six tabs fit into 800, centred, shifted right by margin/2
const lay = layoutPopup(w, 32, 800);
assert.equal(lay.overflow, -1);
const total = w.reduce((a, b) => a + b, 0) + 5 * 32;
assert.ok(Math.abs(lay.total - total) < 1e-6);
assert.ok(Math.abs(lay.xs[0] - ((32 + w[0]) / 2 - total / 2)) < 1e-6);
// tab bodies are 32 apart and the 16px caps touch each other
for (let i = 1; i < 6; i++) {
  const gap = (lay.xs[i] - w[i] / 2) - (lay.xs[i - 1] + w[i - 1] / 2);
  assert.ok(Math.abs(gap - 32) < 1e-6);
}

// 58px speed_buttons with margin 0: 13 fit into 800, the 14th overflows
const items = layoutPopup(Array(10).fill(58), 0, 800);
assert.ok(Math.abs(items.xs[0] - (29 - 290)) < 1e-6);
const many = layoutPopup(Array(14).fill(58), 0, 800);
assert.equal(many.overflow, 13);
assert.equal(many.total, 13 * 58);
console.log('test_popup ok');
