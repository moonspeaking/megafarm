// Comics player, driven by interfaces/comics.txt (13 pages: one per level plus the finale).
//
// Behaviour (observed in the original):
//  * every frame flies in (start_point/angle/size/alpha -> end_point); frames are shaped by the alpha of
//    the page texture;
//  * a frame's first balloon shows when it lands, every click shows the next balloon (one at a time) and
//    after the last balloon of the frame the next frame flies in;
//  * balloon `pos` is the tip of its arrow, the 276px wide box sits 13px away from it;
//  * after the last balloon the "continue" arrow appears; the skip button jumps straight there.

const FRAME_MS = 700;

export class Comics {
  constructor({ container, assets, db, audio }) {
    this.assets = assets;
    this.db = db;
    this.audio = audio;
    this.root = document.createElement('div');
    this.root.className = 'comics hidden';
    container.appendChild(this.root);
    this.active = false;
  }

  tex(name) {
    const key = this.assets.resolve(name);
    return key ? this.assets.manifest.textures[key] : '';
  }

  pages() {
    if (this._pages) return this._pages;
    const iface = this.db.interfaces.get('comics');
    const book = iface && iface.children.find((c) => c.type === 'comics');
    this._pages = book ? book.children.filter((c) => c.type === 'simple_comicspage') : [];
    return this._pages;
  }

  /** Play page `index` (0-based). `onDone` runs when the player leaves the comics. */
  play(index, onDone) {
    const page = this.pages()[index];
    if (!page) { if (onDone) onDone(); return; }
    this.active = true;
    this.onDone = onDone;
    this.root.innerHTML = '';
    this.root.classList.remove('hidden');
    this.audio.playMusic('music_comics');

    const bg = el('div', 'comics_bg', this.root);
    bg.style.backgroundImage = `url('${this.tex('comics1.jpg')}')`;
    this.stage = el('div', 'comics_stage', this.root);
    this.texUrl = this.tex(page.props.tex_name);

    // flatten into steps: each frame, then its balloons
    this.frames = page.children.filter((c) => c.type === 'simple_comicframe');
    this.fi = -1; // current frame
    this.bi = -1; // current balloon in frame
    this.busy = false;
    this.done = false;
    this.layers = [];

    this.skipBtn = el('div', 'comics_btn comics_skip', this.root);
    this.skipBtn.style.backgroundImage = `url('${this.tex('gui/skip_right')}')`;
    this.skipBtn.addEventListener('click', (e) => { e.stopPropagation(); this.skip(); });
    this.backBtn = el('div', 'comics_btn comics_back hidden', this.root);
    this.backBtn.style.backgroundImage = `url('${this.tex('gui/arrow_right')}')`;
    this.backBtn.addEventListener('click', (e) => { e.stopPropagation(); this.close(); });

    this.root.onclick = () => this.advance();
    this.keyHandler = (e) => {
      if (!this.active) return;
      if (e.key === 'Escape') { e.stopPropagation(); this.done ? this.close() : this.skip(); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.done ? this.close() : this.advance(); }
    };
    window.addEventListener('keydown', this.keyHandler, true);
    this.advance();
  }

  advance() {
    if (!this.active || this.done || this.busy) return;
    const f = this.frames[this.fi];
    // next balloon of the current frame
    if (f) {
      const balloons = f.children.filter((c) => c.type === 'simple_balloon');
      if (this.bi + 1 < balloons.length) {
        this.bi++;
        this.showBalloon(balloons[this.bi]);
        return;
      }
    }
    this.clearBalloon();
    // next frame
    if (this.fi + 1 < this.frames.length) {
      this.fi++;
      this.bi = -1;
      this.flyIn(this.frames[this.fi]);
      return;
    }
    this.finish();
  }

  flyIn(f) {
    const p = f.props;
    const [w, h] = p.size || [0, 0];
    const showBalloon = () => {
      this.busy = false;
      const balloons = f.children.filter((c) => c.type === 'simple_balloon');
      if (balloons.length) { this.bi = 0; this.showBalloon(balloons[0]); } else this.advance();
    };
    if (!w || !h) { showBalloon(); return; }
    const [u0, v0] = p.texcoord;
    const [ex, ey] = p.end_point;
    const [sx, sy] = p.start_point;
    const d = el('div', 'comics_frame', this.stage);
    Object.assign(d.style, {
      left: `${ex}px`, top: `${ey}px`, width: `${w}px`, height: `${h}px`,
      backgroundImage: `url('${this.texUrl}')`, backgroundPosition: `-${u0}px -${v0}px`,
    });
    this.layers.push(d);
    this.busy = true;
    this.audio.play('selectmenu', 0.3);
    const from = `translate(${sx - ex}px, ${sy - ey}px) rotate(${p.start_angle || 0}deg) scale(${p.start_size || 1})`;
    const a = d.animate(
      [{ transform: from, opacity: p.start_alpha ?? 0 }, { transform: 'none', opacity: 1 }],
      { duration: FRAME_MS, easing: 'ease-out', fill: 'forwards' },
    );
    a.onfinish = () => { if (this.active) showBalloon(); };
  }

  showBalloon(b) {
    this.clearBalloon();
    const text = this.db.t(b.props.text_key, b.props.text_key);
    const [x, y] = b.props.pos;
    const dir = b.props.arrow_pos || 'lu';
    const box = el('div', 'comics_balloon', this.stage);
    const t = el('div', 'comics_text', box, text);
    void t;
    // measure, then place relative to the arrow tip
    box.style.visibility = 'hidden';
    const w = box.offsetWidth, h = box.offsetHeight;
    const left = dir[0] === 'l' ? x + 13 : x - 13 - w;
    const top = dir[1] === 'u' ? y + 13 : y - 13 - h;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.visibility = '';
    this.balloons = [box];
    if (!b.props.hidden_arrow) {
      const names = { lu: 'left_up', ru: 'right_up', ld: 'left_down', rd: 'right_down' };
      const arrow = el('div', 'comics_arrow', this.stage);
      arrow.style.backgroundImage = `url('${this.tex('gui/' + names[dir] + '_arrow_balloon')}')`;
      arrow.style.left = `${dir[0] === 'l' ? x : x - 32}px`;
      arrow.style.top = `${dir[1] === 'u' ? y : y - 32}px`;
      this.balloons.push(arrow);
    }
    box.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 160 });
  }

  clearBalloon() {
    for (const b of this.balloons || []) b.remove();
    this.balloons = [];
  }

  skip() {
    if (!this.active || this.done) return;
    this.clearBalloon();
    for (let i = this.fi + 1; i < this.frames.length; i++) {
      this.fi = i;
      const p = this.frames[i].props;
      const [w, h] = p.size || [0, 0];
      if (!w || !h) continue;
      const d = el('div', 'comics_frame', this.stage);
      Object.assign(d.style, {
        left: `${p.end_point[0]}px`, top: `${p.end_point[1]}px`, width: `${w}px`, height: `${h}px`,
        backgroundImage: `url('${this.texUrl}')`, backgroundPosition: `-${p.texcoord[0]}px -${p.texcoord[1]}px`,
      });
    }
    for (const l of this.layers) l.getAnimations().forEach((a) => a.finish());
    this.finish();
  }

  finish() {
    this.done = true;
    this.busy = false;
    this.clearBalloon();
    this.skipBtn.classList.add('hidden');
    this.backBtn.classList.remove('hidden');
  }

  close() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('keydown', this.keyHandler, true);
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
    const cb = this.onDone;
    this.onDone = null;
    if (cb) cb();
  }
}

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
