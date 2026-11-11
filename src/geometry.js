// Чистые геометрические функции без зависимостей от рендера и симуляции.

/**
 * Клетки зоны разбрызгивателя: центры клеток в сетке gridW×gridH (размер клетки tile px),
 * лежащие в эллипсе ((dx/rx)^2 + (dy/ry)^2 <= 1). radius = [rx, ry] в клетках, px/py — пиксельный
 * центр. Перебираем только ограничивающий прямоугольник эллипса, а не всё поле.
 * @returns {Array<{x:number, y:number}>}
 */
export function sprinklerZoneCells(gridW, gridH, tile, px, py, radius) {
  const rx = radius[0], ry = radius[1];
  const half = tile / 2;
  // центры клеток: x*tile + tile/2; ищем диапазон индексов по прямоугольнику эллипса
  const x0 = Math.max(0, Math.ceil((px - rx * tile - half) / tile));
  const x1 = Math.min(gridW - 1, Math.floor((px + rx * tile - half) / tile));
  const y0 = Math.max(0, Math.ceil((py - ry * tile - half) / tile));
  const y1 = Math.min(gridH - 1, Math.floor((py + ry * tile - half) / tile));
  const cells = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x * tile + half - px) / tile / rx;
      const dy = (y * tile + half - py) / tile / ry;
      if (dx * dx + dy * dy <= 1) cells.push({ x, y });
    }
  }
  return cells;
}
