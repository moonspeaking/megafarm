// DOM HUD controller.
import { fontForLang, loadFont, loadedFont, textWidth, layoutPopup } from './fontmetrics.js';
import { endSoundName } from './endsound.js';
import { taskGoalLines } from './goals.js';
import { extraT } from './i18n_extra.js';

const TABS = [
  ['inventory', 'ИНВЕНТАРЬ'],
  ['buildings', 'СТРОЕНИЯ'],
  ['seeds', 'СЕМЕНА'],
  ['sprouts', 'РОСТКИ'],
  ['trees', 'ДЕРЕВЬЯ'],
  ['workers', 'РАБОТНИКИ'],
];

export class UI {
  constructor(assets, audio) {
    this.assets = assets;
    this.audio = audio;
    this.world = null;
    this.messages = [];
    this.msgVisible = false;
    this.activeTab = 'inventory';
    this.hintTimer = null;

    this.el = {
      hud: document.getElementById('hud'),
      money: document.getElementById('money'),
      timefill: document.getElementById('timefill'),
      task_text: document.getElementById('task_text'),
      toolslots: document.getElementById('toolslots'),
      shop_tabs: document.getElementById('shop_tabs'),
      shop_items: document.getElementById('shop_items'),
      hint: document.getElementById('hint'),
      msgbox: document.getElementById('msgbox'),
      msg_text: document.getElementById('msg_text'),
      msg_ok: document.getElementById('msg_ok'),
      endbox: document.getElementById('endbox'),
      end_title: document.getElementById('end_title'),
      end_stats: document.getElementById('end_stats'),
      end_next: document.getElementById('end_next'),
    };

    this.el.msg_ok.addEventListener('click', () => this.nextMessage());
    this.el.end_next.addEventListener('click', () => this.onEndNext());
  }

  bind(world, hooks) {
    this.world = world;
    this.hooks = hooks;
    this.el.hud.classList.remove('hidden');
    this.buildTabs();
    this.updateShop();
    this.updateHud();
    this.updateTasks();
    this.updateTools();
  }

  unbind() {
    this.world = null;
    this.el.hud.classList.add('hidden');
  }

  // ------------------------------------------------------------- messages

  showMessage(text) {
    this.messages.push(text);
    this.pumpMessages();
  }

  pumpMessages() {
    if (this.msgVisible || !this.messages.length) return;
    this.msgVisible = true;
    this.el.msg_text.textContent = this.messages.shift();
    this.el.msgbox.classList.remove('hidden');
    this.audio.play('clickmenu', 0.4);
  }

  nextMessage() {
    this.el.msgbox.classList.add('hidden');
    this.msgVisible = false;
    if (this.messages.length) this.pumpMessages();
  }

  notify(text) {
    if (!text) return;
    const el = this.el.hint;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ----------------------------------------------------------------- hud

  updateHud() {
    const w = this.world;
    if (!w) return;
    const now = performance.now();
    if (now - (this._lastHud || 0) < 200) return;
    this._lastHud = now;
    this.el.money.textContent = w.money;
    this.updateTasks(); // прогресс целей (сам разбор дешёвый, DOM меняется только при изменении)
    // the bar shows the time that is left, like the original
    const left = Math.max(0, 100 - (w.time / w.levelTime) * 100);
    this.el.timefill.style.width = left + '%';
  }

  updateTasks() {
    const w = this.world;
    if (!w) return;
    const box = this.el.task_text;
    // как в оригинале (upmenu_form.task1..4): цели текущего задания с прогрессом, а не название задания
    const lines = taskGoalLines(w);
    if (lines.length) {
      const sig = lines.map((l) => `${l.text}|${l.cur}|${l.target}`).join('\n');
      if (box.dataset.sig === sig) return;
      box.dataset.sig = sig;
      box.className = 'goals';
      box.replaceChildren(...lines.map((l) => {
        const row = document.createElement('div');
        row.className = 'goal';
        row.textContent = `${l.text}  ${l.cur}/${l.target}`;
        return row;
      }));
      return;
    }
    // целей нет (например, всё выполнено или у задания только временные условия): название задания
    box.dataset.sig = '';
    box.className = '';
    const active = [...w.tasks].reverse().find((t) => t.state === 'active');
    if (active) box.textContent = w.db.t(active.key, active.key);
    else if (w.tasks.length) box.textContent = w.db.t(w.tasks[w.tasks.length - 1].key, '');
    else box.textContent = '';
  }

  // ---------------------------------------------------------------- shop

  buildTabs() {
    const w = this.world;
    if (!w) return;
    const host = this.el.shop_tabs;
    host.innerHTML = '';
    // shop_form/shop_menu (menuhost_scripts.txt): a horizontal CPopupMenu 800x32, margin 32, six `tab_button`s
    // of fixed height 32. Every tab is as wide as its caption (CTextElement autosize: sum of glyph advances
    // of the language's bitmap font * font_size 12); the caps (16 px) lie outside the body, so neighbouring
    // tabs touch. The row is laid out by layoutPopup (centred, shifted right by margin/2).
    const fontName = fontForLang(w.db.lang);
    const table = loadedFont(fontName);
    if (!table) loadFont(fontName).then(() => { if (this.world === w) this.buildTabs(); }).catch(() => {});
    const labels = TABS.map(([key, label]) => w.db.t(key + '_form', label));
    const bodies = labels.map((s) => (table ? textWidth(table, s, 12) : s.length * 8.5));
    const lay = layoutPopup(bodies, 32, 800);
    TABS.forEach(([key], i) => {
      if (lay.overflow >= 0 && i >= lay.overflow) return; // the original disables tabs that do not fit
      const active = key === this.activeTab;
      const b = document.createElement('button');
      b.className = 'tab' + (active ? ' active' : '');
      b.style.left = `${400 + lay.xs[i] - bodies[i] / 2 - 16}px`;
      b.style.width = `${bodies[i] + 32}px`;
      b.innerHTML = '<i class="tl"></i><i class="tc"></i><i class="tr"></i><span></span>';
      const label = b.querySelector('span');
      label.textContent = labels[i];
      b.addEventListener('click', () => {
        this.activeTab = key;
        this.buildTabs();
        this.updateShop();
        this.audio.play('clickmenu', 0.4);
      });
      host.appendChild(b);
      // our web font is narrower than the bitmap one: stretch the caption to the width the original has
      const natural = label.offsetWidth;
      if (natural > 0 && bodies[i] > 0) {
        const k = Math.max(0.7, Math.min(1.4, bodies[i] / natural));
        label.style.setProperty('--k', k.toFixed(3));
      }
    });
  }

  updateShop() {
    const w = this.world;
    if (!w) return;
    this.buildTabs();
    const el = this.el.shop_items;
    el.innerHTML = '';
    const list = w.shop[this.activeTab] || [];
    if (this.activeTab === 'inventory') this.addSpadeButton(el, w);
    for (const name of list) {
      const def = w.db.objects.get(name);
      if (!def) continue;
      const div = document.createElement('div');
      const carried = w.pending || w.hero.held;
      const inHand = !!(carried && carried.name === name);
      div.className = 'shop_item' + (w.money < (def.props.price || 0) && !inHand ? ' cant' : '') + (inHand ? ' active' : '');
      const img = document.createElement('img');
      // sub_439500: the button picture is the plain `<item name>.tga` (no environment variant, e.g. house_chicken)
      const tex = this.assets.resolve(name, null) || this.assets.resolve(def.props.texpicture_name, null);
      if (tex) img.src = this.assets.manifest.textures[tex];
      div.appendChild(img);
      const price = document.createElement('div');
      price.className = 'price';
      price.textContent = def.props.price || 0;
      div.appendChild(price);
      div.title = w.db.t(name, name) + ' — ' + (def.props.price || 0);
      div.addEventListener('click', () => {
        if (w.deselectShopItem(name)) { this.updateShop(); return; }
        if (w.money < (def.props.price || 0)) {
          w.hooks.notify(w.db.t('notify_no_more_money', 'Не хватает денег!'));
          return;
        }
        w.buy(name);
        this.updateShop();
      });
      el.appendChild(div);
    }
  }

  /** Кнопка лопаты в инвентаре: режим «один клик копает»; повторное нажатие возвращает обычный режим. */
  addSpadeButton(el, w) {
    const div = document.createElement('div');
    div.className = 'shop_item spade' + (w.digMode ? ' active' : '');
    const img = document.createElement('img');
    const tex = this.assets.resolve('spade', null);
    if (tex) img.src = this.assets.manifest.textures[tex];
    div.appendChild(img);
    div.title = extraT('spade_dig');
    div.addEventListener('click', () => { w.toggleDigMode(); this.updateShop(); });
    el.appendChild(div);
  }

  // ---------------------------------------------------------------- tools

  updateTools() {
    // The original panel has no tool slots: the spade is the hero's default tool and whatever he holds is
    // visible on the hero himself. The container stays empty.
    if (this.el.toolslots) this.el.toolslots.innerHTML = '';
  }

  addSlot(el, texName, label, active, onClick, badge) {
    const div = document.createElement('div');
    div.className = 'slot' + (active ? ' active' : '');
    div.title = label;
    const tex = this.assets.resolve(texName, this.world ? this.world.env : null);
    if (tex) {
      const img = document.createElement('img');
      img.src = this.assets.manifest.textures[tex];
      div.appendChild(img);
    } else {
      div.textContent = label;
    }
    if (badge) {
      const b = document.createElement('div');
      b.className = 'badge';
      b.textContent = badge;
      div.appendChild(b);
    }
    div.addEventListener('click', onClick);
    el.appendChild(div);
  }

  // ------------------------------------------------------------------ end

  showEnd(result, stats) {
    const w = this.world;
    const t = (k, d) => w.db.t(k, d);
    const won = result === 'victory';
    this.el.end_title.textContent = won
      ? '🏆 ' + (stats.gold ? t('level_completed_with_trophy', 'Пройден на золото!') : t('level_completed', 'Уровень пройден!'))
      : '💀 ' + t('level_not_finished', 'Уровень не пройден');
    const clock = (s) => {
      const p = (v) => String(v).padStart(2, '0');
      return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
    };
    const lines = [`${extraT('ref_time')}: ${clock(Math.round(w.levelTime))}`, `${extraT('your_time')}: ${clock(Math.round(stats.time))}`];
    if (won && stats.trophies && stats.trophies.length) lines.push(t('trophy_announce_header', 'Вы получили трофей!'));
    this.el.end_stats.textContent = lines.join('\n');
    this.el.end_stats.style.whiteSpace = 'pre-line';
    this.el.end_next.textContent = t('ok', 'ОК');
    this.el.endbox.classList.remove('hidden');
    // orig. sub_42F2B0: выбор звука — см. src/endsound.js (громкость 0.7, как было)
    this.audio.play(endSoundName(won, stats.trophies), 0.7);
  }

  onEndNext() {
    this.el.endbox.classList.add('hidden');
    if (this.onEnd) this.onEnd();
  }

  showMenu() { if (this.menu) this.menu.show(); }

  hideMenu() { if (this.menu) this.menu.hide(); }
}

// ---------------------------------------------------------- error panel

/**
 * Компактная панель ошибки игрового цикла (Задача 18): «Ошибка: <текст>» + «В меню».
 * Одна на экран; если панель уже есть — повторных показов не будет.
 */
export function showErrorPanel(container, text, onQuit) {
  if (document.getElementById('errpanel')) return;
  const box = document.createElement('div');
  box.id = 'errpanel';
  box.className = 'mwin errpanel';
  const msg = document.createElement('div');
  msg.className = 'err_text';
  msg.textContent = String(text).split('\n')[0].slice(0, 160); // стек остаётся только в консоли
  const btn = document.createElement('button');
  btn.className = 'pill err_quit';
  btn.textContent = 'В меню';
  btn.addEventListener('click', () => {
    box.remove();
    if (onQuit) onQuit();
  });
  box.appendChild(msg);
  box.appendChild(btn);
  container.appendChild(box);
}
