// Строки целей текущего задания для верхней панели (оригинал: upmenu_form.task1..task4, sub_414120).
// Цель = условие завершения текущего задания: условия действия «set task <ключ>» из скрипта уровня
// (например fields_dug >= 4 -> «Вскопать 1/4»). Подпись — «<предмет> - <глагол>» (task_separator, task_sow,
// task_sell, task_buy из языкового пака), справа — «текущее/нужное».

const MAX_LINES = 4;

/** Счётчик скрипта -> { verb, obj } (ключи языкового пака) или null, если счётчик — не цель. */
export function goalKind(counter) {
  if (counter === 'fields_dug') return { verb: 'dig_squares', obj: null };
  if (counter === 'plants_watered') return { verb: 'water_plants', obj: null };
  if (counter === 'money') return { verb: null, obj: 'money' };
  let m = /^sow_(.+)$/.exec(counter);
  if (m) return { verb: 'task_sow', obj: m[1] };
  m = /^sell_plant_(.+)$/.exec(counter);
  if (m) return { verb: 'task_sell', obj: m[1] };
  m = /^sell_(house_.+|beehive|tree_.+)$/.exec(counter);
  if (m) return { verb: 'task_sell', obj: m[1] + '_product' };
  m = /^(?:place|buy)_(.+)$/.exec(counter);
  if (m) return { verb: 'task_buy', obj: m[1] };
  return null;
}

/** Выражения «счётчик >= N» условий завершения задания `key`. */
function completionExprs(world, key) {
  const out = [];
  for (const a of world.actions || []) {
    if (a.type !== 'set task' || a.data !== key) continue;
    for (const name of a.conds || []) {
      const c = world.conds.get(name);
      if (!c) continue;
      for (const e of c.exprs) {
        const m = /^\s*([A-Za-z_]\w*)\s*(>=|>)\s*(-?[\d.]+)\s*$/.exec(e);
        if (m) out.push({ counter: m[1], target: parseFloat(m[3]) + (m[2] === '>' ? 1 : 0) });
      }
    }
  }
  return out;
}

/**
 * @returns {{text: string, cur: number, target: number}[]} до четырёх строк; пусто, если у задания нет целей.
 */
export function taskGoalLines(world) {
  if (!world || !world.tasks || !world.tasks.length) return [];
  const active = [...world.tasks].reverse().find((t) => t.state === 'active');
  if (!active) return [];
  const t = (k) => world.db.t(k, k);
  const sep = t('task_separator');
  const lines = [];
  const seen = new Set();
  for (const { counter, target } of completionExprs(world, active.key)) {
    const kind = goalKind(counter);
    if (!kind || seen.has(counter)) continue;
    seen.add(counter);
    const name = kind.obj ? t(kind.obj) : '';
    let text;
    if (kind.verb && kind.obj) text = `${name} ${sep} ${t(kind.verb)}`;
    else text = kind.verb ? t(kind.verb) : name;
    const cur = Math.min(Math.floor(world.counter(counter)), target);
    lines.push({ text, cur, target });
    if (lines.length >= MAX_LINES) break;
  }
  return lines;
}
