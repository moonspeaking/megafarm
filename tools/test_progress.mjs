#!/usr/bin/env node
// Тесты progress.js без браузера (прогресс/рекорды/трофеи/комиксы).
// Проверяет: золото по level_time (включая границу «ровно лимит»), рекорды
// (min time, max money; худший повтор не затирает), трофеи #(n-1) и кубок #12
// после всех 12 золотых, комиксы seen, unlocked/current, отдельные профили,
// чтение данных, записанных старой версией (без части полей).
// Запуск: node tools/test_progress.mjs (код возврата != 0 при ошибках).

// Подставной localStorage с общим хранилищем (как в браузере: один на все ключи).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

import { Progress, LEVELS } from '../src/progress.js';

let failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`ок: ${msg}`); return; }
  console.error(`ОШИБКА: ${msg}`);
  failed++;
}

// Заглушка settings: progress.js нужен только get('player').
let player = '';
const settings = { get: (k) => (k === 'player' ? player : null) };
const as = (name) => { player = name; };
const progress = new Progress(settings);

// --- золото по level_time
as('Аня');
check(progress.complete(1, 100, 10, 120).gold === true, 'время меньше лимита — золото');
check(progress.gold(1) === true, 'золото записано в уровень');
check(JSON.stringify(progress.trophies()) === '[0]', 'золотой уровень 1 дал трофей #0');
check(progress.complete(2, 120, 10, 120).gold === true && progress.gold(2), 'ровно лимит — тоже золото');
check(progress.trophies().includes(1), 'уровень 2 дал трофей #1');
const noGold = progress.complete(3, 120.5, 10, 120);
check(noGold.gold === false && noGold.newTrophies.length === 0, 'хуже лимита — золота нет и трофей не выдан');
check(progress.gold(3) === false, 'уровень без золота не помечен золотым');
check(progress.complete(4, 119.6, 10.6, 120).gold === true, 'дробное время меньше лимита — золото');
check(progress.level(4).time === 120 && progress.level(4).money === 11, 'время/деньги округляются до целых');

// --- рекорды: min time, max money, худший повтор не затирает
as('Борис');
progress.complete(1, 300, 500, 120); // без золота
check(progress.level(1).time === 300 && progress.level(1).money === 500, 'первый результат записан как есть');
progress.complete(1, 200, 700, 120);
check(progress.level(1).time === 200, 'лучшее время — минимум');
check(progress.level(1).money === 700, 'лучшие деньги — максимум');
progress.complete(1, 250, 400, 120); // повтор хуже
check(progress.level(1).time === 200, 'худший повтор не затирает лучшее время');
check(progress.level(1).money === 700, 'худший повтор не затирает лучшие деньги');
progress.complete(1, 150, 900, 120);
check(progress.level(1).time === 150 && progress.level(1).money === 900, 'лучший повтор обновляет оба рекорда');

// --- золото и трофей не отбираются при повторах
as('Вера');
progress.complete(1, 100, 10, 120);
check(progress.gold(1), 'Вера: золото с первого раза');
progress.complete(1, 500, 1, 120); // повтор хуже лимита
check(progress.gold(1) === true, 'повтор хуже лимита не снимает золото');
check(JSON.stringify(progress.trophies()) === '[0]', 'трофей после плохого повтора остался');
check(progress.complete(1, 500, 1, 120).newTrophies.length === 0, 'повтор золота не выдаёт трофей заново');

// --- неголдованный уровень: трофей только когда взято золото
as('Глеб');
check(progress.complete(1, 200, 10, 120).newTrophies.length === 0, 'сперва без золота — трофея нет');
check(progress.complete(1, 90, 10, 120).newTrophies.length === 1, 'потом золото — трофей выдан');

// --- кубок #12 после всех 12 золотых
as('Даша');
for (let n = 1; n <= 11; n++) progress.complete(n, 60, 100, 120);
check(progress.trophies().length === 11, '11 золотых уровней — 11 трофеев');
check(!progress.trophies().includes(12), 'кубок (#12) ещё не выдан');
let res = progress.complete(12, 60, 100, 120);
check(JSON.stringify(res.newTrophies) === '[11,12]', '12-е золото даёт трофей #11 и сразу кубок #12');
check(progress.trophies().filter((i) => i < 12).length === 12, 'все 12 трофеев уровней собраны');
check(progress.trophies().includes(12), 'кубок #12 в списке трофеев');
res = progress.complete(12, 60, 100, 120);
check(res.newTrophies.length === 0, 'повторное прохождение не выдаёт кубок #12 заново');

// 11 золотых недостаточно, если один уровень пройден без золота
as('Егор');
for (let n = 1; n <= 11; n++) progress.complete(n, 60, 100, 120);
progress.complete(12, 200, 100, 120); // 12-й без золота
check(!progress.trophies().includes(12), 'без 12-го золота кубок не выдаётся');

// --- комиксы seen
as('Жанна');
check(progress.comicsSeen(1) === false, 'комикс 1 ещё не видел');
progress.markComics(1);
check(progress.comicsSeen(1) === true, 'после markComics комикс 1 seen');
progress.markComics(1);
check(JSON.stringify(progress.profile.comics) === '[1]', 'повторный markComics не дублирует');

// --- unlocked / current
as('Зина');
check(progress.unlocked(1) === true, 'уровень 1 открыт сразу');
check(progress.unlocked(2) === false && progress.current() === 1, 'уровень 2 закрыт, текущий — 1');
progress.complete(1, 200, 10, 120);
check(progress.unlocked(2) === true, 'после прохождения 1 открыт уровень 2');
check(progress.current() === 2, 'текущий — следующий непройденный');
for (let n = 2; n <= LEVELS; n++) progress.complete(n, 200, 10, 120);
check(progress.current() === LEVELS, 'когда всё пройдено, current остаётся на 12');
check(progress.unlocked(LEVELS) === true, 'последний уровень открыт');

// --- отдельные профили независимы, данные переживают пересоздание (перезагрузку)
as('Игорь');
progress.complete(1, 50, 800, 120);
as('Клава');
check(progress.done(1) === false && progress.level(1) === null, 'у Клавы нет рекордов Игоря');
check(progress.trophies().length === 0, 'у Клавы нет трофеев Игоря');
check(progress.current() === 1, 'у Клавы свой прогресс с 1-го уровня');
as('Игорь');
const progress2 = new Progress(settings); // как после перезагрузки страницы
check(progress2.level(1).time === 50 && progress2.level(1).money === 800, 'рекорды Игоря читаются из хранилища заново');
check(progress2.gold(1) === true, 'золото Игоря сохранилось');

// --- данные старой версии: профиль без полей levels/trophies не должен ронять игру
store.set('megafarm.progress.v1', JSON.stringify({ 'Лёша': { comics: [3] } }));
const progress3 = new Progress(settings);
as('Лёша');
try {
  check(progress3.done(1) === false, 'старый профиль без levels: уровень не пройден, без падения');
  check(JSON.stringify(progress3.trophies()) === '[]', 'старый профиль без trophies: трофеев нет, без падения');
  check(progress3.comicsSeen(3) === true, 'комиксы из старых данных сохранены');
  progress3.complete(1, 100, 10, 120);
  check(progress3.gold(1) === true, 'прохождение записывается в старый профиль');
} catch (e) {
  console.error(`ОШИБКА: старый профиль без levels/trophies падает: ${e}`);
  failed++;
}

if (failed) { console.error(`итог: провалено проверок: ${failed}`); process.exit(1); }
console.log('итог: progress ок');
