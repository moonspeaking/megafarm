// Main menu, pause menu and the other front-end screens, laid out after the
// original `menuhost_scripts.txt` / `interfaces/menu.txt` (window sizes and
// positions are the original ones; coordinates there are centre based, y up).

import { LANGUAGES } from './settings.js';
import { LEVELS, formatTime } from './progress.js';
import { playerKey, loadSave, clearSave } from './savegame.js';
import { EXTRA, setExtraLang } from './i18n_extra.js';

const W = 800, H = 600;

// Animated menu layers.  Coordinates are the original ones: centre of the sprite
// relative to the screen centre, y up.  [texture, x, y, w, h, pivotX, pivotY, amplitude(deg), speed, phase]
const FOLIAGE_BEHIND = [['foliage_03', 112, 276, 128, 128, 112, 316, 1, 1, 1]];
const FOLIAGE_FRONT = [
  ['foliage_01', 0, 256, 256, 256, 0, 296, 0.75, 2.3, 0.2],
  ['foliage_02', 96, 230, 128, 64, 96, 240, 0.86, 1.33, 1],
  ['foliage_04', 180, 300, 256, 128, 180, 350, 1, 1.5, 3],
  ['foliage_05', 315, 256, 256, 256, 315, 306, 0.5, 2, 0.2],
];
const HAIR = [
  ['hair_03', -40, 92, 64, 128, -23, 118, 1.5, 1.86, 4],
  ['hair_02', -28, 128, 16, 32, -23, 118, 4, 3.33, 3],
  ['hair_01', -14, 122, 32, 32, -23, 118, 4, 2.66, 1],
];
const FLOWERS = [
  ['flower_03', -326, -116, 64, 64, -337, -118, 4, 2, 0],
  ['flower_01', -377, -137, 64, 64, -382, -141, 2, 4, 0],
  ['flower_02', -339, -292, 64, 64, -328, -305, 2, 3, 0],
];

export class Menu {
  constructor({ root, assets, db, audio, settings, progress, hooks }) {
    this.progress = progress;
    this.root = root;
    this.assets = assets;
    this.db = db;
    this.audio = audio;
    this.settings = settings;
    this.hooks = hooks; // { startLevel, resume, quit, restart, saveAndQuit, isInGame, currentLevel, setLanguage }
    this.screen = 'main';
    this.inGame = false;
    this.plots = null;
    this.eyeTimer = null;
    // язык запасных текстов порта (sim.js берёт их из i18n_extra.js без настроек)
    setExtraLang(this.settings.get('lang'));
    this.settings.onChange((name) => { if (name === 'lang') setExtraLang(this.settings.get('lang')); });
    this.build();
  }

  // ------------------------------------------------------------ helpers

  tx(key, fallback) {
    const v = this.db.t(key, '\u0000');
    if (v !== '\u0000') return v;
    const lang = this.settings.get('lang');
    const extra = EXTRA[lang] || EXTRA.eng;
    return extra[key] !== undefined ? extra[key] : (fallback !== undefined ? fallback : key);
  }

  /** Имя уровня для карты: map_script даёт ключ levelN_name; если ключа нет
   *  в пиках — запасное имя по языку (i18n_extra.js). */
  levelName(pl) {
    const v = this.db.t(pl.name, '\u0000');
    if (v !== '\u0000') return v;
    return this.tx('level_name_fallback', 'Level %d').replace('%d', pl.n);
  }

  tex(name) {
    const key = this.assets.resolve(name);
    return key ? this.assets.manifest.textures[key] : '';
  }

  click() { this.audio.play('clickmenu', 0.5); }

  el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /** Window with the original frame. (cx, cy) is the centre in original coordinates. */
  win(parent, cx, cy, w, h, cls) {
    const e = this.el('div', 'mwin ' + (cls || ''), parent);
    // the scripts give the inner size; the 16px frame is added around it
    e.style.left = `${W / 2 + cx - w / 2 - 8}px`;
    e.style.top = `${H / 2 - cy - h / 2 - 8}px`;
    e.style.width = `${w + 16}px`;
    e.style.height = `${h + 16}px`;
    return e;
  }

  /** Popup list: plain outlined text lines with a highlight under the cursor. */
  popup(parent, items) {
    const list = this.el('div', 'popup', parent);
    for (const [label, fn] of items) {
      const it = this.el('div', 'popup_item otext', list, label);
      it.addEventListener('mouseenter', () => this.audio.play('selectmenu', 0.3));
      it.addEventListener('click', () => { this.click(); fn(); });
    }
    return list;
  }

  pill(parent, label, fn, cls) {
    const b = this.el('button', 'pill otext ' + (cls || ''), parent, label);
    b.addEventListener('click', () => { this.click(); fn(); });
    return b;
  }

  /** Иконная кнопка @bitbtn из guihost_scripts.txt: 64x64, стрелка arrow_right.tga.
   *  В оригинале в позиции 355,-255 (нижний правый угол) — выход из титров и из трофеев. */
  bitbtn(parent, fn) {
    const b = this.el('div', 'bitbtn', parent);
    b.style.backgroundImage = `url('${this.tex('arrow_right.png')}')`;
    b.addEventListener('click', () => { this.click(); fn(); });
    return b;
  }

  // -------------------------------------------------------------- build

  build() {
    const root = this.root;
    root.classList.add('menu_root');
    root.innerHTML = '';
    this.scene = this.el('div', 'menu_scene', root);
    this.buildArt();
    this.panel = this.el('div', 'menu_panel', root);
    this.render();
  }

  /** One swaying sprite; delta_rotate is the swing amplitude and rotate_speed its angular speed. */
  sprite(parent, [name, x, y, w, h, px, py, amp, speed, phase], keyed) {
    const e = this.el('div', 'sway', parent);
    const left = W / 2 + x - w / 2, top = H / 2 - y - h / 2;
    Object.assign(e.style, {
      left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`,
      backgroundImage: `url('${this.tex(name)}')`,
      transformOrigin: `${W / 2 + px - left}px ${H / 2 - py - top}px`,
      animationDuration: `${(2 * Math.PI / speed).toFixed(2)}s`,
      animationDelay: `-${phase}s`,
      '--amp': `${amp}deg`,
    });
    return e;
  }

  buildArt() {
    const s = this.scene;
    const sky = this.el('div', 'menu_sky', s);
    sky.style.backgroundImage = `url('${this.tex('sky2.jpg')}')`;
    for (const l of FOLIAGE_BEHIND) this.sprite(s, l, true);
    const back = this.el('div', 'menu_back', s);
    back.style.backgroundImage = `url('${this.tex('menu_background.png')}')`;
    // draw order of the original script: hair_01, eyes, hair_02, hair_03
    const hair = (n) => HAIR.find((l) => l[0] === n);
    this.sprite(s, hair('hair_01'), false);
    this.eyes = this.el('div', 'eyes', s);
    Object.assign(this.eyes.style, {
      left: `${W / 2 - 19 - 32}px`, top: `${H / 2 - 76 - 16}px`,
      backgroundImage: `url('${this.tex('eyes.png')}')`,
    });
    this.sprite(s, hair('hair_02'), false);
    this.sprite(s, hair('hair_03'), true);
    for (const l of FOLIAGE_FRONT) this.sprite(s, l, true);
    for (const l of FLOWERS) this.sprite(s, l, true);
    const ver = this.el('div', 'menu_version otext', s, 'v 1.2.0.852');
    ver.style.left = '710px';
    ver.style.top = '580px';
  }

  startEyes() {
    clearInterval(this.eyeTimer);
    let frame = 0;
    this.eyeTimer = setInterval(() => {
      if (!this.eyes || this.root.classList.contains('hidden')) return;
      if (frame === 0 && Math.random() > 0.015) return; // open eyes for ~4 s, then one blink
      frame = (frame + 1) % 13;
      this.eyes.style.backgroundPositionX = `${-frame * 64}px`;
    }, 62);
  }

  show() {
    this.inGame = !!this.hooks.isInGame();
    this.screen = this.inGame ? 'ingame' : 'main';
    this.root.classList.remove('hidden');
    this.root.classList.toggle('ingame', this.inGame);
    this.render();
    this.startEyes();
    this.audio.playMusic(this.inGame ? 'music_mix' : 'music_menu');
  }

  /** Back from a finished level: trophy announcement, otherwise the map with the next level selected. */
  afterLevel(num, won, res) {
    this.inGame = false;
    this.newTrophies = res ? [...res.newTrophies] : [];
    this.pendingSelect = won ? Math.min(num + 1, LEVELS) : num;
    this.screen = this.newTrophies.length ? 'trophies' : 'map';
    this.trophyBack = this.newTrophies.length ? 'map' : null;   // после показа новых трофеев — на карту, а не в меню
    this.root.classList.remove('hidden', 'ingame');
    const finale = won && num === LEVELS && !this.newTrophies.length;
    this.render();
    this.startEyes();
    if (finale) this.hooks.playComics(LEVELS, () => {});
  }

  hide() {
    this.root.classList.add('hidden');
    clearInterval(this.eyeTimer);
  }

  go(screen) {
    if (screen !== 'name') this.nameMode = 'select';
    this.screen = screen;
    this.render();
  }

  back() { this.go(this.inGame ? 'ingame' : 'main'); }

  render() {
    const p = this.panel;
    p.innerHTML = '';
    this.root.classList.toggle('fullscreen_page', ['map', 'credits', 'trophies'].includes(this.screen));
    switch (this.screen) {
      case 'options': if (!this.inGame) this.renderSign(p, false); this.renderOptions(p); break;
      case 'language': if (!this.inGame) this.renderSign(p, false); this.renderLanguage(p); break;
      case 'volume': if (!this.inGame) this.renderSign(p, false); this.renderVolume(p); break;
      case 'help': this.renderHelp(p); break;
      case 'map': this.renderMap(p); break;
      case 'credits': this.renderCredits(p); break;
      case 'trophies': this.renderTrophies(p); break;
      case 'ingame': this.renderIngame(p); break;
      case 'name': this.renderMain(p); this.renderName(p); break;
      case 'exit': this.renderMain(p); this.renderConfirm(p, this.tx('question_exit_game'), () => this.quitApp(), () => this.go('main')); break;
      default: this.renderMain(p);
    }
  }

  // --------------------------------------------------------------- main

  /** Деревянная табличка с приветствием: в оригинале она остаётся и в подменю (настройки, язык, громкость). */
  renderSign(p, interactive) {
    const sign = this.el('div', 'sign', p);
    this.el('div', 'sign_h otext', sign, this.tx('welcome_message'));
    this.el('div', 'sign_n otext', sign, this.profileLabel(this.settings.get('player') || 'default'));
    if (interactive) {
      this.el('div', 'sign_c otext', sign, this.tx('change_player_label'));
      sign.addEventListener('mouseenter', () => sign.classList.add('hl'));
      sign.addEventListener('mouseleave', () => sign.classList.remove('hl'));
      sign.addEventListener('click', () => { this.click(); this.go('name'); });
    } else {
      sign.style.cursor = 'default';
      sign.style.pointerEvents = 'none';
    }
  }

  renderMain(p) {
    this.renderSign(p, true);

    const w = this.win(p, 230, 100, 220, 290);
    const items = [
      [this.tx('start'), () => this.go('map')],
      [this.tx('options'), () => this.go('options')],
      [this.tx('trophyroom'), () => this.go('trophies')],
      [this.tx('help'), () => this.go('help')],
      [this.tx('credits'), () => this.go('credits')],
      [this.tx('exit'), () => this.go('exit')],
    ];
    this.popup(w, items);
  }

  renderIngame(p) {
    // меню паузы оригинала (menuhost_scripts.txt, main_menu_form 220x200): restart, exitgame, options, continue
    const w = this.win(p, 0, 0, 220, 200);
    this.popup(w, [
      [this.tx('restart'), () => this.confirm(this.tx('question_replay_game'), () => this.hooks.restart())],
      // «Закончить/Quit» спрашивает question_saveandexit_game («Сохранить игру перед выходом?»): да — сохранить и выйти,
      // нет — выйти без сохранения (в оригинале есть текст этого вопроса; полный разбор веток не восстановлен)
      [this.tx('exitgame'), () => this.confirm3(this.tx('question_saveandexit_game'),
        () => this.hooks.saveAndQuit(), () => this.hooks.quit())],
      [this.tx('options'), () => this.go('options')],
      [this.tx('continue'), () => this.hooks.resume()],
    ]);
  }

  /** Вопрос с тремя кнопками: «Да», «Нет» и «Отмена» (возврат в меню паузы). */
  confirm3(text, yes, no) {
    const p = this.panel;
    const shade = this.el('div', 'shade', p);
    const w = this.win(shade, 0, 0, 380, 150);
    this.el('div', 'msg_line otext', w, text);
    const row = this.el('div', 'btn_row', w);
    this.pill(row, this.tx('yes'), () => { this.render(); yes(); });
    this.pill(row, this.tx('no'), () => { this.render(); no(); });
    this.pill(row, this.tx('cancel'), () => this.render());
  }

  confirm(text, yes, no) {
    this.renderConfirm(this.panel, text, () => { this.render(); yes(); }, () => { this.render(); if (no) no(); });
  }

  renderConfirm(p, text, yes, no) {
    const shade = this.el('div', 'shade', p);
    const w = this.win(shade, 0, 0, 340, 150);
    this.el('div', 'msg_line otext', w, text);
    const row = this.el('div', 'btn_row', w);
    this.pill(row, this.tx('yes'), yes);
    this.pill(row, this.tx('no'), no);
  }

  // ------------------------------------------------------------ profiles

  /** Все известные профили: список настроек плюс профили с сохранённым прогрессом. */
  profileNames() {
    const names = [...new Set([...this.settings.profiles(), ...this.progress.profiles()])];
    const cur = this.settings.get('player') || 'default';
    if (!names.includes(cur)) names.unshift(cur);
    return names;
  }

  /** Внутренний 'default' показывается как обычное имя игрока. */
  profileLabel(name) { return name === 'default' ? this.tx('player') : name; }

  /** Смена/создание/удаление профиля: оригинальные profiles_window и
   *  delete_profile_window (menuhost_scripts.txt: pos -230,0, size 220x270). */
  renderName(p) {
    const shade = this.el('div', 'shade', p);
    const w = this.win(shade, -230, 0, 220, 270);
    const mode = this.nameMode || 'select';
    const names = this.profileNames();
    const items = [];
    if (mode === 'delete') {
      for (const n of names) items.push([this.profileLabel(n), () => this.confirmDeleteProfile(n)]);
      items.push([this.tx('back'), () => { this.nameMode = 'select'; this.render(); }]);
    } else {
      for (const n of names) items.push([this.profileLabel(n), () => { this.settings.set('player', n); this.render(); }]);
      items.push([this.tx('new_profile'), () => { this.nameMode = 'create'; this.render(); }]);
      items.push([this.tx('delete_profile'), () => { this.nameMode = 'delete'; this.render(); }]);
      items.push([this.tx('back'), () => { this.nameMode = 'select'; this.go('main'); }]);
    }
    const list = this.popup(w, items);
    list.classList.add('profiles');
    if (mode === 'select') {
      const cur = this.settings.get('player') || 'default';
      [...list.children].forEach((c, i) => { if (names[i] === cur) c.classList.add('sel'); });
    } else if (mode === 'create') {
      this.renderEnterName(shade);
    }
  }

  /** Оригинальное enter_name_window (400x150, modal, шрифт 24): ввод имени нового игрока. */
  renderEnterName(shade) {
    const w = this.win(shade, 0, 0, 400, 150);
    this.el('div', 'msg_line otext big', w, this.tx('text_enter_name'));
    const input = this.el('input', 'name_input', w);
    input.maxLength = 16;
    setTimeout(() => input.focus(), 0);
    const ok = () => {
      const name = input.value.trim();
      if (!name) return;
      this.settings.addProfile(name);
      this.settings.set('player', name);
      this.nameMode = 'select';
      this.render();
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ok(); });
    const row = this.el('div', 'btn_row', w);
    this.pill(row, this.tx('cancel'), () => { this.nameMode = 'select'; this.render(); });
    this.pill(row, this.tx('ok'), ok);
  }

  confirmDeleteProfile(name) {
    this.confirm(this.tx('question_delete_profile').split('%s').join(this.profileLabel(name)), () => this.deleteProfile(name));
  }

  /** Удалить профиль: его прогресс и его сохранение игры (сейв хранится по playerKey). */
  deleteProfile(name) {
    this.progress.removeProfile(name);
    clearSave(playerKey(this.settings, name));
    this.settings.removeProfile(name);
    this.nameMode = 'select';
    this.render();
  }

  quitApp() {
    window.close();
    this.go('main');
    const t = this.el('div', 'toast otext', this.panel, this.tx('exit_web'));
    setTimeout(() => t.remove(), 3000);
  }

  // ------------------------------------------------------------ options

  renderOptions(p) {
    const st = this.settings;
    const w = this.win(p, this.inGame ? 0 : 230, this.inGame ? 0 : 100, 240, this.inGame ? 240 : 260);
    const fs = !!document.fullscreenElement;
    this.popup(w, [
      [fs ? this.tx('windowed') : this.tx('fullscreen'), () => {
        if (fs) document.exitFullscreen?.().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
        // метка и настройка обновляются по событию fullscreenchange (см. main.js)
      }],
      [this.tx('set_volume'), () => this.go('volume')],
      [st.get('cursor') ? this.tx('cursor_off') : this.tx('cursor_on'), () => { st.set('cursor', !st.get('cursor')); this.render(); }],
      [this.tx('language'), () => this.go('language')],
      [this.tx('back'), () => this.back()],
    ]);
  }

  renderLanguage(p) {
    const st = this.settings;
    const w = this.win(p, 230, 0, 220, 570);
    const items = [];
    for (const code of LANGUAGES) {
      if (!this.assets.manifest.scripts[code]) continue;
      items.push([this.db.t('lang_' + code, code), async () => {
        await this.hooks.setLanguage(code);
        this.render();
      }]);
    }
    items.push([this.tx('back'), () => this.go('options')]);
    const list = this.popup(w, items);
    [...list.children].forEach((c, i) => { if (i < items.length - 1 && LANGUAGES.filter((l) => this.assets.manifest.scripts[l])[i] === st.get('lang')) c.classList.add('sel'); });
  }

  slider(parent, label, key, ky) {
    const st = this.settings;
    this.el('div', 'vol_label otext', parent, label);
    const track = this.el('div', 'slider', parent);
    track.style.top = `${ky}px`;
    const knob = this.el('div', 'knob', track);
    const set = (v) => { knob.style.left = `calc(${v * 100}% - 16px)`; };
    set(st.get(key));
    const move = (e) => {
      const r = track.getBoundingClientRect();
      const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      set(v); st.set(key, v);
    };
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId);
      move(e);
      const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); this.audio.play('clickmenu', 0.5); };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
    });
  }

  // volume_window (290x240): сначала громкость звуков (заголовок в 0,90, шкала 0,50),
  // затем музыка (0,0 и 0,-40), снизу кнопка ok.
  renderVolume(p) {
    const w = this.win(p, 0, 0, 290, 240, 'vol');
    this.el('div', 'vol_label otext', w, this.tx('sound_volume')).style.top = '28px';
    this.slider(w, '', 'sfx', 56);
    this.el('div', 'vol_label otext', w, this.tx('music_volume')).style.top = '98px';
    this.slider(w, '', 'music', 126);
    const b = this.pill(w, this.tx('ok'), () => this.go('options'), 'abs_bottom');
    void b;
  }

  // --------------------------------------------------------------- help

  renderHelp(p) {
    const w = this.win(p, 0, 0, 600, 500, 'help');
    const pic = (name, cx, cy, pw, ph) => {
      const e = this.el('div', 'help_pic', w);
      Object.assign(e.style, {
        left: `${300 + cx - pw / 2 - 16}px`, top: `${250 - cy - ph / 2 - 16}px`,
        width: `${pw}px`, height: `${ph}px`, backgroundImage: `url('${this.tex(name)}')`,
      });
    };
    const text = (key, cy) => {
      const e = this.el('div', 'help_text otext', w);
      e.style.top = `${250 - cy - 16 - 16}px`;
      e.innerHTML = '';
      this.tx(key).split('^').forEach((line, i) => { if (i) e.appendChild(document.createElement('br')); e.appendChild(document.createTextNode(line)); });
    };
    pic('keyhelper2.png', -112, 180, 256, 128);
    pic('keyhelper.png', 176, 180, 128, 128);
    text('control_help_1', 80);
    pic('help2.png', -160, -30, 256, 128);
    pic('help1.png', 80, -30, 64, 128);
    pic('help3.png', 208, -30, 128, 128);
    text('control_help_2', -120);
    this.pill(w, this.tx('ok'), () => this.back(), 'abs_bottom');
  }

  // -------------------------------------------------------------- credits

  async renderCredits(p) {
    const page = this.el('div', 'page credits', p);
    page.style.backgroundImage = `url('${this.tex('end.jpg')}')`;
    const scroll = this.el('div', 'credits_scroll', this.el('div', 'credits_wrap', page));
    const lang = this.settings.get('lang');
    const path = this.assets.manifest.scripts['credits_' + lang] || this.assets.manifest.scripts.credits_rus;
    let text = '';
    try { text = await (await fetch(path)).text(); } catch (e) { /* ignore */ }
    if (this.screen !== 'credits') return;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('<<') && !l.startsWith('>>') && !l.startsWith('@') && l !== '{' && l !== '}');
    for (const l of lines) {
      if (l.startsWith('_')) this.el('div', 'c_head otext', scroll, l.slice(1));
      else this.el('div', 'c_line otext', scroll, l);
    }
    const dur = Math.max(30, lines.length * 1.4);
    scroll.style.animationDuration = `${dur}s`;
    // края как в credits.txt: fader_in снизу (0,-244), fader_out сверху (0,236), 800x128
    const fadeTop = this.el('div', 'credits_fade', page);
    fadeTop.style.top = '0';
    fadeTop.style.backgroundImage = `url('${this.tex('credits_fade_out.png')}')`;
    const fadeBottom = this.el('div', 'credits_fade', page);
    fadeBottom.style.bottom = '0';
    fadeBottom.style.backgroundImage = `url('${this.tex('credits_fade_in.png')}')`;
    // credits_back: @button_right 355,-255, 64x64
    this.bitbtn(page, () => this.go('main'));
    this.audio.playMusic('music_credits');
  }

  // ------------------------------------------------------------ trophies

  renderTrophies(p) {
    const page = this.el('div', 'page trophies', p);
    page.style.backgroundImage = `url('${this.tex('trophyroom/trophyroom')}')`;
    // [index, centre x, centre y, w, h, texture, hint x, hint y] as in interfaces/trophyroom.txt
    const T = [
      [12, -15, 77, 256, 512, 'trophy12', 35, 136], [4, 209, -97, 128, 256, 'trophy00', 253, -32],
      [8, 29, -101, 128, 128, 'trophy09', 77, -38], [2, 33, -200, 128, 256, 'trophy01', 89, -157],
      [10, 154, -177, 128, 64, 'trophy02', 197, -120], [5, -258, -165, 128, 256, 'trophy04', -207, -116],
      [9, -168, -183, 256, 256, 'trophy03', -125, -117], [0, -215, 170, 256, 256, 'trophy05', -151, 233],
      [1, 128, -90, 128, 128, 'trophy06', 170, -42], [7, -66, -151, 128, 256, 'trophy07', -6, -105],
      [11, -217, -12, 256, 256, 'trophy08', -165, 45], [3, -297, 16, 256, 512, 'trophy10', -257, 77],
      [6, 150, 20, 256, 256, 'trophy11', 190, 85],
    ];
    const earned = this.progress.trophies();
    const hint = this.el('div', 'trophy_hint otext', page);
    hint.style.display = 'none';
    for (const [i, x, y, w, h, tex, hx, hy] of T) {
      if (!earned.includes(i)) continue;
      const e = this.el('div', 'trophy', page);
      Object.assign(e.style, {
        left: `${W / 2 + x - w / 2}px`, top: `${H / 2 - y - h / 2}px`, width: `${w}px`, height: `${h}px`,
        backgroundImage: `url('${this.tex('trophyroom/' + tex)}')`,
      });
      e.addEventListener('mouseenter', () => {
        hint.textContent = this.tx('trophy_hint' + i);
        // позиция @simple_hint из скрипта (ширина 256, текст вниз от pos)
        hint.style.left = `${W / 2 + hx - 128}px`;
        hint.style.top = `${H / 2 - hy}px`;
        hint.style.display = 'block';
      });
      e.addEventListener('mouseleave', () => { hint.style.display = 'none'; });
    }
    // exit: @button_right 355,-255, 64x64
    this.bitbtn(page, () => { const back = this.trophyBack || 'main'; this.trophyBack = null; this.go(back); });
    this.audio.playMusic('music_trophy');
    // announce trophies won in the level that was just finished, one after another
    const queue = [...(this.newTrophies || [])];
    this.newTrophies = [];
    const next = () => {
      const i = queue.shift();
      if (i === undefined) { return; }
      const t = T.find((q) => q[0] === i);
      // announce (trophyroom.txt): окно 512x512, слева trophy_pic (256x256 по центру),
      // справа details (256x256, выравнивание вправо), сверху header, снизу ok.
      const shade = this.el('div', 'shade', page);
      const w = this.win(shade, 0, 0, 512, 512);
      this.el('div', 'msg_line otext big', w, this.tx('trophy_announce_header'));
      const pic = this.el('div', 'announce_pic', w);
      pic.style.backgroundImage = `url('${this.tex('trophyroom/' + t[5])}')`;
      this.el('div', 'msg_line otext', w, this.tx('trophy_hint' + i)).classList.add('announce_text');
      this.pill(w, this.tx('ok'), () => { shade.remove(); next(); }, 'abs_bottom');
    };
    next();
  }

  // ----------------------------------------------------------------- map

  async loadPlots() {
    if (this.plots) return this.plots;
    this.plots = [];
    try {
      const t = await (await fetch(this.assets.manifest.scripts.map_script)).text();
      const re = /@garden_plot (\d+)[\s\S]*?#point pos (-?\d+), (-?\d+);[\s\S]*?#point details_pos (-?\d+), (-?\d+);[\s\S]*?#string level_name "(.*?)"/g;
      for (let m; (m = re.exec(t));) this.plots.push({ n: +m[1] + 1, x: +m[2], y: +m[3], dx: +m[4], dy: +m[5], name: m[6] });
    } catch (e) { /* ignore */ }
    return this.plots;
  }

  async renderMap(p) {
    const page = this.el('div', 'page map', p);
    const view = this.el('div', 'map_view', page);
    const layer = this.el('div', 'map_layer', view);
    const sky = this.el('div', 'map_sky', layer);
    sky.style.backgroundImage = `url('${this.tex('gamemap/sky.png')}')`;
    const land = this.el('div', 'map_land', layer);
    land.style.backgroundImage = `url('${this.tex('gamemap/map.png')}')`;
    const plots = (await this.loadPlots()).filter((pl) => this.db.levels.has(pl.n));
    if (this.screen !== 'map') return;
    const at = (pl) => [512 + pl.x, 512 - pl.y]; // map pixels (centre origin, y up)
    const splines = await this.loadSplines();

    // red dotted road between neighbouring levels (Bezier, 20 nodes per segment)
    for (const sp of splines) {
      const A = plots[sp.a], B = plots[sp.b];
      if (!A || !B) continue;
      const [ax, ay] = at(A), [bx, by] = at(B);
      const P = [[ax, ay], [ax - sp.p1[0], ay + sp.p1[1]], [bx - sp.p2[0], by + sp.p2[1]], [bx, by]];
      for (let i = 1; i < 20; i++) {
        const t = i / 20, u = 1 - t;
        const x = u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0];
        const y = u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1];
        const d = this.el('div', 'map_dot', layer);
        d.style.left = `${x - 5}px`; d.style.top = `${y - 5}px`;
      }
    }

    // first start of a level shows its comics page, then the level begins;
    // a mid-level save for this level asks about loading it
    const begin = (n) => {
      const player = playerKey(this.settings);
      const save = loadSave(player);
      const start = (restored) => {
        if (!this.progress.comicsSeen(n)) {
          this.progress.markComics(n);
          this.hooks.playComics(n - 1, () => this.hooks.startLevel(n, restored));
        } else this.hooks.startLevel(n, restored);
      };
      if (save && save.level === n) {
        // "no" starts the level over: the new run replaces the old save
        this.confirm(this.tx('question_load_game'), () => start(true), () => {
          clearSave(player);
          start(false);
        });
      } else start(false);
    };
    const coins = new Map();
    // hover hint next to the coin (map_script `details_pos` = offset of the hint centre from the coin centre, y up):
    // level name, result line, own time and the best time of all players
    const hint = this.el('div', 'level_hint otext', layer);
    hint.style.display = 'none';
    const bestOf = (n) => {
      let best = null;
      for (const [name, prof] of Object.entries(this.progress.data)) {
        const r = prof.levels && prof.levels[n];
        if (r && (!best || r.time < best.time)) best = { name, time: r.time };
      }
      return best;
    };
    const showHint = (pl) => {
      const rec = this.progress.level(pl.n);
      const [mx, my] = at(pl);
      hint.innerHTML = '';
      // как в оригинале (interfaces/gamemap.txt, level_info 200x110): строки на y = 0, 20, 40, 60, 76 от верха окна
      const line = (cls, text, y) => { const d = this.el('div', cls, hint, text); d.style.top = `${y}px`; return d; };
      line('lh_name', this.levelName(pl), 0);
      line('lh_line', rec
        ? this.tx(rec.gold ? 'level_completed_with_trophy' : 'level_completed')
        : this.tx('level_not_finished'), 22);
      if (rec) {
        line('lh_line', `${this.tx('level_time')}: ${formatTime(rec.time)}`, 42);
        const best = bestOf(pl.n);
        if (best) {
          line('lh_line', this.tx('best_time'), 62);
          line('lh_line', `${best.name} ${formatTime(best.time)}`, 78);
        }
      }
      hint.style.display = 'block';
      const hw = hint.offsetWidth, hh = hint.offsetHeight;
      hint.style.left = `${mx + pl.dx - hw / 2}px`;
      hint.style.top = `${my - pl.dy - hh / 2}px`;
    };
    const mark = (el, n) => {
      el.classList.toggle('locked', !this.progress.unlocked(n));
      el.classList.toggle('done', this.progress.done(n));
      el.classList.toggle('gold', this.progress.gold(n));
    };
    // фигурка героини (gamemap/star.tga, 32x64) идёт по красной дороге от уровня к уровню, камера следует за ней
    const marker = this.el('div', 'map_marker', layer);
    marker.style.backgroundImage = `url('${this.tex('gamemap/star.png')}')`;
    const roadPoints = (i0, i1) => {
      const pts = [];
      const step = i1 > i0 ? 1 : -1;
      for (let i = i0; i !== i1; i += step) {
        const j = i + step;
        const A = plots[i], B = plots[j];
        const [ax, ay] = at(A), [bx, by] = at(B);
        const sp = splines.find((q) => (q.a === i && q.b === j) || (q.a === j && q.b === i));
        const seg = [];
        if (sp) {
          const f = sp.a === i;
          const [sx, sy] = f ? [ax, ay] : [bx, by], [ex, ey] = f ? [bx, by] : [ax, ay];
          const P = [[sx, sy], [sx - sp.p1[0], sy + sp.p1[1]], [ex - sp.p2[0], ey + sp.p2[1]], [ex, ey]];
          for (let k = 0; k <= 20; k++) {
            const t = k / 20, u = 1 - t;
            seg.push([u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0],
              u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1]]);
          }
          if (!f) seg.reverse();
        } else {
          for (let k = 0; k <= 20; k++) seg.push([ax + (bx - ax) * k / 20, ay + (by - ay) * k / 20]);
        }
        pts.push(...(pts.length ? seg.slice(1) : seg));
      }
      return pts;
    };
    const camFor = (mx, my) => [Math.max(0, Math.min(1024 - W, mx - W / 2)), Math.max(0, Math.min(1024 - 472, my - 170))];
    const placeMarker = (mx, my) => { marker.style.left = `${mx - 16}px`; marker.style.top = `${my - 64}px`; };
    let markerIdx = -1;
    let anim = 0;
    const travel = (idx, instant) => {
      cancelAnimationFrame(anim);
      const target = at(plots[idx]);
      if (instant || markerIdx < 0 || markerIdx === idx) {
        markerIdx = idx;
        placeMarker(target[0], target[1]);
        const [cx, cy] = camFor(target[0], target[1]);
        layer.style.transition = instant ? 'none' : 'transform .6s ease-in-out';
        layer.style.transform = `translate(${-cx}px, ${-cy}px)`;
        return;
      }
      const pts = roadPoints(markerIdx, idx);
      markerIdx = idx;
      layer.style.transition = 'none';
      const perNode = 32;   // мс на узел дороги (20 узлов на отрезок)
      const t0 = performance.now();
      const frame = (now) => {
        const k = Math.min(pts.length - 1, (now - t0) / perNode);
        const i = Math.floor(k), f = k - i;
        const a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)];
        const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
        placeMarker(x, y);
        const [cx, cy] = camFor(x, y);
        layer.style.transform = `translate(${-cx}px, ${-cy}px)`;
        if (k < pts.length - 1 && this.screen === 'map') anim = requestAnimationFrame(frame);
      };
      anim = requestAnimationFrame(frame);
    };
    const select = (n, instant) => {
      if (!this.progress.unlocked(n)) return;
      this.selected = n;
      this.settings.set('level', n);
      const pi = plots.findIndex((q) => q.n === n);
      if (pi >= 0) travel(pi, instant);
      for (const [k, c] of coins) {
        c.plot.classList.toggle('sel', k === n);
        c.btn.classList.toggle('sel', k === n);
      }
      const bc = coins.get(n)?.btn;
      if (bc) arrow.style.left = `${bc.offsetLeft + 2 + 15}px`;
    };

    for (const pl of plots) {
      const [mx, my] = at(pl);
      const c = this.el('div', 'plot', layer);
      c.style.left = `${mx - 32}px`; c.style.top = `${my - 32}px`;
      this.el('div', 'coin', c);
      const ic = this.el('div', 'coin_icon', c);
      ic.style.backgroundImage = `url('${this.tex('objects/levels/level' + pl.n)}')`;
      const lab = this.el('div', 'plot_name otext', c, this.levelName(pl));
      mark(c, pl.n);
      c.addEventListener('mouseenter', () => {
        if (c.classList.contains('locked')) return;
        this.audio.play('selectmenu', 0.3);
        showHint(pl);
      });
      c.addEventListener('mouseleave', () => { hint.style.display = 'none'; });
      c.addEventListener('click', () => { if (c.classList.contains('locked')) return; this.click(); select(pl.n); });
      c.addEventListener('dblclick', () => { if (!c.classList.contains('locked')) begin(pl.n); });
      coins.set(pl.n, { plot: c, btn: null });
      void lab;
    }

    // bottom level bar with one coin button per level
    const bar = this.el('div', 'map_bar', page);
    bar.style.backgroundImage = `url('assets/textures/gui/gamemap/level_bar.png')`;
    const row = this.el('div', 'bar_row', bar);
    const arrow = this.el('div', 'bar_arrow', bar);
    for (const pl of plots) {
      const b = this.el('div', 'bar_btn', row);
      this.el('div', 'coin', b);
      const ic = this.el('div', 'coin_icon', b);
      ic.style.backgroundImage = `url('${this.tex('objects/levels/level' + pl.n)}')`;
      mark(b, pl.n);
      b.addEventListener('mouseenter', () => { if (!b.classList.contains('locked')) this.audio.play('selectmenu', 0.3); });
      b.addEventListener('click', () => { if (b.classList.contains('locked')) return; this.click(); select(pl.n); });
      coins.get(pl.n).btn = b;
    }

    // buttons: Back, Start, comics (original positions)
    const back = this.el('div', 'map_btn map_back_btn', page);
    this.el('span', 'otext', back, this.tx('back'));
    back.addEventListener('click', () => { this.click(); this.go('main'); });
    const start = this.el('div', 'map_btn map_start_btn', page);
    this.el('span', 'otext', start, this.tx('start'));
    start.addEventListener('click', () => { this.click(); begin(this.selected); });
    const comicsBtn = this.el('div', 'map_btn map_comics_btn', page);
    comicsBtn.addEventListener('click', () => { this.click(); this.hooks.playComics(this.selected - 1, () => this.audio.playMusic('music_map')); });

    const init = this.pendingSelect || this.progress.current();
    this.pendingSelect = null;
    select(this.progress.unlocked(init) ? init : 1, true);
    this.audio.playMusic('music_map');
  }

  async loadSplines() {
    if (this.splines) return this.splines;
    this.splines = [];
    try {
      const t = await (await fetch(this.assets.manifest.scripts.map_script)).text();
      const re = /@map_spline \d+\s*\{([\s\S]*?)\}/g;
      for (let m; (m = re.exec(t));) {
        const b = m[1];
        const pt = (k) => { const r = new RegExp('#point ' + k + ' (-?\\d+), (-?\\d+)').exec(b); return r ? [+r[1], +r[2]] : [0, 0]; };
        this.splines.push({
          a: +/plot_start (\d+)/.exec(b)[1], b: +/plot_end (\d+)/.exec(b)[1], p1: pt('p1'), p2: pt('p2'),
        });
      }
    } catch (e) { /* ignore */ }
    return this.splines;
  }
}
