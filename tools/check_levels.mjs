#!/usr/bin/env node
// Валидатор скриптов уровней (задача 14).
// Для каждого assets/scripts/level0..12.txt проверяет то, что видно игре
// (тот же парсер src/dsl.js и src/data.js, DOM не нужен):
//   - объекты из "add to field"/"add field"/"add to shop"/"delete shop"/"add particles"
//     существуют в assets/scripts/objects/;
//   - тексты (data у show message/add notify/add task/set task, text_key/title_key)
//     есть в rus-паке;
//   - счётчики в условиях (@cond, @victory, counter >= N) где-то увеличиваются
//     (в src/sim.js по тем же правилам имён, что и в рантайме);
//   - ссылки на условия (@condition) определены в скрипте уровня;
//   - текстуры объектов (texpicture/texhighlight/texmask/texture_name)
//     разрешаются через src/assets.js c env уровня (нет ссылки «в никуда»);
//   - координаты спавна в границах level_size.
// Вывод: таблица «уровень → проблемы», код возврата != 0 при проблемах.
// Запуск: node tools/check_levels.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { Assets } from '../src/assets.js';
import { loadData } from '../src/data.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Скрипты грузятся через fetch; подменяем чтением с диска (как smoke_levels.mjs).
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]+/, '');
  const abs = rel.startsWith('/') ? rel : path.join(ROOT, rel);
  try {
    const text = await fs.readFile(abs, 'utf8');
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, text: async () => '', json: async () => { throw new Error('not found: ' + rel); } };
  }
};

// Типы действий, которые понимает sim.js (runAction).
const ACTION_TYPES = new Set([
  'show message', 'add to field', 'add field', 'add money', 'set money',
  'add to shop', 'delete shop', 'set task', 'add task',
  'enable condition', 'disable condition', 'add particles',
  'show help', 'add notify', 'victory', 'defeat',
]);
// Действия, чей data — ключ локализации (см. sim.js: db.t(a.data)).
const TEXT_ACTIONS = new Set(['show message', 'add notify', 'add task', 'set task']);

const CMP = /^\s*([A-Za-z_]\w*)\s*(>=|<=|==|!=|>|<)\s*(-?[\d.]+)\s*$/;

// Имена шаблонов частиц из particle_scripts.txt (@ParticleTemplate { #string name "…" }).
let particleNames = new Set();

// Счётчики, которые sim.js считает сам (World.counter) или инкрементирует по фиксированному имени.
const BUILTIN_COUNTERS = new Set([
  'time', 'money', 'fields_dug', 'fruits_ready', 'goods_ready',
  'house_fed', 'sick_plants', 'thirsty_plants', 'plants_watered',
  // работники: оплата при переходе в ожидание (sim.js workerStop), «?» без цели (sim.js workerAI)
  'worker_coin', 'worker_question',
]);

function collectProps(node, names, out) {
  for (const [k, v] of Object.entries(node.props || {})) {
    if (names.includes(k) && typeof v === 'string' && v) out.push({ prop: k, value: v });
  }
  for (const c of node.children || []) collectProps(c, names, out);
}

// Проверка одного счётчика из условия. Возвращает null если счётчик корректен,
// иначе строку с причиной.
function counterProblem(name, db) {
  if (BUILTIN_COUNTERS.has(name)) return null;
  const objects = db.objects;
  let m;
  if ((m = /^maxhealth_plant_(.+)$/.exec(name))) return objects.has('plant_' + m[1]) ? null : `нет объекта plant_${m[1]}`;
  if ((m = /^sow_(.+)$/.exec(name))) {
    const def = objects.get(m[1]);
    return def && def.type === 'seed' ? null : `не семя: ${m[1]}`;
  }
  if ((m = /^sell_plant_(.+)$/.exec(name))) return objects.has('plant_' + m[1]) ? null : `нет объекта plant_${m[1]}`;
  if ((m = /^sell_(.+)$/.exec(name))) {
    if (objects.has('plant_' + m[1])) return `продажа растений пишется в sell_plant_${m[1]}`;
    return objects.has(m[1]) ? null : `нет объекта ${m[1]}`;
  }
  if ((m = /^dead_(.+)$/.exec(name))) return objects.has(m[1]) ? null : `гибнет только объект ${m[1]} (нет в objects/)`;
  if ((m = /^place_(.+)$/.exec(name))) return objects.has(m[1]) ? null : `нет объекта ${m[1]}`;
  if ((m = /^buy_(.+)$/.exec(name))) return objects.has(m[1]) ? null : `нет объекта ${m[1]}`;
  return 'счётчик нигде не увеличивается (нет ни в sim.js, ни в скриптах объектов)';
}

function checkLevel(db, assets, n) {
  const problems = [];   // объективные ошибки
  const warnings = [];   // подозрительное, но не заведомая ошибка
  const stats = { actions: 0, conds: 0, counters: 0, objects: 0, textures: 0, texts: 0 };
  const lvl = db.levels.get(n);
  if (!lvl) { problems.push('скрипт не распарсился или @level не найден'); return { problems, warnings, stats }; }

  const env = lvl.props.level_env || 'grass';
  const size = lvl.props.level_size || [24, 16];
  const scenario = (lvl.children || []).find((c) => c.type === 'scenario');

  // Условия, видимые sim.js (setupScenario): узлы с exprs на уровне level и внутри scenario.
  const condNames = new Set();
  for (const c of [...(lvl.children || []), ...((scenario && scenario.children) || [])]) {
    if (c.exprs && c.exprs.length && c.type !== 'action' && c.type !== 'condition') condNames.add(c.type);
  }

  // Объекты, задействованные уровнем, — для проверки их текстур.
  const usedObjects = new Set();
  const actions = scenario ? scenario.children.filter((a) => a.type === 'action') : [];
  if (!scenario) problems.push('нет блока @scenario');
  if (!actions.some((a) => a.props.type === 'victory')) problems.push('нет действия "victory" — уровень непроходим');

  for (const a of actions) {
    const type = a.props.type;
    const data = a.props.data;
    const where = `"${type ?? '?'}"`;
    stats.actions++;
    if (!ACTION_TYPES.has(type)) { problems.push(`${where}: неизвестный тип действия (sim.js его молча игнорирует)`); continue; }

    if (TEXT_ACTIONS.has(type)) {
      if (!data || !data.trim()) { problems.push(`${where}: пустой data — нечего показать`); continue; }
      stats.texts++;
      if (!db.texts.has(data)) problems.push(`текста нет в rus-паке: "${data}"`);
      continue;
    }
    if (type === 'add to field') {
      if (!db.objects.has(data)) { problems.push(`${where}: объекта нет в objects/: "${data}"`); continue; }
      usedObjects.add(data);
      const c = a.props.coords;
      if (!c) { problems.push(`${where}: нет coords — sim.js ничего не поставит`); continue; }
      const [cx, cy] = c;
      if (cx < 0 || cy < 0 || cx >= size[0] || cy >= size[1]) problems.push(`${where}: coords ${cx}, ${cy} вне поля ${size[0]}x${size[1]}`);
      continue;
    }
    if (type === 'add field') {
      const parts = String(data || '').split(/\s+/);
      // "none N M" — разметка грядок в оригинале; порт её молча пропускает (spawn('none') → null).
      if (parts[0] !== 'none' && !db.objects.has(parts[0])) { problems.push(`${where}: объекта нет в objects/: "${parts[0]}"`); continue; }
      if (parts[0] !== 'none') usedObjects.add(parts[0]);
      const cols = parseInt(parts[1], 10) || 1;
      const rows = parseInt(parts[2], 10) || 1;
      if (!a.props.coords) { problems.push(`${where}: нет coords — sim.js ничего не поставит`); continue; }
      const [cx, cy] = a.props.coords;
      if (cx + cols - 1 >= size[0] || cy + rows - 1 >= size[1]) problems.push(`${where}: поле ${cols}x${rows} от ${cx}, ${cy} не влезает в ${size[0]}x${size[1]}`);
      continue;
    }
    if (type === 'add to shop' || type === 'delete shop') {
      if (!db.objects.has(data)) problems.push(`${where}: объекта нет в objects/: "${data}"`);
      else usedObjects.add(data);
      continue;
    }
    if (type === 'enable condition' || type === 'disable condition') {
      if (!condNames.has(data)) problems.push(`${where}: условия "${data}" нет в скрипте уровня`);
      continue;
    }
    if (type === 'add particles') {
      const parts = String(data || '').split(/\s+/).filter(Boolean);
      if (!parts.length || !db.objects.has(parts[0])) { problems.push(`${where}: объекта нет в objects/: "${parts[0] ?? ''}"`); continue; }
      usedObjects.add(parts[0]);
      if (parts[1] && !particleNames.has(parts[1])) problems.push(`${where}: шаблона частиц "${parts[1]}" нет в particle_scripts.txt`);
      continue;
    }
    if (type === 'add money' || type === 'set money') {
      if (!/^-?\d+$/.test(String(data || '').trim())) problems.push(`${where}: data не число: "${data}"`);
      continue;
    }

    // victory / defeat / show help — data не используется
    const condNode = (a.children || []).find((c) => c.type === 'condition');
    for (const e of (condNode && condNode.exprs) || []) {
      if (CMP.test(e)) continue; // сравнение счётчика — проверяется ниже
      if (!condNames.has(e.trim())) problems.push(`${where}: условие "${e}" не определено`);
    }
  }

  // Условия: каждый expr — либо сравнение счётчика, либо ссылка на другое условие.
  for (const name of condNames) {
    const node = [...(lvl.children || []), ...((scenario && scenario.children) || [])].find((c) => c.type === name);
    stats.conds++;
    for (const e of node.exprs) {
      const m = CMP.exec(e);
      if (!m) {
        if (condNames.has(e.trim())) warnings.push(`условие ${name}: ссылка на условие "${e}" — sim.js считает её пустым expr (истиной)`);
        else problems.push(`условие ${name}: "${e}" — не сравнение счётчика и не известное условие`);
        continue;
      }
      stats.counters++;
      const prob = counterProblem(m[1], db);
      if (prob) problems.push(`условие ${name}: счётчик ${m[1]} — ${prob}`);
    }
  }

  // Текстовые ключи text_key/title_key (в level*.txt их нет, проверка на будущее).
  for (const node of [lvl, ...((scenario && scenario.children) || [])]) {
    const found = [];
    collectProps(node, ['text_key', 'title_key'], found);
    for (const { prop, value } of found) {
      if (!db.texts.has(value)) problems.push(`${prop} отсутствует в rus-паке: "${value}"`);
    }
  }

  // Текстуры всех задействованных объектов — тем же резолвером, что и рендер.
  const TEX_PROPS = ['texpicture_name', 'texhighlight_name', 'texmask_name', 'texture_name'];
  const seen = new Set();
  for (const name of [...usedObjects].sort()) {
    const def = db.objects.get(name);
    stats.objects++;
    const refs = [];
    collectProps(def, TEX_PROPS, refs);
    for (const { prop, value } of refs) {
      const key = prop + ':' + value;
      if (seen.has(key)) continue;
      seen.add(key);
      stats.textures++;
      if (!assets.resolve(value, env)) problems.push(`объект ${name}: текстура ${prop} "${value}" не найдена в manifest.json (env ${env})`);
    }
  }

  return { problems, warnings, stats };
}

async function main() {
  const manifest = await loadManifest();
  const db = await loadData(manifest);
  const assets = new Assets(manifest);

  // шаблоны частиц
  const ptext = await fs.readFile(path.join(ROOT, 'assets/scripts/particle_scripts.txt'), 'utf8').catch(() => null);
  if (ptext) {
    const { parseScript } = await import('../src/dsl.js');
    for (const root of parseScript(ptext)) {
      for (const c of root.children || []) if (c.props.name) particleNames.add(c.props.name);
      if (root.props.name) particleNames.add(root.props.name);
    }
  }

  const LEVELS = [...db.levels.keys()].sort((a, b) => a - b);
  const rows = [];
  for (const n of LEVELS) {
    const { problems, warnings, stats } = checkLevel(db, assets, n);
    rows.push({ n, problems, warnings, stats });
  }
  const total = (k) => rows.reduce((s, r) => s + r.stats[k], 0);

  // таблица «уровень → проблемы»
  console.log('уровень | проблемы');
  console.log('--------|---------');
  for (const r of rows) {
    const p = r.problems.length ? `${r.problems.length}` : '—';
    const w = r.warnings.length ? ` (+${r.warnings.length} пред.)` : '';
    console.log(`уровень ${String(r.n).padEnd(2)} | ${p}${w}${r.problems[0] ? `: ${r.problems[0]}${r.problems.length > 1 ? ' …' : ''}` : ''}`);
  }

  // детали
  for (const r of rows) {
    if (!r.problems.length && !r.warnings.length) continue;
    console.log(`\n--- уровень ${r.n} ---`);
    const print = (list, marker) => {
      for (const p of [...new Set(list)]) {
        const k = list.filter((x) => x === p).length;
        console.log(`  ${marker} ${p}${k > 1 ? `  (×${k})` : ''}`);
      }
    };
    print(r.problems, '!');
    print(r.warnings, '~');
  }

  const bad = rows.filter((r) => r.problems.length);
  const warned = rows.filter((r) => r.warnings.length);
  console.log(`\nпроверено: действий ${total('actions')} (текстов ${total('texts')}), условий ${total('conds')} (сравнений счётчиков ${total('counters')}),` +
    ` объектов ${total('objects')} (ссылок на текстуры ${total('textures')})`);
  console.log(`итог: ${rows.length - bad.length}/${rows.length} уровней без проблем` +
    `${bad.length ? `, с проблемами: ${bad.map((r) => r.n).join(', ')}` : ''}` +
    `${warned.length ? `; предупреждения: ${warned.map((r) => r.n).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((err) => { console.error(err && err.stack || err); process.exit(2); });
