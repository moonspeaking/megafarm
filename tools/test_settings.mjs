#!/usr/bin/env node
// Тесты settings.js без браузера (задача 12: настройки применяются).
// Проверяет: значения по умолчанию, запись в localStorage, восстановление при
// загрузке, уведомления onChange, устойчивость к битому JSON и недоступному
// хранилищу, частично сохранённые данные, профили, наличие всех ключей окна
// «Настройки» (sfx/music/smooth/cursor/lang/fullscreen).
// Запуск: node tools/test_settings.mjs (код возврата != 0 при ошибках).

// Подставной localStorage (до создания Settings).
const store = new Map();
let failStorage = false; // true: setItem кидает, как при переполнении/запрете
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (failStorage) throw new Error('QuotaExceeded'); store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

import { Settings, DEFAULTS, LANGUAGES } from '../src/settings.js';

let failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`ок: ${msg}`); return; }
  console.error(`ОШИБКА: ${msg}`);
  failed++;
}

const KEY = 'megafarm.settings.v1';

// --- ключи всех пунктов окна «Настройки» есть в DEFAULTS
for (const k of ['sfx', 'music', 'smooth', 'cursor', 'lang', 'fullscreen']) {
  check(k in DEFAULTS, `DEFAULTS содержит ключ «${k}» из окна настроек`);
}
check(LANGUAGES.includes(DEFAULTS.lang), 'язык по умолчанию есть в списке LANGUAGES');

// --- конструктор без сохранённых данных: значения по умолчанию
store.clear();
let s = new Settings();
check(s.get('sfx') === DEFAULTS.sfx && s.get('music') === DEFAULTS.music, 'громкости по умолчанию');
check(s.get('smooth') === DEFAULTS.smooth && s.get('cursor') === DEFAULTS.cursor, 'сглаживание и курсор по умолчанию');
check(s.get('lang') === DEFAULTS.lang && s.get('fullscreen') === DEFAULTS.fullscreen, 'язык и fullscreen по умолчанию');

// --- set(): значение в памяти + JSON в localStorage
s.set('sfx', 0.25);
s.set('smooth', false);
check(s.get('sfx') === 0.25 && s.get('smooth') === false, 'set() меняет значения');
const saved = JSON.parse(store.get(KEY));
check(saved.sfx === 0.25 && saved.smooth === false, 'set() пишет JSON в localStorage');
check(saved.lang === DEFAULTS.lang && saved.sfx === 0.25, 'в localStorage попадают и изменённые, и прежние ключи');

// --- (в) восстановление при загрузке: новый экземпляр читает то же
const s2 = new Settings();
check(s2.get('sfx') === 0.25 && s2.get('smooth') === false, 'новый Settings восстанавливает сохранённое');
check(s2.get('music') === DEFAULTS.music, 'несохранённый ключ берётся из DEFAULTS');

// --- частично сохранённые данные (старая версия без части полей)
store.set(KEY, JSON.stringify({ sfx: 0.9 }));
const s3 = new Settings();
check(s3.get('sfx') === 0.9 && s3.get('music') === DEFAULTS.music && s3.get('lang') === DEFAULTS.lang,
  'частичный JSON: сохранённое перекрывает, остальное из DEFAULTS');

// --- уведомления onChange
let seen = [];
const s4 = new Settings();
s4.onChange((name, value) => seen.push([name, value]));
s4.set('music', 0.5);
s4.set('cursor', true);
check(seen.length === 2 && seen[0][0] === 'music' && seen[0][1] === 0.5 && seen[1][0] === 'cursor' && seen[1][1] === true,
  'onChange получает (имя, значение) на каждый set');

// --- битый JSON в localStorage: падаем на DEFAULTS, не исключением
store.set(KEY, '{not json');
let s5 = new Settings();
check(s5.get('sfx') === DEFAULTS.sfx && s5.get('lang') === DEFAULTS.lang, 'битый JSON — значения по умолчанию, без исключений');
s5.set('sfx', 0.1); // и запись после этого работает
check(JSON.parse(store.get(KEY)).sfx === 0.1, 'после битого JSON set() снова пишет корректный JSON');

// --- недоступное хранилище: значение в памяти и onChange живут
failStorage = true;
const s6 = new Settings();
let got = null;
s6.onChange((n, v) => { got = v; });
s6.set('lang', 'eng');
check(s6.get('lang') === 'eng' && got === 'eng', 'setItem кидает — значение и onChange всё равно работают');
failStorage = false;

// --- языки: set/get сохраняются и восстанавливаются
store.clear();
const s7 = new Settings();
s7.set('lang', 'deu');
check(new Settings().get('lang') === 'deu', 'язык сохраняется и восстанавливается');

// --- профили: добавление (trim, без дубликатов и пустых), копия списка
store.clear();
const s8 = new Settings();
s8.addProfile('  Аня  ');
s8.addProfile('Аня'); // дубликат
s8.addProfile('   '); // пустое
s8.addProfile('');
check(JSON.stringify(s8.profiles()) === '["Аня"]', 'addProfile: trim, без дубликатов и пустых');
s8.profiles().push('взлом');
check(s8.profiles().length === 1, 'profiles() отдаёт копию списка');

// --- профили: удаление и переключение текущего игрока
s8.set('player', 'Аня');
s8.addProfile('Борис');
s8.removeProfile('Борис');
check(s8.get('player') === 'Аня' && s8.profiles().length === 1, 'удаление не текущего профиля не меняет player');
s8.removeProfile('Аня');
check(s8.get('player') === '' && s8.profiles().length === 0, 'удаление текущего профиля переключает player на первый оставшийся');
s8.removeProfile('несуществующий');
check(s8.get('player') === '' && s8.profiles().length === 0, 'удаление неизвестного имени ничего не ломает');

console.log(failed ? `\nПРОВАЛЕНО проверок: ${failed}` : '\nВсе проверки settings.js прошли.');
process.exit(failed ? 1 : 0);
