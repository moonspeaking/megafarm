#!/usr/bin/env node
// Тест строк целей текущего задания (src/goals.js): уровень 1 по скриптам оригинала.
// Запуск: node tools/test_goals.mjs (код возврата != 0 при ошибках).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World } from '../src/sim.js';
import { taskGoalLines, goalKind } from '../src/goals.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]+/, '');
  const abs = rel.startsWith('/') ? rel : path.join(ROOT, rel);
  try {
    const text = await fs.readFile(abs, 'utf8');
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, text: async () => '', json: async () => { throw new Error('not found'); } };
  }
};

const manifest = await loadManifest();
const db = await loadData(manifest);
const stubAssets = { resolve: () => null, load: () => null, image: () => null, sound: () => null, missing: new Set() };
const hooks = {
  showMessage: () => {}, notify: () => {}, showEnd: () => {}, updateHud: () => {}, updateShop: () => {},
  updateTasks: () => {}, playSound: () => {}, showHelp: () => {},
};

let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('=== goalKind');
ok(goalKind('fields_dug')?.verb === 'dig_squares', 'fields_dug -> dig_squares');
ok(goalKind('plants_watered')?.verb === 'water_plants', 'plants_watered -> water_plants');
ok(JSON.stringify(goalKind('sow_pumpkin')) === JSON.stringify({ verb: 'task_sow', obj: 'pumpkin' }), 'sow_pumpkin');
ok(JSON.stringify(goalKind('sell_plant_pumpkin')) === JSON.stringify({ verb: 'task_sell', obj: 'pumpkin' }), 'sell_plant_pumpkin');
ok(goalKind('sell_house_pig')?.obj === 'house_pig_product', 'sell_house_pig -> house_pig_product');
ok(goalKind('place_hangar_refrigerator')?.verb === 'task_buy', 'place_* -> task_buy');
ok(goalKind('time') === null && goalKind('thirsty_plants') === null, 'time и служебные счётчики — не цели');

console.log('=== уровень 1');
const w = new World(db, stubAssets, 1, hooks);
w.start();
w.update(3); // time >= 2: задание «Тренировка с лопатой»
let lines = taskGoalLines(w);
ok(lines.length === 1 && lines[0].target === 1 && lines[0].cur === 0, 'первое задание: одна цель 0/1', JSON.stringify(lines));
ok(/Вскопать/.test(lines[0] && lines[0].text), 'подпись — «Вскопать» из пака', lines[0] && lines[0].text);
w.dugCount = 1;
w.update(1);
lines = taskGoalLines(w);
ok(lines.length === 1 && lines[0].target === 4 && lines[0].cur === 1, 'после первой грядки: «Вскопать 1/4»', JSON.stringify(lines));
w.dugCount = 4;
w.update(1);
lines = taskGoalLines(w);
ok(lines.length >= 1 && /посеять/.test(lines[0].text) && lines[0].target === 4, 'дальше — «Тыква - посеять 0/4»', JSON.stringify(lines));
ok(taskGoalLines(null).length === 0 && taskGoalLines({ tasks: [] }).length === 0, 'нет мира/заданий — пусто');

console.log(`\nитог: ${passed} ok, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
