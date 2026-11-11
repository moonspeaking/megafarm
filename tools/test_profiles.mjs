#!/usr/bin/env node
// Тест профилей игроков без браузера: settings.js + progress.js + savegame.js
// (menu.js требует DOM и проверяется вручную в браузере).
// Проверяет: два профиля независимы; удаление стирает только свой прогресс
// и своё сохранение игры. Запуск: node tools/test_profiles.mjs (код возврата != 0 при ошибках).

// Подставной localStorage с общим хранилищем (как в браузере: один на все ключи).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

import { Settings } from '../src/settings.js';
import { Progress } from '../src/progress.js';
import { playerKey, saveGame, loadSave, clearSave } from '../src/savegame.js';

let failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`ок: ${msg}`); return; }
  console.error(`ОШИБКА: ${msg}`);
  failed++;
}

/** Фальшивый мир для saveGame: достаточно levelNum и serialize(). */
const fakeWorld = (level, money) => ({ levelNum: level, serialize: () => ({ money, time: 10 }) });

function main() {
  // --- создание двух профилей
  const settings = new Settings();
  const progress = new Progress(settings);
  settings.addProfile('Анна');
  settings.set('player', 'Анна');
  progress.complete(1, 100, 500, 120); // золото: уложилась в level_time
  progress.complete(2, 300, 700, 250); // без золота
  check(saveGame(fakeWorld(3, 111), playerKey(settings)), 'сохранение игры Анны записано');
  check(!!loadSave(playerKey(settings, 'Анна')), 'сейв Анны читается по явному имени');

  settings.addProfile('Борис');
  settings.set('player', 'Борис');
  check(!progress.done(1), 'у Бориса уровень 1 не пройден (прогресс Анны не виден)');
  check(progress.level(1) === null, 'рекорды Анны не подмешиваются к Борису');
  progress.complete(1, 200, 300, 120); // медленнее золотого времени
  check(saveGame(fakeWorld(2, 222), playerKey(settings)), 'сохранение игры Бориса записано');

  // --- независимость после переключений туда-обратно
  settings.set('player', 'Анна');
  check(progress.level(1).time === 100 && progress.level(1).money === 500, 'рекорды Анны на месте');
  check(progress.gold(1) === true, 'золото Анны на месте');
  check(progress.level(2).money === 700, 'второй уровень Анны на месте');
  check(JSON.stringify(progress.trophies()) === '[0]', 'трофеи Анны на месте');
  settings.set('player', 'Борис');
  check(progress.level(1).time === 200 && progress.level(1).money === 300, 'у Бориса свои рекорды');
  check(progress.gold(1) === false, 'у Бориса своё «золото» (нет его)');
  check(JSON.stringify(progress.trophies()) === '[]', 'у Бориса нет трофеев Анны');
  check(loadSave(playerKey(settings, 'Анна')).world.money === 111, 'сейв Анны содержит её данные');
  check(loadSave(playerKey(settings, 'Борис')).world.money === 222, 'сейв Бориса содержит его данные');

  // --- удаление: стирается только свой прогресс и свой сейв
  check(progress.removeProfile('Анна'), 'профиль Анны найден и удалён');
  clearSave(playerKey(settings, 'Анна'));
  settings.removeProfile('Анна');
  check(!progress.profiles().includes('Анна'), 'прогресс Анны стёрт');
  check(loadSave(playerKey(settings, 'Анна')) === null, 'сейв Анны стёрт');
  check(settings.get('player') === 'Борис', 'текущий профиль после удаления — Борис');
  check(!settings.profiles().includes('Анна'), 'Анны нет в списке профилей');
  check(progress.level(1).time === 200, 'прогресс Бориса не задет удалением Анны');
  check(JSON.stringify(progress.trophies()) === '[]', 'трофеи Бориса не задет');
  check(loadSave(playerKey(settings, 'Борис')).world.money === 222, 'сейв Бориса не задет');

  // --- удаление последнего профиля: текущим становится default
  progress.removeProfile('Борис');
  clearSave(playerKey(settings, 'Борис'));
  settings.removeProfile('Борис');
  check(settings.get('player') === '', 'после удаления последнего профиля — default');
  check(playerKey(settings) === 'megafarm.save.v1.default', 'ключ сейва default-игрока (обратная совместимость)');
  check(loadSave(playerKey(settings, 'Борис')) === null, 'сейв Бориса стёрт');

  // --- повторное удаление отсутствующего профиля безопасно
  check(progress.removeProfile('Анна') === false, 'удаление несуществующего профиля — no-op');
  settings.removeProfile('Анна');

  // --- данные переживают пересоздание объектов (аналог перезагрузки страницы)
  settings.addProfile('Вера');
  settings.set('player', 'Вера');
  progress.complete(1, 50, 100, 120);
  const settings2 = new Settings();
  const progress2 = new Progress(settings2);
  check(settings2.get('player') === 'Вера', 'текущий профиль переживает перезагрузку');
  check(progress2.level(1).time === 50, 'прогресс Веры читается заново из хранилища');

  if (failed) { console.error(`итог: провалено проверок: ${failed}`); process.exit(1); }
  console.log('итог: профили ок');
}

main();
