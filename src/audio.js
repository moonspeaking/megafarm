// Sound and music playback.

export class AudioBank {
  constructor(assets) {
    this.assets = assets;
    this.cache = new Map();
    this.music = null;
    this.sfxVolume = 0.6;
    this.musicVolume = 0.35;
    this.sfxOn = true;
    this.musicOn = true;
  }

  play(name, volume) {
    if (!this.sfxOn) return;
    const path = this.assets.sound(name + '.ogg');
    if (!path) return;
    let a = this.cache.get(name);
    if (!a) {
      a = new Audio(path);
      a.preload = 'auto';
      this.cache.set(name, a);
    }
    try {
      a.currentTime = 0;
      a.volume = volume !== undefined ? volume : this.sfxVolume;
      a.play().catch(() => {});
    } catch (e) { /* ignore */ }
  }

  playMusic(name) {
    const path = this.assets.sound(name + '.ogg');
    if (!path) return;
    this.wantedMusic = name;
    if (!this.musicOn) return;
    if (this.music && this.music._name === name) {
      if (this.music.paused) this.music.play().catch(() => {});
      return;
    }
    if (this.music) { this.music.pause(); }
    const a = new Audio(path);
    a.loop = true;
    a.volume = this.musicVolume;
    a._name = name;
    a.play().catch(() => {});
    this.music = a;
  }

  setMusicEnabled(on) {
    this.musicOn = on;
    if (!on) { if (this.music) { this.music.pause(); this.music = null; } }
    else if (this.wantedMusic) this.playMusic(this.wantedMusic);
  }

  setSfxEnabled(on) { this.sfxOn = on; }

  stopMusic() {
    if (this.music) { this.music.pause(); this.music = null; }
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.music) this.music.volume = v;
  }

  setSfxVolume(v) { this.sfxVolume = v; }
}
