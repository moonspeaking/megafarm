#!/usr/bin/env node
// Тест очереди целей героини (галочки, CMover): src/sim.js click/queueMarks/nextQueued, уровень 1.
// Запуск: node tools/test_queue.mjs (код возврата != 0 при ошибках).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World, TILE } from '../src/sim.js';

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
const db = await loadData(await loadManifest());
const stubAssets = { resolve: () => null, load: () => null, image: () => null, sound: () => null, missing: new Set() };
const notes = [];
const hooks = {
  showMessage: () => {}, notify: (t) => notes.push(t), showEnd: () => {}, updateHud: () => {}, updateShop: () => {},
  updateTasks: () => {}, playSound: () => {}, showHelp: () => {},
};

let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
const newWorld = () => { const w = new World(db, stubAssets, 1, hooks); w.start(); return w; };
const run = (w, sec) => { for (let i = 0; i < sec * 20; i++) w.update(0.05); };

console.log('=== очередь: ящик -> ангар (действие выбирается в момент выполнения)');
{
  const w = newWorld();
  notes.length = 0;
  const box = w.objects.find((o) => o.kind === 'box');
  const hangar = w.objects.find((o) => o.kind === 'hangar');
  ok(!!box && !!hangar, 'на уровне 1 есть ящик и ангар');
  w.click(box.x, box.y, false);
  ok(w.hero.task && w.hero.task.kind === 'pickup', 'первый клик начинает работу сразу (идти за ящиком)');
  w.click(hangar.x, hangar.y, false);
  w.click(hangar.x, hangar.y, false);
  const marks = w.queueMarks();
  ok(marks.length === 3, 'три цели: ящик (текущая) + ангар x2', JSON.stringify(marks.map((m) => m.key)));
  ok(marks.every((m) => m.type === 'check'), 'у целей-объектов жёлтые галочки');
  ok(marks.filter((m) => m.key === marks[1].key).length === 2, 'два клика по ангару — две галочки на нём');
  ok(!notes.some((t) => /ящик/i.test(t)), 'клик по ангару без ящика в руках не ругается сразу (нужен ящик — проверится при выполнении)');
  run(w, 25);
  ok(w.queue.length === 0 && w.queueMarks().length === 0, 'очередь отработала, галочек не осталось');
  ok(w.hero.held && w.hero.held.kind === 'box', 'ящик взят (первая цель выполнена)');
}

console.log('=== клик по героине сбрасывает очередь');
{
  const w = newWorld();
  const box = w.objects.find((o) => o.kind === 'box');
  const hangar = w.objects.find((o) => o.kind === 'hangar');
  w.click(box.x, box.y, false);
  w.click(hangar.x, hangar.y, false);
  ok(w.queueMarks().length === 2, 'две цели до сброса');
  w.click(w.hero.x, w.hero.y - 40, false);
  ok(w.queue.length === 0 && !w.hero.task && w.hero.path.length === 0 && w.queueMarks().length === 0, 'клик по героине: очередь пуста, ход остановлен');
}

console.log('=== простой клик — галочка и ход, двойной клик — кольцо и копание');
{
  const w = newWorld();
  const x = 16 * TILE + 32, y = 9 * TILE + 32;
  w.click(x, y, false);
  let m = w.queueMarks();
  ok(m.length === 1 && m[0].type === 'check' && !m[0].obj, 'одиночный клик по земле: галочка на точке', JSON.stringify(m));
  ok(!w.hero.task && w.hero.path.length === 1, 'героиня просто идёт туда (без работы)');
  w.click(x, y, true); // двойной клик: копать
  m = w.queueMarks();
  ok(m.length === 1 && m[0].type === 'ring', 'после двойного клика — одна цель-кольцо вместо галочки', JSON.stringify(m));
  ok(w.hero.task && w.hero.task.kind === 'dig', 'героиня идёт копать');
  run(w, 15);
  ok(w.cell(16, 9).dug && w.queueMarks().length === 0, 'грядка вскопана, кольцо снято');
}

console.log('=== режим лопаты (кнопка в инвентаре): один клик копает, повторное нажатие возвращает обычный режим');
{
  const w = newWorld();
  const x = 16 * TILE + 32, y = 9 * TILE + 32;
  ok(w.digMode === false, 'по умолчанию режим лопаты выключен');
  ok(w.toggleDigMode() === true && w.digMode, 'кнопка включает режим');
  w.click(x, y, false);
  ok(w.hero.task && w.hero.task.kind === 'dig', 'одиночный клик по земле: героиня идёт копать');
  let m = w.queueMarks();
  ok(m.length === 1 && m[0].type === 'ring', 'метка — кольцо копания', JSON.stringify(m));
  run(w, 15);
  ok(w.cell(16, 9).dug, 'грядка вскопана одним кликом');
  // клик по уже вскопанной клетке и по объекту работает обычным образом (режим не ломает остальное)
  w.click(x, y, false);
  ok(!w.hero.task || w.hero.task.kind !== 'dig', 'по вскопанной клетке копание не повторяется');
  run(w, 10);
  ok(w.toggleDigMode() === false && !w.digMode, 'повторное нажатие возвращает обычный режим');
  const x2 = 18 * TILE + 32;
  w.click(x2, y, false);
  ok(!w.hero.task && w.hero.path.length === 1 && w.queueMarks()[0].type === 'check', 'в обычном режиме одиночный клик — просто ход (галочка)');
  run(w, 10);
  // с предметом в руках режим лопаты не копает
  w.toggleDigMode();
  w.hero.held = { kind: 'box', def: db.objects.get('box'), name: 'box', count: 0 };
  const x3 = 19 * TILE + 32, y3 = 11 * TILE + 32;
  w.click(x3, y3, false);
  ok(!w.hero.task, 'с ящиком в руках клик в режиме лопаты — обычный ход, не копание');
}

console.log('=== очередь ходов: порядок и отмена WASD/правым');
{
  const w = newWorld();
  const a = { x: 15 * TILE + 32, y: 9 * TILE + 32 }, b = { x: 18 * TILE + 32, y: 11 * TILE + 32 };
  w.click(a.x, a.y, false);
  w.click(b.x, b.y, false);
  ok(w.queueMarks().length === 2, 'две точки хода в очереди');
  run(w, 20);
  ok(Math.hypot(w.hero.x - b.x, w.hero.y - b.y) < 4, 'героиня дошла до последней точки', `${w.hero.x},${w.hero.y}`);
  w.click(a.x, a.y, false); w.click(b.x, b.y, false);
  w.rightClick();
  ok(w.queue.length === 0 && w.hero.path.length === 0, 'rightClick()/ручное управление сбрасывает очередь');
  w.click(a.x, a.y, false); w.click(b.x, b.y, false);
  w.clearQueue();
  ok(w.queue.length === 0, 'clearQueue()');
}

console.log('=== клики по ангару в разных местах: одна позиция галочки, сдвиг только при повторах; героиня не кружит');
{
  const w = newWorld();
  const hangar = w.objects.find((o) => o.kind === 'hangar');
  w.hero.held = { kind: 'box', def: db.objects.get('box'), name: 'box', count: 4, type: 'pumpkin' };
  const moneyBefore = w.money;
  // верх, центр и нижняя часть основания (раньше нижняя часть считалась землёй, и героиня огибала ангар бесконечно)
  const pts = [[0, -60], [-90, 20], [90, 20], [0, 84], [-60, 100], [60, 100]];
  for (const [dx, dy] of pts) {
    ok(w.objectAt(hangar.x + dx, hangar.y + dy) === hangar, `клик (${dx}, ${dy}) относительно центра попадает в ангар`);
  }
  for (const [dx, dy] of pts) w.click(hangar.x + dx, hangar.y + dy, false);
  const marks = w.queueMarks();
  const keys = new Set(marks.map((m) => m.key));
  const xs = new Set(marks.map((m) => `${m.x},${m.y}`));
  ok(marks.length === pts.length && keys.size === 1 && xs.size === 1, 'все галочки на одном объекте в одной точке (сдвиг рисует отрисовка)', JSON.stringify(marks.slice(0, 2)));
  ok(marks.every((m) => m.type === 'check' && m.obj), 'это галочки объекта');
  run(w, 40);
  ok(w.queue.length === 0 && !w.hero.task && w.hero.path.length === 0 && !w.hero.act, 'героиня отработала очередь и стоит (не кружит)');
  ok(w.hero.held && w.hero.held.kind === 'spade' && w.money > moneyBefore, 'ящик продан ангару: деньги получены, в руках лопата', JSON.stringify({ held: w.hero.held && w.hero.held.kind, money: w.money, before: moneyBefore }));
}

console.log('=== недостижимая точка внутри здания: цель выталкивается наружу, а кружение прерывается');
{
  const w = newWorld();
  const hangar = w.objects.find((o) => o.kind === 'hangar');
  w.hero.x = hangar.x + 300; w.hero.y = hangar.y + 200;
  w.walkToPoint(hangar.x, hangar.y + 42, null); // центр основания
  const t = w.hero.path[0];
  const bc = hangar.def.props.base_center, br = hangar.def.props.base_radius;
  const u = Math.hypot((t.x - (hangar.x + bc[0])) / (br[0] + 2), (t.y - (hangar.y - bc[1])) / (br[1] + 2));
  ok(u >= 1, 'цель простого хода вынесена за основание ангара', 'u=' + u.toFixed(2));
  run(w, 30);
  ok(w.hero.path.length === 0 && !w.hero.task, 'героиня дошла и остановилась');
  // предохранитель: недостижимая цель, для которой выталкивание не сработало (принудительно задаём путь внутрь)
  w.hero.x = hangar.x + 300; w.hero.y = hangar.y + 200;
  w.hero.path = [{ x: hangar.x, y: hangar.y + 42 }]; w.hero.task = null;
  notes.length = 0;
  run(w, 30);
  ok(w.hero.path.length === 0 && !w.hero.moving, 'при кружении у недостижимой точки ход прерывается (предохранитель)');
}

console.log('=== сохранение не тащит очередь');
{
  const w = newWorld();
  const box = w.objects.find((o) => o.kind === 'box');
  w.click(box.x, box.y, false); w.click(box.x, box.y, false);
  const snap = JSON.parse(JSON.stringify(w.serialize()));
  const r = new World(db, stubAssets, 1, hooks);
  r.restore(snap);
  ok(r.queue.length === 0 && r.queueMarks().length === 0, 'после загрузки очередь пуста');
}

console.log(`\nитог: ${passed} ok, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
