(function () {
  'use strict';
  const C = Towers.config;
  const $ = id => document.getElementById(id);
  const setText = (id, value) => { const node = $(id); if (node.textContent !== String(value)) node.textContent = value; };

  // Round state and input live here; graphics and physical reactions are replaceable modules.
  class Game {
    constructor() {
      this.canvas = $('game');
      this.renderer = new Towers.Renderer(this.canvas);
      this.audio = new Towers.Audio();
      this.physics = new Towers.Physics((floor, reason) => this.onFloor(floor, reason), effect => {
        this.renderer.effect(effect);
        this.audio.event(effect);
      });
      this.number = 1;
      this.score = 0;
      this.angle = -.48;
      this.power = 22;
      this.selected = 'normal';
      this.aim = null;
      this.accumulator = 0;
      this.lastFrame = 0;
      this.bindInput();
      this.startTower();
      requestAnimationFrame(time => this.frame(time));
    }

    startTower() {
      this.state = 'building';
      this.cancelAim();
      this.audio.reset();
      this.disabled = 0;
      this.quietTime = 0;
      this.endStarted = 0;
      this.lastShot = -10;
      this.hasFired = false;
      this.ammo = Object.fromEntries(Object.entries(C.ammo).map(([type, spec]) => [type, spec.count]));
      this.totalFloors = this.physics.build(this.number);
      this.renderer.prepare(this.physics.floors);
      this.selected = 'normal';
      this.state = 'ready';
      this.angle = -.48;
      this.noticeUntil = 0;
      $('defeat').hidden = true;
      $('notice').classList.remove('visible');
      $('notice').classList.remove('won');
      this.accumulator = 0;
      this.updateUI();
    }

    remaining() { return Object.values(this.ammo).reduce((sum, count) => sum + count, 0); }

    onFloor(floor) {
      this.disabled++;
      this.score += C.materials[floor.material].points;
      if (this.state !== 'won' && this.disabled / this.totalFloors >= .7) {
        this.state = 'won';
        const bonus = 500 + this.remaining() * 100;
        this.score += bonus;
        this.endStarted = this.physics.time;
        this.quietTime = 0;
        this.cancelAim();
        this.message(`Башня повержена · бонус +${bonus.toLocaleString('ru-RU')} · наблюдаем обрушение`, Infinity);
      }
      this.updateUI();
    }

    message(text, seconds = 2.4) {
      $('notice').textContent = text;
      $('notice').classList.toggle('won', this.state === 'won');
      $('notice').classList.add('visible');
      this.noticeUntil = this.physics.time + seconds;
    }

    choose(type) {
      this.cancelAim();
      if (this.state !== 'ready' || !this.ammo[type]) return;
      this.selected = type;
      this.updateUI();
    }

    cancelAim() {
      const pointerId = this.aim?.pointerId;
      this.aim = null;
      if (pointerId !== undefined && this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
      setText('aim-readout', this.state === 'won' || this.state === 'settling' ? 'ОБРУШЕНИЕ ПРОДОЛЖАЕТСЯ' : 'ГОТОВО К ВЫСТРЕЛУ');
    }

    updateAim(event) {
      if (!this.aim || this.aim.pointerId !== event.pointerId) return;
      const current = this.renderer.toWorld(event.clientX, event.clientY);
      const dx = current.x - this.aim.start.x, dy = current.y - this.aim.start.y;
      const moved = Math.hypot(event.clientX - this.aim.clientX, event.clientY - this.aim.clientY);
      this.aim.current = current;
      this.aim.valid = moved >= 9 && dx > 5;
      if (!this.aim.valid) { setText('aim-readout', 'ВЕДИТЕ ВПРАВО И ВВЕРХ'); return; }
      this.angle = Towers.clamp(Math.atan2(dy, dx), -1.35, .05);
      this.power = Towers.clamp(10 + Math.hypot(dx, dy) * .0575, 10, 33);
      setText('aim-readout', `УГОЛ ${Math.round(-this.angle * 180 / Math.PI)}° · СИЛА ${Math.round((this.power - 10) / 23 * 100)}%`);
    }

    shoot() {
      if (this.state !== 'ready' || !this.ammo[this.selected]) return;
      this.ammo[this.selected]--;
      this.hasFired = true;
      this.physics.fire(this.selected, this.angle, this.power);
      const muzzle = { type: 'muzzle', x: C.cannon.x + Math.cos(this.angle) * C.cannon.barrel,
        y: C.cannon.y + Math.sin(this.angle) * C.cannon.barrel, angle: this.angle };
      this.renderer.effect(muzzle);
      this.audio.fire(this.selected, C.cannon.x);
      this.renderer.recoil = 10;
      this.lastShot = this.physics.time;
      this.quietTime = 0;
      if (!this.remaining()) {
        this.state = 'settling';
        this.endStarted = this.physics.time;
      } else if (!this.ammo[this.selected]) {
        this.selected = Object.keys(this.ammo).find(type => this.ammo[type] > 0);
      }
      this.updateUI();
    }

    bindInput() {
      document.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
      document.addEventListener('keydown', () => this.audio.unlock(), { once: true });
      $('sound-toggle').addEventListener('click', () => {
        this.audio.unlock();
        this.audio.setMuted(!this.audio.muted);
        $('sound-toggle').setAttribute('aria-pressed', String(!this.audio.muted));
        $('sound-toggle').setAttribute('aria-label', this.audio.muted ? 'Включить звук' : 'Выключить звук');
        setText('sound-status', this.audio.muted ? 'ЗВУК ВЫКЛ' : 'ЗВУК ВКЛ');
        $('sound-toggle').classList.toggle('muted', this.audio.muted);
      });
      $('volume').addEventListener('input', event => {
        this.audio.unlock();
        this.audio.setVolume(Number(event.target.value) / 100);
        setText('volume-value', `${event.target.value}%`);
      });
      this.canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0 || this.state !== 'ready' || this.aim) return;
        event.preventDefault(); this.canvas.focus({ preventScroll: true });
        const start = this.renderer.toWorld(event.clientX, event.clientY);
        this.aim = { start, current: start, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, valid: false };
        this.canvas.setPointerCapture(event.pointerId);
        setText('aim-readout', 'ВЕДИТЕ ВПРАВО И ВВЕРХ');
      });
      this.canvas.addEventListener('pointermove', event => this.updateAim(event));
      this.canvas.addEventListener('pointerup', event => {
        if (!this.aim || event.pointerId !== this.aim.pointerId) return;
        this.updateAim(event);
        const valid = this.aim.valid;
        this.cancelAim();
        if (valid) this.shoot();
      });
      this.canvas.addEventListener('pointercancel', () => this.cancelAim());
      this.canvas.addEventListener('lostpointercapture', () => { if (this.aim) this.cancelAim(); });
      window.addEventListener('blur', () => this.cancelAim());
      document.addEventListener('visibilitychange', () => {
        this.cancelAim(); this.lastFrame = 0; this.accumulator = 0;
      });
      window.addEventListener('resize', () => this.cancelAim());
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); this.cancelAim(); }
        const type = { Digit1: 'normal', Digit2: 'heavy', Digit3: 'explosive', Numpad1: 'normal', Numpad2: 'heavy', Numpad3: 'explosive' }[event.code];
        if (type) { event.preventDefault(); this.choose(type); }
      });
      document.querySelectorAll('[data-ammo]').forEach(button => button.addEventListener('click', () => this.choose(button.dataset.ammo)));
      $('restart').addEventListener('click', () => { this.number = 1; this.score = 0; this.startTower(); });
    }

    updateUI() {
      setText('tower', String(this.number).padStart(2, '0'));
      const scoreText = this.score.toLocaleString('ru-RU');
      if ($('score').textContent !== scoreText) {
        setText('score', scoreText);
        $('score').animate([{ transform: 'translateY(2px)', color: '#e8bc79' }, { transform: 'translateY(0)', color: '#e9eeeb' }], { duration: 330, easing: 'ease-out' });
      }
      setText('floors', `${this.disabled} / ${this.totalFloors}`);
      const percent = Math.round(this.disabled / this.totalFloors * 100);
      setText('percent', `${percent}%`);
      if ($('progress-fill').style.width !== `${percent}%`) $('progress-fill').style.width = `${percent}%`;
      const progress = document.querySelector('.progress');
      if (progress.getAttribute('aria-valuenow') !== String(percent)) progress.setAttribute('aria-valuenow', percent);
      setText('ammo-total', `${this.remaining()} / 6`);
      document.querySelectorAll('[data-ammo]').forEach(button => {
        const type = button.dataset.ammo;
        setText(`ammo-${type}`, this.ammo[type]);
        const unavailable = this.ammo[type] === 0 || this.state !== 'ready';
        if (button.disabled !== unavailable) button.disabled = unavailable;
        if (button.classList.contains('selected') !== (this.selected === type)) button.classList.toggle('selected', this.selected === type);
        if (button.getAttribute('aria-pressed') !== String(this.selected === type)) button.setAttribute('aria-pressed', this.selected === type);
      });
      setText('status', { ready: this.hasFired ? 'Огонь по готовности' : 'Полигон готов', won: 'Башня повержена', settling: 'Ждём результат', lost: 'Башня устояла' }[this.state] || 'Подготовка полигона');
      setText('field-note', this.state === 'won' ? 'Следующая башня — после обрушения' : 'Шесть выстрелов. Одна цель.');
      if (this.state === 'won' || this.state === 'settling') setText('aim-readout', 'ОБРУШЕНИЕ ПРОДОЛЖАЕТСЯ');
    }

    step() {
      this.physics.step();
      if (this.noticeUntil < this.physics.time) $('notice').classList.remove('visible');
      if (this.state !== 'won' && this.state !== 'settling') return;
      this.quietTime = this.physics.isQuiet() ? this.quietTime + C.step / 1000 : 0;
      const waited = this.physics.time - this.endStarted;
      if ((waited > 1.8 && this.quietTime > 1.1) || waited > 14) {
        if (this.state === 'won') { this.number++; this.startTower(); }
        else {
          this.state = 'lost';
          this.audio.reset();
          this.cancelAim();
          $('defeat-detail').textContent = `Выведено из строя ${this.disabled} из ${this.totalFloors} этажей. Нужно ${Math.ceil(this.totalFloors * .7)}.`;
          $('defeat').hidden = false;
          this.updateUI();
          $('restart').focus({ preventScroll: true });
        }
      }
    }

    frame(time) {
      const elapsed = this.lastFrame ? Math.min((time - this.lastFrame) / 1000, .1) : 0;
      this.lastFrame = time;
      if (!document.hidden && this.state !== 'lost') {
        this.accumulator += elapsed * 1000;
        let updates = 0;
        while (this.accumulator >= C.step && updates < 12) {
          this.accumulator -= C.step;
          this.step();
          updates++;
        }
      }
      if (!document.hidden) this.audio.updateMotion(this.physics);
      this.renderer.draw(this, elapsed);
      requestAnimationFrame(next => this.frame(next));
    }
  }
  if (!window.Matter) {
    $('status').textContent = 'Не найден vendor/matter.min.js';
    $('notice').textContent = 'Откройте index.html из полной папки игры, вместе с vendor и js.';
    $('notice').classList.add('visible');
    return;
  }
  new Game();
})();
