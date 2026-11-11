// Тест: sprinklerZoneCells совпадает с прежним полным перебором всех клеток поля.
import { sprinklerZoneCells } from '../src/geometry.js';

const TILE = 32;

// прежняя реализация (копия перебора всех клеток из render.js)
function zoneCellsBrute(gridW, gridH, tile, px, py, radius) {
  const cells = [];
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const dx = (x * tile + tile / 2 - px) / tile / radius[0];
      const dy = (y * tile + tile / 2 - py) / tile / radius[1];
      if (dx * dx + dy * dy <= 1) cells.push({ x, y });
    }
  }
  return cells;
}

const key = (list) => list.map((c) => `${c.x},${c.y}`).sort().join(';');

const radii = [[4.5, 2.5], [4, 2], [2.5, 1.5]];
const grids = [[24, 16], [40, 40]];
const centers = [
  // в клетках и на дробных (x.5) позициях, у границ поля
  [0, 0], [0.5, 0.5], [4, 7], [11.5, 7.5], [12, 8], [0.5, 8], [23, 15],
  [23.5, 15.5], [39.5, 39.5], [39, 0], [19.5, 0.5], [20, 20], [39.5, 0.5],
];

let fails = 0;
let count = 0;
for (const [gw, gh] of grids) {
  for (const r of radii) {
    for (const [cx, cy] of centers) {
      const px = cx * TILE + TILE / 2, py = cy * TILE + TILE / 2;
      // центры за пределами поля тоже допустимы (клетки должны обрезаться)
      for (const [ox, oy] of [[-TILE / 2, 0], [gw * TILE, gh * TILE]]) {
        const a = key(sprinklerZoneCells(gw, gh, TILE, px + ox, py + oy, r));
        const b = key(zoneCellsBrute(gw, gh, TILE, px + ox, py + oy, r));
        count++;
        if (a !== b) {
          fails++;
          console.error(`MISMATCH grid ${gw}x${gh} r=${r} center=(${cx},${cy}) offset=(${ox},${oy})`);
          console.error('  fast :', a);
          console.error('  brute:', b);
        }
      }
      count++;
      const a = key(sprinklerZoneCells(gw, gh, TILE, px, py, r));
      const b = key(zoneCellsBrute(gw, gh, TILE, px, py, r));
      if (a !== b) {
        fails++;
        console.error(`MISMATCH grid ${gw}x${gh} r=${r} center=(${cx},${cy})`);
        console.error('  fast :', a);
        console.error('  brute:', b);
      }
    }
  }
}
// зона должна быть непустой в центре поля
const mid = sprinklerZoneCells(24, 16, TILE, 12 * TILE, 8 * TILE, [4, 2]);
if (mid.length === 0) { fails++; console.error('MISMATCH: empty zone in field centre'); }

if (fails) {
  console.error(`test_geometry: ${fails}/${count} cases FAILED`);
  process.exit(1);
}
console.log(`test_geometry: ${count} cases OK`);
