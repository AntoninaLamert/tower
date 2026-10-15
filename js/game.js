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
      }, (floor, amount) => this.onDamage(floor, amount), () => this.onCargo());
      this.replay = new Towers.Replay();
      this.editor = new Towers.Editor();
      this.isCustom = false;
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
      this.isCustom = false;
      this.state = 'building';
      this.cancelAim();
      this.audio.reset();
      this.disabled = 0;
      this.mode = this.number % 3 === 0 ? 'precision' :
        this.number % 5 === 2 ? 'siege' :
        this.number % 5 === 4 ? 'cargo' :
        this.number % 5 === 0 ? 'moving' : 'demolition';
      this.cargoFailed = false;
      this.targetDestroyed = 0;
      this.precisionFailed = false;
      this.shotDisabled = 0;
      this.replayCandidate = false;
      this.lastReplayOffer = -10;
      this.quietTime = 0;
      this.endStarted = 0;
      this.lastShot = -10;
      this.hasFired = false;
      this.ammo = Object.fromEntries(Object.entries(C.ammo).map(([type, spec]) => [type, spec.count]));
      this.totalFloors = this.physics.build(this.number, this.mode);
      this.targetCount = 0;
      if (this.mode === 'precision') {
        const candidates = this.physics.floors.filter(floor => floor.material !== 'concrete').reverse();
        this.targetCount = this.number >= 6 ? 2 : 1;
        for (const floor of candidates.slice(0, this.targetCount)) floor.target = true;
      }
      this.renderer.prepare(this.physics.floors, this.physics);
      this.replay.newTower();
      this.selected = 'normal';
      this.state = 'ready';
      this.angle = -.48;
      this.noticeUntil = 0;
      $('defeat').hidden = true;
      $('editor-panel').hidden = true;
      document.body.classList.remove('editing');
      $('notice').classList.remove('visible');
      $('notice').classList.remove('won');
      this.accumulator = 0;
      this.updateUI();
    }

    openEditor(message = '') {
      if (!this.isCustom && this.state !== 'editing')
        this.campaignSnapshot = { number: this.number, score: this.score };
      this.state = 'editing';
      this.replay.stop();
      this.audio.reset();
      this.cancelAim();
      $('defeat').hidden = true;
      $('notice').classList.remove('visible');
      $('editor-panel').hidden = false;
      document.body.classList.add('editing');
      this.renderer.prepareEditor(this.editor);
      this.editorUI();
      this.editorMessage(message || 'Выберите материал и толщину, затем разместите плиту на поле.');
      this.updateUI();
    }

    editorMessage(message) { setText('editor-message', message); }

    leaveEditor() {
      if (this.campaignSnapshot) {
        this.number = this.campaignSnapshot.number;
        this.score = this.campaignSnapshot.score;
      }
      this.startTower();
    }

    startCustom() {
      const result = this.editor.check();
      if (!result.ok) { this.editorMessage(result.message); return; }
      this.isCustom = true;
      this.mode = 'custom';
      this.state = 'building';
      this.audio.reset();
      this.cancelAim();
      this.score = 0;
      this.disabled = 0;
      this.targetCount = 0;
      this.targetDestroyed = 0;
      this.precisionFailed = false;
      this.cargoFailed = false;
      this.shotDisabled = 0;
      this.replayCandidate = false;
      this.lastReplayOffer = -10;
      this.quietTime = 0;
      this.endStarted = 0;
      this.lastShot = -10;
      this.hasFired = false;
      this.ammo = Object.fromEntries(Object.entries(C.ammo).map(([type, spec]) => [type, spec.count]));
      if (!this.physics.buildCustom(this.editor.blocks)) {
        this.openEditor('Уровень потерял устойчивость. Исправьте расположение плит.');
        return;
      }
      this.totalFloors = this.physics.floors.length;
      this.renderer.prepare(this.physics.floors, this.physics);
      this.replay.newTower();
      this.selected = 'normal';
      this.state = 'ready';
      this.angle = -.48;
      this.noticeUntil = 0;
      $('defeat').hidden = true;
      $('editor-panel').hidden = true;
      document.body.classList.remove('editing');
      $('notice').classList.remove('visible', 'won');
      this.accumulator = 0;
      this.updateUI();
    }

    remaining() { return Object.values(this.ammo).reduce((sum, count) => sum + count, 0); }

    onDamage(floor) {
      if (this.mode !== 'precision' || floor.target) return;
      const penalty = Math.min(100, Math.floor(floor.damage / floor.maxHealth * 100));
      const delta = penalty - (floor.damagePenalty || 0);
      if (delta > 0) {
        floor.damagePenalty = penalty;
        this.score -= delta;
        this.updateUI();
      }
    }

    onFloor(floor) {
      if (!floor.scoreReported) {
        floor.scoreReported = true;
        this.disabled++;
        if (this.hasFired) this.shotDisabled++;
      }
      if (this.mode === 'precision') {
        if (floor.target && floor.destroyed && !floor.targetAwarded) {
          floor.targetAwarded = true;
          this.targetDestroyed++;
          this.score += C.materials[floor.material].points;
          this.replayCandidate = true;
        } else if (!floor.target && !floor.collateralDisabled) {
          floor.collateralDisabled = true;
          this.precisionFailed = true;
          this.score -= Math.max(0, 100 - (floor.damagePenalty || 0));
        }
        if (this.precisionFailed || this.targetDestroyed === this.targetCount) this.beginSettling();
      } else {
        if (!floor.pointsAwarded) {
          floor.pointsAwarded = true;
          this.score += C.materials[floor.material].points;
        }
        if (this.shotDisabled >= 2) this.replayCandidate = true;
        if (this.state !== 'won' && this.disabled / this.totalFloors >= .7) {
          if (this.mode === 'cargo') this.beginSettling();
          else this.win();
        }
      }
      this.updateUI();
    }

    onCargo() {
      if (this.mode !== 'cargo' || this.cargoFailed) return;
      this.cargoFailed = true;
      this.beginSettling();
      this.message('Хрупкий груз разбит · дождитесь завершения обрушения');
      this.updateUI();
    }

    beginSettling() {
      if (this.state === 'settling' || this.state === 'won' || this.state === 'lost') return;
      this.state = 'settling';
      this.endStarted = this.physics.time;
      this.quietTime = 0;
      this.cancelAim();
    }

    win() {
      if (this.state === 'won') return;
      this.state = 'won';
      const bonus = 500 + this.remaining() * 100;
      this.score += bonus;
      this.endStarted = this.physics.time;
      this.quietTime = 0;
      this.cancelAim();
      this.message(`${this.mode === 'precision' ? 'Точный выстрел' : this.mode === 'cargo' ? 'Груз спасён' : this.isCustom ? 'Авторский уровень пройден' : 'Башня повержена'} · бонус +${bonus.toLocaleString('ru-RU')} · наблюдаем обрушение`, Infinity);
    }

    message(text, seconds = 2.4) {
      $('notice').textContent = text;
      $('notice').classList.toggle('won', this.state === 'won');
      $('notice').classList.add('visible');
      this.noticeUntil = this.physics.time + seconds;
    }

    choose(type) {
      this.cancelAim();
      if (this.replay.playing || this.state !== 'ready' || !this.ammo[type]) return;
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
      this.shotDisabled = 0;
      this.replayCandidate = false;
      this.physics.fire(this.selected, this.angle, this.power);
      const muzzle = { type: 'muzzle', x: C.cannon.x + Math.cos(this.angle) * C.cannon.barrel,
        y: C.cannon.y + Math.sin(this.angle) * C.cannon.barrel, angle: this.angle };
      this.renderer.effect(muzzle);
      this.audio.fire(this.selected, C.cannon.x);
      this.renderer.recoil = 10;
      this.lastShot = this.physics.time;
      this.quietTime = 0;
      if (!this.remaining()) this.beginSettling();
      else if (!this.ammo[this.selected]) {
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
        if (this.state === 'editing' && event.button === 0) {
          event.preventDefault();
          const point = this.renderer.toWorld(event.clientX, event.clientY);
          if (point.x < 940 || point.x > 1220) {
            this.editorMessage('Размещайте плиты в зоне башни справа.');
            return;
          }
          this.canvas.setPointerCapture(event.pointerId);
          this.editorPointerId = event.pointerId;
          this.editor.begin(point);
          return;
        }
        if (event.button !== 0 || this.replay.playing || this.state !== 'ready' || this.aim) return;
        event.preventDefault(); this.canvas.focus({ preventScroll: true });
        const start = this.renderer.toWorld(event.clientX, event.clientY);
        this.aim = { start, current: start, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, valid: false };
        this.canvas.setPointerCapture(event.pointerId);
        setText('aim-readout', 'ВЕДИТЕ ВПРАВО И ВВЕРХ');
      });
      this.canvas.addEventListener('pointermove', event => {
        if (this.state === 'editing' && this.editor.drag && event.pointerId === this.editorPointerId)
          this.editor.move(this.renderer.toWorld(event.clientX, event.clientY));
        else this.updateAim(event);
      });
      this.canvas.addEventListener('pointerup', event => {
        if (this.state === 'editing' && event.pointerId === this.editorPointerId) {
          this.editor.move(this.renderer.toWorld(event.clientX, event.clientY));
          this.editorMessage(this.editor.finish());
          this.renderer.prepareEditor(this.editor);
          if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
          this.editorPointerId = null;
          return;
        }
        if (!this.aim || event.pointerId !== this.aim.pointerId) return;
        this.updateAim(event);
        const valid = this.aim.valid;
        this.cancelAim();
        if (valid) this.shoot();
      });
      this.canvas.addEventListener('pointercancel', () => { this.cancelAim(); this.editor.drag = null; });
      this.canvas.addEventListener('lostpointercapture', () => {
        if (this.aim) this.cancelAim();
        if (this.state === 'editing') this.editor.drag = null;
      });
      window.addEventListener('blur', () => this.cancelAim());
      document.addEventListener('visibilitychange', () => {
        this.cancelAim(); this.lastFrame = 0; this.accumulator = 0;
      });
      window.addEventListener('resize', () => this.cancelAim());
      document.addEventListener('keydown', event => {
        if (this.state === 'editing') {
          if (event.key === 'Escape') { this.editor.drag = null; event.preventDefault(); }
          const material = { Digit1: 'wood', Digit2: 'glass', Digit3: 'concrete' }[event.code];
          if (material) { this.editor.material = material; this.editorUI(); event.preventDefault(); }
          return;
        }
        if (event.key === 'Escape') { event.preventDefault(); this.cancelAim(); }
        if (event.key.toLowerCase() === 'r' && this.replay.clip) {
          event.preventDefault(); this.toggleReplay();
        }
        const type = { Digit1: 'normal', Digit2: 'heavy', Digit3: 'explosive', Digit4: 'cluster', Digit5: 'sticky',
          Numpad1: 'normal', Numpad2: 'heavy', Numpad3: 'explosive', Numpad4: 'cluster', Numpad5: 'sticky' }[event.code];
        if (type) { event.preventDefault(); this.choose(type); }
      });
      document.querySelectorAll('[data-ammo]').forEach(button => button.addEventListener('click', () => this.choose(button.dataset.ammo)));
      $('replay').addEventListener('click', () => this.toggleReplay());
      $('editor-open').addEventListener('click', () => this.openEditor());
      $('editor-back').addEventListener('click', () => this.leaveEditor());
      document.querySelectorAll('[data-material]').forEach(button => button.addEventListener('click', () => {
        this.editor.material = button.dataset.material;
        this.editorUI();
      }));
      $('editor-height').addEventListener('input', event => {
        this.editor.height = Number(event.target.value);
        this.editorUI();
      });
      $('editor-undo').addEventListener('click', () => {
        this.editor.undo(); this.renderer.prepareEditor(this.editor);
        this.editorMessage('Последняя плита удалена.');
      });
      $('editor-clear').addEventListener('click', () => {
        this.editor.clear(); this.renderer.prepareEditor(this.editor);
        this.editorMessage('Поле редактора очищено.');
      });
      $('editor-check').addEventListener('click', () => this.editorMessage(this.editor.check().message));
      $('editor-save').addEventListener('click', () => this.editorMessage(this.editor.save()));
      $('editor-load').addEventListener('click', () => {
        this.editorMessage(this.editor.load()); this.renderer.prepareEditor(this.editor);
      });
      $('editor-play').addEventListener('click', () => this.startCustom());
      $('restart').addEventListener('click', () => {
        if (this.isCustom) this.startCustom();
        else { this.number = 1; this.score = 0; this.replay.clear(); this.startTower(); }
      });
    }

    editorUI() {
      document.querySelectorAll('[data-material]').forEach(button =>
        button.classList.toggle('selected', button.dataset.material === this.editor.material));
      setText('editor-height-value', `${this.editor.height} px`);
    }

    toggleReplay() {
      if (this.replay.playing) this.replay.stop();
      else if (this.replay.start()) { this.cancelAim(); this.audio.reset(); }
      this.updateUI();
    }

    updateUI() {
      setText('tower', this.state === 'editing' ? 'РЕД.' : this.isCustom ? 'СВОЯ' : String(this.number).padStart(2, '0'));
      const scoreText = this.score.toLocaleString('ru-RU');
      if ($('score').textContent !== scoreText) {
        setText('score', scoreText);
        $('score').animate([{ transform: 'translateY(2px)', color: '#e8bc79' }, { transform: 'translateY(0)', color: '#e9eeeb' }], { duration: 330, easing: 'ease-out' });
      }
      if (this.state === 'editing') {
        setText('status', 'Редактор уровней');
        setText('field-note', 'Нажмите и потяните мышью, чтобы задать длину плиты');
        setText('objective', 'Плиты укладываются от земли вверх');
        setText('aim-readout', 'ПРОВЕРЬТЕ УСТОЙЧИВОСТЬ ПЕРЕД ИСПЫТАНИЕМ');
        $('replay').hidden = true;
        document.querySelectorAll('[data-ammo]').forEach(button => { button.disabled = true; });
        return;
      }
      const completed = this.mode === 'precision' ? this.targetDestroyed : this.disabled;
      const required = this.mode === 'precision' ? this.targetCount : this.totalFloors;
      setText('floors', `${completed} / ${required}`);
      const percent = Math.round(completed / required * 100);
      setText('percent', `${percent}%`);
      if ($('progress-fill').style.width !== `${percent}%`) $('progress-fill').style.width = `${percent}%`;
      const progress = document.querySelector('.progress');
      if (progress.getAttribute('aria-valuenow') !== String(percent)) progress.setAttribute('aria-valuenow', percent);
      setText('ammo-total', `${this.remaining()} / ${Object.values(C.ammo).reduce((sum, spec) => sum + spec.count, 0)}`);
      setText('progress-title', this.mode === 'precision' ? 'Красные плиты уничтожены' : 'Выведено из строя');
      const objectives = {
        precision: 'Уничтожьте красные плиты · берегите остальные',
        siege: 'Пробейте стену или стреляйте поверх неё',
        cargo: 'Разрушьте 70% башни и сохраните стеклянный груз',
        moving: 'Выбирайте момент между движениями преграды',
        custom: 'Испытание авторской башни · цель 70%'
      };
      setText('objective', objectives[this.mode] || 'Выведите из строя 70% этажей');
      setText('goal-number', this.mode === 'precision' ? `${this.targetCount}/${this.targetCount}` : '70%');
      $('threshold').hidden = this.mode === 'precision';
      $('replay').hidden = !this.replay.clip;
      setText('replay', this.replay.playing ? 'Пропустить повтор' : '↺ Повтор 0,45×');
      document.querySelectorAll('[data-ammo]').forEach(button => {
        const type = button.dataset.ammo;
        setText(`ammo-${type}`, this.ammo[type]);
        const unavailable = this.ammo[type] === 0 || this.state !== 'ready';
        if (button.disabled !== unavailable) button.disabled = unavailable;
        if (button.classList.contains('selected') !== (this.selected === type)) button.classList.toggle('selected', this.selected === type);
        if (button.getAttribute('aria-pressed') !== String(this.selected === type)) button.setAttribute('aria-pressed', this.selected === type);
      });
      setText('status', this.mode === 'precision' ?
        ({ ready: 'Точный выстрел', won: 'Цели уничтожены', settling: 'Проверяем сохранность', lost: 'Точный выстрел не удался' }[this.state] || 'Подготовка полигона') :
        this.mode === 'cargo' ?
          ({ ready: 'Спаси хрупкий груз', won: 'Груз спасён', settling: 'Проверяем груз', lost: 'Груз не спасён' }[this.state] || 'Подготовка полигона') :
        this.mode === 'siege' && this.state === 'ready' ? 'Осада крепости' :
        this.mode === 'moving' && this.state === 'ready' ? 'Движущаяся преграда' :
        this.isCustom && this.state === 'ready' ? 'Авторский уровень' :
        ({ ready: this.hasFired ? 'Огонь по готовности' : 'Полигон готов', won: 'Башня повержена', settling: 'Ждём результат', lost: 'Башня устояла' }[this.state] || 'Подготовка полигона'));
      setText('field-note', this.state === 'won' ? 'Следующая башня — после обрушения' :
        this.mode === 'precision' ? 'Красные плиты — цель. Остальные берегите.' :
        this.mode === 'siege' ? 'Каменную стену можно пробить.' :
        this.mode === 'cargo' ? 'Защитите стеклянный контейнер.' :
        this.mode === 'moving' ? 'Рассчитайте момент выстрела.' :
        this.isCustom ? 'Испытание сохранённой конструкции.' : 'Восемь выстрелов. Одна цель.');
      if (this.state === 'won' || this.state === 'settling') setText('aim-readout', 'ОБРУШЕНИЕ ПРОДОЛЖАЕТСЯ');
    }

    step() {
      this.physics.step();
      this.replay.capture(this.physics, this.angle);
      if (this.replayCandidate && this.physics.time - this.lastShot > 2 &&
          (this.physics.time - this.lastReplayOffer > .35 || !this.replay.clip)) {
        if (this.replay.offer(this.renderer, this.lastShot - .2)) {
          this.lastReplayOffer = this.physics.time;
          this.updateUI();
        }
      }
      if (this.noticeUntil < this.physics.time) $('notice').classList.remove('visible');
      if (this.state !== 'won' && this.state !== 'settling') return;
      this.quietTime = this.physics.isQuiet() ? this.quietTime + C.step / 1000 : 0;
      const waited = this.physics.time - this.endStarted;
      if ((waited > 1.8 && this.quietTime > 1.1) || waited > 14) {
        if (this.mode === 'precision' && this.state === 'settling' && !this.precisionFailed && this.targetDestroyed === this.targetCount) {
          this.win();
          this.updateUI();
          return;
        }
        if (this.mode === 'cargo' && this.state === 'settling' && !this.cargoFailed && this.disabled / this.totalFloors >= .7) {
          this.win();
          this.updateUI();
          return;
        }
        if (this.state === 'won') {
          if (this.isCustom) this.openEditor('Авторский уровень пройден. Можно изменить конструкцию или испытать снова.');
          else { this.number++; this.startTower(); }
        }
        else {
          this.state = 'lost';
          this.audio.reset();
          this.cancelAim();
          setText('defeat-label', this.mode === 'precision' || this.mode === 'cargo' ? 'ЦЕЛЬ НЕ ВЫПОЛНЕНА' : 'БОЕКОМПЛЕКТ ИСЧЕРПАН');
          setText('defeat-heading', this.mode === 'precision' ? 'Точный выстрел не удался' :
            this.mode === 'cargo' && this.cargoFailed ? 'Груз разбит' : 'Башня устояла');
          setText('restart', this.isCustom ? 'Повторить испытание ↗' : 'Начать заново ↗');
          $('defeat-detail').textContent = this.mode === 'precision' ?
            `Красных плит уничтожено ${this.targetDestroyed} из ${this.targetCount}. ${this.precisionFailed ? 'Остальные плиты пострадали.' : 'Попробуйте точнее.'}` :
            this.mode === 'cargo' ? `Выведено из строя ${this.disabled} из ${this.totalFloors} этажей. ${this.cargoFailed ? 'Стеклянный груз разбит.' : 'Нужно не менее 70%.'}` :
            `Выведено из строя ${this.disabled} из ${this.totalFloors} этажей. Нужно ${Math.ceil(this.totalFloors * .7)}.`;
          $('defeat').hidden = false;
          this.updateUI();
          $('restart').focus({ preventScroll: true });
        }
      }
    }

    frame(time) {
      const elapsed = this.lastFrame ? Math.min((time - this.lastFrame) / 1000, .1) : 0;
      this.lastFrame = time;
      if (!document.hidden && this.state !== 'lost' && this.state !== 'editing' && !this.replay.playing) {
        this.accumulator += elapsed * 1000;
        let updates = 0;
        while (this.accumulator >= C.step && updates < 12) {
          this.accumulator -= C.step;
          this.step();
          updates++;
        }
      }
      if (!document.hidden && this.state !== 'editing' && !this.replay.playing) this.audio.updateMotion(this.physics);
      if (this.replay.playing) {
        const data = this.replay.advance(elapsed);
        this.renderer.drawReplay(data);
        if (!this.replay.playing) this.updateUI();
      } else if (this.state === 'editing') this.renderer.drawEditor(this.editor);
      else this.renderer.draw(this, elapsed);
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
