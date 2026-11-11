#!/usr/bin/env node
// Генерирует docs/levels.md — справочник уровней 1..12 по скриптам оригинала.
// Данные только из assets/scripts: файлы уровней, объекты, локализация rus.txt.
// Уровень 0 (level0.txt, «пробный») в кампанию не входит и в справочник не включён.
// Запуск: node tools/gen_levels_doc.mjs (вывод детерминированный, перегенерация без diff).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScript } from '../src/dsl.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LEVELS = 12;

// подписи типов объектов (destructor/transporter — по восстановленному поведению порта, sim.js useTool/buy)
const KIND_LABELS = {
  seed: 'семена', plant: 'грядка с растениями', patent: 'патент', house: 'домик животных',
  hangar: 'ангар', tree: 'дерево', worker: 'работник', box: 'ящик', multibox: 'большой ящик',
  fertilizer: 'удобрение', watercan: 'лейка', waterpump: 'водокачка', water_sprinkler: 'разбрызгатель',
  beehive: 'улей', destructor: 'destructor — удаление растений', transporter: 'transporter — перенос построек',
  hero: 'героиня', spade: 'лопата',
};

async function readText(rel) {
  return fs.readFile(path.join(ROOT, rel), 'utf8');
}

function parseLocalization(text) {
  const body = text.slice(text.indexOf('<<') + 2, text.lastIndexOf('>>'));
  const texts = new Map();
  for (let line of body.split('\n')) {
    line = line.trim();
    const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) texts.set(m[1], m[2].replace(/\^/g, '\n').trim());
  }
  return texts;
}

// все объекты: имя -> { type, typeGoods, price, patentFor }
async function loadObjects() {
  const dir = path.join(ROOT, 'assets/scripts/objects');
  const defs = new Map();
  for (const f of (await fs.readdir(dir)).sort()) {
    for (const node of parseScript(await readText(`assets/scripts/objects/${f}`))) {
      for (const n of [node, ...node.children]) {
        if (!n.props.name) continue;
        defs.set(n.props.name, {
          type: n.type,
          typeGoods: n.props.type_goods || '',
          price: n.props.price,
          patentFor: n.props.patent_for,
        });
      }
    }
  }
  return defs;
}

// сцена уровня: именованные условия и действия
function levelScenario(lvl) {
  const sc = lvl.children.find((c) => c.type === 'scenario');
  const conds = new Map(); // имя (тип узла) -> выражения, как в sim.js setupScenario
  for (const c of [...lvl.children, ...(sc ? sc.children : [])]) {
    if (c.type !== 'action' && c.type !== 'condition' && c.exprs && c.exprs.length) {
      conds.set(c.type, c.exprs);
    }
  }
  const actions = (sc ? sc.children : [])
    .filter((c) => c.type === 'action')
    .map((a) => {
      const cond = a.children.find((c) => c.type === 'condition');
      return {
        type: a.props.type,
        data: a.props.data,
        coords: a.props.coords,
        delay: a.props.delay || 0,
        exprs: cond ? cond.exprs : [],
      };
    });
  return { conds, actions };
}

// раскрытие ссылок на именованные условия: "victory" -> ["sell_plant_pumpkin >= 3"]
function expandExprs(exprs, conds, seen = new Set()) {
  const out = [];
  for (const e of exprs) {
    if (/^[A-Za-z_]\w*$/.test(e) && conds.has(e) && !seen.has(e)) {
      seen.add(e);
      out.push(...expandExprs(conds.get(e), conds, seen));
    } else {
      out.push(e);
    }
  }
  return out;
}

function fmtCond(exprs) {
  return exprs.length ? exprs.join('; ') : '—';
}

function fmtMoney(actions, conds) {
  const start = [];
  const later = [];
  for (const a of actions) {
    if (a.type !== 'add money' && a.type !== 'set money') continue;
    const n = parseInt(a.data, 10) || 0;
    const label = `${a.type === 'set money' ? '=' : '+'}${n}`;
    if (!a.exprs.length && a.delay === 0) start.push(label);
    else later.push(`${label} (${expandExprs(a.exprs, conds).join('; ')}${a.delay ? `, задержка ${a.delay} с` : ''})`);
  }
  return { start, later };
}

// объекты уровня: стартовые на поле, магазин, упоминания (для «новых механик»)
function levelObjects(actions, conds) {
  const field = [];
  const fieldLater = [];
  const shop = [];
  const unshop = [];
  const mentions = [];
  for (const a of actions) {
    if (a.type === 'add to field' || a.type === 'add field') {
      const line = a.type === 'add field'
        ? `${a.data}, сетка от (${a.coords ? a.coords.join(', ') : '?'})`
        : `${a.data} (${a.coords ? a.coords.join(', ') : '?'})`;
      (a.exprs.length ? fieldLater : field).push(line);
      mentions.push(a.type === 'add field' ? String(a.data).split(/\s+/)[0] : a.data);
    } else if (a.type === 'add to shop') {
      shop.push({
        name: a.data,
        when: a.exprs.length ? `по условию: ${fmtCond(expandExprs(a.exprs, conds))}` : 'сразу',
        delay: a.delay,
      });
      mentions.push(a.data);
    } else if (a.type === 'delete shop') {
      unshop.push({ name: a.data, when: fmtCond(expandExprs(a.exprs, conds)) });
      mentions.push(a.data);
    } else if (a.type === 'add particles') {
      mentions.push(String(a.data).split(/\s+/)[0]);
    }
  }
  return { field, fieldLater, shop, unshop, mentions: [...new Set(mentions)] };
}

async function main() {
  const manifest = JSON.parse(await readText('assets/manifest.json'));
  const texts = parseLocalization(await readText(manifest.scripts.rus));
  const objects = await loadObjects();

  const levels = [];
  for (let n = 1; n <= LEVELS; n++) {
    const src = await readText(manifest.scripts[`level${n}`]);
    const lvl = parseScript(src).find((r) => r.type === 'level');
    if (!lvl) throw new Error(`level${n}: @level не найден`);
    levels.push({ n, props: lvl.props, ...levelScenario(lvl) });
  }

  // «новые механики»: объект впервые встречается на этом уровне (поле, магазин, подсказки)
  const seenNames = new Set();
  for (const L of levels) {
    L.obj = levelObjects(L.actions, L.conds);
    L.newKinds = [];
    for (const name of L.obj.mentions) {
      const def = objects.get(name);
      if (!def || seenNames.has(name)) continue;
      seenNames.add(name);
      let kind = L.newKinds.find((k) => k.type === def.type);
      if (!kind) {
        kind = { type: def.type, label: KIND_LABELS[def.type] || def.type, names: [] };
        L.newKinds.push(kind);
      }
      kind.names.push(name);
    }
  }

  const out = [];
  const add = (...lines) => out.push(...lines);

  add('# Справочник уровней', '');
  add('Сгенерирован скриптом `tools/gen_levels_doc.mjs` из скриптов оригинала: `assets/scripts/level1..12.txt`,',
      '`assets/scripts/objects/*.txt`, локализация `assets/scripts/rus.txt`. Не редактировать вручную —',
      'перегенерировать: `node tools/gen_levels_doc.mjs`.', '');
  add('Уровень 0 (`level0.txt`, «пробный») в кампанию не входит. Условия с гигантскими порогами `time`', '(например `time >= 300000000000000`) в оригинале фактически никогда не срабатывают — приведены как есть.', '');
  add('## Сводка', '');
  add('| Уровень | Название | Среда | Поле | `level_time`, с | Стартовые деньги |');
  add('|---|---|---|---|---|---|');
  for (const L of levels) {
    const { start } = fmtMoney(L.actions, L.conds);
    const size = L.props.level_size || [];
    add(`| ${L.n} | ${L.props.level_name || '—'} | ${L.props.level_env || '—'} | ${size.join('×')} | ${L.props.level_time} | ${start.length ? start.join(' ') : '—'} |`);
  }
  add('');

  for (const L of levels) {
    const size = L.props.level_size || [];
    const { start, later } = fmtMoney(L.actions, L.conds);
    const obj = L.obj;
    const victories = L.actions.filter((a) => a.type === 'victory');
    const defeats = L.actions.filter((a) => a.type === 'defeat');
    const msgs = [];
    for (const a of L.actions) {
      if (a.type === 'show message' && !msgs.includes(a.data)) msgs.push(a.data);
    }

    add(`## Уровень ${L.n} — ${L.props.level_name || '—'}`, '');
    add(`- Среда: \`${L.props.level_env}\`, поле ${size.join('×')} клеток.`);
    add(`- \`level_time\`: ${L.props.level_time} с (золотое время, полоска на HUD).`);
    add(`- Стартовые деньги: ${start.length ? start.join(' ') : 'нет'}.`);
    if (later.length) add(`- Деньги по ходу уровня: ${later.join(', ')}.`);

    add('', '### Цели (победа)', '');
    if (victories.length) {
      for (const v of victories) {
        const tail = v.delay ? ` (задержка ${v.delay} с)` : '';
        add(`- ${fmtCond(expandExprs(v.exprs, L.conds))}${tail}`);
      }
    } else add('- нет в сценарии.');

    add('', '### Поражение', '');
    if (defeats.length) {
      for (const d of defeats) add(`- ${fmtCond(expandExprs(d.exprs, L.conds))}`);
    } else add('- нет в сценарии.');

    add('', '### Объекты на поле (старт)', '');
    if (obj.field.length) {
      for (const f of obj.field) add(`- ${f}`);
      for (const f of obj.fieldLater) add(`- ${f} — появляется по ходу уровня`);
    } else add('- нет.');

    add('', '### Магазин', '');
    if (obj.shop.length) {
      add('| Предмет | Тип | Цена | Появление |');
      add('|---|---|---|---|');
      const seenShop = new Set();
      for (const s of obj.shop) {
        if (seenShop.has(s.name)) continue;
        seenShop.add(s.name);
        const def = objects.get(s.name);
        const type = def ? (KIND_LABELS[def.type] || def.type) : '—';
        const price = def && def.price !== undefined ? def.price : '—';
        const when = s.delay ? `${s.when} (задержка ${s.delay} с)` : s.when;
        add(`| ${s.name} | ${type} | ${price} | ${when} |`);
      }
    } else add('- магазин в сценарии не пополняется.');
    if (obj.unshop.length) {
      add('', 'Убирается из магазина по ходу уровня:');
      for (const s of obj.unshop) add(`- ${s.name} — ${s.when}`);
    }

    add('', '### Новые механики (первое появление объектов)', '');
    if (L.newKinds.length) {
      for (const k of L.newKinds) {
        const pats = k.names.filter((m) => objects.get(m) && objects.get(m).patentFor);
        const extra = pats.length ? ` (патент открывает: ${pats.map((m) => objects.get(m).patentFor).join(', ')})` : '';
        add(`- ${k.label}: ${k.names.join(', ')}${extra}`);
      }
    } else add('- новых объектов нет.');

    add('', '### Сообщения-подсказки', '');
    if (msgs.length) {
      for (const key of msgs) {
        const text = texts.get(key);
        add(`- \`${key}\` — ${text !== undefined ? text.replace(/\n/g, '<br>') : '*(нет в rus.txt)*'}`);
      }
    } else add('- нет.');
    add('');
  }

  const doc = out.join('\n') + '\n';
  await fs.writeFile(path.join(ROOT, 'docs/levels.md'), doc);
  console.log(`docs/levels.md: ${levels.length} уровней, ${doc.split('\n').length} строк`);
}

main().catch((err) => { console.error(err && err.stack || err); process.exit(2); });
