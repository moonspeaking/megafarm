#!/usr/bin/env node
// Smoke-тест всех 12 уровней: безголовая симуляция 600 игровых секунд с шагом 0.5.
// Правок игры нет: data.js и sim.js не зависят от DOM, fetch подменяется чтением файлов.
// Запуск: node tools/smoke_levels.mjs (код возврата != 0 при ошибках).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World } from '../src/sim.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Скрипты грузятся через fetch от корня сервера; подменяем его чтением с диска.
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

// Заглушка Assets: sim.js сам ни к какой графике не обращается.
const stubAssets = { resolve: () => null, load: () => null, image: () => null, sound: () => null, missing: new Set() };

const HORIZON = 600; // секунд
const STEP = 0.5;
const LEVELS = 12;

function makeHooks(rec) {
  return {
    showMessage: () => {}, notify: () => {},
    showEnd: (result) => { if (!rec.over) rec.over = result; },
    updateHud: () => {}, updateShop: () => {}, updateTasks: () => {},
    playSound: () => {}, showHelp: () => {},
  };
}

function nanProblems(w) {
  const problems = [];
  const num = (label, v) => { if (!Number.isFinite(v)) problems.push(`${label}(${v})`); };
  num('money', w.money);
  num('time', w.time);
  num('hero.x', w.hero.x);
  num('hero.y', w.hero.y);
  const bad = new Set();
  for (const o of w.objects) {
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) bad.add(o.name);
  }
  if (bad.size) problems.push(`объекты с NaN-координатами: ${[...bad].join(', ')}`);
  return problems;
}

async function runLevel(db, n, rec) {
  let world;
  try {
    world = new World(db, stubAssets, n, makeHooks(rec));
    world.start();
  } catch (err) {
    rec.errors.push(`создание/старт: ${shortStack(err)}`);
    return;
  }
  for (let step = 0; step * STEP < HORIZON; step++) {
    try {
      world.update(STEP);
    } catch (err) {
      rec.errors.push(`t=${Math.round(world.time * 10) / 10}s: ${shortStack(err)}`);
      return;
    }
    rec.money = world.money;
    rec.time = Math.round(world.time * 10) / 10;
    const bads = nanProblems(world);
    if (bads.length) {
      rec.errors.push(`t=${rec.time}s NaN: ${bads.join('; ')}`);
      return;
    }
    if (rec.over) break; // уровень завершился (victory/fail) — дальше симуляция не идёт
  }
}

function shortStack(err) {
  return String(err && err.stack || err).split('\n').slice(0, 3).join(' | ');
}

async function main() {
  const manifest = await loadManifest();
  const db = await loadData(manifest);
  if (!db.levels.size) {
    console.error('уровни не загрузились — проверьте assets/scripts');
    process.exit(2);
  }
  const rows = [];
  let failed = false;
  for (let n = 1; n <= LEVELS; n++) {
    const rec = { level: n, money: null, time: null, over: null, errors: [] };
    const t0 = process.hrtime.bigint();
    await runLevel(db, n, rec);
    const secs = Number(process.hrtime.bigint() - t0) / 1e9;
    if (rec.errors.length) failed = true;
    rows.push({ ...rec, wall: Math.round(secs) });
  }

  // итоговая таблица
  console.log('уровень | деньги | время  | конец | wall | ошибки');
  console.log('---------|--------|-------|-------|------|--------');
  for (const r of rows) {
    const errs = r.errors.length ? `${r.errors.length}: ${r.errors[0]}${r.errors.length > 1 ? ' …' : ''}` : '—';
    console.log(
      `уровень ${r.level}, money=${r.money === null ? '?' : Math.round(r.money)}, ` +
      `time=${r.time ?? '?'}s, over=${r.over || '—'}, wall=${r.wall}s, ошибки: ${errs}`,
    );
    if (r.errors.length > 1 || r.errors[0]) {
      // полные сообщения — отдельными строками, чтобы не терять детали
      for (const e of r.errors.slice(0, 10)) console.error(`  L${r.level}: ${e}`);
      if (r.errors.length > 10) console.error(`  L${r.level}: ещё ${r.errors.length - 10} сообщений…`);
    }
  }
  const bad = rows.filter((r) => r.errors.length);
  console.log(`итог: ${rows.length - bad.length}/${rows.length} уровней чисто${bad.length ? `, проблемные: ${bad.map((r) => r.level).join(', ')}` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(shortStack(err)); process.exit(2); });
