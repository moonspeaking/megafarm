// Аудит манифеста ресурсов (задача 41). Проверяет assets/manifest.json:
//   (а) каждая запись (textures/sounds/scripts/fonts) указывает на существующий файл;
//   (б) каждое имя текстуры, которое src/*.js запрашивает литералом (assets.image('…'),
//       tex('…'), .add('…') → preload и т.п.), разрешается в запись манифеста —
//       проверяется тем же алгоритмом resolve() из src/assets.js;
//   (в) информационно: файлы в assets/textures и assets/sounds, на которые манифест
//       не ссылается (в т.ч. .jpg-оригиналы рядом с .png), и записи манифеста, нигде
//       не запрошенные кодом/скриптами/CSS.
// Код возврата ≠ 0 только при ошибках (а) и (б). Запуск: node tools/check_manifest.mjs

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../src/assets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const SCRIPTS = join(ROOT, 'assets', 'scripts');
const TEXTURES = join(ROOT, 'assets', 'textures');
const SOUNDS_DIR = join(ROOT, 'assets', 'sounds');

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

// ---------------------------------------------------------------- манифест и диск
const manifestPath = join(ROOT, 'assets', 'manifest.json');
const manifest = JSON.parse(read(manifestPath));
const sections = ['textures', 'sounds', 'scripts', 'fonts'].filter((s) => manifest[s]);

const errors = []; // (а) и (б)

// (а) запись -> существующий файл
const entries = new Map(); // section -> Map(key -> path)
for (const sec of sections) {
  entries.set(sec, new Map(Object.entries(manifest[sec])));
  for (const [key, path] of entries.get(sec)) {
    if (!existsSync(join(ROOT, path))) {
      errors.push(`(а) ${sec}: '${key}' → файла нет: ${path}`);
    }
  }
}

// ------------------------------------------------------- (б) литералы текстур в src
const assets = new Assets(manifest);
const srcFiles = readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
const srcText = new Map(srcFiles.map((f) => [f, read(join(SRC, f)) || '']));

const resolvedKeys = new Set(); // ключи манифеста, запрошенные литералами кода
const requestedNames = [];     // [{ name, file }] для отчёта

const checkName = (name, file, strict) => {
  const key = assets.resolve(name);
  if (key) { resolvedKeys.add(key); requestedNames.push({ name, file, key, ok: true }); return; }
  if (strict) {
    errors.push(`(б) src/${file}: литерал текстуры '${name}' не найден в манифесте`);
    requestedNames.push({ name, file, key: null, ok: false });
  }
};

// вызовы-аналоги с единственным строковым аргументом (строгая проверка):
//   assets.image('…') / .tex('…') / .texture('…') / .add('…') (preload-наборы)
const CALL_RE = /\.(?:image|tex|texture|add)\(\s*(['"])((?:[^'\\]|\\.)*)\1\s*[,)]/g;
// прямые ключи: manifest.textures['…']
const KEY_RE = /manifest\.textures\[\s*(['"])([^'"]+)\1\s*\]/g;
// выражения (тернарники/конкатенации): литералы-фрагменты проверяем мягко,
// только если сами разрешаются (иначе это части имён вида 'gui/' + …)
const FRAG_RE = /['"]([^'"\n]+)['"]/g;

for (const [file, text] of srcText) {
  // classList.add('hidden') и т.п. — не текстуры
  let cleaned = text.replace(/classList\.add\([^)]*\)/g, 'classList.add(SKIP)');
  for (const m of cleaned.matchAll(CALL_RE)) checkName(m[2], file, true);
  for (const m of cleaned.matchAll(KEY_RE)) checkName(m[2], file, true);
  // мягкий проход: литералы внутри вызовов с выражениями и шаблонами
  const exprRe = /\.(?:image|tex|texture)\(([^()]*[+?][^()]*)\)/g;
  for (const m of cleaned.matchAll(exprRe)) {
    for (const f of m[1].matchAll(FRAG_RE)) checkName(f[1], file, false);
  }
}

// ------------------------------------------------------- источники «использовано»
// скрипты оригинала: весь корпус (имена текстур/звуков ищем подстрокой)
const scriptFiles = [];
const walk = (dir) => {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.txt')) scriptFiles.push(p);
  }
};
walk(SCRIPTS);
const scriptsCorpus = scriptFiles.map((p) => read(p) || '').join('\n').toLowerCase();

// CSS/HTML: url('assets/textures/…') — сверяем с путями манифеста
const cssFiles = ['styles.css', 'index.html'].map((f) => join(ROOT, f));
const cssPaths = new Set();
for (const p of cssFiles) {
  const text = read(p) || '';
  for (const m of text.matchAll(/url\(\s*['"]?([^)'"]+)['"]?\s*\)/g)) {
    cssPaths.add(m[1].replace(/^\.\//, '').split('?')[0].toLowerCase());
  }
}
const pathToKey = new Map(); // 'assets/textures/…png' -> ключ
for (const sec of ['textures', 'sounds']) {
  for (const [key, path] of entries.get(sec)) pathToKey.set(path.toLowerCase(), `${sec}:${key}`);
}
const cssKeys = new Set();
for (const p of cssPaths) {
  const hit = pathToKey.get(p);
  if (hit) cssKeys.add(hit);
}

// data.js: списки загружаемых скриптов (host + interfaces), остальное — objects/, level*, паки языков
const dataSrc = read(join(SRC, 'data.js')) || '';
const listKeys = new Set();
for (const m of dataSrc.matchAll(/=\s*\[([^\]]*)\]/g)) {
  for (const l of m[1].matchAll(/['"]([^'"]+)['"]/g)) listKeys.add(l[1]);
}

// --------------------------------------------------- (в) неиспользуемые записи
const usedKey = (sec, key) => {
  const tag = `${sec}:${key}`;
  if (resolvedKeys.has(key) && sec === 'textures') return 'src';
  if (cssKeys.has(tag)) return 'css';
  if (sec === 'textures') {
    const base = key.split('/').pop().replace(/\.(tga|jpg|jpeg|png)$/i, '').toLowerCase();
    if (scriptsCorpus.includes(base)) return 'scripts';
    return null;
  }
  if (sec === 'sounds') {
    const name = key.replace(/\.ogg$/i, '').toLowerCase();
    if (scriptsCorpus.includes(name)) return 'scripts';
    return null;
  }
  if (sec === 'scripts') {
    if (listKeys.has(key)) return 'src/data.js';
    if (key.startsWith('objects/') || /^level\d+$/.test(key)) return 'src/data.js';
    if (/^[a-z]{3}$/.test(key) || /^credits_[a-z]{3}$/.test(key)) return 'paks';
    return null;
  }
  if (sec === 'fonts') {
    const base = key.replace(/\.dat$/i, '').toLowerCase();
    const srcCorpus = [...srcText.values()].join('\n').toLowerCase();
    if (srcCorpus.includes(`'${base}'`) || srcCorpus.includes(`"${base}"`)) return 'src';
    return null;
  }
  return null;
};

const unused = new Map(); // section -> [{ key, via }]
for (const sec of sections) {
  const rows = [];
  for (const key of entries.get(sec).keys()) {
    const via = usedKey(sec, key);
    if (!via) rows.push({ key, via: null });
  }
  unused.set(sec, rows);
}

// --------------------------------------------------- (в) файлы диска вне манифеста
const diskFiles = []; // { path, rel }
const walkFiles = (dir) => {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkFiles(p);
    else diskFiles.push(p);
  }
};
walkFiles(TEXTURES);
walkFiles(SOUNDS_DIR);
const manifestPaths = new Set();
for (const sec of sections) for (const p of entries.get(sec).values()) manifestPaths.add(p);

const diskOnly = diskFiles
  .map((p) => relative(ROOT, p).split('?')[0])
  .filter((rel) => !manifestPaths.has(rel));
const jpgLeftovers = diskOnly.filter((rel) => /\.jpe?g$/i.test(rel) &&
  manifestPaths.has(rel.replace(/\.jpe?g$/i, '.png')));

// ---------------------------------------------------------------------- вывод
console.log('=== Аудит манифеста ресурсов ===\n');
console.log(`Манифест: ${sections.map((s) => `${s} ${entries.get(s).size}`).join(', ')};` +
  ` файлов на диске (textures+sounds): ${diskFiles.length}.`);
console.log(`(б) литералов текстур в src/*.js: ${requestedNames.length}` +
  ` (уникальных ключей манифеста задействовано: ${resolvedKeys.size});`);

if (errors.length) {
  console.log(`\nОШИБКИ (${errors.length}):`);
  for (const e of errors) console.log(`  - ${e}`);
}

console.log('\n(в) Неиспользуемые записи манифеста (информационно, не ошибка):');
let total = 0;
for (const sec of sections) {
  const rows = unused.get(sec);
  total += rows.length;
  console.log(`  ${sec}: ${rows.length}${rows.length ? ' ->' : ''}`);
  for (const r of rows) console.log(`    - ${r.key}`);
}
console.log(`\nИТОГО неиспользуемых записей: ${total}.`);

console.log(`\n(в) Файлы на диске вне манифеста: ${diskOnly.length}` +
  (jpgLeftovers.length ? ` (из них .jpg-оригиналов рядом с .png: ${jpgLeftovers.length}):` : ':'));
for (const rel of diskOnly) console.log(`  - ${rel}`);

if (errors.length) {
  console.log('\nИТОГ: ошибки в манифесте/литералах — см. выше.');
  process.exit(1);
}
console.log('ИТОГ: все записи манифеста указывают на существующие файлы, литералы текстур кода разрешаются.');
