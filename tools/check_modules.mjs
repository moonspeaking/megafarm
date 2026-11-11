// Статическая проверка модулей src/ (задача 32). Без запуска DOM: читает каждый
// src/*.js как текст, собирает `import { … } from './x.js'` и `export …`
// (function/const/class/let, `export { … }`), проверяет:
//   (а) каждый импортируемый путь существует;
//   (б) каждое импортируемое имя экспортируется целевым модулем;
//   (в) нет циклических импортов (цикл выводится);
//   (г) информационно: экспорт нигде не импортируется.
// Код возврата ≠ 0 при (а)–(в). Запуск: node tools/check_modules.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

// --------------------------------------------------------------- разбор модуля

// import { a, b as c } from './x.js' — поддержаны дефолт/namespace для полноты
const IMPORT_RE = /import\s+(?:({[^}]*})|(\*\s+as\s+\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
// export function/const/class/let/var имя  (async — перед function)
const EXPORT_DECL_RE = /^export\s+(?:async\s+)?(function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
// export { a, b as c }; — переименование: локальное имя `as` экспортируемое
const EXPORT_LIST_RE = /export\s*\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/g;

function parseModule(text) {
  const imports = []; // { names:[запрашиваемые], path }
  for (const m of text.matchAll(IMPORT_RE)) {
    const names = m[1]
      ? m[1].slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => (s.split(/\s+as\s+/)[1] || s.split(/\s+as\s+/)[0]).trim())
      : m[2] ? [m[2].split(/\s+as\s+/)[1].trim()]
      : [m[3]];
    imports.push({ names, path: m[4] });
  }
  const exports = new Set(); // экспортируемые имена
  for (const m of text.matchAll(EXPORT_DECL_RE)) exports.add(m[2]);
  for (const m of text.matchAll(EXPORT_LIST_RE)) {
    for (let s of m[1].split(',')) {
      s = s.trim();
      if (!s) continue;
      exports.add((s.split(/\s+as\s+/)[1] || s).trim());
    }
  }
  return { imports, exports: [...exports] };
}

// ---------------------------------------------------------------------- сборка

const files = readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
const mods = new Map(); // файл -> { imports, exports }
for (const f of files) mods.set(f, parseModule(read(join(SRC, f)) || ''));

// путь импорта -> файл в src/ ('' если внешний)
function resolveImport(fromFile, path) {
  if (!path.startsWith('.')) return null; // внешний/голый specifier — не наш случай
  const abs = resolve(dirname(join(SRC, fromFile)), path);
  const rel = abs.startsWith(SRC + '/') ? abs.slice(SRC.length + 1) : null;
  return rel;
}

const errors = []; // (а)–(в)
const importedNames = new Map(); // 'модуль#имя' -> [кто импортирует]

for (const [file, mod] of mods) {
  for (const imp of mod.imports) {
    const target = resolveImport(file, imp.path);
    if (target == null) {
      errors.push(`${file}: не-относительный импорт '${imp.path}' — вне src/`);
      continue;
    }
    if (!existsSync(join(SRC, target))) { // (а)
      errors.push(`${file}: импорт из '${imp.path}' — файла нет (${target})`);
      continue;
    }
    if (!mods.has(target)) errors.push(`${file}: импорт из '${imp.path}' — файл вне src/*.js (${target})`);
    const tmod = mods.get(target);
    if (!tmod) continue;
    for (const name of imp.names) {
      importedNames.set(`${target}#${name}`, [...(importedNames.get(`${target}#${name}`) || []), file]);
      if (!tmod.exports.includes(name)) { // (б)
        errors.push(`${file}: импорт { ${name} } из '${imp.path}' — имя не экспортируется`);
      }
    }
  }
}

// (в) циклы: DFS, стек пути
const WHITE = 0, GRAY = 1, BLACK = 2;
const color = new Map(files.map((f) => [f, WHITE]));
const stack = [];
const cycles = [];
function dfs(file) {
  color.set(file, GRAY);
  stack.push(file);
  for (const imp of mods.get(file).imports) {
    const target = resolveImport(file, imp.path);
    if (target == null || !mods.has(target)) continue;
    if (color.get(target) === GRAY) {
      const at = stack.indexOf(target);
      cycles.push([...stack.slice(at), target].join(' → '));
    } else if (color.get(target) === WHITE) {
      dfs(target);
    }
  }
  stack.pop();
  color.set(file, BLACK);
}
for (const f of files) if (color.get(f) === WHITE) dfs(f);
// дедупликация циклов (один цикл находится с каждой его вершины)
const seen = new Set();
const uniqCycles = cycles.filter((c) => {
  const key = c.split(' → ').slice(0, -1).sort().join('|');
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
for (const c of uniqCycles) errors.push(`циклический импорт: ${c}`);

// (г) неиспользуемые экспорты (информационно)
const unused = [];
for (const [file, mod] of mods) {
  for (const name of mod.exports) {
    const users = importedNames.get(`${file}#${name}`);
    if (!users) unused.push(`${name} (${file})`);
  }
}

// --------------------------------------------------------------------- вывод

console.log('Статическая проверка модулей src/\n');
console.log('модуль            | импорты из                          | экспорты');
console.log('------------------|-------------------------------------|------------------');
for (const [file, mod] of mods) {
  const imps = mod.imports.map((i) => i.path.replace('./', '')).join(', ') || '—';
  const exps = mod.exports.join(', ') || '—';
  console.log(`${file.padEnd(17)} | ${imps.padEnd(35).slice(0, 35)} | ${exps}`);
}

if (unused.length) {
  console.log('\nНеиспользуемые экспорты (информационно, не ошибка):');
  for (const u of unused) console.log(`  - ${u}`);
} else {
  console.log('\nНеиспользуемых экспортов нет.');
}

if (errors.length) {
  console.log(`\nОШИБКИ (${errors.length}):`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exitCode = 1;
} else {
  console.log('\nOK: пути существуют, имена экспортируются, циклов нет.');
}
