// Статическая проверка согласованности HTML / CSS / JS (задача 40). Без браузера:
// текстовый разбор index.html, styles.css и src/*.js.
//   (а) каждый id из `getElementById('x')`, `$('#x')`, `querySelector('#x')` и ключ
//       `el.x` в src/*.js либо есть как id="x" в index.html, либо создаётся в коде
//       (`id = 'x'` / `.id = 'x'`);
//   (б) каждый CSS-класс, который src/*.js ставит строками (`className = '…'`,
//       `classList.add/remove/toggle('…')`, `el('div', 'cls', …)`, class в innerHTML),
//       определён в styles.css — ИНФОРМАЦИОННО: класс без стиля бывает маркером;
//   (в) каждый `url('…')` в styles.css и index.html указывает на существующий файл.
//       Там же информационно проверяются статические `url('…')` внутри src/*.js.
// Код возврата ≠ 0 только для (а) и (в). Вывод — таблица «файл → проблемы».
// Запуск: node tools/check_dom.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// ------------------------------------------------- маленький сканер выражений

// Тело вызова: src[i] === '(' — текст до парной скобки с учётом строк и шаблонов
function callArgs(src, i) {
  let depth = 0, quote = null, tmpl = 0;
  const start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (quote === '`' && c === '$' && src[i + 1] === '{') { tmpl++; i++; continue; }
      if (quote === '`' && tmpl && c === '}') { tmpl--; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (--depth === 0 && c === ')') break; }
  }
  return src.slice(start + 1, i);
}

// Аргументы верхнего уровня: сплит по запятым вне скобок/строк
function splitTop(args) {
  const parts = []; let cur = '', depth = 0, quote = null, tmpl = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += args[++i] || ''; continue; }
      if (quote === '`' && c === '$' && args[i + 1] === '{') { tmpl++; cur += args[++i]; continue; }
      if (quote === '`' && tmpl && c === '}') { tmpl--; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// Содержимое строковых литералов ('…', "…", `…`)
const LIT_RE = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g;
function literals(s) {
  const out = [];
  for (const m of s.matchAll(LIT_RE)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
const words = (s) => s.split(/\s+/).filter(Boolean);

// -------------------------------------------------------------------- разбор

const html = read(join(ROOT, 'index.html'));
const css = read(join(ROOT, 'styles.css'));
const srcFiles = readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
const src = new Map(srcFiles.map((f) => [f, read(join(SRC, f))]));

const htmlIds = new Set([...html.matchAll(/\bid\s*=\s*["']([\w-]+)["']/g)].map((m) => m[1]));
const cssClasses = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));

// Помощники меню, у которых строковый аргумент — CSS-класс: имя → номер аргумента
const CLS_ARG = { el: 1, pill: 3, win: 5 };

const problems = new Map(); // файл -> [{ kind, text }]
const add = (file, kind, text) => {
  if (!problems.has(file)) problems.set(file, []);
  problems.get(file).push({ kind, text });
};

const createdIds = new Set(); // id, создаваемые в коде (.id = '…')
for (const text of src.values()) {
  for (const m of text.matchAll(/\b(?:\.\s*)?id\s*=\s*['"]([\w-]+)['"]/g)) createdIds.add(m[1]);
}

for (const [file, text] of src) {
  // (а) id: getElementById / $('#x') / querySelector('#x') / ключи el.x
  const usedIds = new Map(); // id -> пример
  for (const m of text.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) usedIds.set(m[1], m[0]);
  for (const m of text.matchAll(/\$\(\s*['"]#([\w-]+)['"]\s*\)/g)) usedIds.set(m[1], m[0]);
  for (const m of text.matchAll(/querySelector\(\s*['"]#([\w-]+)['"]\s*\)/g)) usedIds.set(m[1], m[0]);
  // ключи el.x (this.el.hint и т.п.): коллекция элементов, ключ = id
  for (const m of text.matchAll(/\.el\.([A-Za-z_$][\w$]*)/g)) usedIds.set(m[1], `el.${m[1]}`);
  for (const [id, how] of usedIds) {
    if (!htmlIds.has(id) && !createdIds.has(id)) {
      add(file, 'ERROR', `id '${id}' (${how}) — нет в index.html и не создаётся в коде`);
    }
  }

  // (б) классы, присваиваемые строками
  const usedClasses = new Set();
  // className = '…' (в пределах строки: в коде присваивания однострочные)
  for (const m of text.matchAll(/\bclassName\s*=\s*([^\n]*)/g)) {
    for (const lit of literals(m[1])) for (const w of words(lit)) usedClasses.add(w);
  }
  // classList.add/remove('a','b') / toggle('a', force) — force не класс
  const CLS_RE = /classList\s*\.\s*(add|remove|toggle)\s*\(/g;
  for (let m; (m = CLS_RE.exec(text));) {
    const parts = splitTop(callArgs(text, m.index + m[0].length - 1));
    const take = m[1] === 'toggle' ? parts.slice(0, 1) : parts;
    for (const arg of take) for (const lit of literals(arg)) for (const w of words(lit)) usedClasses.add(w);
  }
  // хелперы el/pill/win: строковый аргумент — класс(ы)
  const CALL_RE = /(?:\bthis\s*\.\s*)?\b(el|pill|win)\s*\(/g;
  for (let m; (m = CALL_RE.exec(text));) {
    const parts = splitTop(callArgs(text, m.index + m[0].length - 1));
    const arg = parts[CLS_ARG[m[1]]];
    if (arg === undefined) continue;
    for (const lit of literals(arg)) for (const w of words(lit)) usedClasses.add(w);
  }
  // class="…" внутри innerHTML
  for (const m of text.matchAll(/\binnerHTML\s*=\s*([^\n]*)/g)) {
    for (const lit of literals(m[1])) {
      for (const c of lit.matchAll(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        for (const w of words(c[1] ?? c[2])) usedClasses.add(w);
      }
    }
  }
  for (const cls of usedClasses) {
    if (!cssClasses.has(cls)) add(file, 'info', `класс '${cls}' — нет селектора в styles.css (маркер?)`);
  }

  // (в) статические url('…') в src (динамические `url('${…}')` не матчатся) — информационно
  for (const m of text.matchAll(/url\(\s*['"]([^'"})]+?)['"]\s*\)/g)) {
    if (!existsSync(join(ROOT, m[1]))) add(file, 'info', `url('${m[1]}') — файла нет`);
  }
}

// (в) url('…') в styles.css и index.html — ошибка, если файла нет
for (const [file, text] of [['index.html', html], ['styles.css', css]]) {
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    if (!existsSync(join(ROOT, m[2]))) add(file, 'ERROR', `url('${m[2]}') — файла нет`);
  }
}

// --------------------------------------------------------------------- вывод

console.log('Проверка согласованности HTML / CSS / JS\n');
console.log(`index.html: id=${htmlIds.size}; styles.css: классов=${cssClasses.size}; src/*.js: ${srcFiles.length} модулей`);

const files = ['index.html', 'styles.css', ...srcFiles].filter((f) => problems.has(f));
if (files.length) {
  console.log('\nфайл              | проблемы');
  console.log('------------------|------------------------------------------------------');
  for (const f of files) {
    const list = problems.get(f);
    console.log(`${f.padEnd(17)} | ${list.length}`);
    for (const p of list) console.log(`${''.padEnd(17)} | ${p.kind === 'ERROR' ? 'ОШИБКА' : 'инфо '}  ${p.text}`);
  }
}

const errors = [];
for (const [f, list] of problems) for (const p of list) if (p.kind === 'ERROR') errors.push(`${f}: ${p.text}`);

const infos = [];
for (const [f, list] of problems) for (const p of list) if (p.kind === 'info') infos.push(`${f}: ${p.text}`);

if (infos.length) {
  console.log(`\nИнформационно, не ошибка (${infos.length}):`);
  for (const t of infos) console.log(`  - ${t}`);
}

if (errors.length) {
  console.log(`\nОШИБКИ (${errors.length}):`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exitCode = 1;
} else {
  console.log('\nOK: все id из src есть в index.html или создаются в коде; все url() существуют.');
}
