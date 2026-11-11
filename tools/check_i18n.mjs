// Аудит локализации (задача 7).
// Собирает ключи из языковых паков assets/scripts/*.txt, сравнивает каждый язык
// с rus/eng (нет/лишние/пустые/непарные %s %d), собирает все ключи, которые
// запрашивает код (db.t/tx в src/*.js) и скрипты (text_key/title_key, data
// у show message / add notify / add task / set task в level*.txt, map_script).
// Код возврата ≠ 0, если ключей не хватает в rus или eng.
// Запуск: node tools/check_i18n.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRA } from '../src/i18n_extra.js'; // запасные тексты порта (задача 30)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'assets', 'scripts');
const OBJECTS = join(SCRIPTS, 'objects');
const SRC = join(ROOT, 'src');
const LANGS = ['rus', 'eng', 'chn', 'deu', 'dut', 'esp', 'fra', 'ita', 'jap', 'kor', 'por', 'swe'];

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

// ---------------------------------------------------------------- language packs

function parsePack(code) {
  const text = read(join(SCRIPTS, `${code}.txt`));
  const pack = { code, map: new Map(), dup: [], empty: [] };
  if (text == null) return pack;
  const body = text.slice(text.indexOf('<<') + 2, text.lastIndexOf('>>'));
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (pack.map.has(key)) pack.dup.push(key);
    if (!value.trim()) pack.empty.push(key);
    pack.map.set(key, value.trim()); // как в data.js: последняя запись выигрывает
  }
  return pack;
}

const packs = new Map(LANGS.map((c) => [c, parsePack(c)]));
const refKeys = new Set([...packs.get('rus').map.keys(), ...packs.get('eng').map.keys()]);

function placeholders(v) {
  const n = (re) => (v.match(re) || []).length;
  return { s: n(/%s/gi), d: n(/%d/gi) };
}
function phMismatches(pack) {
  const out = [];
  for (const [key, value] of pack.map) {
    for (const base of ['rus', 'eng']) {
      const bv = packs.get(base).map.get(key);
      if (bv == null) continue; // нет эталонного значения
      const a = placeholders(value), b = placeholders(bv);
      if (a.s !== b.s || a.d !== b.d) {
        out.push({ key, base, a, b });
        break; // достаточно одного расхождения на ключ
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- requested keys

const requested = () => req; // map: ключ -> [источники] (используется ниже)

const req = new Map(); // ключ -> массив источников
const dynamicPrefixes = []; // литералы-префиксы из кода с динамическим суффиксом
const addReq = (key, src) => {
  if (!req.has(key)) req.set(key, []);
  const list = req.get(key);
  if (!list.includes(src)) list.push(src);
};

// 1) литералы db.t('…') / tx('…') / локальный помощник t('…') в src/*.js
for (const f of readdirSync(SRC).filter((f) => f.endsWith('.js'))) {
  const text = read(join(SRC, f)) || '';
  const re = /\b(?:db\.t|tx|t)\(\s*'((?:\\.|[^'\\])*)'/g;
  for (let m; (m = re.exec(text));) {
    const key = m[1];
    if (key.endsWith('_') || key === 'trophy_hint') dynamicPrefixes.push({ key, src: `src/${f}` });
    else addReq(key, `src/${f}`);
  }
}

// 2) text_key / title_key во всех скриптах assets/scripts (идентификаторы)
// 3) data у действий, попадающих в db.t в sim.js; имена 'add to shop' → notify_add_shop_*
const TEXT_TYPES = new Set(['show message', 'add notify', 'add task', 'set task']);
const shopNames = new Set();
const levelNames = [];
const scanTargets = [
  ...readdirSync(SCRIPTS).filter((f) => /^(level\d+|map_script)\.txt$/.test(f)),
  ...readdirSync(SCRIPTS).filter((f) => /_scripts\.txt$/.test(f)),
  ...readdirSync(OBJECTS).filter((f) => f.endsWith('.txt')).map((f) => join('objects', f)),
];

for (const rel of scanTargets) {
  const text = read(join(SCRIPTS, rel));
  if (text == null) continue;
  // data у действий обрабатывает только sim.js и только скрипты уровней
  const isLevel = /^(level\d+|map_script)\.txt$/.test(rel);
  const lines = text.split('\n');
  let curType = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    let m = /^#string\s+type\s+"([^"]*)"\s*;/.exec(line);
    if (m) { curType = m[1]; continue; }
    m = /^#string\s+text_key\s+"([^"]*)"\s*;/.exec(line) || /^#string\s+title_key\s+"([^"]*)"\s*;/.exec(line);
    if (m && /^[A-Za-z0-9_]+$/.test(m[1])) { addReq(m[1], rel); continue; }
    m = /^#string\s+data\s+"([^"]*)"\s*;/.exec(line);
    if (m) {
      if (!isLevel) { curType = null; continue; }
      if (curType === 'add to shop') shopNames.add(m[1]);
      if (TEXT_TYPES.has(curType) && /^[A-Za-z0-9_]+$/.test(m[1])) addReq(m[1], rel);
      curType = null; // type и data идут парами
    }
  }
  // имена уровней: menu.js (loadPlots) читает их только из map_script, где
  // level_name — это ключи levelN_name; русские имена в levelN.txt портом
  // не показываются, поэтому как ключи не запрашиваются
  if (rel === 'map_script.txt') {
    const lvlRe = /#string\s+level_name\s+"([^"]*)"/g;
    for (let m; (m = lvlRe.exec(text));) levelNames.push({ name: m[1], src: rel });
  }
}

// 4) семейства динамических ключей из кода
for (const c of LANGS) addReq(`lang_${c}`, 'src/menu.js: lang_ + код');
for (let i = 0; i <= 12; i++) addReq(`trophy_hint${i}`, 'src/menu.js: trophy_hint + i');
for (const tab of ['inventory', 'buildings', 'seeds', 'sprouts', 'trees', 'workers']) {
  addReq(`${tab}_form`, 'src/ui.js: TABS и db.t(key + "_form")');
}
for (const name of shopNames) addReq(`notify_add_shop_${name}`, 'src/sim.js: notify_add_shop_ + name');
for (const { name, src } of levelNames) addReq(name, `src/menu.js: tx(pl.name) ← ${src} level_name`);

// 5) имена объектов = ключи (всплывающие подсказки и «в руке», src/ui.js db.t(name))
for (const f of readdirSync(OBJECTS).filter((f) => f.endsWith('.txt'))) {
  const text = read(join(OBJECTS, f)) || '';
  const m = /#string\s+name\s+"([A-Za-z0-9_]+)"/.exec(text);
  if (m) addReq(m[1], `src/ui.js: db.t(name) ← objects/${f}`);
}

// ---------------------------------------------------------------- comparison

// Неисправимые отсутствия — задокументированы в docs/open-questions.md (пункт i18n,
// задача 7): ключей нет ни в одном паке оригинала, поведение порта осознанное.
const IRREPARABLE = [
  [/^l66_/, 'уровень 0 (freemode/test), ключей нет ни в одном паке'],
  [/^(undef|150|null|hint|unknown|0|task[1-4])$/, 'text_key-пустышки оригинальных интерфейсных скриптов'],
  [/^notify_add_shop_(destructor|house_chiken)$/, 'notify_add_shop_* нет в паках (destructor; опечатка chiken)'],
  [/^(bee|big_fertilizer|big_watercan|box|destructor|egg|fertilizer|fivebox|hangar_vegetables|hero|spade|tenbox|transporter|waterboy|watercan|waterpump|weak_fertilizer)$/,
    'имена объектов-предметов: в оригинальных паках нет, вероятнее оригинал показывал имя как есть'],
];
const whyIrreparable = (key) => {
  for (const [re, why] of IRREPARABLE) if (re.test(key)) return why;
  return null;
};

const covered = []; // покрыты запасными текстами src/i18n_extra.js (rus и eng)
const missing = { rus: [], eng: [] };
const irreparable = { rus: [], eng: [] };
for (const key of req.keys()) {
  const hasExtra = typeof EXTRA.rus[key] === 'string' && typeof EXTRA.eng[key] === 'string';
  for (const lang of ['rus', 'eng']) {
    if (packs.get(lang).map.has(key)) continue;
    if (hasExtra) { if (!covered.includes(key)) covered.push(key); continue; }
    (whyIrreparable(key) ? irreparable : missing)[lang].push(key);
  }
}
// префиксы с динамическим суффиксом: подчеркнуть те, чей набор суффиксов неизвестен
// trophy_hint и lang_/notify_add_shop_ расширены явными семействами выше
const knownPrefixes = new Set(['notify_add_shop_', 'lang_', 'trophy_hint']);
const dynUnchecked = dynamicPrefixes.filter((p) => !knownPrefixes.has(p.key));

const table = [];
for (const code of LANGS) {
  const pack = packs.get(code);
  const miss = [...refKeys].filter((k) => !pack.map.has(k));
  const extra = [...pack.map.keys()].filter((k) => !refKeys.has(k));
  const ph = phMismatches(pack);
  table.push({ code, total: pack.map.size, dup: pack.dup.length, empty: pack.empty.length, miss, extra, ph });
}

// ---------------------------------------------------------------- output

const pad = (s, n) => String(s).padEnd(n);
console.log('=== Аудит локализации ===\n');
console.log('Языковые паки vs общий набор ключей (rus ∪ eng):');
console.log('  ' + [['язык', 5], ['ключей', 7], ['дублей', 6], ['пустых', 6], ['нет', 5], ['лишних', 7], ['%s/%d', 6]]
  .map(([t, n]) => pad(t, n)).join('  '));
for (const row of table) {
  console.log('  ' + [
    pad(row.code, 5), pad(row.total, 7), pad(row.dup, 6), pad(row.empty, 6),
    pad(row.miss.length, 5), pad(row.extra.length, 7), pad(row.ph.length, 6),
  ].join('  '));
}
console.log('  «нет» = ключей нет в паке — все они покрыты цепочкой t() (задача 39: язык → eng → rus),');
console.log('  т.к. таблица сравнивает с rus ∪ eng; не покрыты лишь ключи с пустым значением во всей цепочке.');

const line = (s = '') => console.log(s);
const printList = (title, keys) => {
  line(); line(title + ` (${keys.length}):`);
  if (!keys.length) { line('  (нет)'); return; }
  for (const k of keys) {
    const obj = typeof k === 'object' ? k : null;
    const name = obj ? obj.key : k;
    const src = obj ? obj.src : (req.get(k) || []).join('; ');
    line(`  - ${name}   [источник: ${src}]`);
  }
};

printList('Ключи, покрытые запасными текстами src/i18n_extra.js', covered);
printList('Неисправимые отсутствия в rus (документированы в docs/open-questions.md)', irreparable.rus);
printList('Неисправимые отсутствия в eng (документированы в docs/open-questions.md)', irreparable.eng);
printList('Ключи, которых НЕТ в rus', missing.rus);
printList('Ключи, которых НЕТ в eng', missing.eng);

if (dynUnchecked.length) {
  printList('Динамические префиксы без известного набора суффиксов (не проверены автоматически)', dynUnchecked);
}

// расхождения %s/%d — детали только для rus/eng/проблемных, сокращённо для остальных
const phDetail = table.filter((r) => r.ph.length).map((r) => ({
  code: r.code, list: r.ph,
}));
if (phDetail.length) {
  line(); line('Непарные %s/%d (значение в языке vs rus):');
  for (const { code, list } of phDetail.slice(0, 100)) {
    line('  ' + code + ':');
    for (const d of list.slice(0, 100)) {
      const base = d.base;
      line(`    - ${d.key}  ${code}: %s×${d.a.s} %d×${d.a.d}   ${base}: %s×${d.b.s} %d×${d.b.d}`);
    }
    if (list.length > 100) line(`    … и ещё ${list.length - 100}`);
  }
}

// дубликаты и пустые значения в пиках (у всех языков)
for (const row of table) {
  const p = packs.get(row.code);
  if (p.dup.length) line(`Дубликаты в ${row.code}.txt (выигрывает последняя запись): ${[...new Set(p.dup)].join(', ')}`);
  if (row.extra.length) line(`Ключей нет в rus ∪ eng (лишние ключи ${row.code}.txt): ` + row.extra.join(', '));
}
line();
for (const code of ['rus', 'eng']) {
  const p = packs.get(code);
  if (p.empty.length) line(`Пустые значения в ${code}.txt: ${[...new Set(p.empty)].join(', ')}`);
}

const bad = missing.rus.length || missing.eng.length;
line();
if (bad) {
  console.log(`ИТОГ: не хватает ключей: rus ${missing.rus.length}, eng ${missing.eng.length} → код возврата 1`);
  process.exit(1);
} else {
  console.log('ИТОГ: недостающих ключей в rus/eng нет (остальные отсутствия — i18n_extra или документированы в open-questions.md)');
  process.exit(0);
}
