(function () {
  'use strict';
  const C = Towers.config;
  const seeded = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const surface = (width, height) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; };
  const path = (ctx, points, fill, stroke) => {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (fill) { ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  };

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.assets = new Towers.Textures();
      this.particles = new Towers.Particles();
      this.textures = new Map();
      this.recoil = 0;
      this.background = this.makeBackground();
      this.backdrop = null;
      this.cachedTrajectory = null;
      this.resize();
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas.parentElement);
      window.addEventListener('scroll', () => this.cacheBounds(), { passive: true });
    }

    cacheBounds() {
      const rect = this.canvas.getBoundingClientRect();
      this.left = rect.left;
      this.top = rect.top;
    }

    resize() {
      const bounds = this.canvas.getBoundingClientRect();
      this.left = bounds.left; this.top = bounds.top;
      this.pixelRatio = Towers.clamp(Math.sqrt(2800000 / Math.max(1, bounds.width * bounds.height)), 1, Math.min(window.devicePixelRatio || 1, 2));
      this.canvas.width = Math.round(bounds.width * this.pixelRatio);
      this.canvas.height = Math.round(bounds.height * this.pixelRatio);
      this.viewWidth = bounds.width;
      this.viewHeight = bounds.height;
      this.scale = Math.min(bounds.width / C.width, bounds.height / C.height);
      this.offsetX = (bounds.width - C.width * this.scale) / 2;
      this.offsetY = (bounds.height - C.height * this.scale) / 2;
      this.bakeBackdrop();
    }

    toWorld(clientX, clientY) {
      return { x: (clientX - this.left - this.offsetX) / this.scale, y: (clientY - this.top - this.offsetY) / this.scale };
    }

    bakeBackdrop() {
      const canvas = surface(this.canvas.width, this.canvas.height), ctx = canvas.getContext('2d');
      const ratio=this.pixelRatio;ctx.setTransform(ratio,0,0,ratio,0,0);
      const backdrop=ctx.createLinearGradient(0,0,0,this.viewHeight);
      backdrop.addColorStop(0,'#d1dcd8');backdrop.addColorStop(1,'#cdd3c6');
      ctx.fillStyle=backdrop;ctx.fillRect(0,0,this.viewWidth,this.viewHeight);
      if(this.offsetX>0){
        ctx.drawImage(this.background,0,0,1,C.height,0,this.offsetY,this.offsetX,C.height*this.scale);
        ctx.drawImage(this.background,C.width-1,0,1,C.height,this.viewWidth-this.offsetX,this.offsetY,this.offsetX,C.height*this.scale);
      }
      if(this.offsetY>0){
        ctx.drawImage(this.background,0,0,C.width,1,this.offsetX,0,C.width*this.scale,this.offsetY);
        ctx.fillStyle='#d0d5c8';ctx.fillRect(this.offsetX,this.viewHeight-this.offsetY,C.width*this.scale,this.offsetY);
      }
      ctx.drawImage(this.background,this.offsetX,this.offsetY,C.width*this.scale,C.height*this.scale);
      this.backdrop=canvas;
    }

    makeBackground() {
      const canvas = surface(C.width, C.height), ctx = canvas.getContext('2d'), rng = seeded(18482);
      const sky = ctx.createLinearGradient(0, 0, 0, C.ground);
      sky.addColorStop(0, '#d6dfdb'); sky.addColorStop(.6, '#e6e9df'); sky.addColorStop(1, '#c4cec4');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, C.width, C.height);
      const light = ctx.createRadialGradient(310, 145, 5, 310, 145, 650);
      light.addColorStop(0, '#ffffed60'); light.addColorStop(1, '#ffffed00');
      ctx.fillStyle = light; ctx.fillRect(0, 0, C.width, C.height);
      // Fine atmospheric bands and several irregular, increasingly sharp ridgelines.
      for(let i=0;i<155;i++){
        const x=rng()*C.width,y=70+rng()*410,w=18+rng()*170;
        ctx.fillStyle=rng()>.5?'#ffffff0d':'#8aa29b08';
        ctx.fillRect(x,y,w,.4+rng()*1.2);
      }
      const ridge=(base,large,small,color,phase)=>{
        ctx.beginPath();ctx.moveTo(0,C.ground);
        for(let x=0;x<=C.width;x+=8){
          const y=base+Math.sin(x/172+phase)*large+Math.sin(x/56+phase*2.7)*small+Math.sin(x/21+phase*.8)*small*.15;
          ctx.lineTo(x,y);
        }
        ctx.lineTo(C.width,C.ground);ctx.closePath();ctx.fillStyle=color;ctx.fill();
      };
      ridge(493,24,6,'#b4c2b966',.3);
      ridge(551,17,5,'#a7b8ac75',1.8);
      ridge(592,11,3,'#98ab9e55',3.2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#82978e28';
      for (let x = 30; x < C.width; x += 85) { ctx.beginPath(); ctx.moveTo(x, 620); ctx.lineTo(x, 575); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(0, 587); ctx.lineTo(C.width, 587); ctx.stroke();
      // A distant gantry and low industrial buildings keep the field quiet and readable.
      ctx.globalAlpha = .19;
      path(ctx, [[520,592],[520,540],[602,540],[602,510],[663,510],[663,592]], '#8c9c91');
      path(ctx, [[708,592],[708,562],[804,562],[804,592]], '#8c9c91');
      ctx.lineWidth = 3;
      path(ctx, [[650,535],[650,360],[765,360],[765,370],[571,370]], null, '#7f9389');
      path(ctx, [[650,360],[682,337],[765,360]], null, '#7f9389');
      path(ctx, [[744,370],[744,443]], null, '#7f9389');
      ctx.globalAlpha = 1;
      const ground = ctx.createLinearGradient(0, C.ground, 0, C.height);
      ground.addColorStop(0, '#a6b2a8'); ground.addColorStop(.06, '#bec6ba'); ground.addColorStop(1, '#d0d5c8');
      ctx.fillStyle = ground; ctx.fillRect(0, C.ground, C.width, C.height - C.ground);
      ctx.fillStyle = '#8d9c9060'; ctx.fillRect(0, C.ground, C.width, 2);
      ctx.fillStyle = '#eef0dc80'; ctx.fillRect(0, C.ground + 2, C.width, 1);
      ctx.lineWidth = 1;
      for (let x = -200; x < C.width; x += 205) path(ctx, [[x, C.ground+4],[x-70, C.height]], null, '#82938825');
      for (let i = 0; i < 2200; i++) {
        ctx.fillStyle = rng() > .5 ? '#f8fae91b' : '#506d5d13';
        ctx.fillRect(rng() * C.width, C.ground + rng() * 94, rng() * 3 + .5, 1);
      }
      // Ground markings, never shadows between floors.
      ctx.fillStyle = '#dae0cb';
      ctx.fillRect(C.zone.left, C.ground+8, C.zone.right-C.zone.left, 4);
      ctx.fillStyle = '#72887b';
      ctx.fillRect(C.zone.left, C.ground+4, 2, 16);
      ctx.fillRect(C.zone.right-2, C.ground+4, 2, 16);
      ctx.fillStyle = '#dae0cb';
      ctx.fillRect(77, C.ground+8, 226, 4);
      ctx.font = '11px Segoe UI'; ctx.fillStyle = '#667c6b';
      ctx.fillText('ПОЗИЦИЯ 01', 100, 704); ctx.fillText('ЗОНА ИСПЫТАНИЙ', C.zone.left+67, 704);
      ctx.setLineDash([4, 8]); ctx.strokeStyle = '#778d7950';
      ctx.beginPath(); ctx.moveTo(348, 704); ctx.lineTo(884, 704); ctx.stroke(); ctx.setLineDash([]);
      return canvas;
    }

    prepare(floors) {
      this.textures.clear(); this.assets.clearFaces(); this.particles.clear();
      this.towerFade = 0;
      for (const floor of floors) this.textures.set(floor.id, this.assets.block(floor));
    }

    effect(effect) { this.particles.spawn(effect); }

    drawCannon(angle, elapsed) {
      const ctx=this.ctx;
      this.recoil=Math.max(0,this.recoil-elapsed*38);
      ctx.save();ctx.translate(C.cannon.x-this.recoil*.3,C.cannon.y);
      ctx.drawImage(this.assets.cannon,-140,-67,280,135);
      ctx.save();ctx.rotate(angle);ctx.translate(-this.recoil,0);
      ctx.drawImage(this.assets.barrel,-31,-25,128,50);
      ctx.restore();ctx.restore();
    }

    drawProjectile(projectile) {
      const {x,y}=projectile.body.position,r=projectile.radius;
      const image=this.assets.projectiles.get(projectile.type), size=r*2+4;
      this.ctx.save();this.ctx.translate(x,y);this.ctx.rotate(projectile.body.angle);
      this.ctx.drawImage(image,-r-2,-r-2,size,size);
      this.ctx.restore();
    }

    draw(game, elapsed) {
      const ctx=this.ctx,dpr=this.pixelRatio;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.drawImage(this.backdrop,0,0);
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.translate(this.offsetX,this.offsetY);ctx.scale(this.scale,this.scale);
      if(game.state==='ready'&&!game.hasFired){
        ctx.font='11px Segoe UI';ctx.fillStyle='#71847c';ctx.textAlign='center';
        ctx.fillText('РАЗРУШЕНИЕ · КРЕН 45° · ВЫЛЕТ ЗА ГРАНИЦЫ = ЭТАЖ ВЫВЕДЕН ИЗ СТРОЯ',770,73);
        ctx.textAlign='left';
      }
      for(const floor of game.physics.floors){
        if(floor.destroyed)continue;
        ctx.save();ctx.translate(floor.body.position.x,floor.body.position.y);ctx.rotate(floor.body.angle);
        ctx.globalAlpha=Math.min(1,game.physics.time/.55);
        ctx.drawImage(this.textures.get(floor.id),-floor.width/2,-floor.height/2,floor.width,floor.height);
        ctx.restore();
      }
      if(game.aim&&game.aim.valid){
        const key=`${game.selected}:${game.angle.toFixed(3)}:${game.power.toFixed(2)}`;
        if(!this.cachedTrajectory||this.cachedTrajectory.key!==key){
          this.cachedTrajectory={key,points:game.physics.trajectory(game.selected,game.angle,game.power)};
        }
        const points=this.cachedTrajectory.points;
        points.forEach((point,i)=>{
          ctx.fillStyle=`rgba(44,68,64,${.76*(1-i/points.length)+.1})`;
          ctx.beginPath();ctx.arc(point.x,point.y,i%4===0?3:2,0,Math.PI*2);ctx.fill();
        });
        const {start,current}=game.aim;
        ctx.strokeStyle='#46645f9e';ctx.lineWidth=1.5;
        ctx.beginPath();ctx.arc(start.x,start.y,5,0,Math.PI*2);ctx.stroke();
        ctx.setLineDash([5,5]);path(ctx,[[start.x,start.y],[current.x,current.y]],null,'#4c675e9b');ctx.setLineDash([]);
        ctx.fillStyle='#354e47';ctx.font='12px Segoe UI';
        ctx.fillText(`СИЛА ${Math.round((game.power-10)/23*100)}%`,C.cannon.x-32,C.cannon.y-83);
      }
      this.drawCannon(game.angle,elapsed);
      for(const projectile of game.physics.projectiles)this.drawProjectile(projectile);
      this.particles.update(elapsed);
      this.particles.draw(ctx);
    }
  }
  Towers.Renderer=Renderer;
})();
