#!/usr/bin/env node
// Тесты цепочки запасных языков в data.js (задача 39) без браузера.
// Цепочка t(): выбранный язык -> eng -> rus -> fallback -> ключ.
// Проверяет: недостающие в kor ключи берутся из eng, недостающие в eng — из rus,
// неизвестный ключ даёт fallback (или сам ключ), поведение для rus не изменилось
// (50 случайных ключей против прежней texts.get), пустые значения пропускаются,
// ленивая загрузка паков (rus/eng без лишних запросов) и сброс кэша в setLanguage.
// Запуск: node tools/test_texts_fallback.mjs (код возврата != 0 при ошибках).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameData } from '../src/data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'assets', 'scripts');

let failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`ок: ${msg}`); return; }
  console.error(`ОШИБКА: ${msg}`);
  failed++;
}

// Разбор пака как в data.js/check_i18n.mjs: последняя запись выигрывает.
function parsePack(code) {
  const text = readFileSync(join(SCRIPTS, `${code}.txt`), 'utf8');
  const map = new Map();
  const body = text.slice(text.indexOf('<<') + 2, text.lastIndexOf('>>'));
  for (let line of body.split('\n')) {
    line = line.trim();
    if (!line) continue;
    const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) map.set(m[1], m[2].replace(/\^/g, '\n').trim());
  }
  return map;
}

const packs = new Map(['eng', 'rus', 'kor'].map((c) => [c, parsePack(c)]));

// Игровые данные без load(): паки подставляем напрямую (fetch не нужен).
function makeDb(lang) {
  const db = new GameData();
  db.lang = lang;
  db.texts = packs.get(lang);
  db.packs.set('eng', packs.get('eng'));
  db.packs.set('rus', packs.get('rus'));
  return db;
}

// --- kor: ключа нет в паке — берётся английский текст
const kor = makeDb('kor');
check(!kor.texts.has('l4_message_last_task'), 'в kor нет l4_message_last_task');
check(kor.t('l4_message_last_task', 'запас').startsWith('Fantastic!'),
  'kor: l4_message_last_task берётся из eng');
check(kor.t('l5_task_second_victory', 'запас') === packs.get('eng').get('l5_task_second_victory'),
  'kor: l5_task_second_victory берётся из eng');

// --- eng: ключа нет в eng — берётся русский текст
const eng = makeDb('eng');
check(!packs.get('eng').has('comics_p7f6b9') && packs.get('rus').has('comics_p7f6b9'),
  'comics_p7f6b9 есть в rus и нет в eng');
check(eng.t('comics_p7f6b9', 'запас') === packs.get('rus').get('comics_p7f6b9'),
  'eng: comics_p7f6b9 берётся из rus');

// --- ключ, которого нет нигде: fallback, а без него — сам ключ
check(eng.t('totally_unknown_key_xyz', 'запас') === 'запас', 'неизвестный ключ даёт fallback');
check(eng.t('totally_unknown_key_xyz') === 'totally_unknown_key_xyz',
  'неизвестный ключ без fallback даёт сам ключ');

// --- rus: поведение не изменилось (50 случайных ключей против прежней texts.get)
const rus = makeDb('rus');
const rusKeys = [...packs.get('rus').keys()];
let same = 0;
for (let i = 0; i < 50; i++) {
  const key = rusKeys[Math.floor(Math.random() * rusKeys.length)];
  const fb = 'запас';
  const old = packs.get('rus').get(key) || fb || key; // прежняя формула texts.get
  if (rus.t(key, fb) === old) same++;
}
check(same === 50, `rus: все 50 случайных ключей совпадают с прежней texts.get (${same}/50)`);

// --- пустое значение в выбранном паке пропускается (как в прежней формуле ||)
const dbEmpty = new GameData();
dbEmpty.lang = 'rus';
dbEmpty.texts = new Map([['some_key', '']]); // пусто в rus
dbEmpty.packs.set('eng', new Map([['some_key', 'english']]));
check(dbEmpty.t('some_key', 'запас') === 'english', 'пустое значение пропускается, берётся eng');
dbEmpty.packs.set('eng', new Map([['some_key', '']]));
check(dbEmpty.t('some_key', 'запас') === 'запас', 'пусто во всей цепочке — fallback');

// --- ленивая загрузка паков: считаем запросы подставным fetch
const served = new Map([['eng', packs.get('eng')], ['rus', packs.get('rus')], ['kor', packs.get('kor')]]);
const fetchCounts = new Map();
globalThis.fetch = (url) => {
  fetchCounts.set(url, (fetchCounts.get(url) || 0) + 1);
  const code = String(url).replace(/\.txt$/, '').split('/').pop();
  const text = readFileSync(join(SCRIPTS, `${code}.txt`), 'utf8');
  return Promise.resolve({ ok: true, text: () => Promise.resolve(text) });
};

const korLazy = new GameData();
korLazy.lang = 'kor';
korLazy.texts = packs.get('kor');
const manifest = { scripts: { eng: join(SCRIPTS, 'eng.txt'), rus: join(SCRIPTS, 'rus.txt') } };
korLazy.ensureFallbackPacks(manifest);
await Promise.all(korLazy.packLoads.values());
check(korLazy.packs.get('eng') instanceof Map && korLazy.packs.get('rus') instanceof Map,
  'ensureFallbackPacks загрузил eng и rus');
check(fetchCounts.size === 2, `загружены ровно 2 пака без дублей (${fetchCounts.size} запросов)`);
korLazy.ensureFallbackPacks(manifest); // повторный вызов — из кэша
check([...fetchCounts.values()].reduce((a, b) => a + b, 0) === 2, 'повторный ensure не делает запросов');
check(korLazy.t('l4_message_last_task', 'запас').startsWith('Fantastic!'),
  'после ленивой загрузки цепочка kor->eng работает');

// --- rus: eng загружается, rus повторно не запрашивается
fetchCounts.clear();
const rusLazy = new GameData();
rusLazy.lang = 'rus';
rusLazy.texts = packs.get('rus');
rusLazy.ensureFallbackPacks(manifest);
await Promise.all(rusLazy.packLoads.values());
check(fetchCounts.size === 1 && fetchCounts.has(join(SCRIPTS, 'eng.txt')),
  'при языке rus лениво грузится только eng (без лишних запросов)');

// --- смена языка сбрасывает кэш паков
const dbReset = makeDb('kor');
const manifestKor = { scripts: { kor: join(SCRIPTS, 'kor.txt'), eng: join(SCRIPTS, 'eng.txt'), rus: join(SCRIPTS, 'rus.txt') } };
await dbReset.setLanguage(manifestKor, 'kor');
check(dbReset.lang === 'kor' && dbReset.packs.size === 0 && dbReset.packLoads.size === 2,
  'setLanguage сбрасывает кэш и заново грузит запасные паки');
await Promise.all(dbReset.packLoads.values());
check(dbReset.lang === 'kor' && dbReset.t('l4_message_last_task', 'запас').startsWith('Fantastic!'),
  'после setLanguage цепочка работает');

console.log(failed ? `\nПРОВАЛЕНО проверок: ${failed}` : '\nВсе проверки цепочки запасных языков прошли.');
process.exit(failed ? 1 : 0);
