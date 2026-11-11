// Bootstrap, game loop and input.

import { loadManifest, loadDecor, Assets } from './assets.js';
import { loadData } from './data.js';
import { World, TILE, dirIndex } from './sim.js';
import { Renderer } from './render.js';
import { UI, showErrorPanel } from './ui.js';
import { AudioBank } from './audio.js';
import { Settings } from './settings.js';
import { Menu } from './menu.js';
import { Progress } from './progress.js';
import { Comics } from './comics.js';
import { playerKey, saveGame, loadSave, clearSave, shouldAutosave } from './savegame.js';

const canvas = document.getElementById('screen');
const gameEl = document.getElementById('game');

let assets;
let db;
let audio;
let ui;
let menu;
let settings;
let progress;
let comics;
let world = null;
let renderer = null;
let running = false;
let paused = false;
let crashed = false;
let lastHeldSig = '';
let lastResult = null;

const keys = new Set();

// ------------------------------------------------------------- scaling

function visibleSize() {
  // visualViewport: реальная видимая область (учитывает экранную клавиатуру,
  // зум страницы и адресную строку мобильных браузеров)
  const vv = window.visualViewport;
  const w = vv ? vv.width : window.innerWidth;
  const h = vv ? vv.height : window.innerHeight;
  return { w, h };
}

function resize() {
  const { w: vw, h: vh } = visibleSize();
  const s = Math.min(vw / 800, vh / 600);
  gameEl.style.transform = `scale(${s})`;
  // Render the canvas at the real device resolution instead of letting the
  // browser stretch an 800x600 bitmap (that is what made everything blurry).
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, s * dpr);
  const w = Math.round(800 * k), h = Math.round(600 * k);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

// ------------------------------------------------- global error resilience

let errorReported = false;

/** Выход в меню после фатальной ошибки: как hooks.quit в menu. */
function quitToMenu() {
  crashed = false;
  errorReported = false;
  world = null; renderer = null;
  if (ui) ui.unbind();
  paused = false;
  if (menu) menu.show();
}

/**
 * Один показ на инцидент: панель «Ошибка: <текст>» + console.error.
 * stopLoop — ошибки уровня: цикл останавливается, повторов на каждый кадр нет.
 */
function reportError(err, stopLoop = true) {
  const text = err && err.stack ? String(err.stack) : String(err && err.message || err);
  if (!errorReported) {
    errorReported = true;
    console.error('Ошибка игрового цикла:', text);
    showErrorPanel(gameEl, 'Ошибка: ' + text, quitToMenu);
  }
  if (stopLoop) { running = false; crashed = true; }
}

window.onerror = (msg, src, line, col, err) => {
  reportError(err || msg);
};
window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason;
  reportError(r && r.stack ? r : r && r.message ? r.message : r);
});

// -------------------------------------------------------------- boot

function setLoad(f) {
  const fill = document.querySelector('.ld_fill');
  if (fill) fill.style.width = `${Math.round(350 * f)}px`;
}

/** Splash screens (interfaces/intro): fade in 0.8 s, hold 3 s, fade out 0.8 s; a click skips. */
function playIntro(manifest) {
  const key = manifest.textures['intro/splash1'];
  if (!key) return Promise.resolve();
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'intro';
    const sp = document.createElement('div');
    sp.className = 'splash';
    sp.style.backgroundImage = `url('${key}')`;
    box.appendChild(sp);
    gameEl.appendChild(box);
    let finished = false;
    const done = () => { if (finished) return; finished = true; box.remove(); resolve(); };
    box.addEventListener('click', done);
    requestAnimationFrame(() => sp.classList.add('on'));
    setTimeout(() => sp.classList.remove('on'), 800 + 3000);
    setTimeout(done, 800 + 3000 + 800);
  });
}

async function boot() {
  setLoad(0.05);
  const manifest = await loadManifest();
  setLoad(0.2);
  assets = new Assets(manifest);
  assets.decor = await loadDecor();
  setLoad(0.45);
  db = await loadData(manifest);
  setLoad(0.85);
  audio = new AudioBank(assets);
  ui = new UI(assets, audio);
  setLoad(1);
  await new Promise((r) => setTimeout(r, 250));
  document.getElementById('loading').classList.add('hidden');
  await playIntro(manifest);
  // debugging handles
  window.__game = { get progress() { return progress; }, get settings() { return settings; }, get menu() { return menu; }, manifest, assets, db, audio, ui, startLevel, get world() { return world; }, get renderer() { return renderer; } };

  settings = new Settings();
  progress = new Progress(settings);
  comics = new Comics({ container: gameEl, assets, db, audio });
  applySetting('sfx'); applySetting('music'); applySetting('sfxOn'); applySetting('musicOn');
  applySetting('smooth');
  applySetting('cursor');
  settings.onChange((name) => applySetting(name));
  // фактическое состояние fullscreen — источник истины для настройки и метки в окне
  document.addEventListener('fullscreenchange', () => {
    settings.set('fullscreen', !!document.fullscreenElement);
    if (menu) menu.render();
  });
  if (settings.get('lang') !== 'rus') await db.setLanguage(manifest, settings.get('lang'));

  menu = new Menu({
    root: document.getElementById('menu'),
    assets, db, audio, settings, progress,
    hooks: {
      isInGame: () => !!world && !world.over,
      startLevel: (n, restored) => { menu.hide(); startLevel(n, restored); },
      resume: () => { menu.hide(); paused = false; },
      playComics: (page, done) => comics.play(page, done),
      currentLevel: () => (world ? world.levelNum : 1),
      restart: () => { menu.hide(); startLevel(world ? world.levelNum : 1); },
      saveAndQuit: () => {
        let saved = false;
        if (world && !world.over) {
          saved = saveGame(world, playerKey(settings));
          if (saved) ui.notify(db.t('game_saved', 'Игра сохранена.'));
        }
        world = null; renderer = null; ui.unbind(); paused = false;
        menu.show();
      },
      quit: () => { world = null; renderer = null; ui.unbind(); paused = false; menu.show(); },
      setLanguage: async (code) => {
        if (await db.setLanguage(manifest, code)) settings.set('lang', code);
        if (world) { ui.updateShop(); ui.updateTasks(); ui.updateHud(); }
      },
    },
  });
  ui.menu = menu;
  menu.show();
  // browsers block autoplay: start the music on the first user gesture;
  // fullscreen тоже разрешён только по жесту — возвращаем сохранённый пункт при первом клике
  document.addEventListener('pointerdown', () => {
    if (audio.wantedMusic) audio.playMusic(audio.wantedMusic);
    if (settings.get('fullscreen') && !document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, { once: true });

  // кнопка под «Меню»: камера обратно на героиню
  document.getElementById('btn_center').addEventListener('click', () => {
    if (renderer) renderer.centerOnHero();
  });
  document.getElementById('btn_menu').addEventListener('click', () => {
    paused = true;
    menu.show();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && world && !world.over) {
      paused = !paused;
      if (paused) menu.show(); else menu.hide();
    }
  });

  // Автосохранение при закрытии вкладки/уходе со страницы: тот же механизм, что
  // «Сохранить и выйти», но без уведомлений и без выхода в меню. Сейв другого
  // уровня не затираем (shouldAutosave).
  const autosaveOnHide = () => {
    if (!settings) return;
    const state = world
      ? { inLevel: true, over: world.over, paused, level: world.levelNum }
      : { inLevel: false, over: null, paused, level: 1 };
    if (!shouldAutosave(state, loadSave(playerKey(settings)))) return;
    saveGame(world, playerKey(settings));
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) autosaveOnHide(); });
  window.addEventListener('pagehide', autosaveOnHide);

  requestAnimationFrame(frame);
}

function applySetting(name) {
  const v = settings.get(name);
  if (name === 'sfx') audio.setSfxVolume(v);
  else if (name === 'music') audio.setMusicVolume(v);
  else if (name === 'sfxOn') audio.setSfxEnabled(v);
  else if (name === 'musicOn') audio.setMusicEnabled(v);
  else if (name === 'smooth' && renderer) renderer.smoothing = v;
  else if (name === 'cursor') document.body.style.cursor = v ? "url('assets/textures/gui/cursor.png') 0 0, auto" : '';
}

// ------------------------------------------------------- debug bridge

document.addEventListener('game:cmd', (ev) => {
  const canvasEl = document.getElementById('screen');
  if (!canvasEl) return;
  let res = null;
  try {
    const raw = typeof ev.detail === 'string' ? ev.detail : JSON.stringify(ev.detail || {});
    const req = JSON.parse(raw);
    if (req.cmd === 'eval') {
      res = eval(req.expr);
    } else if (req.cmd === 'state' && world) {
      res = {
        money: world.money, time: Math.round(world.time * 10) / 10,
        over: world.over, objects: world.objects.length,
        hero: { x: Math.round(world.hero.x), y: Math.round(world.hero.y), held: world.hero.held.kind, task: world.hero.task ? world.hero.task.kind : null },
        tasks: world.tasks.map((t) => t.state + ':' + t.key),
        dug: world.dugCount, level: world.levelNum,
        counters: world.counters,
      };
    } else if (req.cmd === 'click' && world) {
      world.click(req.worldX || 0, req.worldY || 0, !!req.double);
      res = 'ok';
    } else if (req.cmd === 'spawn' && world) {
      res = world.spawn(req.name, req.cx, req.cy) ? 'ok' : 'null';
    } else if (req.cmd === 'tick' && world) {
      const n = req.n || 1;
      const dt = req.dt || 0.5;
      for (let i = 0; i < n; i++) world.update(dt);
      res = { time: Math.round(world.time * 10) / 10 };
    } else if (req.cmd === 'db') {
      res = { ready: !!db, levels: db ? [...db.levels.keys()] : [], objects: db ? db.objects.size : -1, anims: db ? db.animations.size : -1, texts: db ? db.texts.size : -1 };
    }
  } catch (err) {
    res = { error: String(err && err.stack || err) };
  }
  canvasEl.dataset.cmd = JSON.stringify(res === undefined ? null : res);
});

function startLevel(num, restored) {
  paused = false;
  crashed = false;
  errorReported = false;
  const hooks = {
    showMessage: (t) => ui.showMessage(t),
    notify: (t) => ui.notify(t),
    showEnd: (r, s) => {
      lastResult = null;
      if (r === 'victory') {
        // the level is over: its save is no longer needed
        const save = loadSave(playerKey(settings));
        if (save && save.level === num) clearSave(playerKey(settings));
        lastResult = progress.complete(num, s.time, s.money, world.levelTime);
        s.gold = lastResult.gold;
        s.trophies = lastResult.newTrophies;
      }
      ui.showEnd(r, s);
    },
    updateHud: () => ui.updateHud(),
    updateShop: () => ui.updateShop(),
    updateTasks: () => ui.updateTasks(),
    playSound: (n) => audio.play(n),
    stopSound: (n) => audio.stop(n),
    showHelp: () => ui.notify('Уровень пройден! Поздравляем!'),
  };
  const save = restored ? loadSave(playerKey(settings)) : null;
  world = new World(db, assets, num, hooks);
  if (save) world.restore(save.world);
  renderer = new Renderer(canvas, world, assets, db);
  renderer.smoothing = settings.get('smooth');
  audio.playMusic('music_mix');
  ui.activeTab = 'inventory';
  ui.bind(world, hooks);
  ui.onEnd = () => {
    const won = world.over === 'victory';
    world = null;
    renderer = null;
    ui.unbind();
    menu.afterLevel(num, won, lastResult);
  };
  world.start();
  if (save) {
    ui.updateShop();
    ui.updateTasks();
    ui.updateHud();
    ui.notify(db.t('game_loaded', 'Игра загружена.'));
  }
  preloadLevel(world).then(() => { running = true; });
  running = true;
}

function preloadLevel(w) {
  const names = new Set();
  names.add(`${w.env}_center_tile`);
  names.add('beds_dry');
  names.add('beds_wet');
  for (const [name, def] of db.animations) {
    if (name.startsWith('hero_')) names.add(def.props.texname);
  }
  const addDef = (def) => {
    if (!def) return;
    if (def.props.texpicture_name) names.add(def.props.texpicture_name);
    if (def.props.texmask_name) names.add(def.props.texmask_name);
    for (const spr of def.children) {
      if (spr.type !== 'sprite') continue;
      for (const a of spr.children) {
        if (a.type === 'animation' && a.props.texture_name) names.add(a.props.texture_name);
      }
    }
  };
  for (const o of w.objects) addDef(o.def);
  return assets.preload([...names], w.env);
}

// --------------------------------------------------------------- loop

let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    if (!crashed) {
      if (world && running && !paused) {
        applyKeyboard(dt);
        applyCameraKeys(dt);
        world.update(dt);
        const sig = heldSignature();
        if (sig !== lastHeldSig) {
          lastHeldSig = sig;
          ui.updateTools();
          ui.updateShop();
        }
      }
      if (renderer) renderer.render(dt);
    }
  } catch (err) {
    // уровень падает один раз: панель показана, обновление/рендер не тикают больше
    reportError(err);
  }
  requestAnimationFrame(frame);
}

function heldSignature() {
  const h = world.hero.held;
  if (!h) return 'none';
  return `${h.kind}:${h.name || ''}:${h.count || 0}:${h.charges || 0}:${h.type || ''}`;
}

// --------------------------------------------------------------- input

function screenToWorld(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (800 / rect.width);
  const my = (e.clientY - rect.top) * (600 / rect.height);
  return { x: mx + renderer.camera.x, y: my + renderer.camera.y };
}

let lastClick = { t: 0, x: 0, y: 0 };

function updateHover(w) {
  if (!world || !renderer) return;
  renderer.hover = {
    x: Math.floor(w.x / TILE),
    y: Math.floor(w.y / TILE),
    obj: world.objectAt(w.x, w.y),
  };
}

// Жест на поле: короткое касание/клик — действие по отпусканию; если указатель сдвинулся больше
// PAN_THRESHOLD логических px, это перетаскивание поля (камера едет за пальцем/мышью, клика нет).
// Правой кнопки и долгого нажатия в игре нет (контекстное меню отключено).
const PAN_THRESHOLD = 8;
let gesture = null; // { id, sx, sy, camX, camY, panning }

function logicalDelta(e, g) {
  const rect = canvas.getBoundingClientRect();
  const k = 800 / rect.width;
  return { dx: (e.clientX - g.sx) * k, dy: (e.clientY - g.sy) * k };
}

function doClick(e) {
  const w = screenToWorld(e);
  const now = performance.now();
  const isDouble = (now - lastClick.t < 350)
    && Math.abs(w.x - lastClick.x) < 20 && Math.abs(w.y - lastClick.y) < 20;
  lastClick = { t: now, x: w.x, y: w.y };
  world.click(w.x, w.y, isDouble);
}

canvas.addEventListener('pointermove', (e) => {
  if (!world || !renderer) return;
  if (gesture && gesture.id === e.pointerId) {
    const { dx, dy } = logicalDelta(e, gesture);
    if (!gesture.panning && Math.hypot(dx, dy) > PAN_THRESHOLD) gesture.panning = true;
    if (gesture.panning) {
      renderer.panCameraTo(gesture.camX - dx, gesture.camY - dy);
      return;
    }
  }
  updateHover(screenToWorld(e));
});

canvas.addEventListener('pointerdown', (e) => {
  if (!world || !renderer || paused) return;
  if (e.button !== 0 || gesture) return; // только основная кнопка и один указатель за раз
  // на таче при первом касании нет предшествующего pointermove
  updateHover(screenToWorld(e));
  audio.playMusic('music_mix'); // unlock audio on first gesture
  gesture = { id: e.pointerId, sx: e.clientX, sy: e.clientY, camX: renderer.camera.x, camY: renderer.camera.y, panning: false };
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* необязательно */ }
});

canvas.addEventListener('pointerup', (e) => {
  const g = gesture;
  if (!g || g.id !== e.pointerId) return;
  gesture = null;
  if (!world || !renderer || paused || g.panning) return;
  doClick(e);
});

canvas.addEventListener('pointercancel', (e) => {
  if (gesture && gesture.id === e.pointerId) gesture = null;
});

// контекстное меню (правый клик, long-press на таче) отключаем, правое нажатие в игре не используется
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Стрелки двигают окно обзора (камеру), а не героиню; героиня ходит кликом (и WASD).
const CAMERA_KEY_SPEED = 520; // логических px/с
function applyCameraKeys(dt) {
  if (!world || !renderer) return;
  let dx = 0, dy = 0;
  if (keys.has('ArrowUp')) dy -= 1;
  if (keys.has('ArrowDown')) dy += 1;
  if (keys.has('ArrowLeft')) dx -= 1;
  if (keys.has('ArrowRight')) dx += 1;
  if (!dx && !dy) return;
  const len = Math.hypot(dx, dy);
  renderer.panCameraTo(renderer.camera.x + (dx / len) * CAMERA_KEY_SPEED * dt,
    renderer.camera.y + (dy / len) * CAMERA_KEY_SPEED * dt);
}

function applyKeyboard(dt) {
  if (!world || world.over) return;
  const h = world.hero;
  let dx = 0, dy = 0;
  if (keys.has('w')) dy -= 1;
  if (keys.has('s')) dy += 1;
  if (keys.has('a')) dx -= 1;
  if (keys.has('d')) dx += 1;
  if (!dx && !dy) return;
  world.clearQueue(); // ручное управление отменяет очередь целей
  h.path = [];
  h.task = null;
  h.act = null;
  const len = Math.hypot(dx, dy);
  // same speed rule as the mouse movement: script speed * 1.05 px/s, half of it vertically
  const nx = h.x + (dx / len) * h.speed * 1.05 * dt;
  const ny = h.y + (dy / len) * h.speed * 1.05 * 0.5 * dt;
  // block against solid cells
  const cell = world.cell(Math.floor(nx / TILE), Math.floor(ny / TILE));
  if (cell && !cell.blocked) {
    h.x = Math.max(16, Math.min(world.worldW - 16, nx));
    h.y = Math.max(16, Math.min(world.worldH - 16, ny));
    h.facing = dirFromKeys(dx, dy);
    h.moving = true;
  } else {
    h.moving = false;
  }
}

function dirFromKeys(dx, dy) {
  return dirIndex(dx, dy);
}

window.addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys.add(k);
  if (world && k === '1') world.selectTool('spade');
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys.delete(k);
  if (world && !world.hero.path.length) world.hero.moving = false;
});

boot();
