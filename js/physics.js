(function () {
  'use strict';
  const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter;
  const C = Towers.config;
  const random = (min, max) => min + Math.random() * (max - min);

  // This module owns all Matter bodies. It emits facts, never score or round decisions.
  class Physics {
    constructor(onFloor, onEffect, onDamage, onCargo) {
      this.onFloor = onFloor;
      this.onEffect = onEffect;
      this.onDamage = onDamage;
      this.onCargo = onCargo;
      this.engine = Engine.create({ enableSleeping: true, positionIterations: 10, velocityIterations: 8 });
      this.engine.gravity.y = 1;
      this.engine.gravity.scale = C.gravity;
      this.floors = [];
      this.projectiles = [];
      this.barrels = [];
      this.walls = [];
      this.movers = [];
      this.supports = [];
      this.cargo = null;
      this.pending = [];
      this.time = 0;
      this.armed = false;
      Events.on(this.engine, 'collisionStart', event => this.collectImpacts(event.pairs));
    }

    build(number, mode = 'demolition') {
      this.armed = false;
      this.mode = mode;
      let accepted = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        this.createCandidate(number, false, mode);
        if (this.checkStability()) { accepted = true; break; }
      }
      if (!accepted) {
        this.createCandidate(number, true, mode);
        this.checkStability();
      }
      this.finishBuild();
      if (mode === 'siege') this.createWall(number);
      if (mode === 'moving') this.createMovers(number);
      if (mode !== 'precision' && mode !== 'cargo') this.createBarrels(number);
      return this.floors.length;
    }

    finishBuild() {
      this.time = 0;
      this.pending.length = 0;
      this.projectiles.length = 0;
      this.averageHeight = this.floors.reduce((sum, floor) => sum + floor.height, 0) / this.floors.length;
      for (const floor of this.floors) {
        floor.initialY = floor.body.position.y;
        floor.initialAngle = floor.body.angle;
        floor.peakY = floor.body.position.y;
        floor.drop = 0;
        floor.damage = 0;
        floor.wakeX = floor.body.position.x;
        floor.wakeY = floor.body.position.y;
        Body.setVelocity(floor.body, { x: 0, y: 0 });
        Body.setAngularVelocity(floor.body, 0);
        Sleeping.set(floor.body, false);
      }
    }

    resetWorld(mode = 'demolition') {
      Composite.clear(this.engine.world, false);
      Engine.clear(this.engine);
      this.floors = [];
      this.projectiles = [];
      this.barrels = [];
      this.walls = [];
      this.movers = [];
      this.supports = [];
      this.cargo = null;
      const ground = Bodies.rectangle(C.width / 2, C.ground + 110, 6000, 220, {
        isStatic: true, friction: .8, restitution: .02, label: 'ground'
      });
      Composite.add(this.engine.world, ground);
      if (mode === 'cargo') this.createCargoSupports();
    }

    createCandidate(number, fallback, mode = 'demolition') {
      this.resetWorld(mode);
      const baseY = mode === 'cargo' ? C.ground - 78 : C.ground;
      const available = baseY - 115;
      const count = Math.min(6 + Math.floor((number - 1) / 2), 11, Math.floor(available / 30));
      const maxHeight = Math.max(30, Math.min(100, Math.floor(available / count)));
      const difficulty = Math.min(1, (number - 1) / 14);
      const concreteCount = Math.min(Math.floor(count * .5), 1 + Math.floor(number / 3));
      const materials = Array.from({ length: count }, (_, i) => i < concreteCount ? 'concrete' : i % 2 ? 'wood' : 'glass');
      // Shuffle before construction, keeping a fixed upper bound on indestructible floors.
      for (let i = materials.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [materials[i], materials[j]] = [materials[j], materials[i]];
      }
      let bottom = baseY;
      let previousX = C.towerX;
      for (let i = 0; i < count; i++) {
        const height = Math.round(fallback ? Math.min(55, maxHeight) : random(Math.max(30, maxHeight * .65), maxHeight));
        const width = Math.round(fallback ? 254 - i * 3 : random(200 + difficulty * 15, 282 + difficulty * 30));
        const x = fallback ? C.towerX : Towers.clamp(previousX + random(-18 - difficulty * 22, 18 + difficulty * 22), C.towerX - 70, C.towerX + 70);
        const y = bottom - height / 2;
        const material = materials[i];
        this.addFloor({ x, y, width, height, material, id: i });
        bottom -= height; // Contact surfaces meet; no spacer bodies or visual gaps.
        previousX = x;
      }
    }

    addFloor({ x, y, width, height, material, id }) {
      const body = Bodies.rectangle(x, y, width, height, {
        ...C.materials[material], frictionAir: .003, sleepThreshold: 100,
        slop: .025, label: 'floor'
      });
      const areaFactor = Math.sqrt(width * height / 14000);
      const thicknessFactor = .8 + .2 * height / 60;
      const maxHealth = material === 'concrete' ? Infinity :
        (material === 'wood' ? 1300 : 820) * areaFactor * thicknessFactor;
      const floor = { id, body, material, width, height, maxHealth, damage: 0, disabled: false, destroyed: false,
        startX: x, startY: y, initialAngle: 0, initialY: y, peakY: y, drop: 0,
        seed: Math.floor(random(1, 1000000)), assistAt: -10 };
      body.plugin.floor = floor;
      Composite.add(this.engine.world, body);
      this.floors.push(floor);
      return floor;
    }

    buildCustom(design) {
      if (!Array.isArray(design) || design.length < 2 || design.length > 11) return false;
      if (design.some(part => !['wood', 'glass', 'concrete'].includes(part.material) ||
          !Number.isFinite(part.x) || !Number.isFinite(part.width) || !Number.isFinite(part.height) ||
          part.x < 980 || part.x > 1180 || part.width < 140 || part.width > 330 ||
          part.height < 30 || part.height > 100) ||
          design.reduce((sum, part) => sum + part.height, 0) > C.ground - 115) return false;
      this.armed = false;
      this.mode = 'custom';
      this.resetWorld();
      let bottom = C.ground;
      design.forEach((part, id) => {
        this.addFloor({ x: part.x, y: bottom - part.height / 2, width: part.width,
          height: part.height, material: part.material, id });
        bottom -= part.height;
      });
      if (!this.checkStability()) return false;
      this.finishBuild();
      return true;
    }

    createCargoSupports() {
      for (const dx of [-82, 82]) {
        const body = Bodies.rectangle(C.towerX + dx, C.ground - 39, 42, 78, {
          isStatic: true, label: 'support', friction: .85
        });
        this.supports.push(body);
        Composite.add(this.engine.world, body);
      }
      const body = Bodies.rectangle(C.towerX, C.ground - 28, 66, 52, {
        isStatic: true, label: 'cargo', friction: .2, restitution: .02
      });
      this.cargo = { body, broken: false };
      Composite.add(this.engine.world, body);
    }

    createWall(number) {
      const count = 2 + (number % 4), height = 44;
      for (let i = 0; i < count; i++) {
        const width = 88 + (i % 2) * 8;
        const body = Bodies.rectangle(775, C.ground - height * (i + .5), width, height, {
          density: .0065, friction: .72, frictionStatic: .9, restitution: .025,
          frictionAir: .003, sleepThreshold: 90, label: 'wall', slop: .025
        });
        const brick = { body, width, height, health: 720 + i * 45, damage: 0,
          destroyed: false, seed: (number * 1031 + i * 337) >>> 0 };
        body.plugin.wall = brick;
        this.walls.push(brick);
        Composite.add(this.engine.world, body);
      }
    }

    createMovers(number) {
      const count = number >= 10 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const mover = { x: 690 + i * 145, baseY: 445 - i * 65,
          amplitude: 104 - i * 17, period: 3.2 + i * 1.3, phase: i * 1.7,
          width: 112 - i * 14, height: 24 };
        const y = mover.baseY + Math.sin(mover.phase) * mover.amplitude;
        mover.body = Bodies.rectangle(mover.x, y, mover.width, mover.height, {
          isStatic: true, label: 'moving', friction: .65, restitution: .05
        });
        this.movers.push(mover);
        Composite.add(this.engine.world, mover.body);
      }
    }

    checkStability() {
      if (!this.hasBalancedSupports()) return false;
      for (let step = 0; step < 300; step++) {
        Engine.update(this.engine, C.step);
        if (step % 15 === 0 && this.floors.some(floor =>
          Math.abs(floor.body.angle) > .055 ||
          Math.abs(floor.body.position.x - floor.startX) > 7 ||
          Math.abs(floor.body.position.y - floor.startY) > 5)) return false;
      }
      if (!this.hasBalancedSupports() || this.floors.some(floor =>
        floor.body.speed >= .15 || Math.abs(floor.body.angularVelocity) >= .005)) return false;
      const settled = this.floors.map(floor => ({ x: floor.body.position.x, y: floor.body.position.y }));
      // A second hidden settling period catches stacks that move only when sleeping bodies wake.
      for (const floor of this.floors) {
        Sleeping.set(floor.body, false);
        Body.setVelocity(floor.body, { x: 0, y: 0 });
        Body.setAngularVelocity(floor.body, 0);
      }
      for (let step = 0; step < 120; step++) {
        Engine.update(this.engine, C.step);
        if (step % 12 === 0 && this.floors.some((floor, i) =>
          Math.abs(floor.body.position.x - settled[i].x) > 5 ||
          Math.abs(floor.body.position.y - settled[i].y) > 4 ||
          Math.abs(floor.body.angle) > .055)) return false;
      }
      return this.hasBalancedSupports() && this.floors.every(floor =>
        floor.body.speed < .15 && Math.abs(floor.body.angularVelocity) < .005);
    }

    hasBalancedSupports() {
      // At every joint, the mass of all slabs above must stay over the actual shared contact area.
      for (let i = 1; i < this.floors.length; i++) {
        const lower = this.floors[i - 1], upper = this.floors[i];
        const left = Math.max(lower.body.position.x - lower.width / 2, upper.body.position.x - upper.width / 2);
        const right = Math.min(lower.body.position.x + lower.width / 2, upper.body.position.x + upper.width / 2);
        const overlap = right - left;
        if (overlap < Math.min(lower.width, upper.width) * .5) return false;
        let mass = 0, moment = 0;
        for (let j = i; j < this.floors.length; j++) {
          const body = this.floors[j].body;
          mass += body.mass;
          moment += body.position.x * body.mass;
        }
        const margin = Math.min(10, overlap * .08), center = moment / mass;
        if (center < left + margin || center > right - margin) return false;
      }
      return true;
    }

    muzzle(angle, type) {
      const distance = C.cannon.barrel + C.ammo[type].radius + 3;
      return { x: C.cannon.x + Math.cos(angle) * distance, y: C.cannon.y + Math.sin(angle) * distance };
    }

    fire(type, angle, speed) {
      this.armed = true;
      const spec = C.ammo[type];
      const position = this.muzzle(angle, type);
      const body = Bodies.circle(position.x, position.y, spec.radius, {
        friction: .75, frictionStatic: 1, frictionAir: 0, restitution: .13,
        label: 'projectile', sleepThreshold: 70, collisionFilter: { category: 0x0002, mask: 0x0005 }
      });
      Body.setMass(body, spec.mass);
      Body.setVelocity(body, { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed });
      const projectile = { body, type, radius: spec.radius, born: this.time, resting: 0, exploded: false, removed: false, attached: null };
      body.plugin.projectile = projectile;
      this.projectiles.push(projectile);
      Composite.add(this.engine.world, body);
      this.wakeTower();
    }

    createBarrels(number) {
      if (number % 3 === 0 || (number % 2 !== 0 && Math.random() > .3)) return;
      const count = number >= 5 ? 2 : 1;
      const choices = this.floors.slice(1, -1).filter(floor => floor.height >= 35);
      for (let i = 0; i < count && choices.length; i++) {
        const index = Math.floor(Math.random() * choices.length);
        const floor = choices.splice(index, 1)[0];
        // A sensor on an exposed end of the slab behaves like a barrel in a shallow recess.
        const barrel = { floor, localX: -floor.width / 2 + 9, localY: 0, radius: 17, exploded: false };
        const position = this.barrelPosition(barrel);
        barrel.body = Bodies.circle(position.x, position.y, barrel.radius, {
          isStatic: true, isSensor: true, label: 'barrel', collisionFilter: { category: 0x0004, mask: 0x0002 }
        });
        barrel.body.plugin.barrel = barrel;
        this.barrels.push(barrel);
        Composite.add(this.engine.world, barrel.body);
      }
    }

    barrelPosition(barrel) {
      const body = barrel.floor.body, cos = Math.cos(body.angle), sin = Math.sin(body.angle);
      return { x: body.position.x + barrel.localX * cos - barrel.localY * sin,
        y: body.position.y + barrel.localX * sin + barrel.localY * cos };
    }

    makeFragment(parent, angle, speed) {
      const spec = C.ammo.fragment, p = parent.body.position;
      const body = Bodies.circle(p.x + Math.cos(angle) * 17, p.y + Math.sin(angle) * 17, spec.radius, {
        friction: .75, frictionStatic: 1, frictionAir: 0, restitution: .13,
        label: 'projectile', sleepThreshold: 70, collisionFilter: { category: 0x0002, mask: 0x0005 }
      });
      Body.setMass(body, spec.mass);
      Body.setVelocity(body, { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed });
      const shot = { body, type: 'fragment', radius: spec.radius, born: this.time, resting: 0, exploded: false, removed: false, attached: null };
      body.plugin.projectile = shot;
      this.projectiles.push(shot);
      Composite.add(this.engine.world, body);
    }

    splitProjectile(projectile) {
      if (projectile.removed) return;
      const v = projectile.body.velocity, heading = Math.atan2(v.y, v.x), speed = Math.max(12, Math.hypot(v.x, v.y));
      for (const spread of [-.13, 0, .13]) this.makeFragment(projectile, heading + spread, speed * 1.06);
      this.onEffect({ type: 'split', x: projectile.body.position.x, y: projectile.body.position.y });
      this.removeProjectile(projectile);
    }

    wakeTower() {
      // Small stacks: waking the connected stack plus debris is cheap and prevents floating supports.
      for (const floor of this.floors) if (!floor.destroyed) Sleeping.set(floor.body, false);
    }

    collectImpacts(pairs) {
      if (!this.armed) return;
      for (const pair of pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        const contacts = pair.collision.supports.filter(Boolean);
        const point = contacts.length ? { x: contacts.reduce((s, p) => s + p.x, 0) / contacts.length, y: contacts.reduce((s, p) => s + p.y, 0) / contacts.length } : { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 };
        const velocityAt = body => {
          const v = body.plugin.beforeVelocity || body.velocity;
          const omega = body.plugin.beforeAngular || 0;
          return { x: v.x - omega * (point.y - body.position.y), y: v.y + omega * (point.x - body.position.x) };
        };
        const va = velocityAt(a), vb = velocityAt(b), normal = pair.collision.normal;
        const speed = Math.abs((va.x - vb.x) * normal.x + (va.y - vb.y) * normal.y);
        this.pending.push({ a, b, point, speed });
      }
    }

    disableFloor(floor, reason) {
      if (floor.disabled) return;
      floor.disabled = true;
      this.onFloor(floor, reason);
    }

    destroy(floor, reason, strength = 0) {
      if (floor.destroyed || floor.material === 'concrete') return;
      floor.destroyed = true;
      const wasDisabled = floor.disabled;
      this.disableFloor(floor, reason);
      if (wasDisabled) this.onFloor(floor, reason);
      this.onEffect({ type: 'break', x: floor.body.position.x, y: floor.body.position.y, width: floor.width, height: floor.height, angle: floor.body.angle, material: floor.material, mass: floor.body.mass, strength });
      Composite.remove(this.engine.world, floor.body);
      this.wakeTower();
    }

    damageFloor(floor, amount, reason, speed) {
      if (floor.destroyed || floor.material === 'concrete' || amount <= 0) return;
      const before = floor.damage;
      floor.damage += amount;
      if (this.onDamage) this.onDamage(floor, floor.damage - before);
      if (floor.damage >= floor.maxHealth) this.destroy(floor, reason, speed);
    }

    damageWall(wall, amount, speed) {
      if (wall.destroyed || amount <= 0) return;
      wall.damage += amount;
      if (wall.damage < wall.health) return;
      wall.destroyed = true;
      const body = wall.body;
      this.onEffect({ type: 'wall-break', x: body.position.x, y: body.position.y,
        width: wall.width, height: wall.height, angle: body.angle, strength: speed });
      Composite.remove(this.engine.world, body);
      for (const brick of this.walls) if (!brick.destroyed) Sleeping.set(brick.body, false);
    }

    breakCargo() {
      if (!this.cargo || this.cargo.broken || !this.armed) return;
      this.cargo.broken = true;
      const body = this.cargo.body;
      this.onEffect({ type: 'break', material: 'glass', x: body.position.x, y: body.position.y,
        width: 66, height: 52, angle: 0, strength: 10 });
      Composite.remove(this.engine.world, body);
      if (this.onCargo) this.onCargo();
    }

    explode(projectile, point) {
      if (projectile.exploded || projectile.removed) return;
      projectile.exploded = true;
      this.blast(point, this.averageHeight * (projectile.type === 'sticky' ? 3.3 : 3),
        projectile.type === 'sticky' ? 1450 : 1050);
      this.removeProjectile(projectile);
    }

    detonateBarrel(barrel) {
      if (barrel.exploded) return;
      barrel.exploded = true;
      const point = { x: barrel.body.position.x, y: barrel.body.position.y };
      Composite.remove(this.engine.world, barrel.body);
      this.blast(point, this.averageHeight * 2.1, 890);
    }

    blast(point, radius, force) {
      this.onEffect({ type: 'explosion', x: point.x, y: point.y, radius });
      this.wakeTower();
      if (this.cargo && Math.hypot(this.cargo.body.position.x - point.x,
          this.cargo.body.position.y - point.y) < radius * .7) this.breakCargo();
      for (const wall of this.walls) {
        if (wall.destroyed) continue;
        const distance = Math.hypot(wall.body.position.x - point.x, wall.body.position.y - point.y);
        if (distance < radius) this.damageWall(wall, wall.health * (1 - distance / radius) * 1.8, 10);
      }
      for (const floor of this.floors) {
        if (floor.destroyed) continue;
        const body = floor.body;
        // Distance to the actual oriented rectangle, not just its center.
        const cos = Math.cos(body.angle), sin = Math.sin(body.angle);
        const dx = point.x - body.position.x, dy = point.y - body.position.y;
        const lx = cos * dx + sin * dy, ly = -sin * dx + cos * dy;
        const cx = Towers.clamp(lx, -floor.width / 2, floor.width / 2);
        const cy = Towers.clamp(ly, -floor.height / 2, floor.height / 2);
        const distance = Math.hypot(lx - cx, ly - cy);
        if (distance >= radius) continue;
        const attenuation = 1 - distance / radius;
        if (floor.material !== 'concrete') { this.destroy(floor, 'explosion'); continue; }
        const directionX = body.position.x - point.x;
        const directionY = body.position.y - point.y;
        const length = Math.max(1, Math.hypot(directionX, directionY));
        const impulse = force * attenuation * attenuation;
        const ix = directionX / length * impulse, iy = directionY / length * impulse;
        Body.setVelocity(body, { x: body.velocity.x + ix / body.mass, y: body.velocity.y + iy / body.mass });
        const contactX = cos * cx - sin * cy, contactY = sin * cx + cos * cy;
        Body.setAngularVelocity(body, body.angularVelocity + (contactX * iy - contactY * ix) / body.inertia);
      }
      for (const barrel of this.barrels) {
        if (!barrel.exploded && Math.hypot(barrel.body.position.x - point.x, barrel.body.position.y - point.y) < radius)
          this.detonateBarrel(barrel);
      }
    }

    attachSticky(projectile, other, point) {
      if (projectile.attached || projectile.removed) return;
      if (other.label !== 'barrel') {
        const dx = point.x - other.position.x, dy = point.y - other.position.y;
        const cos = Math.cos(other.angle), sin = Math.sin(other.angle);
        projectile.attached = { body: other, x: cos * dx + sin * dy, y: -sin * dx + cos * dy };
      } else projectile.attached = { x: point.x, y: point.y };
      Body.setStatic(projectile.body, true);
      Body.setPosition(projectile.body, point);
      projectile.body.collisionFilter.mask = 0;
      projectile.fuse = this.time + 2;
      this.onEffect({ type: 'attach', x: point.x, y: point.y });
    }

    processImpacts() {
      for (const impact of this.pending) {
        const { a, b, point, speed } = impact;
        if (this.cargo && !this.cargo.broken &&
            (a === this.cargo.body || b === this.cargo.body)) {
          const other = a === this.cargo.body ? b : a;
          if ((other.plugin.floor && speed >= 3.2) ||
              (other.plugin.projectile && speed >= 4) ||
              (other.plugin.wall && speed >= 5)) this.breakCargo();
        }
        // Visual-only contact notification. Score, forces and destruction remain below.
        if (speed > 2.2) {
          for (const [body, other] of [[a, b], [b, a]]) {
            const floor = body.plugin.floor;
            if (floor && !floor.destroyed) this.onEffect({ type: 'impact', x: point.x, y: point.y,
              strength: speed, relativeSpeed: speed, mass: body.mass, material: floor.material,
              otherMaterial: other.plugin.floor?.material || other.label, ground: other.label === 'ground', width: floor.width });
            const wall = body.plugin.wall;
            if (wall && !wall.destroyed) this.onEffect({ type: 'impact', x: point.x, y: point.y,
              strength: speed, relativeSpeed: speed, mass: body.mass, material: 'concrete',
              ground: other.label === 'ground', width: wall.width });
          }
        }
        for (const [body, other] of [[a, b], [b, a]]) {
          const shot = body.plugin.projectile;
          if (shot && !shot.removed) {
            if (other.plugin.barrel) {
              this.detonateBarrel(other.plugin.barrel);
              this.removeProjectile(shot);
            } else if (shot.type === 'explosive') this.explode(shot, point);
            else if (shot.type === 'sticky') this.attachSticky(shot, other, point);
            else if (other.plugin.floor || other.plugin.wall) {
              const reducedMass = body.mass * other.mass / (body.mass + other.mass);
              const energy = .5 * reducedMass * speed * speed;
              const damage = speed > 3 ? energy * (shot.type === 'heavy' ? 1.16 : 1) : 0;
              if (other.plugin.floor) this.damageFloor(other.plugin.floor, damage, 'direct', speed);
              else this.damageWall(other.plugin.wall, damage, speed);
            }
          }
        }
        for (const [body, other] of [[a, b], [b, a]]) {
          if (body.plugin.wall && !body.plugin.wall.destroyed && !other.plugin.projectile && speed > 9) {
            const reduced = other.isStatic ? body.mass : body.mass * other.mass / (body.mass + other.mass);
            this.damageWall(body.plugin.wall, .5 * reduced * speed * speed * .42, speed);
          }
          const floor = body.plugin.floor;
          if (!floor || floor.destroyed || floor.material === 'concrete' || other.plugin.projectile) continue;
          const toppledGlass = floor.material === 'glass' && Math.abs(body.angle - floor.initialAngle) > .45;
          const threshold = floor.material === 'wood' ? 9 : toppledGlass ? 4.3 : 6.2;
          if (speed < threshold) continue;
          const reducedMass = other.isStatic ? body.mass : (body.mass * other.mass) / (body.mass + other.mass);
          const energy = .5 * reducedMass * speed * speed;
          const multiplier = floor.material === 'glass' ? (toppledGlass ? 1.35 : .95) : .58;
          this.damageFloor(floor, energy * multiplier, 'impact', speed);
        }
      }
      this.pending.length = 0;
    }

    removeProjectile(projectile) {
      if (projectile.removed) return;
      projectile.removed = true;
      Composite.remove(this.engine.world, projectile.body);
    }

    supportInterval(floor) {
      let left = Infinity, right = -Infinity;
      const body = floor.body;
      for (const pair of this.engine.pairs.list) {
        if (!pair.isActive || Math.abs(pair.collision.normal.y) < .35) continue;
        const other = pair.bodyA === body ? pair.bodyB : pair.bodyB === body ? pair.bodyA : null;
        if (!other || other.position.y <= body.position.y || other.plugin.floor?.destroyed) continue;
        const contactLeft = Math.max(body.bounds.min.x, other.bounds.min.x);
        const contactRight = Math.min(body.bounds.max.x, other.bounds.max.x);
        if (contactRight <= contactLeft) continue;
        left = Math.min(left, contactLeft);
        right = Math.max(right, contactRight);
      }
      return left < right ? { left, right } : null;
    }

    keepUnstableAwake(floor) {
      const body = floor.body, support = this.supportInterval(floor);
      if (!support) {
        if (body.isSleeping) Sleeping.set(body, false);
        return;
      }
      const offset = body.position.x < support.left ? body.position.x - support.left :
        body.position.x > support.right ? body.position.x - support.right : 0;
      if (Math.abs(offset) <= 6 || Math.abs(body.angle) > .6) return;
      Sleeping.set(body, false);
      if (floor.material !== 'concrete' || floor.disabled || body.speed > .35 ||
          this.time - floor.assistAt < .45) return;
      floor.assistAt = this.time;
      Body.applyForce(body, { x: body.position.x + Math.sign(offset) * floor.width * .38, y: body.position.y },
        { x: 0, y: body.mass * .000018 });
    }

    wakeAbove(floor) {
      for (const upper of this.floors) {
        if (!upper.destroyed && upper.initialY < floor.initialY) Sleeping.set(upper.body, false);
      }
    }

    step() {
      this.time += C.step / 1000;
      for (const mover of this.movers) {
        const y = mover.baseY + Math.sin(this.time * Math.PI * 2 / mover.period + mover.phase) * mover.amplitude;
        Body.setPosition(mover.body, { x: mover.x, y }, true);
      }
      for (const barrel of this.barrels) {
        if (!barrel.exploded && !barrel.floor.destroyed) Body.setPosition(barrel.body, this.barrelPosition(barrel));
      }
      for (const projectile of this.projectiles) {
        if (projectile.removed) continue;
        if (projectile.type === 'cluster' && this.time - projectile.born > .72 && projectile.body.position.x > 480) this.splitProjectile(projectile);
        if (projectile.attached) {
          const anchor = projectile.attached, body = anchor.body;
          if (body && !body.plugin.floor?.destroyed && !body.plugin.wall?.destroyed) {
            const cos = Math.cos(body.angle), sin = Math.sin(body.angle);
            Body.setPosition(projectile.body, { x: body.position.x + anchor.x * cos - anchor.y * sin,
              y: body.position.y + anchor.x * sin + anchor.y * cos });
          }
          if (this.time >= projectile.fuse) this.explode(projectile, projectile.body.position);
        }
      }
      for (const body of Composite.allBodies(this.engine.world)) {
        body.plugin.beforeVelocity = { x: body.velocity.x, y: body.velocity.y };
        body.plugin.beforeAngular = body.angularVelocity;
      }
      for (const floor of this.floors) {
        if (floor.destroyed) continue;
        // Keep the apex across the whole flight; do not confuse horizontal motion with a fall.
        floor.peakY = Math.min(floor.peakY, floor.body.position.y);
        floor.drop = Math.max(0, floor.body.position.y - floor.peakY);
      }
      for (const wall of this.walls) {
        if (wall.destroyed) continue;
        if (wall.body.position.x < -200 || wall.body.position.x > C.width + 200 ||
            wall.body.position.y > C.height + 180) {
          wall.destroyed = true;
          Composite.remove(this.engine.world, wall.body);
        }
      }
      Engine.update(this.engine, C.step);
      this.processImpacts();
      for (const floor of this.floors) {
        if (floor.destroyed) continue;
        const body = floor.body;
        if (this.armed && Math.abs(body.angle - floor.initialAngle) >= Math.PI / 4) this.disableFloor(floor, 'toppled');
        // A whole slab beyond either marked boundary is out of action, even if it stays level.
        if (this.armed && (body.bounds.max.x < C.zone.left || body.bounds.min.x > C.zone.right)) this.disableFloor(floor, 'ejected');
        if (body.speed < .25 && Math.abs(body.angularVelocity) < .008) floor.peakY = body.position.y;
        if (this.armed) {
          if (Math.abs(body.position.x - floor.wakeX) > 8 || Math.abs(body.position.y - floor.wakeY) > 8) {
            floor.wakeX = body.position.x; floor.wakeY = body.position.y;
            this.wakeAbove(floor);
          }
          this.keepUnstableAwake(floor);
        }
      }
      for (const projectile of this.projectiles) {
        if (projectile.removed) continue;
        const { x, y } = projectile.body.position;
        const age = this.time - projectile.born;
        projectile.resting = projectile.body.speed < .65 ? projectile.resting + C.step / 1000 : 0;
        if (projectile.attached) continue;
        if (x < -180 || x > C.width + 180 || y > C.height + 180 || y < -900 || age > 12 || (age > .6 && projectile.resting > .65)) this.removeProjectile(projectile);
      }
      this.projectiles = this.projectiles.filter(projectile => !projectile.removed);
    }

    isQuiet() {
      return this.projectiles.length === 0 && this.floors.every(floor => floor.destroyed ||
        (floor.body.speed < .32 && Math.abs(floor.body.angularVelocity) < .012)) &&
        this.walls.every(wall => wall.destroyed ||
          (wall.body.speed < .4 && Math.abs(wall.body.angularVelocity) < .015));
    }

    // Same timestep, acceleration and zero air drag as the real projectile integrator.
    trajectory(type, angle, speed) {
      const start = this.muzzle(angle, type), points = [];
      let x = start.x, y = start.y, vx = Math.cos(angle) * speed, vy = Math.sin(angle) * speed;
      const ratio = C.step / (1000 / 60);
      const acceleration = C.gravity * C.step * (1000 / 60);
      for (let i = 0; i < 420; i++) {
        vy += acceleration;
        x += vx * ratio;
        y += vy * ratio;
        if (y > C.ground - C.ammo[type].radius || x > C.width || x < 0 || y < -150) break;
        if (i % 6 === 0) points.push({ x, y });
        if (type === 'cluster' && i * C.step / 1000 > .72 && x > 480) {
          const heading = Math.atan2(vy, vx), velocity = Math.max(12, Math.hypot(vx, vy)) * 1.06;
          points.branches = [-.13, 0, .13].map(spread => {
            const branch = [], angle = heading + spread;
            let bx = x, by = y, bvx = Math.cos(angle) * velocity, bvy = Math.sin(angle) * velocity;
            for (let j = 0; j < 240; j++) {
              bvy += acceleration;bx += bvx * ratio;by += bvy * ratio;
              if (by > C.ground - C.ammo.fragment.radius || bx > C.width || by < -150) break;
              if (j % 6 === 0) branch.push({ x: bx, y: by });
            }
            return branch;
          });
          break;
        }
      }
      return points;
    }
  }
  Towers.Physics = Physics;
})();
