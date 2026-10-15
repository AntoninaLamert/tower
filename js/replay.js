(function () {
  'use strict';
  // Fixed-size positional history. Playback never advances or modifies Matter bodies.
  class Replay {
    constructor() {
      this.frames = [];
      this.clip = null;
      this.playing = false;
      this.playhead = 0;
      this.lastSample = -1;
    }

    newTower() {
      this.frames = [];
      this.lastSample = -1;
    }

    clear() {
      this.newTower();
      this.clip = null;
      this.playing = false;
    }

    capture(physics, angle) {
      if (physics.time - this.lastSample < 1 / 30) return;
      this.lastSample = physics.time;
      const snapshot = {
        time: physics.time,
        angle,
        floors: physics.floors.map(floor => ({ id: floor.id, x: floor.body.position.x,
          y: floor.body.position.y, angle: floor.body.angle, destroyed: floor.destroyed,
          target: !!floor.target })),
        barrels: physics.barrels.filter(barrel => !barrel.exploded).map(barrel => ({
          x: barrel.body.position.x, y: barrel.body.position.y, angle: barrel.floor.body.angle })),
        supports: physics.supports.map(body => ({ x: body.position.x, y: body.position.y })),
        cargo: physics.cargo && !physics.cargo.broken ?
          { x: physics.cargo.body.position.x, y: physics.cargo.body.position.y } : null,
        walls: physics.walls.filter(wall => !wall.destroyed).map(wall => ({
          x: wall.body.position.x, y: wall.body.position.y, angle: wall.body.angle,
          width: wall.width, height: wall.height, seed: wall.seed })),
        movers: physics.movers.map(mover => ({
          x: mover.body.position.x, y: mover.body.position.y, width: mover.width })),
        projectiles: physics.projectiles.filter(shot => !shot.removed).map(shot => ({
          x: shot.body.position.x, y: shot.body.position.y, angle: shot.body.angle,
          radius: shot.radius, type: shot.type }))
      };
      this.frames.push(snapshot);
      while (this.frames.length > 180 || (this.frames.length > 1 && physics.time - this.frames[0].time > 6)) this.frames.shift();
    }

    offer(renderer, since) {
      const frames = this.frames.filter(frame => frame.time >= since);
      if (frames.length < 10) return false;
      this.clip = { frames, images: new Map(renderer.textures), wallImages: new Map(renderer.wallTextures) };
      return true;
    }

    start() {
      if (!this.clip || this.clip.frames.length < 2) return false;
      this.playing = true;
      this.playhead = 0;
      return true;
    }

    stop() { this.playing = false; }

    advance(elapsed) {
      if (!this.playing) return null;
      this.playhead += elapsed * .45;
      const frames = this.clip.frames, start = frames[0].time;
      let low = 0, high = frames.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (frames[mid].time - start <= this.playhead) low = mid;
        else high = mid - 1;
      }
      const progress = Math.min(1, this.playhead / Math.max(.01, frames[frames.length - 1].time - start));
      if (progress >= 1) this.playing = false;
      return { frame: frames[low], images: this.clip.images, wallImages: this.clip.wallImages, progress };
    }
  }
  Towers.Replay = Replay;
})();
