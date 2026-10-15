(function () {
  'use strict';
  const C = Towers.config;
  const key = 'towers.custom-level.v1';
  const valid = part => part && ['wood', 'glass', 'concrete'].includes(part.material) &&
    Number.isFinite(part.x) && part.x >= 980 && part.x <= 1180 &&
    Number.isFinite(part.width) && part.width >= 140 && part.width <= 330 &&
    Number.isFinite(part.height) && part.height >= 30 && part.height <= 100;

  class Editor {
    constructor() {
      this.blocks = [];
      this.material = 'wood';
      this.height = 56;
      this.drag = null;
      this.saved = false;
      this.load();
    }

    heightUsed() { return this.blocks.reduce((sum, block) => sum + block.height, 0); }

    begin(point) {
      this.drag = { x: Towers.clamp(point.x, 980, 1180), width: 220 };
    }

    move(point) {
      if (!this.drag) return;
      const distance = Math.abs(point.x - this.drag.x);
      if (distance > 5) this.drag.width = Math.round(Towers.clamp(distance * 2, 140, 330));
    }

    finish() {
      if (!this.drag) return 'Нет размещаемой плиты.';
      const part = { x: this.drag.x, width: this.drag.width, height: this.height, material: this.material };
      this.drag = null;
      if (this.blocks.length >= 11) return 'Не более 11 плит.';
      if (this.heightUsed() + part.height > C.ground - 115) return 'Башня выйдет за верхнюю границу.';
      this.blocks.push(part);
      return `Плита ${this.blocks.length} размещена.`;
    }

    undo() { if (this.blocks.length) this.blocks.pop(); }
    clear() { this.blocks.length = 0; this.drag = null; }

    preview() {
      if (!this.drag) return null;
      return { ...this.drag, height: this.height, material: this.material,
        y: C.ground - this.heightUsed() - this.height / 2 };
    }

    positions() {
      let bottom = C.ground;
      return this.blocks.map((part, id) => {
        const result = { ...part, y: bottom - part.height / 2, id, seed: 9000 + id * 101 + part.width };
        bottom -= part.height;
        return result;
      });
    }

    check() {
      if (this.blocks.length < 2) return { ok: false, message: 'Поставьте хотя бы две плиты.' };
      const simulation = new Towers.Physics(() => {}, () => {});
      const ok = simulation.buildCustom(this.blocks);
      return { ok, message: ok ? 'Конструкция устойчива. Можно испытывать.' :
        'Башня неустойчива. Выровняйте плиты и проверьте снова.' };
    }

    save() {
      if (!this.blocks.length) return 'Сначала разместите плиты.';
      try {
        localStorage.setItem(key, JSON.stringify(this.blocks));
        this.saved = true;
        return 'Уровень сохранён в этом браузере.';
      } catch (_) { return 'Браузер не разрешил локальное сохранение.'; }
    }

    load() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return 'Сохранённого уровня пока нет.';
        const blocks = JSON.parse(raw);
        if (!Array.isArray(blocks) || blocks.length > 11 || blocks.some(part => !valid(part)) ||
            blocks.reduce((sum, part) => sum + part.height, 0) > C.ground - 115) throw Error('Invalid level');
        this.blocks = blocks.map(({ x, width, height, material }) => ({ x, width, height, material }));
        this.saved = true;
        return 'Сохранённый уровень загружен.';
      } catch (_) { return 'Сохранённый уровень повреждён или недоступен.'; }
    }
  }
  Towers.Editor = Editor;
})();
