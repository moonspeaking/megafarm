#!/usr/bin/env node
// Задача 35: сохранение/загрузка на всех уровнях 1..12 (без браузера, игру не меняем).
//
// Для каждого уровня: создаётся World (как в test_savegame.mjs), гонится игровая
// симуляция с детерминированным псевдослучайным вводом (свой PRNG с seed: клики по
// клеткам поля, покупки из магазина, отмена/размещение покупки на курсоре) до
// 60, 180 и 400 игровых секунд. В каждой точке:
//   serialize() -> JSON.parse(JSON.stringify()) -> новый World.restore() -> serialize()
// и снимки сравниваются глубоко (допустимы отличия только в явно несохраняемых полях).
//
// Явно НЕ сохраняемые поля (в serialize() не попадают, на сравнение снимков не влияют):
//   world.ambientT       — таймер фоновых звуков уровня;
//   hero.path/task/act   — маршрут и текущее действие героини;
//   worker.goal/act/path/moving — цели и пути работников (пере-обдумываются после загрузки);
//   bee.target           — пересоздаётся при restore (transient AI, sim_bees.js);
//   world.particles      — частицы; world.pending — покупка на курсоре; world.over.
// Список допустимых расхождений путей в снимках пуст: любое расхождение — ошибка.
//
// Вывод — таблица «уровень × момент → ok/расхождение (поле)»; код возврата != 0 при расхождении.
// Запуск: node tools/test_savegame_all.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World, TILE } from '../src/sim.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LEVELS = 12;
const STEP = 0.5;              // как в smoke_levels.mjs
const CHECKPOINTS = [60, 180, 400]; // игровые секунды
const PROBE_STEPS = 10;        // короткий прогон восстановленного мира после restore
const INPUT_SEED = 0x35350000; // база seed ввода: + номер уровня * 7919
const RANDOM_SEED = 20261111;  // seed подменённого Math.random (детерминизм между запусками)

// Скрипты грузятся через fetch от корня сервера; подменяем чтением с диска.
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]+/, '');
  let abs = path.join(ROOT, rel);
  if (rel.startsWith('/')) abs = rel;
  try {
    const text = await fs.readFile(abs, 'utf8');
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, text: async () => '', json: async () => { throw new Error('not found: ' + rel); } };
  }
};

const stubAssets = { resolve: () => null, load: () => null, image: () => null, sound: () => null, missing: new Set() };

function makeHooks(rec) {
  return {
    showMessage: () => {}, notify: () => {},
    showEnd: (result) => { if (!rec.over) rec.over = result; },
    updateHud: () => {}, updateShop: () => {}, updateTasks: () => {},
    playSound: () => {}, showHelp: () => {},
  };
}

function shortStack(err) {
  return String(err && err.stack || err).split('\n').slice(0, 3).join(' | ');
}

function fail(msg) {
  console.error(`ОШИБКА: ${msg}`);
  process.exit(1);
}

/** Детерминированный PRNG (mulberry32) — как в test_savegame.mjs. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** sim.js сыпет Math.random при спавне разбрызгателей, в частицах и в ambient —
 * подменяем его на время всего прогона, чтобы 3 запуска подряд были идентичны. */
function withDeterministicRandom(fn) {
  const realRandom = Math.random;
  Math.random = mulberry32(RANDOM_SEED);
  try {
    return fn();
  } finally {
    Math.random = realRandom;
  }
}

/** Глубокое сравнение снимков: список расхождений (до limit) с путём до поля. */
function diffList(a, b, where, out, limit) {
  if (out.length >= limit) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return;
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9) return;
    out.push(`${where}: ${a} != ${b}`);
    return;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.push(`${where}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${where}: тип-массива расходится`);
    return;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  const extra = ka.filter((k) => !kb.includes(k)).concat(kb.filter((k) => !ka.includes(k)));
  if (extra.length) {
    out.push(`${where}: ключи расходятся (${extra.join(', ')})`);
    return;
  }
  for (const k of ka) {
    diffList(a[k], b[k], `${where}.${k}`, out, limit);
    if (out.length >= limit) return;
  }
}

/** Краткая сводка состава мира для таблицы: kinds и пчёлы. */
function kindsSummary(w) {
  const n = {};
  for (const o of w.objects) n[o.kind] = (n[o.kind] || 0) + 1;
  const bees = w.objects.reduce((s, o) => s + (o.bees ? o.bees.length : 0), 0);
  const held = w.hero.held && w.hero.held.kind !== 'spade' ? `, в руках ${w.hero.held.name || w.hero.held.kind}` : '';
  const parts = Object.keys(n).map((k) => `${k}:${n[k]}`);
  if (bees) parts.push(`пчёл:${bees}`);
  return parts.join(' ') + held;
}

function nanProblems(w) {
  const problems = [];
  const num = (label, v) => { if (!Number.isFinite(v)) problems.push(`${label}(${v})`); };
  num('money', w.money);
  num('time', w.time);
  num('hero.x', w.hero.x);
  num('hero.y', w.hero.y);
  for (const o of w.objects) {
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) problems.push(`объект ${o.name} x=${o.x} y=${o.y}`);
    if (o.bees) o.bees.forEach((b, i) => {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) problems.push(`пчела ${i} улья ${o.name}`);
    });
  }
  return problems;
}

/** Один шаг псевдослучайного ввода: покупки из магазина, клики по клеткам поля.
 * Покупку на курсоре разрешаем всегда (она не связана с героиней); игровой клик —
 * только когда героиня свободна, иначе её постоянные переехывания не дают задачам
 * выполняться и мир остаётся бедным. */
function driveInput(w, rng) {
  if (w.pending) {
    if (rng() < 0.8) {
      // клик по случайной внутренней клетке поля: placePending
      const cx = 2 + Math.floor(rng() * (w.gridW - 4));
      const cy = 2 + Math.floor(rng() * (w.gridH - 4));
      w.click(cx * TILE + TILE / 2, cy * TILE + TILE / 2, false);
    } else {
      w.rightClick(); // отмена выбора без списания денег
    }
    return;
  }
  if (rng() < 0.25) return; // иногда просто ждём
  const h = w.hero;
  const busy = h.task || h.act || (h.path && h.path.length);
  if (busy) return;
  const roll = rng();
  if (roll < 0.18) {
    // покупка случайного товара из текущего магазина (все категории)
    const cats = Object.keys(w.shop);
    const cat = cats[Math.floor(rng() * cats.length)];
    const list = w.shop[cat] || [];
    if (list.length) w.buy(list[Math.floor(rng() * list.length)]);
    return;
  }
  if (roll < 0.22 && h.held && h.held.kind !== 'spade') {
    w.selectTool('spade'); // вернуть лопату: несомый предмет кладётся под ноги
    return;
  }
  // клик по случайной точке поля (может попасть в предмет/растение/грядку — как в игре)
  const wx = 2 * TILE + rng() * (w.worldW - 4 * TILE);
  const wy = 2 * TILE + rng() * (w.worldH - 4 * TILE);
  w.click(wx, wy, rng() < 0.15);
}

/** Контрольная точка: serialize -> JSON-круг -> restore -> serialize, глубокое сравнение. */
function checkpoint(db, levelNum, w, mark, rows) {
  const row = { level: levelNum, mark, ok: false, note: '' };
  try {
    const data = JSON.parse(JSON.stringify(w.serialize()));
    const fresh = new World(db, stubAssets, levelNum, makeHooks({ over: null }));
    fresh.restore(data);
    const after = fresh.serialize();
    const diffs = [];
    diffList(data, after, 'snapshot', diffs, 5);
    // короткий прогон восстановленного мира: restore не должен ломать симуляцию
    for (let i = 0; i < PROBE_STEPS && !diffs.length; i++) fresh.update(STEP);
    const bads = nanProblems(fresh);
    if (diffs.length) {
      row.note = `расхождение: ${diffs.join(' | ')}`;
    } else if (bads.length) {
      row.note = `NaN после restore+прогона: ${bads.join('; ')}`;
    } else {
      row.ok = true;
      row.note = `объектов ${data.objects.length}, денег ${Math.round(w.money)}, грядок ${w.dugCount}; ${kindsSummary(w)}`;
    }
  } catch (err) {
    row.note = `исключение: ${shortStack(err)}`;
  }
  rows.push(row);
}

async function runLevel(db, levelNum, rows) {
  const rec = { over: null };
  const w = new World(db, stubAssets, levelNum, makeHooks(rec));
  w.start();
  const rng = mulberry32(INPUT_SEED + levelNum * 7919);
  const targets = [...CHECKPOINTS];
  const maxSteps = Math.ceil(CHECKPOINTS[CHECKPOINTS.length - 1] / STEP) + 40;
  let steps = 0;
  while (targets.length && steps < maxSteps) {
    driveInput(w, rng);
    try {
      w.update(STEP);
    } catch (err) {
      fail(`уровень ${levelNum}: падение симуляции на t=${w.time}s: ${shortStack(err)}`);
    }
    steps++;
    const bads = nanProblems(w);
    if (bads.length) fail(`уровень ${levelNum}: NaN на t=${w.time}s: ${bads.join('; ')}`);
    if (rec.over) {
      // уровень завершился (victory/fail): время стоит, оставшиеся точки снимаем сразу
      while (targets.length) checkpoint(db, levelNum, w, `${targets.shift()} (после конца уровня, t=${w.time.toFixed(1)}s)`, rows);
      break;
    }
    if (w.time + 1e-9 >= targets[0]) {
      checkpoint(db, levelNum, w, `t=${targets.shift()}s`, rows);
    }
  }
  if (targets.length) fail(`уровень ${levelNum}: не дошёл до точек ${targets.join(', ')} за ${steps} шагов`);
  return rec;
}

async function main() {
  const manifest = await loadManifest();
  const db = await loadData(manifest);
  if (db.levels.size < LEVELS) fail(`загрузилось только ${db.levels.size} уровней из ${LEVELS}`);
  const rows = [];
  withDeterministicRandom(() => {
    for (let n = 1; n <= LEVELS; n++) {
      if (!db.levels.has(n)) fail(`уровень ${n} не загрузился`);
      runLevel(db, n, rows);
    }
  });

  // итоговая таблица «уровень × момент → ok/расхождение (поле)»
  console.log('уровень | момент | итог');
  console.log('--------|--------|-----');
  let bad = 0;
  for (const r of rows) {
    const mark = r.ok ? `ok (${r.note})` : `FAIL — ${r.note}`;
    if (!r.ok) bad++;
    console.log(`L${String(r.level).padStart(2, '0')}  | ${r.mark.padEnd(28)} | ${mark}`);
  }
  console.log(`итог: ${rows.length - bad}/${rows.length} точек чисто${bad ? `, расхождений: ${bad}` : ''}`);
  process.exit(bad ? 1 : 0);
}

main().catch((err) => { console.error(shortStack(err)); process.exit(2); });
