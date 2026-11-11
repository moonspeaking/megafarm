#!/usr/bin/env node
// Замер скорости симуляции всех 12 уровней: 1200 вызовов update(0.1) = 120 игровых секунд.
// Это не тест: код возврата всегда 0. Запуск: node tools/bench_sim.mjs
// Заглушки те же, что в smoke_levels.mjs (fetch с диска, Assets без графики).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World } from '../src/sim.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

const LEVELS = 12;
const CALLS = 1200;
const STEP = 0.1;
const WARMUP = 100; // прогрев JIT на отдельном мире, чтобы замер шёл с ровного старта
const SERIALIZE_RUNS = 20;

const makeHooks = () => ({
  showMessage: () => {}, notify: () => {},
  showEnd: () => {}, updateHud: () => {}, updateShop: () => {},
  updateTasks: () => {}, playSound: () => {}, showHelp: () => {},
});

const ms = (bigintDiff) => Number(bigintDiff) / 1e6;

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return { avg: sum / sorted.length, p95, max: sorted[sorted.length - 1] };
}

const fmt = (v) => v.toFixed(3);

function benchLevel(db, n) {
  const rec = { level: n, objects: null, over: null, error: null };

  let world;
  try {
    world = new World(db, stubAssets, n, makeHooks());
    world.start();
    const warm = new World(db, stubAssets, n, makeHooks());
    warm.start();
    for (let i = 0; i < WARMUP; i++) warm.update(STEP);
  } catch (err) {
    rec.error = shortStack(err);
    return rec;
  }

  const times = [];
  try {
    for (let i = 0; i < CALLS; i++) {
      const t0 = process.hrtime.bigint();
      world.update(STEP);
      times.push(ms(process.hrtime.bigint() - t0));
    }
  } catch (err) {
    rec.error = `t=${Math.round(world.time * 10) / 10}s: ${shortStack(err)}`;
  }

  // serialize() на конечном состоянии: среднее по нескольким вызовам
  let serAvg = null;
  try {
    const serTimes = [];
    for (let i = 0; i < SERIALIZE_RUNS; i++) {
      const t0 = process.hrtime.bigint();
      world.serialize();
      serTimes.push(ms(process.hrtime.bigint() - t0));
    }
    serAvg = serTimes.reduce((a, b) => a + b, 0) / serTimes.length;
  } catch (err) {
    if (!rec.error) rec.error = `serialize: ${shortStack(err)}`;
  }

  rec.objects = world.objects.length;
  rec.over = world.over;
  Object.assign(rec, stats(times), { serAvg });
  return rec;
}

function shortStack(err) {
  return String(err && err.stack || err).split('\n').slice(0, 3).join(' | ');
}

async function main() {
  const manifest = await loadManifest();
  const db = await loadData(manifest);
  if (!db.levels.size) {
    console.error('уровни не загрузились — проверьте assets/scripts');
    process.exit(0); // бенчмарк не тест: код возврата всегда 0
  }

  const rows = [];
  for (let n = 1; n <= LEVELS; n++) rows.push(benchLevel(db, n));

  console.log(`замер: ${CALLS} вызовов update(${STEP}) на уровень (${CALLS * STEP} игровых секунд), шаг прогрева ${WARMUP} вызовов`);
  console.log('');
  console.log('уровень | объектов на поле | ср. мс | p95 мс | макс. мс | serialize ср. мс | конец | ошибки');
  console.log('--------|------------------|--------|--------|----------|------------------|-------|--------');
  for (const r of rows) {
    console.log(
      `уровень ${String(r.level).padStart(2)} | ` +
      `${r.objects === null ? '?' : r.objects} | ` +
      (r.avg === undefined ? '— | — | — | — | —' : `${fmt(r.avg)} | ${fmt(r.p95)} | ${fmt(r.max)} | ${r.serAvg === null ? '?' : fmt(r.serAvg)}`) +
      ` | ${r.over || '—'} | ${r.error || '—'}`,
    );
    if (r.error) console.error(`  L${r.level}: ${r.error}`);
  }

  const ok = rows.filter((r) => r.avg !== undefined);
  const heavy = [...ok].sort((a, b) => b.p95 - a.p95).slice(0, 3);
  console.log('');
  console.log('три самых тяжёлых уровня (по p95 мс на вызов):');
  for (const r of heavy) {
    console.log(`  уровень ${r.level}: p95 ${fmt(r.p95)} мс, ср. ${fmt(r.avg)} мс, макс ${fmt(r.max)} мс, объектов ${r.objects}`);
  }
  process.exit(0);
}

main().catch((err) => { console.error(shortStack(err)); process.exit(0); });
