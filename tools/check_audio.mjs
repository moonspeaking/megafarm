// Аудит звуков и музыки (задача 8).
// Собирает имена звуков/музыки из скриптов оригинала (soundhost_scripts.txt @sample/@stream,
// name_sfx в objects/*.txt) и из src/*.js (audio.play/playMusic/hooks.playSound + динамические
// семейства: ready_/feed_/harvest_<дом>, <работник>_wait). Проверяет, что каждое имя есть
// в assets/manifest.json, а файл файла манифеста существует. Выводит таблицу: отсутствующие,
// неиспользуемые (есть в манифесте, никем не запрошены), файлы на диске вне манифеста.
// Код возврата ≠ 0, только если что-то, запрошенное кодом порта, отсутствует в манифесте/на диске.
// Исключение: <работник>_wait для работников, которых не продаёт ни один уровень (bee, price 0) —
// такого звука нет и в оригинале, workerStop его молча пропускает.
// Звуки из скриптов оригинала, не попавшие в манифест (озвучка комиксов), — информационно.
// Запуск: node tools/check_audio.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'assets', 'scripts');
const OBJECTS = join(SCRIPTS, 'objects');
const SRC = join(ROOT, 'src');
const SOUNDS_DIR = join(ROOT, 'assets', 'sounds');

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const stripOgg = (s) => String(s).trim().replace(/\.ogg$/i, '').toLowerCase();

// ---------------------------------------------------------------- манифест и диск
const manifest = JSON.parse(read(join(ROOT, 'assets', 'manifest.json')));
const manifestSounds = new Map(Object.entries(manifest.sounds || {})); // 'name.ogg' -> путь
for (const [k, v] of manifestSounds) if (k !== k.toLowerCase()) { manifestSounds.delete(k); /* case */ }

// ---------------------------------------------------------------- request map: имя -> источники

const requested = new Map(); // имя -> Set(источников)
const addReq = (name, src) => {
  if (!name) return;
  name = name.toLowerCase();
  if (!requested.has(name)) requested.set(name, new Set());
  requested.get(name).add(src);
};

// 1) soundhost_scripts.txt: список звуков (@sample) и музыки (@stream) оригинала
const soundhost = read(join(SCRIPTS, 'soundhost_scripts.txt')) || '';
if (soundhost) {
  const body = soundhost.slice(soundhost.indexOf('<<') + 2, soundhost.lastIndexOf('>>'));
  let section = null;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const sec = /^@(\w+)\s*$/.exec(line.replace(/[{}]/g, '').trim());
    if (sec) { section = sec[1]; continue; }
    const m = /^([\w-]+)\.ogg\s*;$/.exec(line);
    if (m) addReq(m[1], `scripts/soundhost_scripts.txt @${section || '?'}`);
  }
}

// 2) name_sfx в объектных скриптах (звуки животных/поливалки)
for (const f of readdirSync(OBJECTS).filter((f) => f.endsWith('.txt'))) {
  const text = read(join(OBJECTS, f)) || '';
  const m = /#string\s+name_sfx\s+"([^"]+)"/.exec(text);
  if (m) addReq(stripOgg(m[1]), `objects/${f} name_sfx`);
}

// 3) литералы в src/*.js: audio.play('…'), hooks.playSound('…'), playMusic('…').
// В «чисто литеральном» вызове берём все литералы аргументов; в выражении
// (тернарник/конкатенация вида playSound(x ? 'a' : 'b'), wk.name + '_wait') литералы
// могут быть не полными именами ('tree', '_wait', 'ready_'), поэтому принимаем
// только те, что сами являются именами из манифеста.
for (const f of readdirSync(SRC).filter((f) => f.endsWith('.js'))) {
  const text = read(join(SRC, f)) || '';
  const re = /\b(?:(?:hooks\.)?playSound|audio\.play(?:Music)?)\(([^()]*?)\)/g;
  for (let m; (m = re.exec(text));) {
    const pure = /^\s*'/.test(m[1]);
    const lre = /'([^'\n]+)'/g;
    for (let l; (l = lre.exec(m[1]));) {
      const name = stripOgg(l[1]);
      if (pure || manifestSounds.has(`${name}.ogg`)) addReq(name, `src/${f}`);
    }
  }
}

// 4) динамические семейства из src/sim.js, суффиксы выводим из объектных скриптов
const objNames = []; // [имя, текст скрипта]
for (const f of readdirSync(OBJECTS).filter((f) => f.endsWith('.txt'))) {
  const m = /#string\s+name\s+"([^"]+)"\s*;/.exec(read(join(OBJECTS, f)) || '');
  if (m) objNames.push([m[1], f]);
}
// производящие постройки: house_* и beehive (name_sfx→ready_/harvest_'+houseSound)
const prodHouses = objNames.filter(([n]) => n.startsWith('house_') || n === 'beehive').map(([n]) => n);
for (const h of prodHouses) {
  const suffix = h.replace(/^house_/, '');
  addReq(`ready_${suffix}`, `src/sim.js: 'ready_' + houseSound(${h})`);
  addReq(`harvest_${suffix}`, `src/sim.js: 'harvest_' + houseSound(${h})`);
}
// кормёжка: только постройки с time_feed
for (const [n, f] of objNames) {
  if (n.startsWith('house_') && /#(?:int|float)\s+time_feed\s+\d/.test(read(join(OBJECTS, f)) || '')) {
    addReq(`feed_${n.replace(/^house_/, '')}`, `src/sim.js: 'feed_' + houseSound(${n})`);
  }
}
// работники по оплате: type_goods "workers" -> name_wait. Звук требуется только
// работникам, которых продают уровни (add to shop в level*.txt); у bee (price 0)
// звука нет и в оригинале (soundhost_scripts.txt) — workerStop молча его пропускает.
const soldByLevels = new Set(); // имена объектов из "add to shop" скриптов уровней
for (const f of readdirSync(SCRIPTS).filter((f) => /^level\d+\.txt$/.test(f))) {
  const text = read(join(SCRIPTS, f)) || '';
  const re = /#string\s+type\s+"add to shop";\s*#string\s+data\s+"([^"]+)"/g;
  for (let m; (m = re.exec(text));) soldByLevels.add(m[1]);
}
for (const [n, f] of objNames) {
  const text = read(join(OBJECTS, f)) || '';
  if (!/#string\s+type_goods\s+"workers"/.test(text)) continue;
  const sold = soldByLevels.has(n);
  addReq(`${n}_wait`, `src/sim.js: workerStop: ${n} + '_wait' (objects/${f})` +
    (sold ? '' : ', не продаётся уровнями'));
}
// карты звуков в src (const PUT_SOUNDS/TAKE_SOUNDS = {...}): значения — имена звуков
for (const f of readdirSync(SRC).filter((f) => f.endsWith('.js'))) {
  const text = read(join(SRC, f)) || '';
  const mapRe = /(?:const|let)\s+(\w*?_SOUNDS)\s*=\s*\{([^}]*)\}/g;
  for (let m; (m = mapRe.exec(text));) {
    const vre = /'([\w-]+)'/g;
    for (let v; (v = vre.exec(m[2]));) addReq(v[1], `src/${f}: ${m[1]}`);
  }
}
// клик по животному (house_* с name_sfx, задача 23) и по улью (beehive -> bees_sfx)
for (const [n, f] of objNames) {
  const text = read(join(OBJECTS, f)) || '';
  const m = /#string\s+name_sfx\s+"([^"]+)"/.exec(text);
  if (m && n.startsWith('house_')) addReq(stripOgg(m[1]), `src/sim.js: click house name_sfx (objects/${f})`);
}
addReq('bees_sfx', `src/sim.js: click beehive -> bees_sfx`);
// конец уровня (задача 37): имена берём из src/endsound.js — перебираем все
// комбинации endSoundName(won, newTrophies) и добавляем возвращённые имена
import { endSoundName } from '../src/endsound.js';
for (const won of [false, true]) {
  for (const trophies of [undefined, [], ['trophy_level1'], ['trophy_level1', 'trophy_level2']]) {
    addReq(endSoundName(won, trophies), 'src/endsound.js: endSoundName');
  }
}
// фон уровня (sim.js updateAmbient): birds<1..4> строится из строки, поэтому перечислен явно
for (let i = 1; i <= 4; i++) addReq(`birds${i}`, 'src/sim.js: updateAmbient (grass)');

// ---------------------------------------------------------------- файлы манифеста на диске
const diskFiles = new Set(readdirSync(SOUNDS_DIR).map((f) => f.toLowerCase()));
const fileMissing = [...manifestSounds.values()].filter((p) => !existsSync(join(ROOT, p)));
// на диске есть, в манифесте нет (имя на диске имя.m4a в манифесте значится как имя.ogg)
const diskOnly = [...diskFiles].filter((f) => !manifestSounds.has(f.replace(/\.m4a$/i, '.ogg')));

// ---------------------------------------------------------------- разбор запросов
const missing = [];   // запрошено, но нет в манифесте
const noFile = [];    // в манифесте есть, файла нет
const unusedInCode = []; // запрошено только скриптами оригинала, кодом порта не воспроизводится
const okRows = [];
for (const [name, srcs] of requested) {
  const inManifest = manifestSounds.has(`${name}.ogg`);
  const path = inManifest ? manifestSounds.get(`${name}.ogg`) : null;
  if (!inManifest) { missing.push({ name, srcs }); continue; }
  if (!existsSync(join(ROOT, path))) { noFile.push({ name, srcs, path }); continue; }
  const onlyOriginal = [...srcs].every((s) => s.startsWith('scripts/') || s.startsWith('objects/'));
  if (onlyOriginal) unusedInCode.push({ name, srcs, path });
  else okRows.push({ name, srcs, path });
}
// неиспользуемые: в манифесте, но ни код, ни скрипты их не запрашивают
const unusedManifest = [...manifestSounds.keys()]
  .map((k) => stripOgg(k))
  .filter((name) => !requested.has(name))
  .sort();

// компактная группировка множества отсутствующих по префиксу (озвучка комиксов)
const groupByPrefix = (rows) => {
  const out = [];
  const comics = rows.filter((r) => /^comics_/.test(r.name));
  if (comics.length) out.push({
    name: `comics_* (${comics.length} шт., озвучка кадров комиксов, p1…p13)`,
    srcs: comics[0].srcs, files: false,
  });
  for (const r of rows.filter((r) => !/^comics_/.test(r.name))) out.push(r);
  return out;
};

const pad = (s, n) => String(s).padEnd(n);
const cls = (name) => (name.startsWith('music_') ? 'music' : 'sfx');

// ---------------------------------------------------------------- вывод
console.log('=== Аудит звуков и музыки ===\n');
console.log(`Манифест: ${manifestSounds.size} записей в "sounds";` +
  ` файлов на диске (assets/sounds): ${diskFiles.size}.`);
console.log(`Запрошено имён: ${requested.size}; источники: литералы src/*.js,` +
  ` soundhost_scripts.txt (@sample/@stream), objects/*.txt name_sfx, семейства sim.js` +
  ` (ready_/feed_/harvest_ <дом>, <работник>_wait).`);

const line = () => console.log('');
const printRows = (title, rows, { files = true } = {}) => {
  console.log(`${title} (${rows.length}):`);
  if (!rows.length) { console.log('  (нет)'); return; }
  console.log('  ' + pad('имя', 40) + pad('класс', 7) + pad('источники', 60));
  for (const r of rows) {
    const srcs = [...r.srcs].slice(0, 3).join('; ') + ([...r.srcs].length > 3 ? '; …' : '');
    console.log('  ' + pad(r.name, 40) + pad(cls(r.name), 7) + pad(srcs, 60) +
      (r.path ? `[в манифесте: ${r.path}]` : files ? '[нет в манифесте]' : '[нет в манифесте, нет в assets/sounds]'));
  }
};

const missingGrouped = groupByPrefix(missing);
console.log('\nСводка по всем запрошенным именам:');
console.log(`  воспроизводится кодом порта (есть в манифесте и на диске): ${okRows.length}`);
console.log(`  в манифесте, но файла нет на диске: ${noFile.length + fileMissing.length}`);
console.log(`  запрошено только скриптами оригинала (код порта не играет): ${unusedInCode.length}`);
console.log(`  отсутствуют в манифесте и не портированы: ${missing.length}`);

line();
printRows('Отсутствующие в манифесте', missingGrouped);
line();
printRows('В манифесте, но файла нет на диске', noFile);
line();
const unusedAll = [
  ...unusedInCode.map((r) => ({ name: r.name, srcs: r.srcs, note: 'только в скриптах оригинала' })),
  ...unusedManifest.map((n) => ({ name: n, srcs: new Set(['—']), note: 'есть в манифесте, не запрошено никем' })),
].sort((a, b) => a.name.localeCompare(b.name));
console.log(`Неиспользуемые (${unusedAll.length}):`);
for (const r of unusedAll) console.log(`  - ${pad(r.name, 40)} ${r.note}`);
line();
if (diskOnly.length) console.log(`Файлы на диске, отсутствующие в манифесте (${diskOnly.length}): ${diskOnly.join(', ')}`);
else console.log('Файлов вне манифеста на диске нет.');

const bad = missing.some((r) =>
  [...r.srcs].some((s) => s.startsWith('src/')) &&
  // работники, которых уровни не продают (bee_wait): звука нет и в оригинале
  ![...r.srcs].every((s) => s.includes('не продаётся уровнями')));
line();
if (bad || noFile.length + fileMissing.length) {
  console.log('ИТОГ: запрошенное кодом порта отсутствует в манифесте/на диске:');
  for (const r of [...missing.filter((r) =>
    [...r.srcs].some((s) => s.startsWith('src/')) &&
    ![...r.srcs].every((s) => s.includes('не продаётся уровнями'))), ...noFile]) {
    console.log(`  - ${r.name}`);
  }
  process.exit(1);
}
console.log('ИТОГ: всё, что воспроизводит порт, есть в манифесте и на диске.');
console.log(`Вне порта: отсутствующих в манифесте имен из скриптов оригинала — ${missing.length},` +
  ` неиспользуемых — ${unusedAll.length} (см. выше).`);
process.exit(0);
