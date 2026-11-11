// Canvas renderer.

import { TILE } from './sim.js';
import { sprinklerZoneCells } from './geometry.js';

const frameSizeCache = new Map();

// sub_41B470 / sub_419B20: first cell of the 16 pile frames of every fruit type (index = icon number % 25), and the
// offsets of the pile from the hero's feet (x, y up) for the slots 0..7
const PILE_BASE = [48, 64, 80, 32, 96, 128, 112, 144, 160, 176, 272, 240, 192, 208, 224, 256, 304, 320, 336, 288, 352, 328, 296, 280, 312];
const PILE_OFF = [[-2, 65], [-15, 75], [-25, 75], [-12, 90], [-2, 70], [12, 90], [25, 75], [15, 75]];

export class Renderer {
  constructor(canvas, world, assets, db) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.assets = assets;
    this.db = db;
    this.camera = { x: 0, y: 0 };
    this.hover = { x: -1, y: -1, obj: null };
    this.terrain = null;
    this.t = 0;
  }

  setWorld(world) {
    this.world = world;
    this.terrain = null;
    this.decor = null;
  }

  /**
   * Static ground, like the original CGameField::draw (sub_412220): the centre tile covers the whole
   * field (512 px tile, scaled by (H+128)/H vertically, starting 64 px above the field); the outer
   * 128 px ring is drawn with the border strips (up/down/left/right_center, repeated W/512 resp. H/512
   * times across the inner length) and the four 128x128 corners.
   */
  buildTerrain() {
    const w = this.world;
    const W = w.worldW, H = w.worldH;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    const ok = (i) => i && i.complete && i.naturalWidth;
    const img = this.assets.image(`${w.env}_center_tile`, w.env)
      || this.assets.image('grass_center_tile', w.env);
    if (ok(img)) {
      const th = img.naturalHeight * (H + 128) / H;
      for (let y = -64; y < H; y += th) {
        for (let x = 0; x < W; x += img.naturalWidth) {
          ctx.drawImage(img, x, y, img.naturalWidth, th);
        }
      }
    } else {
      ctx.fillStyle = '#5a8a3a';
      ctx.fillRect(0, 0, cv.width, cv.height);
      // retry when loaded
      if (img) img.onload = () => { this.terrain = null; };
    }

    const get = (n) => this.assets.image(`${w.env}_${n}`, w.env);
    const iw = W - 256, ih = H - 256;
    const strips = {
      up_center: get('up_center'), down_center: get('down_center'),
      left_center: get('left_center'), right_center: get('right_center'),
      left_up: get('left_up'), right_up: get('right_up'), left_down: get('left_down'), right_down: get('right_down'),
    };
    const all = Object.values(strips);
    if (all.every(ok)) {
      // horizontal strips: u runs 0..W/512 over the inner width
      const tw = 512 * iw / W;
      for (let x = 0; x < iw; x += tw) {
        const dw = Math.min(tw, iw - x), sw = dw / tw * 512;
        ctx.drawImage(strips.down_center, 0, 0, sw, 128, 128 + x, H - 128, dw, 128);
        ctx.drawImage(strips.up_center, 0, 0, sw, 128, 128 + x, 0, dw, 128);
      }
      // vertical strips: v runs 0..H/512 over the inner height
      const th = 512 * ih / H;
      for (let y = 0; y < ih; y += th) {
        const dh = Math.min(th, ih - y), sh = dh / th * 512;
        ctx.drawImage(strips.left_center, 0, 0, 128, sh, 0, 128 + y, 128, dh);
        ctx.drawImage(strips.right_center, 0, 0, 128, sh, W - 128, 128 + y, 128, dh);
      }
      ctx.drawImage(strips.left_up, 0, 0);
      ctx.drawImage(strips.right_up, W - 128, 0);
      ctx.drawImage(strips.left_down, 0, H - 128);
      ctx.drawImage(strips.right_down, W - 128, H - 128);
    } else {
      for (const i of all) if (i && !i.complete) i.addEventListener('load', () => { this.terrain = null; }, { once: true });
    }
    this.drawDecorLayer(ctx, W, H);
    this.terrain = cv;
  }

  /**
   * Decoration of the ground (original CGameField::sub_412BE0): int(gridW*gridH/33) sprites of 64x64,
   * each centred at a uniformly random point of the whole field; the sprite is a random cell of the 8x8
   * `decor` sheet: grass 0..17, desert 24..36 (24 + rand(13)), swamp 40..49 (40 + rand(10)).
   * They are part of the field's own draw, i.e. below beds, plants and objects.
   */
  drawDecorLayer(ctx, W, H) {
    const w = this.world;
    const sheet = this.assets.image('decor.png');
    if (!sheet || !sheet.complete || !sheet.naturalWidth) {
      if (sheet) sheet.addEventListener('load', () => { this.terrain = null; }, { once: true });
      return;
    }
    let seed = (w.levelNum * 7919 + 17) >>> 0;         // stable per level (the original uses rand())
    const rnd = () => {
      seed = (seed + 0x6D2B79F5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const base = { grass: [0, 18], desert: [24, 13], swamp: [40, 10] }[w.env] || [0, 18];
    const count = Math.floor(w.gridW * w.gridH / 33);
    for (let i = 0; i < count; i++) {
      const x = rnd() * W, y = rnd() * H;
      const n = base[0] + Math.floor(rnd() * base[1]);
      ctx.drawImage(sheet, (n % 8) * 64, Math.floor(n / 8) * 64, 64, 64, x - 32, y - 32, 64, 64);
    }
  }

  bedImage(wet) {
    return this.assets.image(wet ? 'beds_wet' : 'beds_dry');
  }

  /**
   * One dug bed, exactly like the original CSquare::draw (sub_420E40).
   *  - the square is drawn 72x72 (the 64px cell enlarged by 1.125), variant 0..3 picks one of the four
   *    64px frames of beds_dry / beds_wet and the grass strips;
   *  - order: top, left and right grass strips, dry bed, wet bed (alpha = water level of the plant, an empty
   *    bed is fully wet), fertilizer overlay (alpha = fertilizer left), bottom grass strip;
   *  - a strip exists on the sides that have no dug neighbour.
   */
  drawBed(ctx, cell, cx, cy) {
    const w = this.world;
    const ok = (i) => i && i.complete && i.naturalWidth;
    const dug = (x, y) => { const c = w.cell(x, y); return !!(c && c.dug); };
    const px = cx * TILE + TILE / 2, py = cy * TILE + TILE / 2;
    const half = TILE * 1.125 / 2;                       // 36
    const v = (((cx * 73856093) ^ (cy * 19349663)) >>> 0) % 4;
    const lr = this.assets.image(`${w.env}_bed_lr`, w.env);
    const ud = this.assets.image(`${w.env}_bed_ud`, w.env);
    const strip = (img, sx, sy, sw, sh, dx, dy) => {
      if (ok(img)) ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
    };
    // grass strips behind the bed (UV insets of the original: +0.0039 of the sheet size = 1px)
    if (!dug(cx, cy - 1)) strip(ud, 0, v * 32 + 1, 96, 31, px - 48, py - half - 12 - 16);
    if (!dug(cx - 1, cy)) strip(lr, v * 32 + 1, 0, 31, 96, px - half - 10 - 16, py - 48);
    if (!dug(cx + 1, cy)) strip(lr, (v + 4) * 32, 0, 31, 96, px + half + 10 - 16, py - 48);

    const dry = this.bedImage(false);
    if (ok(dry)) ctx.drawImage(dry, v * 64, 0, 64, 64, px - half, py - half, half * 2, half * 2);
    const plant = cell.plant && !cell.plant.dead ? cell.plant : null;
    const wetA = plant ? Math.max(0, Math.min(1, (100 - plant.dry) / 100)) : 1;
    const wet = this.bedImage(true);
    if (wetA > 0 && ok(wet)) {
      ctx.globalAlpha = wetA;
      ctx.drawImage(wet, v * 64, 0, 64, 64, px - half, py - half, half * 2, half * 2);
      ctx.globalAlpha = 1;
    }
    if (plant && plant.fertTicks > 0 && plant.fertMax > 0) {
      const f = this.assets.image(`fertilizer_on_bad${(v & 1) + 1}`);
      if (ok(f)) {
        ctx.globalAlpha = Math.min(1, plant.fertTicks / plant.fertMax);
        ctx.drawImage(f, px - half, py - half, half * 2, half * 2);
        ctx.globalAlpha = 1;
      }
    }
    if (!dug(cx, cy + 1)) strip(ud, 0, (v + 4) * 32 + 1, 96, 31, px - 48, py + half - 16);
  }

  render(dt) {
    this.t += dt;
    const w = this.world;
    const ctx = this.ctx;
    if (!w) return;
    if (!this.terrain) this.buildTerrain();

    // camera follows hero
    const cam = this.camera;
    const tx = clamp(w.hero.x - 400, 0, Math.max(0, w.worldW - 800));
    const ty = clamp(w.hero.y - 300, 0, Math.max(0, w.worldH - 600));
    cam.x += (tx - cam.x) * Math.min(1, dt * 6);
    cam.y += (ty - cam.y) * Math.min(1, dt * 6);

    const k = this.canvas.width / 800;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = this.smoothing !== false;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#20180f';
    ctx.fillRect(0, 0, 800, 600);
    ctx.save();
    // snap the camera to whole device pixels to avoid shimmering
    ctx.translate(-Math.round(cam.x * k) / k, -Math.round(cam.y * k) / k);

    if (this.terrain) ctx.drawImage(this.terrain, 0, 0);

    // beds (each one draws its own grass strips, see drawBed)
    for (let cy = 0; cy < w.gridH; cy++) {
      for (let cx = 0; cx < w.gridW; cx++) {
        const cell = w.cell(cx, cy);
        if (cell && cell.dug) this.drawBed(ctx, cell, cx, cy);
      }
    }

    // hover highlight
    if (this.hover.obj == null && this.hover.x >= 0) {
      const c = w.cell(this.hover.x, this.hover.y);
      if (c) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(this.hover.x * TILE, this.hover.y * TILE, TILE, TILE);
      }
    }

    this.drawSprinklerZone(ctx);

    // draw list sorted by base y
    const drawables = [];
    for (const o of w.objects) {
      drawables.push({ o, y: sortY(o) });
    }
    drawables.push({ o: w.hero, y: w.hero.y });
    drawables.sort((a, b) => a.y - b.y);

    for (const d of drawables) {
      if (d.o === w.hero) this.drawHero(ctx);
      else {
        this.drawObject(ctx, d.o);
        const o = d.o;
        if (o.kind === 'box' && o.type && o.count > 0) {
          const num = this.fruitIconNum(o.type);
          if (num !== undefined) {
            this.drawPile(ctx, num, o.count >= 4, 2, o.x + 2, o.y - 14);
            if (this.hover.obj === o) this.drawFruitRow(ctx, o.x, o.y, num, 4, o.count);
          }
        }
        if (this.hover.obj === o && (o.kind === 'watercan' || o.kind === 'seed')) {
          this.drawObjectBadge(ctx, o.kind, o.def, o.kind === 'seed' ? o.count : o.charges, o.x, o.y);
        }
      }
    }

    this.drawSprinklerGhost(ctx);
    this.drawParticles(ctx);
    this.drawHints(ctx);
    ctx.restore();
  }

  // ------------------------------------------------------------- objects

  drawObject(ctx, o) {
    const w = this.world;
    if (o.kind === 'plant') { this.drawPlant(ctx, o); return; }
    if (o.kind === 'hero') return;
    if (o.kind === 'worker') { this.drawWorker(ctx, o); return; }


    if (o.kind === 'item' || o.kind === 'spade') {
      const img = this.assets.image(o.def.props.texpicture_name, w.env);
      if (img && img.complete) {
        ctx.drawImage(img, o.x - o.size[0] / 2, o.y - o.size[1] / 2, o.size[0], o.size[1]);
      }
      this.drawItemBadges(ctx, o);
      return;
    }

    // buildings / trees / waterpump: texture picture
    const img = this.assets.image(o.def.props.texpicture_name, w.env);
    if (img && img.complete) {
      ctx.drawImage(img, o.x - o.size[0] / 2, o.y - o.size[1] / 2, o.size[0], o.size[1]);
    }
    // sprites (animals, birds, sprinkler)
    for (const spr of o.def.children) {
      if (spr.type !== 'sprite') continue;
      this.drawDefSprite(ctx, o, spr);
    }
    if (o.kind === 'house') this.drawHouseStatus(ctx, o);
    if (o.bees) this.drawBees(ctx, o);
    if (o.kind === 'tree') this.drawTreeFruit(ctx, o);
    this.drawItemBadges(ctx, o);
  }

  drawItemBadges() { /* the original shows no counters on items lying on the ground */ }

  drawBadgeText(ctx, x, y, text) {
    ctx.font = 'bold 12px Georgia';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const w = ctx.measureText(text).width + 10;
    roundRect(ctx, x - w / 2, y - 10, w, 16, 4);
    ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(text, x, y + 2);
  }

  drawDefSprite(ctx, owner, spr) {
    const w = this.world;
    const size = spr.props.size || [32, 32];
    const pos = spr.props.pos || [0, 0];
    const anims = spr.children.filter((c) => c.type === 'animation');
    if (!anims.length) return;
    // pick idle animation; hungry animals use the second ("nofood") one
    let anim = anims[0];
    if (owner.kind === 'house' && owner.def.props.type_feed && owner.feed <= 0 && anims[1]) anim = anims[1];
    // sub_423D00 requests `water_sprinkler_work` on every update and CSpriteElement::setAnimation lets a running one
    // finish, so a placed sprinkler spins all the time (the stop animation is only the initial one)
    if (owner.kind === 'sprinkler' && anims[1]) anim = anims[1];
    const img = this.assets.image(anim.props.texture_name, w.env);
    if (!img || !img.complete) return;
    const frames = anim.props.end_frame - anim.props.start_frame + 1;
    const fps = anim.props.frame_per_second || 8;
    const idx = anim.props.start_frame
      + (Math.floor(this.t * fps) % frames);
    const fw = size[0], fh = size[1];
    const dx = owner.x + pos[0] - fw / 2;
    const dy = owner.y - pos[1] - fh / 2;
    drawFrame(ctx, img, fw, fh, idx, dx, dy, fw, fh);
  }

  drawWorker(ctx, wk) {
    const w = this.world;
    let name;
    if (wk.act) name = wk.act.name;
    else if (wk.moving) name = `${wk.name}_walk${wk.facing}`;
    else name = (Math.floor(this.t / 5) % 3 === 2) ? `${wk.name}_idle2` : `${wk.name}_idle1`;
    const def = w.db.animations.get(name) || w.db.animations.get(`${wk.name}_idle1`);
    if (def) {
      const img = this.assets.image(def.props.texname, w.env);
      if (img && img.complete && img.naturalWidth) {
        const fs = def.props.frame_size || [100, 150];
        const start = def.props.start_frame || 0;
        const end = def.props.end_frame || start;
        const frames = end - start + 1;
        const dur = def.props.animation_time || 0.8;
        const idx = wk.act
          ? start + Math.min(frames - 1, Math.floor((wk.act.t / wk.act.dur) * frames))
          : start + (Math.floor((this.t % dur) / dur * frames) % frames);
        const delta = def.props.delta_pos || [0, 0];
        drawFrame(ctx, img, fs[0], fs[1], idx,
          wk.x - fs[0] / 2 + delta[0], wk.y + 4 - (fs[1] - footPad(img, fs[0], fs[1], idx)), fs[0], fs[1]);
      }
    }
    // status bubble above the head
    const top = wk.y - 150;
    const bob = Math.sin(this.t * 5) * 3;
    if (wk.state !== 'work') {
      this.drawBubble(ctx, wk.x, top + bob, '$', '#ffd75e');
    } else if (wk.question) {
      this.drawBubble(ctx, wk.x, top + bob, '?', '#9ec9ff');
    } else {
      const total = wk.def.props.work_time || 100;
      const k = clamp(wk.workLeft / total, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(wk.x - 19, top + 6, 38, 6);
      ctx.fillStyle = '#7ed957';
      ctx.fillRect(wk.x - 18, top + 7, 36 * k, 4);
    }
    if (wk.box && wk.box.count > 0) {
      this.drawBadgeText(ctx, wk.x, wk.y + 24, `${wk.box.count}/4`);
    }
  }

  drawBubble(ctx, x, y, text, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = '#4a3410';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4a3410';
    ctx.font = 'bold 17px Georgia';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y + 6);
  }

  drawTreeFruit(ctx, o) {
    const w = this.world;
    const p = o.def.props;
    const frac = Math.min(1, (o.progress || 0) / 100);
    const stage = o.fruits > 0 ? 'c' : frac < 0.34 ? 'a' : frac < 0.67 ? 'b' : 'c';
    // the last fruit of a full tree is always ripe; unripe stages only while growing
    const base = p.name_fruit;
    if (base) {
      let img = this.assets.image(`${base}_${stage}_1`, w.env);
      if (img && img.complete && img.naturalWidth && img.naturalWidth !== img.naturalHeight) {
        img = this.assets.image(`${base}_${stage}_2`, w.env);
      }
      if (img && img.complete && img.naturalWidth) {
        const fp = p.fruit_pos || (o.def.children.find((c) => c.type === 'fruit') || { props: {} }).props.fruit_pos || [0, 52];
        const fs = (o.def.children.find((c) => c.type === 'fruit') || { props: {} }).props.fruit_size || [128, 128];
        ctx.globalAlpha = 1;
        ctx.drawImage(img, o.x + fp[0] - fs[0] / 2, o.y - fp[1] - fs[1] / 2, fs[0], fs[1]);
        ctx.globalAlpha = 1;
      }
    }
    if (o.fruits > 0) {
      const y = o.y - o.size[1] / 2 + 6 + Math.sin(this.t * 5) * 3;
      this.drawBadgeText(ctx, o.x, y, '✓');
    } else {
      const bx = o.x - 22, by = o.y - (p.ready_bar_pos ? p.ready_bar_pos[1] : 148);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx - 1, by - 1, 46, 8);
      ctx.fillStyle = '#ffd75e';
      ctx.fillRect(bx, by, 44 * frac, 6);
    }
  }

  drawBees(ctx, o) {
    for (const b of o.bees) {
      const wing = Math.sin(this.t * 40 + b.x) * 3;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.ellipse(b.x - 2, b.y - 4 + wing * 0.3, 3, 2 + Math.abs(wing) * 0.4, -0.5, 0, Math.PI * 2);
      ctx.ellipse(b.x + 2, b.y - 4 + wing * 0.3, 3, 2 + Math.abs(wing) * 0.4, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f2c230';
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, 4.5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a2a08';
      ctx.fillRect(b.x - 1, b.y - 3, 1.4, 6);
    }
  }

  drawHouseStatus(ctx, o) {
    const p = o.def.props;
    const bar = (pos, frac, color) => {
      const bx = o.x + pos[0] - 22, by = o.y - pos[1] - 3;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx - 1, by - 1, 46, 8);
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, 44 * clamp(frac, 0, 1), 6);
    };
    if (p.type_feed) {
      bar(p.feed_bar_pos || [-48, 96], o.feed / (p.time_feed || 60), o.feed > 0 ? '#7ed957' : '#e0453a');
    }
    const max = p.max_count_good || 1;
    if (p.type_feed || o.ready < max) {
      bar(p.ready_bar_pos || [48, 96], o.ready >= max ? 1 : (o.bees ? o.progress / 100 : o.progress / (p.time_complete || 60)), '#ffd75e');
    }
    if (o.ready > 0) {
      const y = o.y - o.size[1] / 2 - 8 + Math.sin(this.t * 5) * 3;
      ctx.fillStyle = '#ffd75e';
      ctx.strokeStyle = '#7a5a10';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(o.x, y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#5a3a00';
      ctx.font = 'bold 16px Georgia';
      ctx.textAlign = 'center';
      ctx.fillText(o.ready > 1 ? String(o.ready) : '✓', o.x, y + 6);
    } else if (p.type_feed && o.feed <= 0) {
      const y = o.y - o.size[1] / 2 - 8;
      ctx.font = 'bold 12px Georgia';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e0453a';
      ctx.fillText('голодно', o.x, y);
    }
  }

  drawPlant(ctx, o) {
    const w = this.world;
    if (o.dead) {
      // withered plant: draw last frame darkened
      this.drawPlantSprites(ctx, o, 63, true);
      return;
    }
    // stage animations: plant_growthN (8 frames, once) then plant_idleN (loop)
    let frame = 0;
    if (o.stage > 0) {
      const base = (o.stage - 1) * 16;
      frame = o.stageT < 1 ? base + Math.min(7, Math.floor(o.stageT * 8))
        : base + 8 + (Math.floor((o.stageT - 1) * 8) % 8); // every plant loops on its own clock, like the original
    }
    this.drawPlantSprites(ctx, o, frame, false);

    // status icons
    let iy = o.y - 34;
    if (o.thirsty) {
      this.drawDrop(ctx, o.x - 10, iy + Math.sin(this.t * 5) * 2);
      iy -= 14;
    }
    // no bag/fruit icon above a ripe plant: the original only plays ready_plant and a sparkle effect
    if (this.hover.obj === o) this.drawPlantMeters(ctx, o);
  }

  drawPlantSprites(ctx, o, frame, dead) {
    const w = this.world;
    for (const spr of o.def.children) {
      if (spr.type !== 'sprite') continue;
      const size = spr.props.size || [32, 32];
      const pos = spr.props.pos || [0, 0];
      const anims = spr.children.filter((c) => c.type === 'animation');
      if (!anims.length) continue;
      const texName = anims[0].props.texture_name;
      const img = this.assets.image(texName, w.env);
      if (!img || !img.complete) continue;
      const dx = o.x + pos[0] - size[0] / 2;
      const dy = o.y - pos[1] - size[1] / 2;
      if (dead) {
        ctx.globalAlpha = 0.55;
        drawPlantFrame(ctx, img, size, frame, dx, dy);
        ctx.globalAlpha = 1;
      } else {
        drawPlantFrame(ctx, img, size, frame, dx, dy);
      }
    }
  }

  /**
   * Watering zone of a sprinkler (CWaterSprinkler sub_4239C0): while one is carried (bought / being moved) it follows the
   * cursor, and a placed one shows it while the mouse is over it. A `wcircle` tile is drawn per cell whose centre lies
   * inside the ellipse ((dx/rx)^2 + (dy/ry)^2 <= 1, sprinkle_radius in cells). Cell centres rather than cell indices:
   * a sprinkler can stand between four cells (fractional level0 coords 13.5/7.5), the drawn zone must stay grid-aligned.
   */
  drawSprinklerZone(ctx) {
    const w = this.world;
    const held = w.pending || w.hero.held;
    let def = null, px = 0, py = 0;
    if (held && held.kind === 'sprinkler' && this.hover.x >= 0) {
      def = held.def;
      px = this.hover.x * TILE + TILE / 2; py = this.hover.y * TILE + TILE / 2;
    } else if (this.hover.obj && this.hover.obj.kind === 'sprinkler') {
      def = this.hover.obj.def;
      px = this.hover.obj.x; py = this.hover.obj.y;
    }
    if (!def) return;
    const img = this.assets.image('wcircle.png', null);
    if (!img || !img.complete || !img.naturalWidth) return;
    const r = def.props.sprinkle_radius || [4, 2];
    for (const c of sprinklerZoneCells(w.gridW, w.gridH, TILE, px, py, r)) {
      ctx.drawImage(img, c.x * TILE, c.y * TILE, TILE, TILE);
    }
  }

  /** What is carried (a purchase on the cursor) is shown on the cell under the cursor: where it will stand. */
  drawSprinklerGhost(ctx) {
    const w = this.world;
    // a purchase on the cursor, or a building/tree/sprinkler that is being moved; things in the hero's hands
    // (can, seeds, box, fertilizer) are not shown at the cursor
    const held = w.hero.held;
    const p = w.pending || (held && ['sprinkler', 'house', 'tree', 'hangar', 'waterpump'].includes(held.kind) ? held : null);
    if (!p || !p.def || this.hover.x < 0 || this.hover.y < 0
      || this.hover.x >= w.gridW || this.hover.y >= w.gridH) return;
    const x = this.hover.x * TILE + TILE / 2, y = this.hover.y * TILE + TILE / 2;
    ctx.save();
    ctx.globalAlpha = 0.8;
    if (p.kind === 'sprinkler') {
      const ghost = { kind: 'sprinkler', def: p.def, x, y, size: p.def.props.size || [128, 128] };
      for (const spr of p.def.children) if (spr.type === 'sprite') this.drawDefSprite(ctx, ghost, spr);
    } else {
      const img = p.kind === 'worker'
        ? this.assets.image(p.name, null)
        : this.assets.image(p.def.props.texpicture_name, w.env);
      if (img && img.complete && img.naturalWidth) {
        const s = p.kind === 'worker' ? [64, 64] : (p.def.props.size || [64, 64]);
        ctx.drawImage(img, x - s[0] / 2, y - s[1] / 2, s[0], s[1]);
      }
    }
    ctx.restore();
  }

  /** Health hearts and water drops, shown while the mouse is over a plant. */
  drawPlantMeters(ctx, o) {
    const hearts = Math.ceil(o.health / 20);
    const drops = Math.ceil((100 - o.dry) / 20);
    for (let i = 0; i < 5; i++) {
      const x = o.x + (i - 2) * 17;
      this.drawHeart(ctx, x, o.y - 62, i < hearts ? '#e0262a' : '#7a4a22');
      this.drawDrop(ctx, x, o.y - 44, i < drops ? '#2f9bf0' : '#1f3a5a');
    }
  }

  drawHeart(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(70,10,10,0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y + 5);
    ctx.bezierCurveTo(x - 9, y - 1, x - 5, y - 8, x, y - 3);
    ctx.bezierCurveTo(x + 5, y - 8, x + 9, y - 1, x, y + 5);
    ctx.fill();
    ctx.stroke();
  }

  drawDrop(ctx, x, y, color) {
    ctx.fillStyle = color || '#4aa3e8';
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.quadraticCurveTo(x + 6, y, x, y + 5);
    ctx.quadraticCurveTo(x - 6, y, x, y - 8);
    ctx.fill();
  }

  // --------------------------------------------------------------- hero

  heroAnimName() {
    const h = this.world.hero;
    if (h.act) return h.act.name;
    const held = h.held ? h.held.kind : 'spade';
    let carry = { box: 'box', seed: 'seed', watercan: 'watercan', fertilizer: 'box', house: 'box', tree: 'box', sprinkler: 'box' }[held];
    if (carry === 'watercan' && h.held.name === 'big_watercan') carry = 'big_watercan';   // the blue can has its own animations
    if (h.moving) {
      if (carry) return `hero_carry_${carry}${h.facing}`;
      return `hero_walk${h.facing}`;
    }
    if (carry) return `hero_idle_${carry}`;
    // occasionally blink to idle2
    return (Math.floor(this.t / 4) % 4 === 3) ? 'hero_idle2' : 'hero_idle1';
  }

  drawHero(ctx) {
    const w = this.world;
    const h = w.hero;
    const name = this.heroAnimName();
    const def = w.db.animations.get(name) || w.db.animations.get('hero_idle1');
    if (!def) return;
    const img = this.assets.image(def.props.texname, w.env);
    if (!img || !img.complete) return;
    const fs = def.props.frame_size || [64, 64];
    const start = def.props.start_frame || 0;
    const end = def.props.end_frame || start;
    const frames = end - start + 1;
    const dur = def.props.animation_time || 0.8;
    let idx;
    if (h.act) {
      idx = start + Math.min(frames - 1, Math.floor((h.act.t / h.act.dur) * frames));
    } else {
      idx = start + (Math.floor((this.t % dur) / dur * frames) % frames);
    }
    const delta = def.props.delta_pos || [0, 0];
    const dx = h.x - fs[0] / 2 + delta[0];
    // put the lowest opaque row of this very frame on the ground point
    const pad = footPad(img, fs[0], fs[1], idx);
    const dy = h.y + 4 - (fs[1] - pad);
    drawFrame(ctx, img, fs[0], fs[1], idx, dx, dy, fs[0], fs[1]);
    this.drawBoxContents(ctx, h);
    const held = h.held;
    if (held && held.def && !h.act) this.drawObjectBadge(ctx, held.kind, held.def, held.kind === 'seed' ? held.count : held.charges, h.x, h.y - 100);
  }

  /**
   * Water in a can / seeds in a packet (CWatercan `sub_423280`, packet `sub_420870`): while the object is highlighted
   * (the hero keeps the carried one highlighted, a lying one is highlighted by the mouse) it draws a 32x32 icon at
   * (-16, +48) above its position and the text " x<count>" (white, size 12) at (+16, +48). The can shows the drop
   * (icons.tga cell 27), a packet its `seed_icon_num`.
   */
  drawCountBadge(ctx, x, y, num, count) {
    // sub_405C50 takes the CENTRE of the icon: (-16, +48) for the icon and (+16, +48) for the centred text " x<n>"
    this.drawCell(ctx, num, x - 16, y - 48, 32, 1, false);
    ctx.save();
    ctx.font = 'bold 16px "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#1b2a52';
    ctx.fillStyle = '#fff';
    const text = ` x${count}`;
    ctx.strokeText(text, x + 16, y - 48);
    ctx.fillText(text, x + 16, y - 48);
    ctx.restore();
  }

  /** Cell `num` of the icon sheets (icons.tga 16x16 cells of 64 px; >= 256: icons_ex.tga) centred at (cx, cy). */
  drawCell(ctx, num, cx, cy, size, alpha, dim) {
    const big = num >= 256;
    const img = this.assets.image(big ? 'icons_ex.tga' : 'icons.tga');
    if (!img || !img.complete || !img.naturalWidth) return;
    const n = big ? num - 256 : num;
    ctx.save();
    ctx.globalAlpha = dim ? 0.63 * alpha : alpha;
    if (dim) ctx.filter = 'brightness(0.5)';   // colour 0xA0808080 for the not yet filled slots
    ctx.drawImage(img, (n % 16) * 64, Math.floor(n / 16) * 64, 64, 64, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  }

  /**
   * A box (CBox `sub_419B20`) that is highlighted (carried / under the mouse) draws `cap` 32px icons of its fruit,
   * 4 per row, centred 48 px above its position; the first `count` are bright, the rest dim.
   */
  drawFruitRow(ctx, x, y, num, cap, count) {
    const cols = 4;
    const rows = Math.ceil(cap / cols);
    for (let i = 0; i < cap; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = Math.min(cols, cap - r * cols);
      this.drawCell(ctx, num, x - (inRow * 32) / 2 + 16 + c * 32, y - 48 + r * 32, 32, 1, i >= count);
    }
    void rows;
  }

  /** Pile of fruit in/on a box: frame = base(type) + (full ? 8 : 0) + direction slot. */
  drawPile(ctx, num, full, k, cx, cy) {
    this.drawCell(ctx, PILE_BASE[num % 25] + (full ? 8 : 0) + k, cx, cy, 64, 1, false);
  }

  /** Badge of a can or seed packet (carried by the hero when `owner` is the hero's held item, or lying under the mouse). */
  drawObjectBadge(ctx, kind, def, count, x, y) {
    if (kind === 'watercan' && count !== undefined) this.drawCountBadge(ctx, x, y, 27, count);
    else if (kind === 'seed' && count !== undefined && def.props.seed_icon_num !== undefined) {
      this.drawCountBadge(ctx, x, y, def.props.seed_icon_num, count);
    }
  }

  /** The contents of a carried box: the pile on the hero (sub_41B470) and the icon row above him (sub_419B20). */
  drawBoxContents(ctx, h) {
    const held = h.held;
    if (!held || held.kind !== 'box' || !held.type || !(held.count > 0)) return;
    const num = this.fruitIconNum(held.type);
    if (num === undefined) return;
    const cap = 4;
    // the pile slot: index (14 - dir) % 8 while walking, 0 when standing (dword_483FDC)
    const k = h.moving ? (((6 - h.facing) % 8) + 8) % 8 : 0;
    this.drawPile(ctx, num, held.count >= cap, k, h.x + PILE_OFF[k][0], h.y - PILE_OFF[k][1]);
    if (!h.act) this.drawFruitRow(ctx, h.x, h.y - 100, num, cap, held.count);
  }

  fruitIconNum(type) {
    const def = this.world.db.objects.get(type);
    let num = def && (def.props.seed_icon_num !== undefined ? def.props.seed_icon_num : def.props.ready_icon_num);
    if (type === 'beehive') num = 24;
    return num;
  }

  drawShadow(ctx, x, y, r) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ----------------------------------------------------------- particles

  drawParticles(ctx) {
    for (const p of this.world.particles) {
      if (p.kind === 'fx') { this.drawFx(ctx, p); continue; }
      const k = p.t / p.life;
      ctx.globalAlpha = 1 - k;
      if (p.kind === 'sparkle') {
        ctx.fillStyle = p.color || '#fff';
        const r = 3 + 4 * (1 - k);
        star(ctx, p.x, p.y - k * 20, r, 5);
        ctx.fill();
      } else if (p.kind === 'dust') {
        ctx.fillStyle = '#b59a6a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 * (1 - k) + 1, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'drop') {
        ctx.fillStyle = '#4aa3e8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'text') {
        ctx.font = 'bold 16px Georgia';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#000';
        ctx.fillText(p.text, p.x + 1, p.y + 1);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Template particle: a cell of the 8x8 particle sheet, tinted, rotated, optionally additive. */
  drawFx(ctx, p) {
    const img = this.assets.image(p.tex, this.world.env);
    if (!img || !img.complete || p.size <= 0) return;
    const cell = img.naturalWidth / 8;
    const sx = (p.frame % 8) * cell, sy = Math.floor(p.frame / 8) * cell;
    if (!this._fxCv) { this._fxCv = document.createElement('canvas'); this._fxCtx = this._fxCv.getContext('2d'); }
    const cv = this._fxCv, c = this._fxCtx;
    if (cv.width !== cell) { cv.width = cell; cv.height = cell; }
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, cell, cell);
    c.drawImage(img, sx, sy, cell, cell, 0, 0, cell, cell);
    c.globalCompositeOperation = 'multiply';          // tint, then restore the sprite's own alpha
    c.fillStyle = `rgb(${p.c[0] | 0},${p.c[1] | 0},${p.c[2] | 0})`;
    c.fillRect(0, 0, cell, cell);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(img, sx, sy, cell, cell, 0, 0, cell, cell);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle * Math.PI / 180);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.c[3] / 255));
    if (p.blend) ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(cv, -p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }

  drawHints(ctx) {
    const w = this.world;
    for (const id of w.hintObjs) {
      const o = w.objects.find((x) => x.id === id);
      if (!o) continue;
      const bounce = Math.sin(this.t * 4) * 4;
      const y = o.y - o.size[1] / 2 - 26 + bounce;
      ctx.fillStyle = '#ffd75e';
      ctx.strokeStyle = '#7a5a10';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(o.x, y + 14);
      ctx.lineTo(o.x - 9, y);
      ctx.lineTo(o.x + 9, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------- helpers

const footCache = new Map();
/** Number of empty pixel rows below the lowest opaque pixel of one sprite-sheet frame. */
function footPad(img, fw, fh, index) {
  const key = img.src + '|' + index;
  if (footCache.has(key)) return footCache.get(key);
  let pad = 0;
  try {
    const cols = Math.max(1, Math.floor(img.naturalWidth / fw));
    const sx = (index % cols) * fw, sy = Math.floor(index / cols) * fh;
    const cv = document.createElement('canvas');
    cv.width = fw; cv.height = fh;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(img, sx, sy, fw, fh, 0, 0, fw, fh);
    const data = c.getImageData(0, 0, fw, fh).data;
    let last = fh - 1;
    for (; last >= 0; last--) {
      let hit = false;
      for (let x = 0; x < fw; x++) if (data[(last * fw + x) * 4 + 3] > 24) { hit = true; break; }
      if (hit) break;
    }
    pad = Math.max(0, fh - 1 - last);
  } catch (e) { pad = 0; }
  footCache.set(key, pad);
  return pad;
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function sortY(o) {
  const zb = o.def.props.zbase;
  if (zb) return o.y - zb[1];
  return o.y;
}

function baseY(o) {
  const bc = o.def.props.base_center;
  return o.y - (bc ? bc[1] : 0);
}

function drawFrame(ctx, img, fw, fh, index, dx, dy, dw, dh) {
  const cols = Math.max(1, Math.floor(img.naturalWidth / fw));
  const sx = (index % cols) * fw;
  const sy = Math.floor(index / cols) * fh;
  ctx.drawImage(img, sx, sy, fw, fh, dx, dy, dw, dh);
}

/**
 * Plant sheets (original CAnimationEl, sub_432210): a frame is exactly as large as the sprite element
 * (pumpkin 62x49), cols = floor(sheetWidth / frameWidth), and the frame's texture rectangle starts
 * 1 px right/below its grid cell: x = col*fw + 1 .. (col+1)*fw, y = row*fh + 1 .. (row+1)*fh.
 */
function drawPlantFrame(ctx, img, size, index, dx, dy) {
  const fw = Math.trunc(size[0]), fh = Math.trunc(size[1]);
  const cols = Math.max(1, Math.floor(img.naturalWidth / fw));
  const sx = (index % cols) * fw + 1;
  const sy = Math.floor(index / cols) * fh + 1;
  ctx.drawImage(img, sx, sy, fw - 1, fh - 1, dx, dy, size[0], size[1]);
}

function inferFrameSize(img, spriteW, spriteH, framesNeeded) {
  const key = `${img.src}|${spriteW}x${spriteH}|${framesNeeded}`;
  if (frameSizeCache.has(key)) return frameSizeCache.get(key);
  const cands = [16, 32, 48, 64, 96, 128, 256];
  let result = 32;
  for (const f of cands) {
    if (img.naturalWidth % f) continue;
    const cols = img.naturalWidth / f;
    const rows = Math.floor(img.naturalHeight / f);
    if (cols * rows >= framesNeeded && f >= Math.max(spriteW, spriteH) * 0.7) {
      result = f;
      break;
    }
  }
  frameSizeCache.set(key, result);
  return result;
}

function star(ctx, x, y, r, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
