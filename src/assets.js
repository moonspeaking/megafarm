// Asset loading and texture resolution.

export class Assets {
  constructor(manifest) {
    this.manifest = manifest;
    this.images = new Map(); // key -> HTMLImageElement (or 'loading')
    this.pending = new Set();
    this.index = new Map(); // basename -> [keys]
    for (const key of Object.keys(manifest.textures)) {
      const base = key.split('/').pop();
      if (!this.index.has(base)) this.index.set(base, []);
      this.index.get(base).push(key);
    }
    this.missing = new Set();
  }

  /** Resolve a texture reference like "plant_pumpkin.tga" to a manifest key. */
  resolve(name, env) {
    if (!name) return null;
    let n = String(name).toLowerCase().replace(/\.(tga|jpg|jpeg|png)$/, '');
    // direct path reference
    if (n.includes('/')) {
      if (this.manifest.textures[n]) return n;
      n = n.split('/').pop();
    }
    const base = n.split('/').pop();
    // environment-specific variant, e.g. house_cow -> grass_house_cow
    if (env && this.index.has(`${env}_${base}`)) {
      const envKeys = this.index.get(`${env}_${base}`);
      const pick = envKeys.find((k) => k.startsWith('objects/')) || envKeys[0];
      return pick;
    }
    const cands = this.index.get(base) || [];
    if (!cands.length) return null;
    let best = null;
    let bestScore = -1;
    for (const key of cands) {
      let score = 0;
      if (env && key.includes(`/${env}_`)) score += 30;
      if (key.startsWith('objects/')) score += 6;
      if (key.startsWith('animations/')) score += 5;
      if (env && key.startsWith('textures/objects/buildings/') && !key.includes(`/${env}_`)) score -= 8;
      score -= key.length / 1000;
      if (score > bestScore) { bestScore = score; best = key; }
    }
    return best;
  }

  /** Start loading an image; returns the image element (may be incomplete). */
  load(key) {
    if (!key) return null;
    let img = this.images.get(key);
    if (img) return img;
    const path = this.manifest.textures[key];
    if (!path) { this.missing.add(key); return null; }
    img = new Image();
    img.src = path;
    this.images.set(key, img);
    return img;
  }

  /** Convenience: resolve + load. */
  image(name, env) {
    const key = this.resolve(name, env);
    return key ? this.load(key) : null;
  }

  ready(img) {
    return img && img.complete && img.naturalWidth > 0;
  }

  /** Preload a list of texture names (resolved against env). */
  preload(names, env) {
    const jobs = [];
    for (const n of names) {
      const key = this.resolve(n, env);
      if (!key) { this.missing.add(n); continue; }
      const img = this.load(key);
      if (!img.complete) {
        jobs.push(new Promise((res) => { img.onload = img.onerror = res; }));
      }
    }
    return Promise.all(jobs);
  }

  sound(name) {
    const path = this.manifest.sounds[String(name).toLowerCase()];
    return path || null;
  }
}

export async function loadDecor() {
  try {
    const res = await fetch('assets/decor.json?v=' + Date.now());
    return res.ok ? await res.json() : [];
  } catch (e) { return []; }
}

export async function loadManifest() {
  const res = await fetch('assets/manifest.json?v=' + Date.now());
  if (!res.ok) throw new Error('manifest.json not found');
  return res.json();
}
