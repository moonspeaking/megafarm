// Player progress: finished levels, records and trophies (kept in localStorage).
//
// Rules recovered from the original (sub_42F2B0, level-finished handler of the map screen):
//  * a finished level is marked "completed"; if it was finished within `level_time` it is
//    "gold" and gives trophy #(level-1);
//  * once all 12 level trophies are owned, trophy #12 (the cup) is granted;
//  * best time is the minimum, best money the maximum, over all runs of that level.

const KEY = 'megafarm.progress.v1';
export const LEVELS = 12;

export class Progress {
  constructor(settings) {
    this.settings = settings;
    this.data = {};
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = JSON.parse(raw) || {};
    } catch (e) { /* storage unavailable */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }

  get profile() {
    const name = this.settings.get('player') || 'default';
    if (!this.data[name]) this.data[name] = { levels: {}, trophies: [], comics: [] };
    // данные, записанные старой версией: части полей может не быть
    if (!this.data[name].levels) this.data[name].levels = {};
    if (!this.data[name].trophies) this.data[name].trophies = [];
    if (!this.data[name].comics) this.data[name].comics = [];
    return this.data[name];
  }

  level(n) { return this.profile.levels[n] || null; }
  done(n) { return !!this.level(n); }
  gold(n) { return !!(this.level(n) && this.level(n).gold); }
  /** Levels open one after another. */
  unlocked(n) { return n <= 1 || this.done(n - 1); }
  /** First level that was not finished yet (what the map selects initially). */
  current() {
    for (let n = 1; n <= LEVELS; n++) if (!this.done(n)) return n;
    return LEVELS;
  }
  trophies() { return this.profile.trophies; }
  comicsSeen(n) { return this.profile.comics.includes(n); }
  markComics(n) {
    if (!this.profile.comics.includes(n)) { this.profile.comics.push(n); this.save(); }
  }

  /** Имена профилей, у которых есть сохранённый прогресс. */
  profiles() { return Object.keys(this.data); }

  /** Стереть прогресс профиля; сохранение игры удаляется отдельно (savegame.js). */
  removeProfile(name) {
    if (!this.data[name]) return false;
    delete this.data[name];
    this.save();
    return true;
  }

  /**
   * Record a won level. `limit` is the gold time in seconds.
   * Returns { gold, newTrophies: [index, ...] }.
   */
  complete(n, time, money, limit) {
    const p = this.profile;
    const old = p.levels[n];
    const gold = time <= limit || !!(old && old.gold);
    const rec = {
      gold,
      time: old && old.time && old.time < time ? old.time : Math.round(time),
      money: Math.max(old ? old.money : 0, Math.round(money)),
    };
    p.levels[n] = rec;
    const fresh = [];
    if (gold && !p.trophies.includes(n - 1)) { p.trophies.push(n - 1); fresh.push(n - 1); }
    const owned = p.trophies.filter((i) => i < LEVELS).length;
    if (owned === LEVELS && !p.trophies.includes(LEVELS)) { p.trophies.push(LEVELS); fresh.push(LEVELS); }
    this.save();
    return { gold: time <= limit, newTrophies: fresh };
  }
}

export function formatTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const p = (v) => String(v).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
