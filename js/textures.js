(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const tileWidth = 256, tileHeight = 128;
  const makeCanvas = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
    return canvas;
  };
  const seeded = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const palettes = {
    wood: [
      ['#a88159', '#8e6946', '#c4a47c'], ['#9e7957', '#816144', '#b99a75'],
      ['#aa8965', '#8f7154', '#c6ad8c'], ['#967350', '#795a3e', '#b29570']
    ],
    concrete: [
      ['#a3aaa5', '#818a87', '#c0c6be'], ['#9ba5a3', '#7e8987', '#bdc7c3'],
      ['#a9aaa2', '#898e86', '#c7c7b9'], ['#969f9b', '#737f7a', '#b8c0b6']
    ],
    glass: [
      ['#c8e6e9', '#669aa6', '#f4ffff'], ['#bedde2', '#568996', '#e9fafc'],
      ['#d0e8e8', '#6b9ca1', '#f4ffff'], ['#bddce5', '#5d8eaa', '#f1ffff']
    ]
  };

  class Textures {
    constructor() {
      this.tiles = new Map();
      this.faces = new Map();
      this.projectiles = new Map();
      this.cannon = this.makeCannon();
      this.barrel = this.makeBarrel();
      for (const material of ['wood', 'concrete', 'glass']) {
        for (let variant = 0; variant < 4; variant++) this.tiles.set(`${material}:${variant}`, this.makeTile(material, variant));
      }
      for (const type of ['normal', 'heavy', 'explosive', 'cluster', 'sticky', 'fragment']) this.projectiles.set(type, this.makeProjectile(type));
      this.barrel = this.makeBarrel();
    }

    makeTile(material, variant) {
      const canvas = makeCanvas(tileWidth * 2, tileHeight * 2);
      const ctx = canvas.getContext('2d'); ctx.scale(2, 2);
      const rng = seeded(73313 + variant * 1019 + material.length * 5177);
      const [base, dark, light] = palettes[material][variant];
      if (material === 'wood') {
        const wash = ctx.createLinearGradient(0, 0, 0, tileHeight);
        wash.addColorStop(0, light); wash.addColorStop(.24, base); wash.addColorStop(.69, base); wash.addColorStop(1, dark);
        ctx.fillStyle = wash; ctx.fillRect(0, 0, tileWidth, tileHeight);
        for (let band = 0; band < 68; band++) {
          const y = band * 1.9 + (rng() - .5) * 1.5;
          const amp = .25 + rng() * 1.3, phase = rng() * TAU;
          ctx.beginPath(); ctx.lineWidth = .25 + rng() * 1.15;
          ctx.strokeStyle = rng() < .55 ? '#3e30252a' : '#fbdfb83a';
          for (let x = 0; x <= tileWidth; x += 4) {
            const yy = y + Math.sin(x / tileWidth * TAU + phase) * amp * Math.sin(x / tileWidth * Math.PI);
            x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
          }
          ctx.stroke();
        }
        for (let i = 0; i < 55; i++) {
          const x = rng() * tileWidth, y = rng() * tileHeight;
          ctx.strokeStyle = rng() > .5 ? '#eee0bc2b' : '#3a30292b'; ctx.lineWidth = .55;
          ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x + 3 + rng() * 22, y + (rng() - .5) * 1.5); ctx.stroke();
        }
      } else if (material === 'concrete') {
        const wash = ctx.createLinearGradient(0, 0, 0, tileHeight);
        wash.addColorStop(0, light); wash.addColorStop(.37, base); wash.addColorStop(1, dark);
        ctx.fillStyle = wash; ctx.fillRect(0, 0, tileWidth, tileHeight);
        for (let i = 0; i < 4500; i++) {
          const size = rng() < .92 ? .25 + rng() * 1.1 : 1.2 + rng() * 2;
          const x = rng() * tileWidth, y = rng() * tileHeight;
          ctx.fillStyle = rng() < .46 ? '#26332c35' : '#f7faf047';
          if (rng() < .27) { ctx.beginPath(); ctx.ellipse(x,y,size*1.3,size*.63,rng()*TAU,0,TAU); ctx.fill(); }
          else ctx.fillRect(x,y,size,size*.7);
        }
        for (let i = 0; i < 20; i++) {
          const x = rng()*tileWidth, y=rng()*tileHeight, length=2+rng()*11;
          ctx.strokeStyle=rng()<.5?'#3d4d4642':'#e8e9d850';ctx.lineWidth=.3+rng()*.7;
          ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+length,y+(rng()-.5)*2);ctx.stroke();
        }
      } else {
        // The tile is intentionally translucent; the scenery remains visible through every pane.
        ctx.fillStyle = variant % 2 ? '#a7d4dc30' : '#b7e0e036';
        ctx.fillRect(0, 0, tileWidth, tileHeight);
        const reflection = ctx.createLinearGradient(0, 0, tileWidth, tileHeight);
        reflection.addColorStop(0,'#ffffff00');reflection.addColorStop(.27,'#eaffff2c');
        reflection.addColorStop(.34,'#ffffff0b');reflection.addColorStop(.65,'#4f82910d');reflection.addColorStop(1,'#ffffff00');
        ctx.fillStyle=reflection;ctx.fillRect(0,0,tileWidth,tileHeight);
        for(let i=0;i<4;i++){
          const x=18+i*51+rng()*19;
          ctx.strokeStyle=i%2?'#f7ffff34':'#477f8f20';ctx.lineWidth=.5+rng()*2;
          ctx.beginPath();ctx.moveTo(x,-2);ctx.lineTo(x+tileHeight*.42,tileHeight+2);ctx.stroke();
        }
      }
      return canvas;
    }

    // Each body gets a stable baked face. Shared 256px material tiles keep detail at fixed scale.
    block(floor) {
      const variant = floor.seed % 4;
      const key = `${floor.material}:${variant}:${floor.width}:${floor.height}:${floor.seed}`;
      if (this.faces.has(key)) return this.faces.get(key);
      const w = floor.width, h = floor.height, material = floor.material;
      const canvas = makeCanvas(w * 2, h * 2), ctx = canvas.getContext('2d'); ctx.scale(2, 2);
      const rng = seeded(floor.seed + 41), tile = this.tiles.get(`${material}:${variant}`);
      const pattern = ctx.createPattern(tile, 'repeat');
      const face = ctx.createPattern(tile, 'repeat');
      pattern.setTransform(new DOMMatrix().scale(.5));
      face.setTransform(new DOMMatrix().scale(.5));
      if (material === 'glass') {
        // Refraction is a translucent geometric layer, never an opaque blue fill.
        ctx.fillStyle = pattern; ctx.fillRect(0,0,w,h);
        const tint=ctx.createLinearGradient(0,0,w,h);
        tint.addColorStop(0,'#e8ffff0a');tint.addColorStop(.5,'#5e9ba416');tint.addColorStop(1,'#e4faff06');
        ctx.fillStyle=tint;ctx.fillRect(0,0,w,h);
        for(let i=0;i<2;i++){
          const x=12+rng()*(w-65), slope=14+rng()*25;
          ctx.beginPath();ctx.moveTo(x,2);ctx.lineTo(x+5,2);ctx.lineTo(x+5+slope,h-2);ctx.lineTo(x+slope,h-2);ctx.closePath();
          ctx.fillStyle='#f8ffff35';ctx.fill();
        }
        const side=ctx.createLinearGradient(w-11,0,w,0);
        side.addColorStop(0,'#7eb4c333');side.addColorStop(.58,'#3e82948c');side.addColorStop(1,'#dff9f9ae');
        ctx.fillStyle=side;ctx.fillRect(w-11,1,11,h-2);
        ctx.fillStyle='#f8ffffa6';ctx.fillRect(1,1,w-2,2);
        ctx.fillStyle='#5b94a67a';ctx.fillRect(1,h-7,w-2,6);
        ctx.fillStyle='#e9ffff88';ctx.fillRect(2,h-7,w-4,1);
        ctx.strokeStyle='#d9f8fbaf';ctx.lineWidth=1;ctx.strokeRect(1.5,1.5,w-3,h-3);
      } else {
        ctx.fillStyle=face;ctx.fillRect(0,0,w,h);
        if(material==='wood'){
          // Knot rings and fine checks vary per slab, on top of the reusable long-grain tile.
          for(let k=0;k<1+(floor.seed%2);k++){
            const x=28+rng()*(w-56), y=10+rng()*(h-20), radius=3+rng()*3;
            ctx.fillStyle='#4c332747';ctx.beginPath();ctx.ellipse(x,y,radius*2.2,radius*.64,-.06,0,TAU);ctx.fill();
            for(let ring=1;ring<5;ring++){
              ctx.beginPath();ctx.ellipse(x,y,(radius+ring*2.5)*2.2,(radius+ring*1.8)*.66,-.06,0,TAU);
              ctx.strokeStyle=ring%2?'#4d37243a':'#e8d2ad54';ctx.lineWidth=.6;ctx.stroke();
            }
          }
          for(let i=0;i<4;i++){
            const x=16+rng()*(w-32), y=3+rng()*(h-8);
            ctx.strokeStyle='#3d302532';ctx.lineWidth=.55;
            ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+9+rng()*15,y+(rng()-.5)*2);ctx.stroke();
          }
          // Both end-grain faces have concentric, vertical-ish growth structure.
          for(const left of [true,false]){
            const sx=left?0:w-10;
            ctx.fillStyle=left?'#74593d44':'#5c452f58';ctx.fillRect(sx,2,10,h-4);
            for(let i=1;i<10;i++){
              ctx.strokeStyle=i%2?'#dcc29b65':'#34271e35';ctx.lineWidth=.7;
              ctx.beginPath();ctx.moveTo(sx+i,2);
              for(let y=2;y<h-2;y+=5)ctx.lineTo(sx+i+Math.sin(y/8+i)*.75,y);
              ctx.stroke();
            }
            ctx.fillStyle='#efe0bd39';ctx.fillRect(left?sx:sx+8,2,2,h-4);
          }
          ctx.fillStyle='#f0d4a347';ctx.fillRect(10,0,w-20,2.3);
          ctx.fillStyle='#3b2e243b';ctx.fillRect(10,h-4,w-20,4);
        } else {
          const top=ctx.createLinearGradient(0,0,0,8);
          top.addColorStop(0,'#e3e6d796');top.addColorStop(1,'#a6b2ab28');
          ctx.fillStyle=top;ctx.fillRect(0,0,w,8);
          ctx.fillStyle='#47544e54';ctx.fillRect(0,h-6,w,6);
          const edge=ctx.createLinearGradient(w-13,0,w,0);
          edge.addColorStop(0,'#69777224');edge.addColorStop(1,'#4b59557d');
          ctx.fillStyle=edge;ctx.fillRect(w-13,1,13,h-2);
          ctx.fillStyle='#e1e5d066';ctx.fillRect(w-12,1,1,h-3);
          for(let i=0;i<2+floor.seed%3;i++){
            const x=10+rng()*(w-20), y=10+rng()*(h-20), extent=3+rng()*7;
            ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+extent,y-1-rng()*2);ctx.lineTo(x+extent*.72,y+2);
            ctx.strokeStyle='#4d595437';ctx.lineWidth=.7;ctx.stroke();
          }
          // Tiny angular edge losses leave the Matter rectangle untouched.
          for(let i=0;i<5;i++){
            const x=3+rng()*(w-6), y=rng()<.5?0:h-2;
            ctx.fillStyle=y===0?'#64716d4f':'#c2c7ba62';
            ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+2+rng()*3,y);ctx.lineTo(x+1,y+(y===0?2:-2));ctx.fill();
          }
        }
      }
      this.faces.set(key,canvas);
      return canvas;
    }

    clearFaces() { this.faces.clear(); }

    makeProjectile(type) {
      const radius = Towers.config.ammo[type].radius, size=radius*2+4;
      const canvas=makeCanvas(size*2,size*2),ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.translate(radius+2,radius+2);
      const colors=type==='normal'||type==='fragment'?['#c3cac7','#697a7b','#223941']:
        type==='heavy'?['#a2a8a3','#4b5556','#17282c']:
        type==='cluster'?['#b8c4c4','#627c7e','#253e46']:
        type==='sticky'?['#c2bb9b','#716d58','#282e2e']:['#e3cc9c','#8c7048','#2f3433'];
      const steel=ctx.createRadialGradient(-radius*.38,-radius*.45,1,0,0,radius);
      steel.addColorStop(0,colors[0]);steel.addColorStop(.3,colors[1]);steel.addColorStop(1,colors[2]);
      ctx.fillStyle=steel;ctx.beginPath();ctx.arc(0,0,radius,0,TAU);ctx.fill();
      ctx.strokeStyle='#e4ebe590';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,radius-1,-2.55,-.5);ctx.stroke();
      if(type==='heavy'){
        ctx.strokeStyle='#d2d5c398';ctx.lineWidth=2.1;
        ctx.beginPath();ctx.ellipse(0,0,radius*.5,radius-2,-.22,0,TAU);ctx.stroke();
        for(let a=0;a<TAU;a+=TAU/6){ctx.fillStyle='#afb7ae';ctx.beginPath();ctx.arc(Math.cos(a)*radius*.68,Math.sin(a)*radius*.68,1.25,0,TAU);ctx.fill();}
      } else if(type==='explosive'||type==='sticky'){
        ctx.strokeStyle='#3d4b49';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,0,radius*.53,radius-2,-.3,0,TAU);ctx.stroke();
        ctx.fillStyle='#e0b974';ctx.fillRect(-radius*.2,-radius*.83,radius*.42,2.2);
        if(type==='sticky'){
          ctx.fillStyle='#d35d4d';ctx.beginPath();ctx.arc(0,0,radius*.24,0,TAU);ctx.fill();
          ctx.strokeStyle='#bfc7ac';ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(0,0,radius*.64,.3,2.8);ctx.stroke();
        }
      } else if(type==='cluster'){
        for(const [x,y] of [[-4,-3],[4,-2],[0,5]]){
          ctx.fillStyle='#d7e1d8';ctx.beginPath();ctx.arc(x,y,2.2,0,TAU);ctx.fill();
        }
      } else {
        ctx.strokeStyle='#2e464c75';ctx.lineWidth=.75;ctx.beginPath();ctx.arc(0,0,radius-3,.35,2.8);ctx.stroke();
      }
      return canvas;
    }

    makeBarrel() {
      const canvas=makeCanvas(76,82),ctx=canvas.getContext('2d');
      ctx.scale(2,2);
      const metal=ctx.createLinearGradient(3,0,35,0);
      metal.addColorStop(0,'#492e28');metal.addColorStop(.2,'#ad5140');
      metal.addColorStop(.5,'#b95c48');metal.addColorStop(.8,'#6e302a');metal.addColorStop(1,'#322d2c');
      ctx.fillStyle=metal;ctx.beginPath();ctx.roundRect(4,4,30,34,5);ctx.fill();
      ctx.strokeStyle='#d19168';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(19,5,14,3,0,0,TAU);ctx.stroke();
      ctx.fillStyle='#283431';ctx.fillRect(4,10,30,3);ctx.fillRect(4,30,30,4);
      ctx.fillStyle='#d9ad7b';ctx.font='bold 12px Segoe UI';ctx.textAlign='center';ctx.fillText('⚠',19,26);
      ctx.strokeStyle='#301f1d';ctx.lineWidth=1;ctx.strokeRect(5,5,28,32);
      return canvas;
    }

    makeCannon() {
      const canvas=makeCanvas(280*2,135*2),ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.translate(140,67);
      // Static carriage, iron rim and spoke details are baked once.
      ctx.fillStyle='#3a4540';ctx.beginPath();ctx.moveTo(-75,27);ctx.lineTo(-32,-10);ctx.lineTo(13,-9);ctx.lineTo(73,30);ctx.lineTo(73,38);ctx.lineTo(-75,38);ctx.fill();
      ctx.fillStyle='#7b8576';ctx.beginPath();ctx.moveTo(-58,27);ctx.lineTo(-24,-4);ctx.lineTo(-10,-4);ctx.lineTo(-40,27);ctx.fill();
      ctx.fillStyle='#596761';ctx.fillRect(-75,31,151,10);
      for(const x of [-39,42]){
        const wheel=ctx.createRadialGradient(x-7,15,2,x,23,27);
        wheel.addColorStop(0,'#b1b9ac');wheel.addColorStop(.34,'#606f69');wheel.addColorStop(.72,'#273832');wheel.addColorStop(.84,'#75827b');wheel.addColorStop(1,'#172924');
        ctx.fillStyle=wheel;ctx.beginPath();ctx.arc(x,23,27,0,TAU);ctx.fill();
        ctx.strokeStyle='#b2bbb0';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(x,23,19,0,TAU);ctx.stroke();
        for(let i=0;i<10;i++){
          const a=i*TAU/10;ctx.strokeStyle=i%2?'#9faa9b':'#4e5e58';ctx.lineWidth=2.1;
          ctx.beginPath();ctx.moveTo(x+Math.cos(a)*7,23+Math.sin(a)*7);ctx.lineTo(x+Math.cos(a)*18,23+Math.sin(a)*18);ctx.stroke();
        }
        ctx.fillStyle='#bcc4b8';ctx.beginPath();ctx.arc(x,23,7,0,TAU);ctx.fill();
        ctx.fillStyle='#344940';ctx.beginPath();ctx.arc(x,23,3.4,0,TAU);ctx.fill();
      }
      for(let i=0;i<17;i++){
        const x=-65+(i*37)%125,y=28+(i*13)%10;
        ctx.strokeStyle=i%2?'#a3aea31c':'#0c242623';ctx.lineWidth=.6;
        ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+4,y);ctx.stroke();
      }
      return canvas;
    }

    makeBarrel() {
      const canvas=makeCanvas(128*2,50*2),ctx=canvas.getContext('2d');
      ctx.scale(2,2);ctx.translate(31,25);
      const metal=ctx.createLinearGradient(0,-19,0,19);
      metal.addColorStop(0,'#253942');metal.addColorStop(.16,'#6a7d80');
      metal.addColorStop(.31,'#c0cbc5');metal.addColorStop(.43,'#8c9d9b');
      metal.addColorStop(.73,'#51676b');metal.addColorStop(1,'#23383f');
      ctx.fillStyle=metal;ctx.beginPath();ctx.roundRect(-30,-19,112,38,[15,3,3,15]);ctx.fill();
      ctx.strokeStyle='#d7e0d1a1';ctx.lineWidth=.8;
      ctx.beginPath();ctx.moveTo(-14,-12);ctx.lineTo(67,-12);ctx.stroke();
      for(let i=0;i<17;i++){
        const x=-22+(i*43)%91,y=-11+(i*13)%21;
        ctx.strokeStyle=i%2?'#d1d9cf3d':'#152b323b';ctx.lineWidth=.65;
        ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+2+i%4,y+.3);ctx.stroke();
      }
      const band=ctx.createLinearGradient(0,-22,0,22);
      band.addColorStop(0,'#1e3339');band.addColorStop(.28,'#8f9e98');band.addColorStop(.58,'#647779');band.addColorStop(1,'#203840');
      ctx.fillStyle=band;ctx.fillRect(66,-22,12,44);
      ctx.fillStyle='#c8d4c1';ctx.fillRect(68,-20,1.4,40);
      ctx.fillStyle='#193039';ctx.beginPath();ctx.ellipse(82,0,4.5,17.5,0,0,TAU);ctx.fill();
      ctx.strokeStyle='#9baba6';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(81.5,0,4.7,17.5,0,0,TAU);ctx.stroke();
      ctx.fillStyle='#111e24';ctx.beginPath();ctx.ellipse(81.8,0,2.2,13.5,0,0,TAU);ctx.fill();
      ctx.fillStyle='#5d7374';ctx.fillRect(-25,-22,13,5);
      return canvas;
    }
  }
  Towers.Textures=Textures;
})();
