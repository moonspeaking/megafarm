// Persistent user settings (volume, language, graphics).

const KEY = 'megafarm.settings.v1';

export const DEFAULTS = {
  sfx: 0.6,
  music: 0.35,
  sfxOn: true,
  musicOn: true,
  smooth: true,
  fullscreen: false,
  lang: 'rus',
  cursor: false,
  player: '',
  profiles: [],
  trophies: [],
};

export const LANGUAGES = ['rus', 'eng', 'deu', 'fra', 'ita', 'esp', 'dut'];

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    this.listeners = [];
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.values, JSON.parse(raw));
    } catch (e) { /* storage unavailable */ }
  }

  get(name) { return this.values[name]; }

  set(name, value) {
    this.values[name] = value;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch (e) { /* ignore */ }
    for (const fn of this.listeners) fn(name, value);
  }

  onChange(fn) { this.listeners.push(fn); }

  /** Известные имена игроков (созданные профили); текущий — settings.get('player'). */
  profiles() {
    const list = this.values.profiles;
    return Array.isArray(list) ? [...list] : [];
  }

  addProfile(name) {
    name = String(name || '').trim();
    if (!name) return;
    const list = this.profiles();
    if (!list.includes(name)) { list.push(name); this.set('profiles', list); }
  }

  /** Убрать профиль из списка; если он был текущим — переключить на первый оставшийся. */
  removeProfile(name) {
    const list = this.profiles().filter((n) => n !== name);
    this.set('profiles', list);
    if (this.get('player') === name) this.set('player', list[0] || '');
  }
}
