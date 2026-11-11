#!/usr/bin/env node
// Тесты парсера DSL (задача 16), браузер не нужен.
// Часть 1: распарсить ВСЕ assets/scripts/**/*.txt — без исключений и без
//   «осиротевших» токенов (каждый @узел/#свойство вне строк и комментариев
//   должен попасть в дерево); посчитать узлы/свойства/ссылки/выражения.
// Часть 2: unit-проверки — пропущенная ';' перед @/#, вложенные блоки,
//   комментарии //, строки с кавычками и запятыми, #point a, b.
// Запуск: node tools/test_dsl.mjs (код возврата != 0 при ошибках).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScript } from '../src/dsl.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`ок: ${msg}`); return true; }
  console.error(`ОШИБКА: ${msg}`);
  failed++;
  return false;
}

// --- подсчёт содержимого дерева
function countTree(node) {
  const out = { nodes: 1, props: 0, refs: node.refs.length, exprs: node.exprs.length };
  for (const [k, v] of Object.entries(node.props)) {
    if (v === undefined) continue;
    out.props++;
    void k;
  }
  for (const c of node.children) {
    const r = countTree(c);
    out.nodes += r.nodes; out.props += r.props; out.refs += r.refs; out.exprs += r.exprs;
  }
  return out;
}

// Счётчик @узлов и #свойств в исходнике ВНЕ строк и комментариев
// (зеркало очистки комментариев в tokenize()). Повторное присваивание того же
// свойства в том же узле — не потеря: парсер хранит последнее значение.
function countMarkers(text) {
  let at = 0, hash = 0, inStr = false;
  const stack = [];        // узлы, чьи фигурные скобки открыты
  const seen = new Set();  // 'узел:имя' уже встречавшихся свойств
  let dups = 0;
  let pending = null;      // @узел, ждущий своей '{'
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // кавычка экранирована, если перед ней нечётное число backslash'ей
      let bs = 0;
      while (text[i - 1 - bs] === '\\') bs++;
      if (bs % 2 === 0) inStr = !inStr;
      continue;
    }
    if (!inStr && c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (inStr) continue;
    if (c === '@' && /\w/.test(text[i + 1] || '')) {
      let j = i + 1;
      while (/\w/.test(text[j] || '')) j++;
      at++;
      pending = at;        // порядковый номер узла
      i = j - 1;
      continue;
    }
    if (c === '{') {
      stack.push(pending ?? `anon${stack.length}`);
      pending = null;
      continue;
    }
    if (c === '}') { stack.pop(); pending = null; continue; }
    if (c === ';') { pending = null; continue; }
    if (c === '#' && /\w/.test(text[i + 1] || '')) {
      let j = i + 1;
      while (/\w/.test(text[j] || '')) j++;
      // имя свойства — идентификатор после маркера типа: #string <name> "…"
      let k = j, name = '';
      while (/\s/.test(text[k] || '')) k++;
      if (/[A-Za-z_]/.test(text[k] || '')) while (/\w/.test(text[k] || '')) name += text[k++];
      if (!name) name = text.slice(i + 1, j);
      const owner = stack.length ? stack[stack.length - 1] : 0;
      const key = `${owner}:${name}`;
      if (seen.has(key)) dups++; else seen.add(key);
      hash++;
      i = j - 1;
      continue;
    }
  }
  return { at, hash, dups };
}

// --- Часть 1: все скрипты
function listTxt(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTxt(p));
    else if (e.name.endsWith('.txt')) out.push(p);
  }
  return out.sort();
}

const files = listTxt(path.join(ROOT, 'assets/scripts'));
const rows = [];
let exceptions = 0, orphans = 0, overwrites = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  let roots = [];
  try {
    roots = parseScript(text);
  } catch (e) {
    exceptions++;
    console.error(`ОШИБКА: ${rel}: исключение парсера: ${e.message}`);
    rows.push({ rel, nodes: 0, props: 0, refs: 0, exprs: 0, bad: true });
    continue;
  }
  const sum = { nodes: 0, props: 0, refs: 0, exprs: 0 };
  for (const r of roots) {
    const c = countTree(r);
    sum.nodes += c.nodes; sum.props += c.props; sum.refs += c.refs; sum.exprs += c.exprs;
  }
  rows.push({ rel, ...sum, bad: false });

  // «осиротевшие» токены: каждый @/# вне строк и комментариев обязан попасть в дерево
  // (повторные присваивания того же свойства в одном узле учитываются отдельно)
  const mark = countMarkers(text);
  if (mark.at !== sum.nodes || mark.hash - mark.dups !== sum.props) {
    orphans++;
    console.error(`ОШИБКА: ${rel}: осиротевшие токены — @узлов в тексте ${mark.at}, в дереве ${sum.nodes}; ` +
      `#свойств в тексте ${mark.hash} (перезаписей ${mark.dups}), в дереве ${sum.props}`);
  }
  overwrites += mark.dups;
}

console.log('\nфайл | узлов | свойств | ссылок | выражений');
console.log('-----|-------|---------|--------|----------');
const tot = { nodes: 0, props: 0, refs: 0, exprs: 0 };
for (const r of rows) {
  console.log(`${r.rel} | ${r.bad ? '—' : r.nodes} | ${r.bad ? '—' : r.props} | ${r.bad ? '—' : r.refs} | ${r.bad ? '—' : r.exprs}`);
  tot.nodes += r.nodes; tot.props += r.props; tot.refs += r.refs; tot.exprs += r.exprs;
}
console.log(`\nитого по ${files.length} файлам: узлов ${tot.nodes}, свойств ${tot.props}, ссылок ${tot.refs}, выражений ${tot.exprs}`);
check(exceptions === 0, `ни одного исключения парсера на ${files.length} файлах`);
check(orphans === 0, `нет осиротевших токенов (@/# потеряны в ${orphans} файлах)`);
if (overwrites) console.log(` info: повторных присваиваний свойства в одном узле (хранится последнее): ${overwrites}`);

// семантика перезаписи: в plant_pumpkin.txt thirst_death задан дважды, побеждает последнее
{
  const text = fs.readFileSync(path.join(ROOT, 'assets/scripts/objects/plant_pumpkin.txt'), 'utf8');
  const n = parseScript(text)[0];
  check(n && n.props.thirst_death === 600, 'перезапись свойства: действует последнее присваивание (600, не 200)');
}

// --- Часть 2: unit-проверки
console.log('');

// пропущенная ';' перед '#' (значение свойства): parseValue останавливается на @/#
{
  const r = parseScript('@n {\n  #string a "x"\n  #string b "y";\n}');
  const n = r[0];
  check(n && n.props.a === 'x' && n.props.b === 'y', "пропущенная ';' перед #: оба свойства на месте");
  check(n && n.exprs.length === 0, "пропущенная ';' перед #: мусорных выражений нет");
}

// пропущенная ';' перед '@' (значение свойства)
{
  const r = parseScript('@n {\n  #string a "x"\n  @child { #string t "y"; }\n}');
  const n = r[0];
  check(n && n.props.a === 'x', "пропущенная ';' перед @: свойство на месте");
  check(n && n.children.length === 1 && n.children[0].type === 'child', "пропущенная ';' перед @: узел @child распознан");
}

// пропущенная ';' перед '@' внутри выражений (@cond): выражение не должно глотать узел
{
  const r = parseScript('@n {\n  @cond { c1\n    @action { #string type "victory"; }\n  }\n}');
  const cond = r[0] && r[0].children[0];
  check(cond && cond.type === 'cond' && JSON.stringify(cond.exprs) === '["c1"]', "пропущенная ';' перед @ в @cond: выражение 'c1' не разрослось");
  check(cond && cond.children.length === 1 && cond.children[0].type === 'action', "пропущенная ';' перед @ в @cond: @action остался дочерним узлом");
}

// вложенные блоки
{
  const r = parseScript('@a { @b { @c { #string x "1"; } #string y "2"; } }');
  const a = r[0], b = a && a.children[0], c = b && b.children[0];
  check(a && a.type === 'a' && b && b.type === 'b' && c && c.type === 'c', 'вложенные блоки: цепочка a→b→c');
  check(c && c.props.x === '1' && b.props.y === '2', 'вложенные блоки: свойства на своих уровнях');
  check(a && a.children.length === 1 && b && b.children.length === 1, 'вложенные блоки: лишних узлов нет');
}

// комментарии //
{
  const r = parseScript('// верхний комментарий с @fake и #fake\n@n { // внутренний\n  #string a "b"; // хвостовой\n}');
  check(r.length === 1 && r[0].type === 'n', 'комментарии: @fake из комментария не стал узлом');
  check(r[0] && r[0].props.a === 'b' && r[0].exprs.length === 0, 'комментарии: текст комментария не попал в свойства/выражения');
}

// комментарии не прячутся внутри строк, а строки не ломаются на //
{
  const r = parseScript('@n { #string u "http://x//y"; #string v "w"; }');
  check(r[0] && r[0].props.u === 'http://x//y', 'комментарии: // внутри строки — не комментарий');
  check(r[0] && r[0].props.v === 'w', 'комментарии: следующее свойство после строки с // на месте');
}

// строки с кавычками и запятыми (в т.ч. экранированные кавычки и ';' внутри строки)
{
  const r = parseScript('@n {\n  #string s "a, b; c";\n  #string q "say \\"hi\\"";\n  #string e "p \\" q"; // комментарий после строки с \\"\n  #string f "g";\n}');
  const n = r[0];
  check(n && n.props.s === 'a, b; c', 'строки: запятая и \';\' внутри кавычек не рвут значение');
  check(n && n.props.q === 'say "hi"', 'строки: экранированные \\" восстанавливаются');
  check(n && n.props.e === 'p " q', 'строки: \\" перед комментарием не ломает разбор хвоста');
  check(n && n.props.f === 'g' && n.exprs.length === 0, 'строки: свойства после строки с \\" и комментарием не потеряны');
}

// #point a, b (и отрицательные/дробные)
{
  const r = parseScript('@n { #point size 24, 16; #rect r -1.5, 2; }');
  const n = r[0];
  check(n && JSON.stringify(n.props.size) === '[24,16]', '#point a, b → массив [24, 16]');
  check(n && JSON.stringify(n.props.r) === '[-1.5,2]', '#point: отрицательные и дробные числа');
}

// базовые типы значений и ссылки [ref]
{
  const r = parseScript('@n 7 { #num k 5; #bool f true; #id v hello; [c1] }');
  const n = r[0];
  check(n && n.id === 7, 'узел: числовой идентификатор после @n');
  check(n && n.props.k === 5 && n.props.f === true && n.props.v === 'hello', 'значения: число / true / идентификатор');
  check(n && JSON.stringify(n.refs) === '["c1"]', 'ссылки [c1] собираются в node.refs');
}

// итог
console.log(`\nитог: ${failed === 0 ? 'все проверки прошли' : `упавших проверок: ${failed}`}`);
process.exit(failed ? 1 : 0);
