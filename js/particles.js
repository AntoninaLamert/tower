(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = Towers.clamp;
  class Particles {
    constructor() { this.items=[]; this.flashes=[]; this.limit=330; }
    clear(){this.items.length=0;this.flashes.length=0;}
    add(particle){
      if(this.items.length>=this.limit)this.items.splice(0,Math.max(1,this.items.length-this.limit+1));
      this.items.push(particle);
    }
    spawn(effect){
      if(effect.type==='break')this.break(effect);
      else if(effect.type==='wall-break'){
        for(let i=0;i<24;i++)this.piece(i%3?'stone':'dust',effect.x+(Math.random()-.5)*effect.width,
          effect.y+(Math.random()-.5)*effect.height,(Math.random()-.5)*190,-35-Math.random()*135,
          3+Math.random()*9,.35+Math.random()*.55);
        this.flash(effect.x,effect.y,25,.13,'impact');
      }
      else if(effect.type==='explosion')this.explosion(effect);
      else if(effect.type==='impact')this.impact(effect);
      else if(effect.type==='split'){
        this.flash(effect.x,effect.y,16,.12,'impact');
        for(let i=0;i<12;i++)this.piece('spark',effect.x,effect.y,(Math.random()-.5)*115,(Math.random()-.5)*100,2,.18);
      }
      else if(effect.type==='attach')this.flash(effect.x,effect.y,10,.14,'impact');
      else if(effect.type==='muzzle'){
        this.flash(effect.x,effect.y,26,.14,'muzzle');
        for(let i=0;i<9;i++){
          const angle=effect.angle+(Math.random()-.5)*.9,speed=50+Math.random()*120;
          this.piece('spark',effect.x,effect.y,Math.cos(angle)*speed,Math.sin(angle)*speed,
            2+Math.random()*4,.12+Math.random()*.16,angle);
        }
      }
    }
    piece(type,x,y,vx,vy,size,life,angle=Math.random()*TAU){
      this.add({type,x,y,vx,vy,size,life,age:0,angle,spin:(Math.random()-.5)*(type==='dust'?2:10),
        variant:Math.random(),vertices:type==='glass'?[[-.5,-.48],[.42,-.37],[.56,.38],[-.2,.58]]:
          type==='wood'?[[-.57,-.13],[-.21,-.31],[.54,-.14],[.61,.11],[-.37,.3]]:
          type==='stone'?[[-.5,-.4],[.13,-.53],[.59,-.17],[.38,.44],[-.23,.52]]:null});
    }
    flash(x,y,size,life,kind){
      this.flashes.push({x,y,size,life,age:0,kind});
      if(this.flashes.length>12)this.flashes.shift();
    }
    break(effect){
      const glass=effect.material==='glass', count=glass?26:22;
      const cos=Math.cos(effect.angle),sin=Math.sin(effect.angle);
      for(let i=0;i<count;i++){
        const lx=(Math.random()-.5)*effect.width,ly=(Math.random()-.5)*effect.height;
        const x=effect.x+cos*lx-sin*ly,y=effect.y+sin*lx+cos*ly;
        const spread=(Math.random()-.5)*(glass?240:175);
        this.piece(effect.material,x,y,spread,-Math.random()*150-20,glass?4+Math.random()*13:6+Math.random()*18,.65+Math.random()*.85);
      }
      if(glass)this.flash(effect.x,effect.y,Math.min(70,effect.width*.32),.23,'glass');
      else{
        for(let i=0;i<19;i++){
          this.piece('dust',effect.x+(Math.random()-.5)*effect.width*.65,effect.y+(Math.random()-.5)*effect.height,
            (Math.random()-.5)*62,-Math.random()*50,3+Math.random()*5,.42+Math.random()*.42);
        }
      }
    }
    impact(effect){
      const strength=clamp(effect.strength/10,0,1);
      if(strength<.16)return;
      const count=Math.min(17,Math.ceil(2+strength*12));
      const concrete=effect.material==='concrete';
      if(concrete&&strength>.36)this.flash(effect.x,effect.y,9+strength*19,.13,'impact');
      for(let i=0;i<count;i++){
        const kind=concrete?(i%3===0?'stone':'dust'):effect.material==='glass'?'glass':i%2?'wood':'dust';
        const speed=24+Math.random()*strength*125;
        this.piece(kind,effect.x+(Math.random()-.5)*12,effect.y+(Math.random()-.5)*7,
          (Math.random()-.5)*speed*2,-Math.random()*speed,
          kind==='dust'?2+Math.random()*4:2+Math.random()*5,
          .25+strength*(kind==='dust'?.55:.75));
      }
      if(concrete&&effect.ground&&strength>.38){
        for(let i=0;i<Math.ceil(strength*11);i++){
          this.piece('dust',effect.x+(Math.random()-.5)*effect.width*.7,effect.y,
            (Math.random()-.5)*50,-12-Math.random()*55,5+Math.random()*9,.48+Math.random()*.45);
        }
      }
    }
    explosion(effect){
      this.flash(effect.x,effect.y,37,.19,'explosion');
      this.flash(effect.x,effect.y,effect.radius,.48,'wave');
      for(let i=0;i<75;i++){
        const a=Math.random()*TAU,speed=65+Math.random()*265,kind=i%4===0?'dust':i%3===0?'spark':'stone';
        this.piece(kind,effect.x+Math.cos(a)*4,effect.y+Math.sin(a)*4,
          Math.cos(a)*speed,Math.sin(a)*speed-36,kind==='dust'?3+Math.random()*7:2+Math.random()*5,
          kind==='spark'?.2+Math.random()*.36:.38+Math.random()*.58,a);
      }
    }
    update(dt){
      if(dt<=0)return;
      const gravity=420;
      for(const p of this.items){
        p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
        p.vy+=gravity*dt*(p.type==='dust'?.13:1);
        p.vx*=Math.max(0,1-dt*(p.type==='dust'?2.2:.25));
        p.angle+=p.spin*dt;
      }
      this.items=this.items.filter(p=>p.age<p.life&&p.y<Towers.config.height+60);
      for(const f of this.flashes)f.age+=dt;
      this.flashes=this.flashes.filter(f=>f.age<f.life);
    }
    draw(ctx){
      for(const f of this.flashes){
        const t=f.age/f.life,alpha=1-t;
        ctx.save();ctx.translate(f.x,f.y);
        if(f.kind==='wave'){
          ctx.globalAlpha=alpha*.84;ctx.strokeStyle='#fff2c7';ctx.lineWidth=2.8*(1-t)+.45;
          ctx.beginPath();ctx.arc(0,0,f.size*(.09+.91*t),0,TAU);ctx.stroke();
          ctx.globalAlpha=alpha*.25;ctx.strokeStyle='#9f8662';ctx.lineWidth=5*(1-t);
          ctx.beginPath();ctx.arc(0,0,f.size*(.11+.84*t),0,TAU);ctx.stroke();
        }else{
          const radius=f.size*(.45+t*.65),radial=ctx.createRadialGradient(0,0,0,0,0,radius);
          radial.addColorStop(0,f.kind==='glass'?'#ffffffd9':'#fff6d7e8');
          radial.addColorStop(.3,f.kind==='glass'?'#ccfcff86':'#ffd08a91');radial.addColorStop(1,'#fff7cf00');
          ctx.globalAlpha=alpha;ctx.fillStyle=radial;ctx.beginPath();ctx.arc(0,0,radius,0,TAU);ctx.fill();
          ctx.strokeStyle=f.kind==='glass'?'#f5ffff':'#fff6d4';ctx.lineWidth=1.4*alpha;
          const arm=radius*(1-t*.4);
          ctx.beginPath();ctx.moveTo(-arm,0);ctx.lineTo(arm,0);ctx.moveTo(0,-arm*.55);ctx.lineTo(0,arm*.55);ctx.stroke();
        }
        ctx.restore();
      }
      for(const p of this.items){
        const t=p.age/p.life;
        ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);ctx.globalAlpha=(1-t)*(p.type==='dust'?.23:1);
        if(p.type==='dust'){
          ctx.fillStyle=p.variant>.5?'#a4a39a':'#b6a69a';
          ctx.beginPath();ctx.ellipse(0,0,p.size*(1+t*2),p.size*(.45+t*.9),0,0,TAU);ctx.fill();
        }else if(p.type==='spark'){
          ctx.strokeStyle=p.variant>.35?'#ffe9a7':'#fffdfa';ctx.lineWidth=1.1;
          ctx.beginPath();ctx.moveTo(-p.size*.7,0);ctx.lineTo(p.size*1.8,0);ctx.stroke();
        }else{
          const stretch=p.type==='wood'?2.1:1;
          ctx.beginPath();p.vertices.forEach(([x,y],i)=>i?ctx.lineTo(x*p.size*stretch,y*p.size):ctx.moveTo(x*p.size*stretch,y*p.size));ctx.closePath();
          ctx.fillStyle=p.type==='glass'?(p.variant>.5?'#e4fcffd1':'#9bcbd4a8'):
            p.type==='wood'?(p.variant>.5?'#b4956b':'#795938'):(p.variant>.5?'#abb1aa':'#777e7a');
          ctx.fill();
          ctx.strokeStyle=p.type==='glass'?'#ffffffca':p.type==='wood'?'#d5b386ad':'#d3d8cf89';
          ctx.lineWidth=p.type==='glass'?.8:.5;ctx.stroke();
          if(p.type==='glass'){
            ctx.strokeStyle='#ffffffb2';ctx.beginPath();ctx.moveTo(-p.size*.3,-p.size*.38);ctx.lineTo(p.size*.12,p.size*.05);ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
  }
  Towers.Particles=Particles;
})();
