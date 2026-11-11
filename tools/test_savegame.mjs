#!/usr/bin/env node
// Тест сохранения/загрузки без браузера (data.js и sim.js не зависят от DOM).
// Сценарий 1, уровень 3: середина уровня, богатый мир (грядки, растения, работник).
// Сценарий 2, уровень 6 (dahlia/tulip/sunflower + beehive): ставим улей, ждём вылета
// пчёл, сериализуем прямо в полёте, восстанавливаем в новый мир, сравниваем
// состояние и гоним ещё 200 шагов (пчёлы продолжают носить мёд).
// Запуск: node tools/test_savegame.mjs (код возврата != 0 при ошибках).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World } from '../src/sim.js';
import { shouldAutosave } from '../src/savegame.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LEVEL_VEG = 3;   // сценарий 1: растения/грядки/работник
const LEVEL_BEE = 6;   // сценарий 2: улей и пчёлы
const STEP = 0.5;      // как в smoke_levels.mjs
const PROBE = 200;     // шагов после восстановления

// Задача 20: детерминированный снимок сейва улья. Хеш снят ДО выноса пчёл из sim.js;
// после рефакторинга сериализация должна быть побитово той же.
const HIVE_HASH_STEPS = 600; // шагов по STEP секунд
const HIVE_HASH_SEED = 2020; // seed детерминированного Math.random
const EXPECTED_HIVE_HASH = '50f6e67b39a5f32f09110fd6af94862eb0bb0abbd929835f527d0d14b03c2b47';

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

/** Задача 19: чистая функция shouldAutosave(state, existingSave) решает, сохранять ли
 * мир при закрытии вкладки: только в идущем (незавершённом) уровне и не затирая
 * сейв другого уровня. */
function testShouldAutosave() {
  const cases = [
    // [описание, state, existingSave, ожидание]
    ['в меню (не в уровне)', { inLevel: false, over: null, level: 3 }, null, false],
    ['после победы (уровень завершён)', { inLevel: true, over: 'victory', level: 3 }, { level: 3, version: 1 }, false],
    ['после поражения (уровень завершён)', { inLevel: true, over: 'defeat', level: 6 }, null, false],
    ['идёт уровень, сейва ещё нет', { inLevel: true, over: null, level: 3 }, null, true],
    ['идёт уровень, сейв того же уровня', { inLevel: true, over: null, level: 6 }, { level: 6, version: 1 }, true],
    ['идёт уровень, сейв другого уровня (не затирать)', { inLevel: true, over: null, level: 6 }, { level: 3, version: 1 }, false],
    ['пауза в уровне — сохранять можно', { inLevel: true, over: null, paused: true, level: 3 }, { level: 3, version: 1 }, true],
  ];
  for (const [label, state, save, want] of cases) {
    const got = shouldAutosave(state, save);
    if (got !== want) fail(`shouldAutosave (${label}): ожидалось ${want}, получено ${got} [state=${JSON.stringify(state)}, save=${JSON.stringify(save)}]`);
  }
  console.log(`shouldAutosave: ${cases.length} случаев — все верно`);
}

/** A few "hand moves" directly through the world's public methods. */
function enrichWorld(w, db) {
  const cell = (cx, cy) => w.cell(cx, cy);
  const spot = w.freeCellNear(3, 3) || { x: 1, y: 1 };
  const plantSpots = [];
  for (let dy = 0; dy < 3 && plantSpots.length < 3; dy++) {
    for (let dx = 0; dx < 3 && plantSpots.length < 3; dx++) {
      const c = cell(spot.x + dx + 2, spot.y + dy);
      if (c && !c.blocked && !c.occupant && !c.plant) {
        c.dug = true; c.wet = 1; w.dugCount++;
        plantSpots.push(c);
      }
    }
  }
  // растения в разных стадиях: «свежая», «почти зрелая», «готова к уборке»
  const plantTypes = [...db.objects.values()].filter((d) => d.type === 'plant').slice(0, 3);
  plantTypes.forEach((def, i) => {
    const c = plantSpots[i] || plantSpots[0];
    if (!c) return;
    const p = w.spawn(def.name, c.x, c.y); // spawn сам прикрепляет растение к клетке
    if (p) {
      if (i === 1) { p.growth = 99; p.fruitProg = 40; }
      if (i === 2) { p.growth = 100; p.fruitPhase = true; p.ready = true; p.fruits = 1; p.spoil = 30; }
      w.waterPlant(p);
    }
  });
  // предметы и работник (сериализация ресурсов и AI-счётчиков)
  const pickup = (name, dx, dy) => {
    const def = db.objects.get(name);
    if (def && w.objects.every((o) => o.name !== name)) {
      const c = w.freeCellNear(spot.x + dx, spot.y + (dy || 0)) || spot;
      w.spawn(name, c.x, c.y);
    }
  };
  pickup('box', 5);
  pickup('watercan', 6);
  pickup('fertilizer', 7);
  if (db.objects.get('harvester')) {
    const hc = w.freeCellNear(spot.x, spot.y + 2) || spot;
    const wk = w.spawnWorker('harvester', hc.x, hc.y);
    if (wk) {
      wk.state = 'work';
      wk.workLeft = 40;
      wk.box = { type: plantTypes[0] ? String(plantTypes[0].name).replace(/^plant_/, '') : null, count: 2 };
    }
  }
}
function diff(a, b, where) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return null;
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9) return null;
    return `${where}: ${a} != ${b}`;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return a === b ? null : `${where}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${where}: тип-массива расходится`;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) {
    const extra = ka.filter((k) => !kb.includes(k)).concat(kb.filter((k) => !ka.includes(k)));
    return `${where}: ключи расходятся (${extra.join(', ')})`;
  }
  for (const k of ka) {
    const d = diff(a[k], b[k], `${where}.${k}`);
    if (d) return d;
  }
  return null;
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
    if (o.bees) {
      o.bees.forEach((b, i) => {
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) problems.push(`пчела ${i} улья ${o.name} x=${b.x} y=${b.y}`);
      });
    }
  }
  return problems;
}

/** «Садовник» в прогоне: держит цветы зрелыми и политыми, иначе зрелый плод
 * портится за 4 тика (+25 spoil/с) и пчёлам становится некуда лететь. */
function gardener(flowers) {
  for (const f of flowers) {
    if (f.dead) continue;
    if (!f.ready || (f.spoil || 0) >= 100) { f.ready = true; f.spoil = 0; f.fruits = 1; }
    if ((f.dry || 0) > 40) { f.dry = 0; f.thirsty = false; }
  }
}

/** Детерминированный PRNG (mulberry32) для подмены Math.random в тесте. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Запускает fn с подменённым Math.random (sim.js сыпет им при спавне
 * разбрызгателей и в частицах) и возвращает результат. */
function withDeterministicRandom(fn) {
  const realRandom = Math.random;
  Math.random = mulberry32(HIVE_HASH_SEED);
  try {
    return fn();
  } finally {
    Math.random = realRandom;
  }
}

/** Задача 20: сценарий улья (как hiveScenario) с фиксированным seed, 600 шагов по
 * 0.5 с, затем sha256 от JSON.stringify(world.serialize()). Хеш-константа снята
 * до рефакторинга пчёл; расхождение = поведение изменилось. */
function hiveDeterministicScenario(db) {
  console.log(`=== уровень ${LEVEL_BEE}: детерминированный снимок сейва улья (${HIVE_HASH_STEPS} шагов, seed ${HIVE_HASH_SEED})`);
  const hash = withDeterministicRandom(() => {
    const rec = { over: null };
    let world, hive;
    try {
      world = new World(db, stubAssets, LEVEL_BEE, makeHooks(rec));
      world.start();
    } catch (err) {
      fail('создание/старт (снимок улья): ' + shortStack(err));
    }
    const spot = world.freeCellNear(3, 3) || { x: 1, y: 1 };
    hive = world.spawn('beehive', spot.x, spot.y);
    if (!hive || !hive.bees || !hive.bees.length) fail('улей не появился (spawn beehive, снимок)');
    // ripe-цветы рядом, как в hiveScenario
    const flowers = [];
    for (const name of ['plant_dahlia', 'plant_tulip', 'plant_sunflower']) {
      if (!db.objects.get(name)) continue;
      let placed = false;
      for (let r = 1; r < 12 && !placed; r++) {
        for (let dx = -r; dx <= r && !placed; dx++) {
          for (let dy = -r; dy <= r && !placed; dy++) {
            const c = world.cell(spot.x + dx, spot.y + dy);
            if (!(c && !c.blocked && !c.occupant && !c.plant)) continue;
            const f = world.spawn(name, c.x, c.y);
            if (!f) continue;
            f.growth = 100; f.fruitPhase = true; f.ready = true; f.fruits = 1; f.spoil = 0;
            flowers.push(f); placed = true;
          }
        }
      }
    }
    if (!flowers.length) fail('ripe-цветы не появились (снимок улья)');
    // Пчёлы летят только к ripe-цветам с spoil >= 100 (полностью «перезрелым»),
    // поэтому spoil НЕ сбрасываем — а вот от засыхания (гибели) цветы спасаем,
    // чтобы все 600 шагов updateBeehive прошёл через idle/out/pick/back.
    for (let step = 0; step < HIVE_HASH_STEPS; step++) {
      try {
        for (const f of flowers) {
          if (f.dead) continue;
          f.ready = true; f.fruits = 1;
          if ((f.dry || 0) > 0) { f.dry = 0; f.thirsty = false; }
        }
        world.update(STEP);
      } catch (err) {
        fail(`t=${world.time}s (снимок улья): ${shortStack(err)}`);
      }
      const bads = nanProblems(world);
      if (bads.length) fail(`t=${world.time}s NaN (снимок улья): ${bads.join('; ')}`);
    }
    const states = hive.bees.map((b) => b.state).join('/');
    console.log(`прогон ${HIVE_HASH_STEPS} шагов: t=${world.time}s, пчёл ${hive.bees.length} (${states}), progress=${hive.progress.toFixed(1)}`);
    return createHash('sha256').update(JSON.stringify(world.serialize())).digest('hex');
  });
  if (hash !== EXPECTED_HIVE_HASH) {
    fail(`хеш сейва улья изменился: получено ${hash}, ожидалось ${EXPECTED_HIVE_HASH}`);
  }
  console.log(`хеш сейва улья совпал: ${hash}`);
}

async function makeWorld(db, rec, doStart) {
  const w = new World(db, stubAssets, LEVEL_VEG, makeHooks(rec));
  if (doStart) w.start();
  return w;
}

/** Задача 10: сценарий с ульем и пчёлами (уровень 6 — в level6.txt есть place_beehive).
 * Ставим улей, ставим ripe-цветы, разводим пчёл по разным состояниям, serialize/restore,
 * сравниваем состояние и гоним ещё 200 шагов. */

async function hiveScenario(db) {
  if (!db.levels.has(LEVEL_BEE)) {
    console.error(`уровень ${LEVEL_BEE} не загрузился`);
    process.exit(2);
  }
  console.log(`=== уровень ${LEVEL_BEE}: улей и пчёлы`);
  const rec = { over: null };
  let world;
  try {
    world = new World(db, stubAssets, LEVEL_BEE, makeHooks(rec));
    world.start();
  } catch (err) {
    fail('создание/старт (уровень 6): ' + shortStack(err));
  }
  const spot = world.freeCellNear(3, 3) || { x: 1, y: 1 };
  const hive = world.spawn('beehive', spot.x, spot.y);
  if (!hive || !hive.bees || !hive.bees.length) fail('улей не появился (spawn beehive)');
  // ripe-цветы (type_fruit flower / sunflower): пчёлы летят только к готовым растениям
  const flowers = [];
  for (const name of ['plant_dahlia', 'plant_tulip', 'plant_sunflower']) {
    if (!db.objects.get(name)) continue;
    let placed = false;
    for (let r = 1; r < 12 && !placed; r++) {
      for (let dx = -r; dx <= r && !placed; dx++) {
        for (let dy = -r; dy <= r && !placed; dy++) {
          const c = world.cell(spot.x + dx, spot.y + dy);
          if (!(c && !c.blocked && !c.occupant && !c.plant)) continue;
          const f = world.spawn(name, c.x, c.y);
          if (!f) continue;
          // зрелый плод портится (+25 spoil/тик), поэтому сразу готовый: spoil=0
          f.growth = 100; f.fruitPhase = true; f.ready = true; f.fruits = 1; f.spoil = 0;
          flowers.push(f); placed = true;
        }
      }
    }
  }
  if (!flowers.length) fail('ripe-цветы не появились (пчёлам некуда лететь)');

  // ждём, пока пчёлы сами вылетят из улья к цветам (корректные цветы + wait 0..2.8с)
  let steps = 0;
  while (!hive.bees.some((b) => (b.state === 'out' || b.state === 'pick') && b.target) && steps < 100) {
    try {
      world.update(STEP);
    } catch (err) {
      fail(`t=${world.time}s до вылета пчёл: ${shortStack(err)}`);
    }
    const bads = nanProblems(world);
    if (bads.length) fail(`t=${world.time}s NaN: ${bads.join('; ')}`);
    steps++;
  }
  const flyingN = hive.bees.filter((b) => (b.state === 'out' || b.state === 'pick') && b.target).length;
  if (!flyingN) fail(`за ${steps} шагов пчёлы так и не вылетели (цветов ${flowers.length})`);
  console.log(`пчёлы вылетели сами на t=${world.time}s: в полёте ${flyingN}/${hive.bees.length}, цветов ${flowers.length}, progress=${hive.progress.toFixed(1)}%`);

  // и доукомплектуем состояния вручную: out/pick/back/idle — каждая ветка updateBeehive под тестом
  const bees = hive.bees;
  bees[0].state = 'out';   bees[0].target = flowers[0];
  bees[1].state = 'pick';  bees[1].target = flowers[1] || flowers[0]; bees[1].t = 0.42;
  bees[2].state = 'back';
  if (bees[3]) { bees[3].state = 'idle'; bees[3].wait = 0.3; }

  // serialize + круг через JSON, как это делает localStorage
  let data;
  try {
    data = JSON.parse(JSON.stringify(world.serialize()));
  } catch (err) {
    fail('сериализация (уровень 6): ' + shortStack(err));
  }
  const savedProgress = hive.progress;
  console.log(`сохранение на t=${world.time}s: пчёл ${bees.length} (${bees.map((b) => b.state).join('/')}), ` +
    `цветов ${flowers.length}, progress=${savedProgress.toFixed(1)}`);

  const rec2 = { over: null };
  let restored;
  try {
    restored = new World(db, stubAssets, LEVEL_BEE, makeHooks(rec2));
    restored.restore(data);
    restored.start();
  } catch (err) {
    fail('восстановление (уровень 6): ' + shortStack(err));
  }
  const hive2 = restored.objects.find((o) => o.name === 'beehive');
  if (!hive2 || !hive2.bees) fail('улей не восстановился');

  const d2 = diff(data, restored.serialize(), 'hive-serialize');
  if (d2) fail(`состояние после restore отличается: ${d2}`);
  const statesOk = hive2.bees.every((b) => ['idle', 'out', 'pick', 'back'].includes(b.state) &&
    Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.t) && Number.isFinite(b.wait));
  if (!statesOk) fail('пчёлы после restore в некорректном состоянии');
  const beeTargets = restored.objects.filter((o) => hive2.bees.some((b) => b.target === o));
  if (!beeTargets.every((o) => o.kind === 'plant' && o.ready)) fail('цели пчёл после restore не цветочные/не ripe');

  // +200 шагов: «садовник» держит цветы зрелыми и политыми (зрелый плод портится
  // за 4 тика), пчёлы летают, мёд набирается, ошибок и NaN нет
  const rFlowers = restored.objects.filter((o) => flowers.includes(o));
  for (let step = 0; step < PROBE; step++) {
    gardener(rFlowers);
    try {
      restored.update(STEP);
    } catch (err) {
      fail(`t=${restored.time}s после загрузки (уровень 6): ${shortStack(err)}`);
    }
    const bads = nanProblems(restored);
    hive2.bees.forEach((b, i) => {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) bads.push(`пчела ${i} x=${b.x} y=${b.y}`);
    });
    const prog = hive2.progress;
    if (!Number.isFinite(prog)) bads.push('hive.progress NaN');
    if (bads.length) fail(`t=${restored.time}s NaN: ${bads.join('; ')}`);
  }
  if (!(hive2.ready || hive2.progress > savedProgress)) {
    fail(`мёд не растёт после restore: progress=${hive2.progress}, было ${savedProgress}`);
  }
  const stillFlying = hive2.bees.filter((b) => (b.state === 'out' || b.state === 'pick') && b.target).length;
  console.log(`прогон ${PROBE} шагов после загрузки чистый: t=${restored.time}s, progress=${hive2.progress.toFixed(1)}, ` +
    `ready=${hive2.ready ? 1 : 0}, пчёл в полёте ${stillFlying}`);
  console.log('итог: savegame улья ок');
}

async function main() {
  testShouldAutosave();
  const manifest = await loadManifest();
  const db = await loadData(manifest);
  hiveDeterministicScenario(db);
  await hiveScenario(db);
  if (!db.levels.has(LEVEL_VEG)) {
    console.error(`уровень ${LEVEL_VEG} не загрузился`);
    process.exit(2);
  }
  console.log('=== уровень ' + LEVEL_VEG + ': разгон до середины уровня');
  const rec = { over: null };
  let world;
  try {
    world = await makeWorld(db, rec, true);
  } catch (err) {
    fail('создание/старт: ' + shortStack(err));
  }
  const halfSteps = Math.max(1, Math.round(world.levelTime / 2 / STEP)); // середина level_time
  for (let step = 0; step < halfSteps && !rec.over; step++) {
    try {
      world.update(STEP);
    } catch (err) {
      fail(`t=${world.time}s при разгоне: ${shortStack(err)}`);
    }
    const bads = nanProblems(world);
    if (bads.length) fail(`t=${world.time}s NaN: ${bads.join('; ')}`);
  }
  if (rec.over) console.log(`(уровень завершился раньше середины: over=${rec.over} на t=${world.time}s)`);

  // немного «игры руками»: грядки, растения в разных стадиях, предметы, работник —
  // чтобы сериализация покрыла все виды объектов, а не только пустое поле
  enrichWorld(world, db);
  console.log(`сохранение на t=${world.time}s, денег ${Math.round(world.money)}, объектов ${world.objects.length}, грядок ${world.dugCount}`);

  // сериализация + круг через JSON, как это делает localStorage
  let data;
  try {
    data = JSON.parse(JSON.stringify(world.serialize()));
  } catch (err) {
    fail('сериализация: ' + shortStack(err));
  }
  const kb = (JSON.stringify(data).length / 1024).toFixed(1);
  console.log(`serialize() -> ${kb} KB, объектов: ${data.objects.length}, действий со сценарием: ${data.actions.length}`);

  // восстановление в новый мир: свежий World без start() — как в startLevel(num, true)
  const rec2 = { over: null };
  let restored;
  try {
    restored = new World(db, stubAssets, LEVEL_VEG, makeHooks(rec2));
    restored.restore(data);
    restored.start();
  } catch (err) {
    fail('восстановление: ' + shortStack(err));
  }

  // сравнение общего состояния
  const before = data, after = restored.serialize();
  const d1 = diff(before, after, 'serialize');
  if (d1) {
    console.error('before[0] =', JSON.stringify(before.objects[0]));
    console.error('after[0]  =', JSON.stringify(after.objects[0]));
    fail(`состояние после restore отличается: ${d1}`);
  }
  console.log(`состояние идентично: деньги=${restored.money}, время=${restored.time}s, ` +
    `героиня (${Math.round(restored.hero.x)}, ${Math.round(restored.hero.y)}), объектов ${restored.objects.length}`);

  // ещё 200 шагов без ошибок
  for (let step = 0; step < PROBE; step++) {
    try {
      restored.update(STEP);
    } catch (err) {
      fail(`t=${restored.time}s после загрузки: ${shortStack(err)}`);
    }
    const bads = nanProblems(restored);
    if (bads.length) fail(`t=${restored.time}s NaN: ${bads.join('; ')}`);
  }
  console.log(`прогон ${PROBE} шагов после загрузки чистый (t=${restored.time}s, денег ${Math.round(restored.money)})`);
  console.log('итог: savegame ок');
}

main().catch((err) => { console.error(shortStack(err)); process.exit(2); });
