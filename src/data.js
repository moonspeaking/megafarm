// Loads and indexes all game scripts.

import { parseScript } from './dsl.js';

const HOST_SCRIPTS = [
  'config_scripts',
  'scene_scripts',
  'functionhost_scripts',
  'texturehost_scripts',
  'soundhost_scripts',
  'texthost_scripts',
  'translatehost_scripts',
  'guihost_scripts',
  'menuhost_scripts',
  'objecthost_scripts',
  'animationhost_scripts',
  'particle_scripts',
  'map_script',
];

const INTERFACE_SCRIPTS = [
  'interfaces/intro',
  'interfaces/loader',
  'interfaces/menu',
  'interfaces/gamemap',
  'interfaces/gameplay',
  'interfaces/trophyroom',
  'interfaces/credits',
  'interfaces/comics',
];

export class GameData {
  constructor() {
    this.objects = new Map();      // name -> node
    this.objectsByType = new Map(); // type -> [node]
    this.levels = new Map();       // number -> node
    this.animations = new Map();   // name -> node
    this.texts = new Map();        // localization key -> text (selected pack)
    this.interfaces = new Map();   // name -> node
    this.gui = new Map();          // component name -> node
    this.lang = 'rus';             // language pack currently loaded
    this.packs = new Map();        // code -> Map: fallback packs for the t() chain
    this.packLoads = new Map();    // code -> Promise: in-flight fallback pack loads
  }

  async load(manifest) {
    const jobs = [];
    const fetchText = (key) => {
      const path = manifest.scripts[key];
      if (!path) return Promise.resolve(null);
      return fetch(path).then((r) => (r.ok ? r.text() : null));
    };

    // hosts
    for (const key of HOST_SCRIPTS) {
      jobs.push(fetchText(key).then((t) => t && this.ingest(parseScript(t))));
    }
    // interfaces
    for (const key of INTERFACE_SCRIPTS) {
      jobs.push(fetchText(key).then((t) => {
        if (!t) return;
        for (const node of parseScript(t)) {
          const name = node.props.name || key.split('/').pop();
          this.interfaces.set(String(name), node);
        }
      }));
    }
    // object scripts
    for (const [key, path] of Object.entries(manifest.scripts)) {
      if (!key.startsWith('objects/')) continue;
      jobs.push(fetchText(key).then((t) => t && this.ingest(parseScript(t))));
    }
    // levels
    for (const [key, path] of Object.entries(manifest.scripts)) {
      const m = /^level(\d+)$/.exec(key);
      if (!m) continue;
      jobs.push(fetchText(key).then((t) => {
        if (!t) return;
        const roots = parseScript(t);
        const lvl = roots.find((r) => r.type === 'level');
        if (lvl) this.levels.set(parseInt(m[1], 10), lvl);
      }));
    }
    // localization (rus)
    jobs.push(fetchText('rus').then((t) => { if (t) this.parseLocalization(t); }));

    await Promise.all(jobs);
    this.ensureFallbackPacks(manifest);
    return this;
  }

  ingest(roots) {
    for (const root of roots) {
      if (root.type === 'animationhost') {
        for (const a of root.children) {
          if (a.type === 'animation' && a.props.name) {
            this.animations.set(a.props.name, a);
          }
        }
      } else if (root.type === 'guihost') {
        for (const c of root.children) {
          if (c.props.name) this.gui.set(c.props.name, c);
        }
      } else if (root.type === 'menuhost') {
        // keep raw for later menu work
        this.menuhost = root;
      } else {
        // object files: either a single typed root node (@seed 4 { ... })
        // or a wrapper root containing typed children
        const register = (node) => {
          const name = node.props.name;
          if (!name) return;
          this.objects.set(name, node);
          if (!this.objectsByType.has(node.type)) this.objectsByType.set(node.type, []);
          this.objectsByType.get(node.type).push(node);
        };
        if (root.type !== 'config' && root.type !== 'font' && root.type !== 'language'
            && root.type !== 'texturehost' && root.type !== 'soundhost'
            && root.type !== 'texthost' && root.type !== 'translatehost'
            && root.type !== 'objecthost' && root.type !== 'functionhost'
            && root.type !== 'level') {
          register(root);
        }
        for (const child of root.children) register(child);
      }
    }
  }

  parseLocalization(text, map = this.texts) {
    const body = text.slice(text.indexOf('<<') + 2, text.lastIndexOf('>>'));
    for (let line of body.split('\n')) {
      line = line.trim();
      if (!line) continue;
      const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) map.set(m[1], m[2].replace(/\^/g, '\n').trim());
    }
  }

  /** Lazily fetch eng/rus packs for the t() chain (not awaited: t() is sync). */
  ensureFallbackPacks(manifest) {
    for (const code of ['eng', 'rus']) {
      if (code === this.lang || this.packs.has(code) || this.packLoads.has(code)) continue;
      const path = manifest.scripts[code];
      if (!path) continue;
      const load = fetch(path)
        .then((r) => (r.ok ? r.text() : null))
        .then((text) => {
          if (!text) return;
          const map = new Map();
          this.parseLocalization(text, map);
          this.packs.set(code, map);
        })
        .catch(() => {}); // нет сети — цепочка просто короче
      this.packLoads.set(code, load);
    }
  }

  /** Replace all UI/level texts with another language pack. */
  async setLanguage(manifest, code) {
    const path = manifest.scripts[code];
    if (!path) return false;
    const res = await fetch(path);
    if (!res.ok) return false;
    this.texts.clear();
    this.parseLocalization(await res.text());
    this.lang = code;
    // смена языка сбрасывает кэш запасных паков и перезагружает нужные
    this.packs.clear();
    this.packLoads.clear();
    this.ensureFallbackPacks(manifest);
    return true;
  }

  /** Language chain for t(): selected -> eng -> rus (without repeats). */
  chainLangs() {
    if (this.lang === 'rus') return ['rus', 'eng'];
    if (this.lang === 'eng') return ['eng', 'rus'];
    return [this.lang, 'eng', 'rus'];
  }

  /** Lookup chain: selected pack -> eng -> rus -> fallback -> key. */
  t(key, fallback) {
    for (const code of this.chainLangs()) {
      const map = code === this.lang ? this.texts : this.packs.get(code);
      const value = map && map.get(key);
      if (value) return value; // пустые значения пропускаем, как раньше
    }
    return fallback || key;
  }

  levelNumbers() {
    return [...this.levels.keys()].sort((a, b) => a - b);
  }
}

export async function loadData(manifest) {
  return new GameData().load(manifest);
}
