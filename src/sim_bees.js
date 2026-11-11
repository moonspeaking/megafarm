// Логика пчёл улья (beehive), вынесенная из sim.js (задача 20).
// Все функции принимают world/объект; поведение в точности как раньше.

/**
 * Bees fly to the nearest *ripe* flower (type_fruit "flower": dahlia, sunflower,
 * tulip), come back, and every trip adds `honey_per_bee` percent to the honey bar.
 */

/** Поиск цели: ближайший готовый (ripe) и полностью «перезрелый» (spoil >= 100)
 * цветок — type_fruit "flower" (георгин, тюльпан) или подсолнух. */
export function findFlower(world, b) {
  let best = null, bd = Infinity;
  for (const f of world.objects) {
    if (f.kind !== 'plant' || f.dead || !f.ready || (f.spoil || 0) < 100) continue;
    if (f.def.props.type_fruit !== 'flower' && f.name !== 'plant_sunflower') continue;
    const d = Math.hypot(f.x - b.x, f.y - b.y);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

/** Пчёлы улья: idle (ждёт и ищет цветок) -> out (летит) -> pick (собирает)
 * -> back (несёт мёд, каждая ходка даёт honey_per_bee процентов соты). */
export function updateBeehive(world, o, dt) {
  const p = o.def.props;
  const hpb = p.honey_per_bee || 1.5;
  const home = { x: o.x, y: o.y - 40 };
  for (const b of o.bees) {
    const fly = (to, speed) => {
      const dx = to.x - b.x, dy = to.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) return true;
      const step = Math.min(speed * dt, d);
      b.x += dx / d * step; b.y += dy / d * step;
      b.dir = dx;
      return false;
    };
    if (b.state === 'idle') {
      if (o.ready) continue;
      b.wait -= dt;
      if (b.wait > 0) continue;
      const best = findFlower(world, b);
      if (!best) { b.wait = 1; continue; }
      b.target = best; b.state = 'out';
    } else if (b.state === 'out') {
      const f = b.target;
      if (!f || f.dead || !f.ready) { b.state = 'back'; continue; }
      if (fly({ x: f.x, y: f.y - 24 }, 100)) { b.state = 'pick'; b.t = 0.8; }
    } else if (b.state === 'pick') {
      b.t -= dt;
      if (b.t <= 0) b.state = 'back';
    } else if (b.state === 'back') {
      if (fly(home, 100)) {
        b.state = 'idle'; b.wait = 0.5; b.target = null;
        if (o.progress < 100) {
          o.progress = Math.min(100, o.progress + hpb);
          if (o.progress >= 100 && !o.ready) {
            o.ready = 1;
            world.hooks.playSound('ready_beehive');
            world.sparkle(o.x, o.y - 60, '#fff2a0');
            world.hooks.updateHud();
          }
        }
      }
    }
  }
}

/** Инициализация роя при спавне улья (раньше — в World.spawn). */
export function initBees(o, x, y, def) {
  o.bees = [];
  for (let i = 0; i < (def.props.num_bees || 5); i++) {
    o.bees.push({ x: x, y: y - 40, state: 'idle', wait: i * 0.7, target: null, t: 0 });
  }
}

/** Сериализация пчёл: позиция, состояние, таймеры и цель (индексом в списке объектов). */
export function serializeBees(o, idx) {
  return o.bees.map((b) => ({ x: b.x, y: b.y, state: b.state, wait: b.wait, t: b.t, target: b.target ? idx.get(b.target) : null }));
}

/** Восстановление пчёл из снимка (раньше — в World.restoreObj). */
export function restoreBees(o, d, list) {
  for (let i = 0; i < o.bees.length && i < d.bees.length; i++) {
    const b = o.bees[i], s = d.bees[i];
    b.x = s.x; b.y = s.y; b.state = s.state; b.wait = s.wait; b.t = s.t || 0;
    // worker/bee claims are transient AI state: re-thought after the restore
    b.target = s.target != null ? (list[s.target] && !list[s.target].dead ? list[s.target] : null) : null;
  }
}
