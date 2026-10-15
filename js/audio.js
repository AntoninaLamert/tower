(function () {
  'use strict';
  const C = Towers.config;
  const clamp = Towers.clamp;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;

  class Audio {
    constructor() {
      this.ctx = null;
      this.supported = !!AudioCtor;
      this.muted = false;
      this.volume = .68;
      this.active = new Set();
      this.flightLoops = new Map();
      this.scrapeLoops = new Map();
      this.cooldowns = new Map();
      this.lastMotion = 0;
      this.maxVoices = 32;
    }

    unlock() {
      if (!this.supported) return;
      if (!this.ctx) {
        try {
          this.ctx = new AudioCtor({ latencyHint: 'interactive' });
          const ctx = this.ctx;
          this.mix = ctx.createGain(); this.mix.gain.value = .72;
          this.limiter = ctx.createDynamicsCompressor();
          this.limiter.threshold.value = -17;
          this.limiter.knee.value = 10;
          this.limiter.ratio.value = 13;
          this.limiter.attack.value = .004;
          this.limiter.release.value = .19;
          this.master = ctx.createGain();this.master.gain.value = this.volume;
          this.mix.connect(this.limiter);this.limiter.connect(this.master);this.master.connect(ctx.destination);
          this.reflectionSend = ctx.createGain();this.reflectionSend.gain.value = .13;
          const first=ctx.createDelay(.3),second=ctx.createDelay(.3),soft=ctx.createBiquadFilter();
          first.delayTime.value=.072;second.delayTime.value=.142;soft.type='lowpass';soft.frequency.value=1700;
          this.reflectionSend.connect(first);first.connect(soft);soft.connect(this.mix);
          this.reflectionSend.connect(second);second.connect(soft);
          this.buffers=this.makeBuffers();
        } catch (_) {
          this.ctx=null;this.supported=false;return;
        }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    }

    makeBuffers() {
      const ctx=this.ctx,length=Math.ceil(ctx.sampleRate*2.1);
      const data={};
      for(const kind of ['air','rumble','grit']){
        const buffer=ctx.createBuffer(1,length,ctx.sampleRate),channel=buffer.getChannelData(0);
        let low=0,rough=0;
        for(let i=0;i<length;i++){
          const white=Math.random()*2-1;
          low=low*.975+white*.025;
          rough=rough*.72+white*.28;
          channel[i]=kind==='air'?white*.38:kind==='rumble'?low*2.6:rough*.72+(Math.random()<.0015?(Math.random()-.5)*.7:0);
        }
        data[kind]=buffer;
      }
      return data;
    }

    setMuted(muted) {
      this.muted=muted;
      if(this.ctx)this.master.gain.setTargetAtTime(muted?0:this.volume,this.ctx.currentTime,.025);
    }

    setVolume(value) {
      this.volume=clamp(value,0,1);
      if(this.ctx)this.master.gain.setTargetAtTime(this.muted?0:this.volume,this.ctx.currentTime,.025);
    }

    pan(x) { return clamp((x/C.width-.5)*1.2,-.62,.62); }

    output(source, level, duration, x, wet=false, delay=0, filter=null, bufferOffset=0) {
      if(!this.ctx||this.active.size>=this.maxVoices)return false;
      const ctx=this.ctx,now=ctx.currentTime+delay;
      const envelope=ctx.createGain(),stereo=ctx.createStereoPanner();
      envelope.gain.setValueAtTime(.0001,now);
      envelope.gain.linearRampToValueAtTime(Math.max(.0002,level),now+Math.min(.012,duration*.11));
      envelope.gain.exponentialRampToValueAtTime(.0001,now+duration);
      stereo.pan.value=this.pan(x);
      if(filter){source.connect(filter);filter.connect(envelope);}
      else source.connect(envelope);
      envelope.connect(stereo);stereo.connect(this.mix);
      if(wet)stereo.connect(this.reflectionSend);
      this.active.add(source);
      source.onended=()=>{this.active.delete(source);source.disconnect();if(filter)filter.disconnect();envelope.disconnect();stereo.disconnect();};
      if(filter)source.start(now,bufferOffset);
      else source.start(now);
      source.stop(now+duration+.025);
      return true;
    }

    noise(kind,level,duration,filterType,frequency,x,wet=false,delay=0) {
      if(!this.ctx||this.active.size>=this.maxVoices)return;
      const ctx=this.ctx,source=ctx.createBufferSource(),filter=ctx.createBiquadFilter();
      source.buffer=this.buffers[kind];source.playbackRate.value=.84+Math.random()*.35;
      filter.type=filterType;filter.frequency.value=frequency*(.89+Math.random()*.23);
      filter.Q.value=filterType==='bandpass'?.75:.5;
      this.output(source,level,duration,x,wet,delay,filter,Math.random()*.3);
    }

    tone(frequency,endFrequency,level,duration,x,wave='sine',wet=false,delay=0) {
      if(!this.ctx||this.active.size>=this.maxVoices)return;
      const ctx=this.ctx,source=ctx.createOscillator(),now=ctx.currentTime+delay;
      source.type=wave;source.frequency.setValueAtTime(frequency,now);
      source.frequency.exponentialRampToValueAtTime(Math.max(18,endFrequency),now+duration*.88);
      this.output(source,level,duration,x,wet,delay);
    }

    shouldPlay(key,interval) {
      if(!this.ctx||this.muted)return false;
      const now=this.ctx.currentTime;
      if(now-(this.cooldowns.get(key)||-10)<interval)return false;
      this.cooldowns.set(key,now);return true;
    }

    fire(type,x) {
      if(!this.ctx||this.muted)return;
      const heavy=type!=='normal',size=heavy?1.27:1;
      this.noise('rumble',.37*size,heavy?.36:.26,'lowpass',heavy?170:225,x,true);
      this.noise('grit',.14*size,.11,'bandpass',heavy?510:660,x);
      this.tone(heavy?74:94,heavy?34:44,.25*size,heavy?.38:.27,x,'sine',true);
      this.noise('air',.055,.075,'highpass',1100,x);
      if(type==='heavy'||type==='explosive')this.tone(49,27,.15,.35,x,'triangle');
    }

    explosion(effect) {
      if(!this.ctx||this.muted)return;
      const x=effect.x;
      this.noise('air',.42,.21,'lowpass',670,x,true);
      this.noise('rumble',.5,.62,'lowpass',125,x,true,.016);
      this.noise('grit',.24,.31,'bandpass',720,x,true,.03);
      this.tone(88,29,.32,.53,x,'sine',true);
      for(let i=0;i<4;i++)this.noise('grit',.075,.065,'highpass',1200+i*210,x,false,.09+i*.057);
    }

    break(effect) {
      if(!this.ctx||this.muted)return;
      const x=effect.x,glass=effect.material==='glass';
      if(glass){
        this.noise('air',.16,.17,'highpass',1900,x,true);
        const base=760*(.85+Math.random()*.3);
        this.tone(base,base*.7,.11,.32,x,'triangle',true);
        for(let i=0;i<4;i++)this.tone(base*(1.3+i*.37),base*(.9+i*.25),.034,.12+Math.random()*.18,x,'sine',false,.018+i*.023);
      }else{
        this.noise('grit',.22,.24,'bandpass',760,x,true);
        this.noise('rumble',.16,.14,'lowpass',250,x);
        for(let i=0;i<3;i++)this.noise('grit',.08,.045,'highpass',1000+i*140,x,false,.016+i*.032);
      }
    }

    impact(effect) {
      const material=effect.material,speed=effect.relativeSpeed||effect.strength||0;
      const interval=material==='glass'?.075:material==='concrete'?.065:.08;
      if(speed<2.5||!this.shouldPlay('hit-'+material,interval))return;
      const massFactor=clamp(Math.sqrt((effect.mass||25)/45),.55,1.35);
      const force=clamp((speed-2.2)/13,0,1)*massFactor;
      const x=effect.x;
      if(material==='glass'){
        this.noise('air',.04+force*.08,.09,'highpass',1700,x);
        this.tone(630*(.9+Math.random()*.2),440,.035+force*.065,.1+force*.09,x,'triangle');
      }else if(material==='wood'){
        this.noise('grit',.05+force*.18,.095+force*.09,'lowpass',550,x);
        if(force>.5)this.noise('air',force*.045,.04,'bandpass',1250,x);
      }else{
        this.noise('rumble',.07+force*.24,.16+force*.19,'lowpass',180,x,force>.6);
        this.noise('grit',force*.15,.09+force*.1,'bandpass',410,x);
        if(effect.ground&&force>.45)this.tone(61,31,force*.13,.23,x,'sine',true);
      }
    }

    event(effect) {
      if(effect.type==='impact')this.impact(effect);
      else if(effect.type==='break')this.break(effect);
      else if(effect.type==='explosion')this.explosion(effect);
      else if(effect.type==='split')this.noise('air',.09,.13,'bandpass',1100,effect.x);
      else if(effect.type==='attach')this.noise('grit',.13,.1,'bandpass',560,effect.x);
    }

    loop(kind,id,x,filterType,frequency) {
      if(!this.ctx)return null;
      const ctx=this.ctx,source=ctx.createBufferSource(),filter=ctx.createBiquadFilter();
      const gain=ctx.createGain(),pan=ctx.createStereoPanner();
      source.buffer=this.buffers[kind];source.loop=true;
      filter.type=filterType;filter.frequency.value=frequency;filter.Q.value=.62;
      gain.gain.value=0;pan.pan.value=this.pan(x);
      source.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(this.mix);
      source.start();
      const loop={source,filter,gain,pan,id};
      source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();pan.disconnect();};
      return loop;
    }

    fadeLoop(loop) {
      if(!loop||!this.ctx)return;
      const now=this.ctx.currentTime;
      loop.gain.gain.setTargetAtTime(0,now,.06);
      try{loop.source.stop(now+.28);}catch(_){}
    }

    updateMotion(physics) {
      if(!this.ctx||this.ctx.state!=='running')return;
      const now=this.ctx.currentTime;
      if(now-this.lastMotion<.055)return;
      this.lastMotion=now;
      const activeShots=new Set();
      for(const projectile of physics.projectiles){
        if(projectile.removed)continue;
        const id=projectile.body.id,speed=projectile.body.speed;
        if(speed<7)continue;
        activeShots.add(id);
        let loop=this.flightLoops.get(id);
        if(!loop){loop=this.loop('air',id,projectile.body.position.x,'bandpass',800);if(!loop)continue;this.flightLoops.set(id,loop);}
        const amount=clamp((speed-9)/27,0,1);
        loop.gain.gain.setTargetAtTime(amount*.055,now,.07);
        loop.filter.frequency.setTargetAtTime(500+speed*24,now,.08);
        loop.pan.pan.setTargetAtTime(this.pan(projectile.body.position.x),now,.06);
      }
      for(const [id,loop] of this.flightLoops){if(!activeShots.has(id)){this.fadeLoop(loop);this.flightLoops.delete(id);}}

      const movement={wood:{power:0,x:C.towerX},concrete:{power:0,x:C.towerX}};
      for(const pair of physics.engine.pairs.list){
        if(!pair.isActive)continue;
        const a=pair.bodyA,b=pair.bodyB;
        const slip=Math.abs(a.velocity.x-b.velocity.x);
        if(slip<.45)continue;
        for(const body of [a,b]){
          const floor=body.plugin.floor;
          if(!floor||floor.destroyed||!movement[floor.material])continue;
          const power=clamp((slip-.4)/5,0,1)*clamp(Math.sqrt(body.mass/45),.65,1.35);
          if(power>movement[floor.material].power)movement[floor.material]={power,x:body.position.x};
        }
      }
      for(const material of ['wood','concrete']){
        const {power,x}=movement[material];
        let loop=this.scrapeLoops.get(material);
        if(power>.03&&!loop){
          loop=this.loop(material==='wood'?'grit':'rumble',material,x,'bandpass',material==='wood'?410:205);
          if(!loop)continue;this.scrapeLoops.set(material,loop);
        }
        if(loop){
          loop.gain.gain.setTargetAtTime(power*(material==='wood'?.045:.08),now,.12);
          loop.pan.pan.setTargetAtTime(this.pan(x),now,.08);
          loop.filter.frequency.setTargetAtTime((material==='wood'?310:155)+power*(material==='wood'?260:115),now,.1);
        }
      }
    }

    reset() {
      for(const loop of this.flightLoops.values())this.fadeLoop(loop);
      for(const loop of this.scrapeLoops.values())this.fadeLoop(loop);
      this.flightLoops.clear();this.scrapeLoops.clear();this.cooldowns.clear();
      this.lastMotion=0;
    }
  }
  Towers.Audio=Audio;
})();
