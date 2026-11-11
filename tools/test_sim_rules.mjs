#!/usr/bin/env node
// Тесты правил симуляции по скриптам уровня 1 (docs/opencode-tasks.md, задача 9).
// World без UI: data.js и sim.js не зависят от DOM, fetch подменяется чтением файлов.
// Ожидания выведены из docs/original-notes.md и скриптов assets/scripts
// (level1.txt, objects/plant_pumpkin.txt, objects/pumpkin.txt, objects/hangar_*.txt, ...).
// Запуск: node tools/test_sim_rules.mjs (код возврата != 0 при ошибках).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World, TILE } from '../src/sim.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LEVEL = 1;

globalThis.fetch = async (url) => {
  const rel = String(url).replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]+/, '');
  let abs = rel.startsWith('/') ? rel : path.join(ROOT, rel);
  try {
    const text = await fs.readFile(abs, 'utf8');
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, text: async () => '', json: async () => { throw new Error('not found: ' + rel); } };
  }
};

const stubAssets = { resolve: () => null, load: () => null, image: () => null, sound: () => null, missing: new Set() };

// ---------------------------------------------------------------- запуск

let passed = 0, failed = 0;
const failures = [];

// Покупка теперь привязывается к курсору: поставить на клетку, затем герой берёт предмет в руки.
// Хелпер делает всё это мгновенно (путь героя и анимации здесь не важны).
function buyToHand(w, name) {
  const before = new Set(w.objects);
  w.buy(name);
  if (!w.pending) return;
  const hc = w.cellAt(w.hero.x, w.hero.y);
  const spot = w.freeCellNear(hc ? hc.x : 1, hc ? hc.y : 1);
  if (!spot) return;
  w.placePending(w.cell(spot.x, spot.y));
  const obj = w.objects.find((o) => !before.has(o));
  if (!obj) return;
  w.hero.held = { kind: obj.kind, def: obj.def, name: obj.name, charges: obj.charges, count: obj.count, type: obj.type };
  w.removeObject(obj);
}

function ok(cond, name, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; failures.push(name); console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

function makeHooks(rec) {
  return {
    showMessage: () => {}, notify: () => {},
    showEnd: (result) => { if (!rec.over) rec.over = result; },
    updateHud: () => {}, updateShop: () => {}, updateTasks: () => {},
    playSound: rec.playSound || (() => {}), showHelp: () => {},
  };
}

function newWorld() {
  const w = new World(stubDb, stubAssets, LEVEL, makeHooks({}));
  w.start();
  return w;
}

function steps(w, n) {
  for (let i = 0; i < n && !w.over; i++) w.update(1);
}

const at = (c) => c * TILE + TILE / 2;
const nearest = (w, name) => w.objects.find((o) => o.name === name);

// Свойства тыквы из objects/plant_pumpkin.txt и уровня 1 (level1.txt):
const THIRST = 42 / 100 * 1.3;        // thirsty 42, plant_thirst_growth 1.3

// ------------------------------------------------------------------ бот

/** «Бот» — последовательность действий героини через публичные методы мира.
 * Копает 12 грядок, сеет все 12 семян пакета, поливает у колонки, собирает
 * ящики (4 плода) и продаёт их ангару, докупая ящики после продаж; цель —
 * скриптовое условие победы sell_plant_pumpkin >= 3. */
function runBot(w, maxSteps) {
  const grid = [];
  for (let y = 9; y <= 11; y++) for (let x = 13; x <= 16; x++) grid.push({ x, y });

  const plants = () => w.objects.filter((o) => o.kind === 'plant' && !o.dead);
  const ready = () => plants().filter((p) => p.fruits > 0);
  const fieldItem = (kind) => w.objects.find((o) => o.kind === kind);
  const busy = () => w.hero.task || w.hero.act || w.hero.path.length;
  const dugCount = () => grid.filter((c) => w.cell(c.x, c.y).dug).length;
  const sowTargets = () => grid.filter((c) => { const cell = w.cell(c.x, c.y); return cell && cell.dug && !cell.plant; });

  // клик по героине гасится только вне грядки/растения (задача 27): по грядке под ногами
  // можно действовать. Отступ остаётся запасным для прочих кликов рядом с героиней.
  const safeClick = (x, y, isDouble = false) => {
    const h = w.hero;
    const c = w.cellAt(x, y);
    const bed = c && (c.dug || c.plant);
    if (!bed && !isDouble && w.heroAt(x, y)) {
      const dodge = w.cell(2, 13);
      if (dodge && !dodge.blocked && dodge.occupant === null) { w.walkToCell(2, 13); return 'dodge'; }
    }
    w.click(x, y, isDouble);
    return 'click';
  };

  const act = () => {
    const held = w.hero.held || {};
    if (held.kind !== 'spade' && held.kind) {
      if (held.kind === 'seed') {
        const t = sowTargets()[0];
        if (!t) return 'seeds_done';
        return safeClick(at(t.x), at(t.y));
      }
      if (held.kind === 'watercan') {
        // зрелые плоды важнее полива: сначала собрать (ходьба стала медленнее, круг полива теперь длиннее)
        if (ready().length) { w.selectTool('spade'); return 'drop_can'; }
        const neediest = plants().reduce((b, p) => (!b || p.dry > b.dry ? p : b), null);
        const need = neediest && neediest.dry >= 18 ? neediest : null;
        if (need && (held.charges || 0) > 0) return safeClick(need.x, need.y);
        if ((held.charges || 0) < ((held.def && held.def.props.max_watering) || 6)) {
          const pump = fieldItem('waterpump');
          if (pump) return safeClick(pump.x, pump.y);
        }
        if (ready().length) { w.selectTool('spade'); return 'drop_can'; }
        return 'idle';
      }
      if (held.kind === 'box') {
        if ((held.count || 0) >= 4) {
          const hangar = w.objects.find((o) => o.kind === 'hangar');
          return hangar ? safeClick(hangar.x, hangar.y) : 'no_hangar';
        }
        const r = ready()[0];
        return r ? safeClick(r.x, r.y) : 'idle_wait_fruit';
      }
      return 'idle';
    }
    // в руках лопата: копать, потом брать семена/лейку, продавать...
    const r = ready();
    if (r.length) {
      const box = fieldItem('box');
      if (box) return safeClick(box.x, box.y);
      if (w.shop.inventory.includes('box') && w.money >= 1) { buyToHand(w, 'box'); return 'buy_box'; }
      return 'wait_box';
    }
    if (dugCount() < grid.length) {
      const c = grid.find((g) => !w.cell(g.x, g.y).dug);
      return safeClick(at(c.x), at(c.y), true);
    }
    const seed = fieldItem('seed');
    if (seed) return safeClick(seed.x, seed.y);
    const can = fieldItem('watercan');
    if (can) return safeClick(can.x, can.y);
    return 'idle';
  };

  for (let step = 0; step < maxSteps && !w.over; step++) {
    w.update(1);
    if (busy()) continue;
    if (!Number.isFinite(w.money)) return { err: `NaN money на шаге ${step}` };
    if (!Number.isFinite(w.hero.x) || !Number.isFinite(w.hero.y)) return { err: `NaN координат героини на шаге ${step}` };
    const what = act();
    if (process.env.BOTLOG && step % 20 === 0) console.log(step, what, Math.round(w.hero.x), Math.round(w.hero.y), w.hero.held && w.hero.held.kind, w.hero.path.length, w.hero.task && w.hero.task.kind, w.hero.held && w.hero.held.charges, ready().length);
    if (what === 'buy_box' && w.hero.held.kind !== 'box') return { err: 'bot: не смог купить ящик' };
  }
  return { err: w.over ? null : 'бюджет шагов исчерпан, победы нет' };
}

// ----------------------------------------------------------------- main

let stubDb;

async function main() {
  const manifest = await loadManifest();
  stubDb = await loadData(manifest);
  if (!stubDb.levels.has(LEVEL) || !stubDb.objects.has('plant_pumpkin')) {
    console.error('уровень/объекты не загрузились');
    process.exit(2);
  }

  // -- сценарий уровня из скрипта
  console.log('=== (д) сценарий уровня 1');
  const w = newWorld();
  ok(w.levelTime === 300, 'level_time из скрипта = 300', `получено ${w.levelTime}`);
  ok(w.money === 10, 'стартовые деньги: «add money 10»', `получено ${w.money}`);
  ok(Math.round(w.hero.x) === at(6) && Math.round(w.hero.y) === at(6),
    'героиня стоит на (6,6) по скрипту', `(${Math.round(w.hero.x)},${Math.round(w.hero.y)})`);
  ok(!!nearest(w, 'hangar_vegetables') && !!nearest(w, 'watercan') && !!nearest(w, 'waterpump')
    && !!nearest(w, 'box') && !!nearest(w, 'pumpkin'),
    'ангар, лейка, колонка, ящик и пакет семян стоят на поле по скрипту');

  // -- вскопка и посадка (а)
  console.log('=== (а) вскопка и посадка');
  w.click(at(13), at(9), true); // двойной клик лопатой = копать
  steps(w, 30);
  ok(w.cell(13, 9).dug && w.dugCount === 1, 'двойной клик копает грядку (dugCount = 1)');
  ok(w.cell(13, 9).wet > 0, 'свежевскопанная грядка мокрая');
  w.click(at(12), at(9)); // невскопанная
  steps(w, 30);
  ok(!w.cell(12, 9).plant, 'посеять на невскопанную грядку нельзя');
  w.hero.held = { kind: 'seed', def: stubDb.objects.get('pumpkin'), name: 'pumpkin', count: 3 };
  w.hero.x = at(12); w.hero.y = at(9); // встать рядом, не на засеваемой клетке
  w.click(at(13), at(9));
  let poll = 0;
  while (poll < 30 && !w.cell(13, 9).plant) { w.update(1); poll++; }
  const plant = w.cell(13, 9).plant;
  ok(!!plant && plant.name === 'plant_pumpkin', 'семя на вскопанную: всходит plant_pumpkin');
  ok((w.counters.sow_pumpkin || 0) === 1, 'счётчик sow_pumpkin = 1 (условие l1_4plant_cond)');
  ok(w.hero.held.count === 2, 'посев уменьшил пакет семян', `count=${w.hero.held.count}`);

  // -- магазин (г)
  console.log('=== (г) магазин');
  const m0 = w.money; // 10 денег, пакет семян стоит 40
  let notified = '';
  w.hooks.notify = (t) => { notified = t; };
  buyToHand(w, 'pumpkin');
  ok(w.money === m0 && String(notified).includes('Не хватает денег'), 'покупка без денег блокирована, минуса нет', `money=${w.money}`);
  ok(String(notified).includes('Не хватает денег'), 'сообщение «не хватает денег»');
  w.money = 100;
  buyToHand(w, 'pumpkin');
  ok(w.money === 60, 'покупка семян списывает цену из скрипта (40)', `money=${w.money}`);
  ok(w.hero.held.kind === 'seed' && w.counters.buy_pumpkin === 1, 'пакет в руках, счётчик buy_pumpkin');
  ok(w.hero.held.count === 12, 'в пакете max_seed_count = 12', `count=${w.hero.held.count}`);

  // -- сухость и стадии (а): рост по скрипту — growth 68/100*plant_growth(10) = 6.8/тик
  console.log('=== (а) стадии роста по скрипту');
  w.waterPlant(plant); // dry = 0
  w.hero.held = { kind: 'spade' };
  steps(w, 10); // без полива сухость успевает вырасти до ~5
  const stageGrowth = plant.growth;
  ok(stageGrowth > 60 && stageGrowth < 75, `рост 6.8/тик*(100-dry)/100: за 10 тиков ~66% (growth=${stageGrowth})`, `growth=${stageGrowth}`);
  ok(plant.stage === 1, 'стадия спрайта 1 при growth 10..90');
  poll = 0;
  while (poll < 60 && !plant.fruitPhase) { if (poll % 5 === 0) w.waterPlant(plant); w.update(1); poll++; }
  ok(plant.fruitPhase, 'growth=100 → фаза плода (fruitPhase)', `growth=${plant.growth}`);
  steps(w, 45); // плод: 3.4/тик при health 50
  ok(plant.ready && plant.fruits === 1, 'плод созрел: ready, один плод за цикл', `fr=${plant.fruitProg}`);
  ok(plant.stage === 4, 'стадия 4 у созревшего плода');

  // -- полив
  console.log('=== полив');
  w.hero.held = { kind: 'watercan', def: stubDb.objects.get('watercan'), name: 'watercan', charges: 6 };
  w.hero.x = at(13); w.hero.y = at(10); // рядом с растением
  w.click(plant.x, plant.y);
  poll = 0;
  while (poll < 20 && w.hero.held.charges === 6) { w.update(1); poll++; }
  ok(w.hero.held.charges === 5 && plant.dry === 0 && w.cell(13, 9).wet === 1,
    'полив по клику: dry=0, грядка мокрая, лейка −1 заряд',
    `charges=${w.hero.held.charges} dry=${plant.dry}`);
  ok((w.counters.plants_watered || 0) === 1, 'счётчик plants_watered = 1');
  // окно без полива: dry растёт THIRST/тик
  w.waterPlant(plant); // точка отсчёта
  steps(w, 150);
  ok(Math.abs(plant.dry - THIRST * 150) < 1, `сухость растёт по thirsty/100*plant_thirst_growth (${THIRST}/тик)`,
    `dry=${plant.dry} ожидание ${THIRST * 150}`);
  ok(plant.thirsty === (plant.dry >= 66), 'флаг thirsty = dry >= 66');
  w.waterPlant(plant);
  ok(plant.dry === 0 && !plant.thirsty, 'waterPlant сбрасывает dry и thirsty');
  ok(plant.health === 50, 'здоровье: start_health/100 * plant_starting_health(50)', `health=${plant.health}`);

  // -- без полива (б): увядание, остановка роста
  console.log('=== (б) без полива');
  const dw = newWorld();
  dw.click(at(13), at(9), true); steps(dw, 30); // вскопка
  dw.hero.held = { kind: 'seed', def: stubDb.objects.get('pumpkin'), name: 'pumpkin', count: 3 };
  dw.hero.x = at(12); dw.hero.y = at(9);
  dw.click(at(13), at(9));
  poll = 0;
  while (poll < 30 && !dw.cell(13, 9).plant) { dw.update(1); poll++; }
  const dp = dw.cell(13, 9).plant;
  steps(dw, 150);
  ok(Math.abs(dp.dry - THIRST * 150) < 1 && dp.thirsty, `без полива сухость ${THIRST * 150} за 150 т, thirsty вкл.`, `dry=${dp.dry}`);
  steps(dw, 300);
  ok(dp.dry >= 100, 'сухость доходит до 100', `dry=${dp.dry}`);
  ok(dp.health < 50 && dp.health === 1, 'floor по plant_minimal_health(1) при сухости, растение не гибнет',
    `health=${dp.health}`);
  ok(!dp.dead && dw.cell(13, 9).plant === dp, 'растение живо (min health удерживает его на грядке)');

  // -- урожай и продажа (в)
  console.log('=== (в) продажа через ангар');
  w.hero.held = { kind: 'box', def: stubDb.objects.get('box'), name: 'box', count: 0 };
  w.hero.x = at(13); w.hero.y = at(10);
  w.click(plant.x, plant.y); // у растения есть плод, пустой ящик в руках
  poll = 0;
  while (poll < 30 && !w.hero.held.count) { w.update(1); poll++; }
  ok(w.hero.held.count === 1 && w.hero.held.type === 'pumpkin', 'сбор: плод в ящик (max_count_fruit 1 за цикл)');
  ok(plant.fruits === 0 && plant.growth === 0, 'после сбора цикл начался заново (complete_harvest)', `growth=${plant.growth}`);
  ok(plant.health < 50, 'сбор травмирует: harvest_damage 770 * health_reduction 2', `health=${plant.health}`);
  const hangar = nearest(w, 'hangar_vegetables');
  const moneyBeforeSell = w.money;
  w.hero.held.count = 3; // неполный ящик
  w.click(hangar.x, hangar.y);
  poll = 0;
  while (poll < 40 && w.hero.held.kind === 'box') { w.update(1); poll++; }
  ok(w.hero.held.kind === 'box' && w.money === moneyBeforeSell, 'неполный ящик не продаётся (нужно 4)', `money=${w.money}`);
  w.hero.held.count = 4;
  let sellNotice = '';
  w.hooks.notify = (t) => { sellNotice = t; };
  w.click(hangar.x, hangar.y);
  poll = 0;
  while (poll < 40 && w.hero.held.kind === 'box') { w.update(1); poll++; }
  ok(w.money === moneyBeforeSell + 4 * 20, 'продажа полного ящика: 4 * cost_fruit(20) = +80',
    `money=${w.money}, было ${moneyBeforeSell}`);
  ok((w.counters.sell_plant_pumpkin || 0) === 1, 'счётчик sell_plant_pumpkin = 1');
  ok(w.hero.held.kind === 'spade', 'после продажи в руках лопата');
  steps(w, 10); // «add to shop box» идёт с задержкой 2 после условия продажи
  ok(w.shop.inventory.includes('box'), 'после 1-й продажи box добавлен в магазин (delay 2)', JSON.stringify(w.shop.inventory));

  // -- чужой ангар (в)
  console.log('=== (в) ангар принимает только свой товар');
  const badHangar = w.spawn('hangar_flowers', 21, 10);
  if (badHangar) {
    w.hero.held = { kind: 'box', def: stubDb.objects.get('box'), name: 'box', count: 4, type: 'pumpkin' };
    w.hero.x = at(20); w.hero.y = at(10);
    w.money = 100;
    let badNotice = '';
    w.hooks.notify = (t) => { badNotice = t; };
    w.click(badHangar.x, badHangar.y);
    poll = 0;
    while (poll < 40 && w.hero.held.kind === 'box' && !badNotice) { w.update(1); poll++; }
    ok(w.money === 100, 'ангар цветов не берёт овощ: денег нет', `money=${w.money}`);
    ok(String(badNotice).includes('не принимает'), 'сообщение «ангар не принимает такой товар»', String(badNotice));
    ok(w.hero.held.count === 4, 'товар остался в ящике');
    w.removeObject(badHangar);
  } else {
    ok(false, 'hangar_flowers спавнится для проверки отказа');
  }

  // -- магазин 2 (г)
  console.log('=== (г) магазин: ящик и лейка');
  w.money = 50;
  w.hero.held = { kind: 'spade' };
  buyToHand(w, 'box');
  ok(w.money === 49 && w.hero.held.kind === 'box' && w.hero.held.count === 0, 'покупка ящика за 1 (пустой)');
  const canPrice = stubDb.objects.get('watercan').props.price;
  buyToHand(w, 'watercan');
  ok(w.money === 49 - canPrice && w.hero.held.kind === 'watercan', `покупка лейки за ${canPrice}`, `money=${w.money}`);
  w.money = 0;
  w.hero.held = { kind: 'spade' };
  buyToHand(w, 'box');
  ok(w.hero.held.kind === 'spade' && w.money === 0, 'покупка без денег невозможна', `held=${w.hero.held.kind}`);

  // -- «бот» победы уровня 1 (д)
  console.log('=== (д) бот: полный цикл уровня');
  const rec = { over: null };
  const bw = new World(stubDb, stubAssets, LEVEL, makeHooks(rec));
  bw.start();
  const bot = runBot(bw, 2500);
  console.log(`   (бот: t=${bw.time}s, грядок ${bw.dugCount}, сеяно ${bw.counters.sow_pumpkin || 0}, ` +
    `поливов ${bw.counters.plants_watered || 0}, продано ${bw.counters.sell_plant_pumpkin || 0}, денег ${bw.money})`);
  ok(!bot.err, 'бот без ошибок', bot.err || '');
  ok(rec.over === 'victory', 'уровень завершён победой (condition @victory: sell_plant_pumpkin >= 3)', `over=${rec.over}`);
  ok((bw.counters.sell_plant_pumpkin || 0) >= 3, 'условие победы: 3 продажи');
  ok((bw.counters.sow_pumpkin || 0) === 12, 'весь пакет (12 семян) посеян');
  ok(bw.tasks.some((t) => t.key === 'l1_task_3sell'), 'скриптовая задача l1_task_3sell выдана');
  ok(bw.shop.inventory.includes('box') && bw.shop.inventory.includes('fertilizer'),
    'магазин пополнился по скрипту: box (после 1-й продажи), fertilizer (после 2-й)',
    JSON.stringify(bw.shop.inventory));

  // -- покупка на курсоре: платим и играем звуки только при установке, герой не идёт
  console.log('=== (г) покупка привязана к курсору');
  {
    const heard = [];
    const pw = new World(stubDb, stubAssets, LEVEL, makeHooks({ playSound: (n) => heard.push(n) }));
    pw.money = 1000;
    const hx = pw.hero.x, hy = pw.hero.y;
    pw.buy('watercan');
    const price = stubDb.objects.get('watercan').props.price;
    ok(pw.pending && pw.pending.name === 'watercan' && pw.money === 1000, 'выбор не списывает деньги', `money=${pw.money}`);
    ok(!heard.includes('pay_shop'), 'звук оплаты не играет до установки');
    const hc = pw.cellAt(hx, hy);
    const spot = pw.freeCellNear(hc.x + 3, hc.y);
    pw.click(spot.x * TILE + 32, spot.y * TILE + 32, false);
    ok(!pw.pending && pw.money === 1000 - price, 'клик по клетке ставит покупку и списывает цену', `money=${pw.money}`);
    ok(heard.includes('pay_shop') && heard.includes('put_watercan'), 'звуки оплаты и установки играют при установке', heard.join());
    ok(pw.hero.x === hx && pw.hero.y === hy && pw.hero.path.length === 0, 'герой не идёт к месту');
    ok(pw.objects.some((o) => o.name === 'watercan'), 'лейка лежит на выбранной клетке');
    pw.buy('watercan');
    pw.rightClick();
    ok(!pw.pending && pw.money === 1000 - price, 'правый клик снимает выбор без трат');
  }

  // -- счётчики работника (задача 21, уровень 4)
  console.log('=== счётчики worker_coin / worker_question (уровень 4)');
  {
    const heard = [];
    const lw = new World(stubDb, stubAssets, 4, { ...makeHooks({}), showMessage: (t) => heard.push(t) });
    lw.start();
    steps(lw, 3); // скриптовые add to field выполняются на старте
    const wk = lw.objects.find((o) => o.kind === 'worker' && o.name === 'harvester');
    ok(!!wk, 'комбайн стоит на поле по скрипту уровня 4 (add to field harvester)');
    if (wk) {
      lw.money = 500;
      lw.workerClicked(wk); // «наняли»: оплата, состояние work
      ok(wk.state === 'work' && lw.money === 400, 'наняли за pay 100: state work, деньги −100', `state=${wk.state} money=${lw.money}`);
      steps(lw, 2); // спелых плодов на старте нет → цели нет
      ok(wk.question === true, 'работнику нечего делать — «?» над ним', `question=${wk.question}`);
      ok((lw.counters.worker_question || 0) === 1, 'счётчик worker_question = 1 (впервые за цикл)',
        `worker_question=${lw.counters.worker_question || 0}`);
      steps(lw, 3);
      ok((lw.counters.worker_question || 0) === 1, '«?» не растёт дальше в том же цикле',
        `worker_question=${lw.counters.worker_question || 0}`);
      wk.workLeft = 0.5; // смена кончилась
      steps(lw, 2);
      ok(wk.state === 'pay', 'работа кончилась — работник ждёт оплаты', `state=${wk.state}`);
      ok((lw.counters.worker_coin || 0) === 1, 'счётчик worker_coin = 1',
        `worker_coin=${lw.counters.worker_coin || 0}`);
      // условия сценария уровня 4 срабатывают и показывают подсказки
      ok(lw.condTrue('harvester_coin_help') && lw.condTrue('harvester_question_help'),
        'условия harvester_coin_help / harvester_question_help выполнены');
      steps(lw, 2); // действия показывают сообщение по этим условиям
      const firedData = lw.actions.filter((a) => a.fired && a.type === 'show message').map((a) => a.data);
      ok(firedData.includes('l4_message_harvester_money_help') && firedData.includes('l4_message_harvester_question_help'),
        'подсказки про комбайн (оплата и «?») показаны сценарием', firedData.join(', '));
      // новая оплата — новый цикл: счётчик «?» может сработать снова
      lw.workerClicked(wk);
      steps(lw, 2);
      ok((lw.counters.worker_question || 0) === 2, 'после новой оплаты «?» считается заново (за цикл)',
        `worker_question=${lw.counters.worker_question || 0}`);
    }
  }

  // -- задача 22 (а): «add field none W H» уровня 0 — сетки вскопанных грядок (CSquare) без растений
  console.log('=== «add field none W H» уровня 0: готовые грядки');
  {
    const lw = new World(stubDb, stubAssets, 0, makeHooks({}));
    lw.start();
    // 12 действий level0: (4x3)+(4x3)+(5)+(5)+1+1+(4x3)+(4x3)+(5)+(5)+1+1 = 72 клетки
    const dug = lw.cells.filter((c) => c.dug);
    ok(dug.length === 72, 'скрипт уровня 0 вскопал 72 клетки грядок', `dug=${dug.length}`);
    ok(lw.cell(9, 6).dug && lw.cell(12, 8).dug && lw.cell(14, 6).dug && lw.cell(19, 14).dug,
      'углы сеток «none 4 3» (9,6)..(12,8) и (16,12)..(19,14) вскопаны');
    ok(lw.cell(11, 5).dug && lw.cell(15, 5).dug && lw.cell(13, 15).dug && lw.cell(17, 15).dug,
      'полосы «none 5 1» (11..15,5) и (13..17,15) вскопаны');
    ok(lw.cell(13, 6).dug && lw.cell(13, 8).dug && lw.cell(15, 12).dug && lw.cell(15, 14).dug,
      'одиночные клетки «none 1 1» вскопаны');
    ok(dug.every((c) => !c.plant && !c.occupant && c.wet === 1),
      'готовые грядки без растений/объектов и мокрые (грядка без растения рисуется мокрой)');
    ok(lw.dugCount === 0, 'dugCount (fields_dug) не растёт от скриптовых грядок', `dugCount=${lw.dugCount}`);
    // на готовую грядку можно сеять (условие посева: dug, без растения и объекта)
    ok(lw.cell(9, 6).dug && !lw.cell(9, 6).plant && !lw.cell(9, 6).occupant,
      'сеять на готовую грядку можно (dug, без растения и объекта)');
  }

  // -- задача 22 (б): разбрызгатель на дробных координатах 13.5/7.5 (level0)
  console.log('=== разбрызгатель на дробных координатах 13.5/7.5');
  {
    const lw = new World(stubDb, stubAssets, 0, makeHooks({}));
    lw.start();
    let spr = lw.objects.find((o) => o.name === 'water_sprinkler');
    ok(!!spr, 'разбрызгатель уровня 0 стоит на поле');
    if (spr) {
      ok(spr.cell.x === 13.5 && spr.cell.y === 7.5, 'координаты клетки дробные (13.5, 7.5) из скрипта',
        `${spr.cell.x},${spr.cell.y}`);
      // 13.5*64+32 = 896: граница клеток 13/14, по y — клеток 7/8 (между четырьмя клетками)
      ok(spr.x === 896 && spr.y === 512, 'пиксельная позиция между четырьмя клетками (896, 512)',
        `${spr.x},${spr.y}`);
      ok(lw.cell(spr.cell.x, spr.cell.y) === undefined,
        'cell() на дробных координатах пуст (occupant не пишется, спрайт не solid — блокировки нет)');
      // объект находится кликом/наведением (objectAt работает по пикселям)
      ok(lw.objectAt(spr.x, spr.y) === spr, 'клик по центру разбрызгателя находит его (objectAt)');
      ok(lw.objectAt(880, 520) === spr, 'клик по корпусу разбрызгателя (со смещением) тоже находит');
      ok(lw.objectAt(800, 512) === null, 'клик в центре соседней клетки 12 не задевает разбрызгатель');
      // canPlace других объектов не зависит от несolid-ного разбрызгателя
      const house = stubDb.objects.get('house_pig');
      ok(lw.canPlace({ def: house }, 21, 13) && lw.canPlace({ def: house }, 21, 14),
        'canPlace свободных клеток работает (разбрызгатель не solid)');
      const withSpr = lw.canPlace({ def: house }, 13, 7) && lw.canPlace({ def: house }, 14, 8);
      lw.removeObject(spr);
      const withoutSpr = lw.canPlace({ def: house }, 13, 7) && lw.canPlace({ def: house }, 14, 8);
      ok(withSpr === withoutSpr, 'canPlace клеток рядом с разбрызгателем от него не зависит');
      spr = lw.spawn('water_sprinkler', 13.5, 7.5) || spr; // вернуть на место для проверок ниже
      // герой может подойти к нему: клик по спрайту ведёт к его точке
      lw.hero.x = at(11); lw.hero.y = at(11);
      lw.click(spr.x, spr.y);
      ok(lw.hero.path.length === 1 && lw.hero.path[0].x === 896 && lw.hero.path[0].y === 512,
        'клик по разбрызгателю ведёт героиню к его точке (896, 512)',
        JSON.stringify(lw.hero.path));
      // сохранение/загрузка сохраняет дробную позицию
      const snap = JSON.parse(JSON.stringify(lw.serialize()));
      const rw = new World(stubDb, stubAssets, 0, makeHooks({}));
      rw.restore(snap);
      const spr2 = rw.objects.find((o) => o.name === 'water_sprinkler');
      ok(!!spr2 && spr2.cell.x === 13.5 && spr2.cell.y === 7.5 && spr2.x === 896 && spr2.y === 512,
        'после save/load разбрызгатель на месте (дробные клетка и пиксели)',
        spr2 ? `${spr2.cell.x},${spr2.cell.y} ${spr2.x},${spr2.y}` : 'потерян');
      // полив по пиксельной геометрии работает и с дробным центром
      const seed = { kind: 'seed', def: stubDb.objects.get('aubergine'), name: 'aubergine', count: 1 };
      lw.hero.held = seed;
      lw.hero.x = at(12); lw.hero.y = at(10); // встать ниже, иначе клик по грядке попадёт «в героиню»
      lw.click(at(12), at(8)); // грядка сетки (9..12,6..8) — сеем
      let poll = 0;
      while (poll < 30 && !lw.cell(12, 8).plant) { lw.update(1); poll++; }
      const pl = lw.cell(12, 8).plant;
      ok(!!pl, 'на готовой грядке под разбрызгателем всходит растение');
      if (pl) {
        pl.dry = 40; pl.thirsty = false;
        steps(lw, 3); // разбрызгатель (радиус 4.5x2.5 клетки) снижает dry по частоте 2 с
        ok(pl.dry < 40, 'разбрызгатель с дробным центром поливает растения вокруг',
          `dry=${pl.dry}`);
      }
    }
  }

  // -- клик по грядке под героиней (задача 27)
  console.log('=== клик по грядке под героиней (задача 27)');
  {
    const cw = newWorld();
    cw.click(at(13), at(9), true);
    steps(cw, 30); // вскопка (13,9)
    // посеять, стоя на самой грядке: «клик по героине» больше не гасит клик по клетке с грядкой
    cw.hero.held = { kind: 'seed', def: stubDb.objects.get('pumpkin'), name: 'pumpkin', count: 3 };
    cw.hero.x = at(13); cw.hero.y = at(9);
    cw.click(at(13), at(9));
    let poll = 0;
    while (poll < 30 && !cw.cell(13, 9).plant) { cw.update(1); poll++; }
    ok(!!cw.cell(13, 9).plant, 'клик по грядке под героиней сеет (heroAt не гасит клетку с грядкой)');
    ok(cw.hero.held.count === 2, 'посев под собой расходует семечко', `count=${cw.hero.held.count}`);
    // полить растение под собой
    const pl27 = cw.cell(13, 9).plant;
    if (pl27) {
      pl27.dry = 80; pl27.thirsty = true;
      cw.hero.held = { kind: 'watercan', def: stubDb.objects.get('watercan'), name: 'watercan', charges: 6 };
      cw.click(at(13), at(9));
      poll = 0;
      while (poll < 20 && pl27.dry !== 0) { cw.update(1); poll++; }
      ok(pl27.dry === 0 && (cw.counters.plants_watered || 0) === 1,
        'клик по растению под героиней поливает', `dry=${pl27.dry}`);
    } else {
      ok(false, 'растение под героиней взошло для проверки полива');
    }
    // подбор предмета, лежащего на клетке героини, сохранён (obj важнее «клика по героине»)
    cw.hero.held = { kind: 'spade' };
    const box27 = cw.spawn('box', 14, 9);
    if (box27) {
      cw.hero.x = at(14); cw.hero.y = at(9); // героиня стоит на клетке с ящиком
      cw.click(box27.x, box27.y);
      poll = 0;
      while (poll < 30 && cw.hero.held.kind !== 'box') { cw.update(1); poll++; }
      ok(cw.hero.held.kind === 'box', 'подбор предмета с клетки героини работает', cw.hero.held.kind);
    } else {
      ok(false, 'box заспавнился на клетке героини для проверки подбора');
    }
    // «клик по героине» на траве (без грядки/растения) по-прежнему гасится
    steps(cw, 5); // дать завершиться анимации подбора
    cw.hero.task = null; cw.hero.path = [];
    cw.hero.held = { kind: 'spade' };
    cw.hero.x = at(20); cw.hero.y = at(13);
    cw.click(at(20), at(13));
    ok(cw.hero.path.length === 0 && !cw.hero.task,
      'клик по героине на траве игнорируется, как раньше');
    // двойной клик по своей травяной клетке копает (гасился и раньше только одиночный)
    cw.click(at(20), at(13), true);
    poll = 0;
    while (poll < 30 && !cw.cell(20, 13).dug) { cw.update(1); poll++; }
    ok(cw.cell(20, 13).dug, 'двойной клик по своей клетке копает (не «клик по героине»)');
  }

  // -- фон уровня (sub_415420): birds1..4 на траве, swamp1 на болоте, desert1 в пустыне
  console.log('=== фоновые звуки уровня');
  for (const [lvl, env, re] of [[1, 'grass', /^birds[1-4]$/], [5, 'swamp', /^swamp1$/], [6, 'desert', /^desert1$/]]) {
    const heard = [];
    const aw = new World(stubDb, stubAssets, lvl, makeHooks({ playSound: (n) => heard.push(n) }));
    aw.start();
    if (aw.env !== env) { ok(false, `уровень ${lvl}: окружение ${env}`, `env=${aw.env}`); continue; }
    steps(aw, 3);
    const amb = () => heard.filter((n) => re.test(n));
    ok(amb().length === 1, `${env}: первый фоновый звук через ~1 с`, heard.join(','));
    steps(aw, env === 'grass' ? 5 : 15);
    ok(amb().length === 1, `${env}: следующий не раньше паузы (6+ с / 20+ с)`, `n=${amb().length}`);
    steps(aw, env === 'grass' ? 8 : 12);
    ok(amb().length === 2, `${env}: второй звук в пределах 12 с / 25 с`, `n=${amb().length}`);
  }

  // -- итог
  console.log(`\nитог: ${passed} ok, ${failed} FAIL`);
  if (failed) {
    for (const f of failures) console.error('  FAIL: ' + f);
    process.exit(1);
  }
}

main().catch((err) => { console.error(String(err && err.stack || err)); process.exit(2); });
