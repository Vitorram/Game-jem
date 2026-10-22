const fs = require('node:fs');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');

require.extensions['.ts'] = (module, filename) => {
  let source = Module.stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'), { mode: 'transform' });
  const names = [...source.matchAll(/export (?:class|const|function) (\w+)/g)].map(match => match[1]);
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, 'const {$1} = require(\'$2\');')
    .replace(/export (class|const|function) /g, '$1 ');
  module._compile(source + '\nObject.assign(exports, {' + names.join(',') + '});', filename);
};
const { GridMap } = require('../src/game/map/GridMap.ts');
const { ORLA_MAP } = require('../src/game/map/orlaMap.ts');
const { TrafficSystem } = require('../src/game/traffic/TrafficSystem.ts');
const { ActiveMobilitySystem } = require('../src/game/traffic/ActiveMobilitySystem.ts');
const { CROSSING_RULES } = require('../src/game/traffic/crossingRules.ts');
const { suburbanGameState } = require('../src/game/core/GameState.ts');

function world() {
  suburbanGameState.reset();
  const map = new GridMap(ORLA_MAP, 2, .3);
  const traffic = new TrafficSystem(map);
  const mobility = new ActiveMobilitySystem(map, traffic);
  return { traffic, mobility, dispose() { mobility.dispose(); traffic.dispose(); } };
}
function tick(world, seconds, inspect = () => {}, dt = .05) {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) {
    world.traffic.update(dt); world.mobility.update(dt); inspect();
  }
}

test('um ou dois pedestres na avenida nao param os ciclistas nem os carros', () => {
  const w = world();
  try {
    w.mobility.spawnWalkerTimer = Infinity;
    w.mobility.walkers.forEach((p, i) => { p.state = i < 2 ? 'wait-road' : 'exit'; p.x = i < 2 ? 1 : -17; p.z = i < 2 ? 5.5 : 10.75; });
    const cyclist = w.mobility.cyclists[0]; cyclist.x = -3; cyclist.mesh.position.x = -3; cyclist.direction = 1;
    const initialCars = w.traffic.vehicles.map(v => [v, v.mesh.position.x]);
    tick(w, 5);
    assert.equal(w.traffic.waitingPedestrians, 0);
    assert.equal(w.mobility.roadBatch.length, 0);
    assert.ok(cyclist.x > 2, 'bicicleta deve atravessar sem pedestre na ciclovia');
    assert.ok(initialCars.some(([v, x]) => Math.abs(v.mesh.position.x - x) > 3), 'carros devem continuar');
  } finally { w.dispose(); }
});

test('um pedestre na ciclovia para as bicicletas, atravessa e libera sem parar os carros', () => {
  const w = world();
  try {
    w.mobility.spawnWalkerTimer = Infinity;
    const p = w.mobility.walkers[0]; p.state = 'wait-cycle'; p.x = 1; p.z = 1.5;
    w.mobility.walkers.slice(1).forEach(p => { p.state = 'exit'; p.z = 10.75; });
    const cyclist = w.mobility.cyclists[0]; cyclist.x = -2; cyclist.direction = 1; cyclist.speed = 2;
    let crossed = false, stopped = false;
    tick(w, 14, () => {
      stopped ||= cyclist.speed < .01;
      crossed ||= p.state === 'cross-cycle';
      assert.equal(w.traffic.waitingPedestrians, 0);
      if (p.state === 'cross-cycle') for (const c of w.mobility.cyclists) {
        assert.ok(Math.abs(c.x - 1) >= CROSSING_RULES.cycleConflictHalfWidth - .001, 'bicicleta invadiu a faixa ocupada');
      }
    });
    assert.ok(stopped && crossed);
    assert.equal(w.mobility.cycleBatch, null);
    assert.ok(cyclist.x > 3, 'bicicleta precisa retomar');
  } finally { w.dispose(); }
});

test('trio inicia junto, carros respeitam a faixa e retomam quando o ultimo sai', () => {
  const w = world();
  try {
    w.mobility.spawnWalkerTimer = Infinity;
    w.mobility.walkers.forEach((p, i) => {
      p.state = i < 3 ? 'wait-road' : 'exit'; p.x = 1 + (i - 1) * .48; p.z = i < 3 ? 5.5 : 10.75;
    });
    let sawGroup = false, sawStoppedCar = false, released = false, resumed = false;
    tick(w, 35, () => {
      const crossing = w.mobility.walkers.filter(p => p.state === 'cross-road');
      if (crossing.length) {
        sawGroup = true;
        assert.equal(crossing.length, 3);
        assert.ok(Math.max(...crossing.map(p => p.z)) - Math.min(...crossing.map(p => p.z)) < .001);
        for (const v of w.traffic.vehicles) assert.ok(Math.abs(v.mesh.position.x - 1) >= CROSSING_RULES.roadConflictHalfWidth - .001, 'carro invadiu faixa ocupada');
      }
      sawStoppedCar ||= w.traffic.waitingPedestrians >= 3 && w.traffic.vehicles.some(v => v.speed < .01);
      released ||= sawGroup && w.mobility.roadBatch.length === 0;
      resumed ||= released && w.traffic.vehicles.some(v => Math.abs(v.mesh.position.x - 1) < 1 && v.speed > .3);
    });
    assert.ok(sawGroup && sawStoppedCar && released && resumed, JSON.stringify({ sawGroup, sawStoppedCar, released, resumed }));
  } finally { w.dispose(); }
});

for (const dt of [.05, 1 / 60]) test(`fluxo continuo por 180s sem travamento nem invasao (dt=${dt})`, () => {
  const w = world();
  let groups = 0, previousCrossing = false, cyclePassages = 0, previousCycle = null;
  try {
    tick(w, 180, () => {
      const occupied = w.mobility.walkers.some(p => p.state === 'cross-road');
      if (occupied && !previousCrossing) groups++;
      previousCrossing = occupied;
      const cycle = w.mobility.walkers.find(p => p.state === 'cross-cycle');
      if (cycle && cycle !== previousCycle) cyclePassages++;
      previousCycle = cycle;
      if (occupied) for (const v of w.traffic.vehicles) {
        assert.ok(Math.abs(v.mesh.position.x - 1) >= CROSSING_RULES.roadConflictHalfWidth - .001, 'sobreposicao carro/pedestre');
      }
      if (cycle) for (const c of w.mobility.cyclists) {
        assert.ok(Math.abs(c.x - 1) >= CROSSING_RULES.cycleConflictHalfWidth - .001, 'sobreposicao bicicleta/pedestre');
      }
      for (const p of w.mobility.walkers) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
    }, dt);
    assert.ok(groups >= 3, `apenas ${groups} grupos atravessaram`);
    assert.ok(cyclePassages >= 5, `apenas ${cyclePassages} travessias da ciclovia`);
  } finally { w.dispose(); }
});
