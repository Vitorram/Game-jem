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
  return { map, traffic, mobility, dispose() { mobility.dispose(); traffic.dispose(); } };
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
        // O lote tem sempre 3; quem chega primeiro ao destino sai de 'cross-road'.
        assert.equal(w.mobility.roadBatch.length, 3);
        // O grupo atravessa em fila indiana: mesmo X, espaçamento fixo de 0,72 em Z.
        assert.ok(Math.max(...crossing.map(p => p.x)) - Math.min(...crossing.map(p => p.x)) < .001);
        const zs = w.mobility.roadBatch.map(p => p.z).sort((a, b) => a - b);
        assert.ok(zs[2] - zs[0] <= 1.44 + .001, 'fila deve manter no máximo o espaçamento inicial');
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

/** Deixa só dois carros na faixa principal de sentido +1, nas posições pedidas, sem novos carros por perto. */
function twoCars(w, firstX, secondX) {
  const lane = w.traffic.lanes.find(l => l.type === 'PRINCIPAL' && l.direction === 1);
  w.mobility.spawnWalkerTimer = Infinity;
  w.mobility.walkers.forEach(p => { p.state = 'exit'; p.x = -17; p.z = 10.75; });
  w.traffic.setScheduledDemand(0);
  const [a, b] = w.traffic.vehicles;
  w.traffic.vehicles.slice(2).forEach(v => w.traffic.removeVehicle(v));
  for (const [v, x] of [[a, firstX], [b, secondX]]) {
    v.lane = lane; v.homeLane = lane; v.preferredLane = lane; v.kind = 'sedan';
    v.mesh.position.set(x, 0.27, lane.z); v.speed = 1.5; v.maxSpeed = 1.7;
  }
  return { lane, a, b, crossingX: w.traffic.pedestrianCrossingX };
}

test('CT-2.2: carro que já passou da faixa continua quando a pista é bloqueada; o que chega para', () => {
  const w = world();
  try {
    const { lane, a, b, crossingX } = twoCars(w, 0, 0);
    a.mesh.position.x = crossingX + 5;
    b.mesh.position.x = crossingX - 8;
    w.traffic.applyMobilityAction(lane.id, 'block');
    const startA = a.mesh.position.x;
    tick(w, 4);
    assert.ok(a.mesh.position.x - startA > 3, 'quem já cruzou a faixa segue até sair do mapa');
    assert.ok(b.speed < .01, 'quem ainda chega à faixa para');
    assert.ok(b.mesh.position.x < crossingX - CROSSING_RULES.roadConflictHalfWidth, 'e para antes da faixa');
  } finally { w.dispose(); }
});

test('CT-2.3: sem espaço depois da faixa o carro espera antes dela, nunca sobre ela', () => {
  const w = world();
  try {
    const { a, b, crossingX } = twoCars(w, 0, 0);
    // O da frente está parado logo depois da faixa; sobra menos que um carro entre a faixa e ele.
    a.mesh.position.x = crossingX + CROSSING_RULES.roadConflictHalfWidth + 0.9;
    a.speed = 0; a.maxSpeed = 0;
    b.mesh.position.x = crossingX - 7;
    tick(w, 12, () => {
      assert.ok(b.mesh.position.x <= crossingX - CROSSING_RULES.roadStopDistance + .05, 'carro invadiu a faixa sem espaço para sair');
    });
    assert.ok(b.speed < .01);
    // Quando a fila anda e abre espaço, o carro volta a seguir.
    a.maxSpeed = 1.7;
    tick(w, 8);
    assert.ok(b.mesh.position.x > crossingX, 'com espaço livre o carro atravessa');
  } finally { w.dispose(); }
});

test('CT-3.2: pedestre em dispersão contorna obstáculo urbano e segue adiante', () => {
  const w = world();
  try {
    w.mobility.spawnWalkerTimer = Infinity;
    const z = 9.2;
    w.mobility.walkers.forEach((p, i) => {
      p.state = 'exit'; p.exitDirection = 1; p.z = z + (i ? 6 : 0); p.x = -5 - i * 3; p.speed = .8;
    });
    const walker = w.mobility.walkers[0];
    // Poste, lixeira ou banco exatamente na linha de caminhada do pedestre.
    const obstacle = { x: -3, z, radius: .3 };
    w.map.addObstacle(obstacle.x, obstacle.z, obstacle.radius);
    let closest = Infinity;
    tick(w, 7, () => { closest = Math.min(closest, Math.hypot(walker.x - obstacle.x, walker.z - obstacle.z)); });
    assert.ok(closest >= obstacle.radius + .17 - 1e-6, `pedestre atravessou o obstáculo (distância mínima ${closest.toFixed(3)})`);
    assert.ok(walker.x > obstacle.x + 1, 'depois de contornar, o pedestre continua em frente');
  } finally { w.dispose(); }
});

test('combinação CT-2.2 + CT-2.3: com bloqueios e liberações alternados, nenhum carro fica parado sobre a faixa', () => {
  for (const dt of [.05, 1 / 60]) {
    const w = world();
    try {
      const crossingX = w.traffic.pedestrianCrossingX;
      const zone = CROSSING_RULES.roadConflictHalfWidth;
      const east = w.traffic.lanes.find(l => l.type === 'PRINCIPAL' && l.direction === 1);
      const west = w.traffic.lanes.find(l => l.type === 'PRINCIPAL' && l.direction === -1);
      const schedule = [['block', east], ['release', east], ['blockAll', east], ['release', west], ['block', west], ['release', east]];
      const stoppedFor = new Map();
      let step = 0, sampled = 0, longest = 0;
      tick(w, 240, () => {
        const t = sampled++ * dt;
        if (t >= (step + 1) * 14 && step < schedule.length * 3) {
          const [action, lane] = schedule[step++ % schedule.length];
          w.traffic.applyMobilityAction(lane.id, action);
        }
        for (const v of w.traffic.vehicles) {
          const inZone = Math.abs(v.mesh.position.x - crossingX) < zone && v.lane.type === 'PRINCIPAL';
          if (inZone && v.speed < .05) {
            const time = (stoppedFor.get(v) ?? 0) + dt;
            stoppedFor.set(v, time);
            longest = Math.max(longest, time);
          } else stoppedFor.delete(v);
        }
      }, dt);
      assert.ok(longest <= 2.5, `carro parado ${longest.toFixed(1)} s sobre a faixa (dt=${dt.toFixed(3)})`);
      assert.ok(w.traffic.vehicles.some(v => v.speed > .3), 'o trânsito continua circulando depois de todas as intervenções');
    } finally { w.dispose(); }
  }
});

test('A1: fila cheia na travessia fica na calçada, sem pedestres sobrepostos nem no eixo do grupo', () => {
  const w = world();
  try {
    w.mobility.setCrossingIncident(true);
    w.mobility.setRoadBatchHold(true);
    let worstGap = Infinity, maxWaiting = 0;
    tick(w, 60, () => {
      const waiting = w.mobility.walkers.filter(p => p.state === 'wait-road');
      maxWaiting = Math.max(maxWaiting, waiting.length);
      for (const p of waiting) {
        assert.ok(p.z > w.mobility.cycleSouthZ + .17, `pedestre esperando sobre a ciclovia (z=${p.z.toFixed(2)})`);
        assert.ok(p.z < w.mobility.roadNorthEdgeZ - .17, `pedestre esperando na pista (z=${p.z.toFixed(2)})`);
        assert.ok(Math.abs(p.x - w.traffic.pedestrianCrossingX) > .3, 'quem espera deixa livre o eixo onde o grupo se forma');
      }
      for (let i = 0; i < waiting.length; i++) for (let j = i + 1; j < waiting.length; j++) {
        worstGap = Math.min(worstGap, Math.hypot(waiting[i].x - waiting[j].x, waiting[i].z - waiting[j].z));
      }
    });
    assert.ok(maxWaiting >= 6, `a fila enche durante o incidente (${maxWaiting})`);
    assert.ok(worstGap >= .45, `pedestres esperando a ${worstGap.toFixed(2)} m uns dos outros`);
  } finally { w.dispose(); }
});
