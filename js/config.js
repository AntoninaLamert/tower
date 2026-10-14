(function () {
  'use strict';
  window.Towers = {};
  Towers.config = Object.freeze({
    width: 1440, height: 760, ground: 666, towerX: 1080,
    zone: { left: 930, right: 1254 },
    cannon: { x: 172, y: 624, barrel: 83 },
    step: 1000 / 120, gravity: .001,
    materials: {
      wood: { density: .0013, friction: .55, frictionStatic: .8, restitution: .06, points: 150 },
      glass: { density: .0021, friction: .38, frictionStatic: .65, restitution: .04, points: 100 },
      concrete: { density: .0058, friction: .62, frictionStatic: .9, restitution: .02, points: 200 }
    },
    ammo: {
      normal: { radius: 13, mass: 22, count: 3 },
      heavy: { radius: 17, mass: 62, count: 2 },
      explosive: { radius: 14, mass: 25, count: 1 }
    }
  });
  Towers.clamp = (value, min, max) => Math.max(min, Math.min(max, value));
})();
