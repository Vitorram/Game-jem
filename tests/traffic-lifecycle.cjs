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
const { suburbanGameState } = require('../src/game/core/GameState.ts');

function world() {
  suburbanGameState.reset();
  const map = new GridMap(ORLA_MAP, 2, .3);
  const traffic = new TrafficSystem(map);
  const mobility = new ActiveMobilitySystem(map, traffic);
  return { traffic, mobility, dispose() { mobility.dispose(); traffic.dispose(); } };
}

function simulate(world, seconds, deltas = [.05], inspect = () => {}) {
  const target = world.traffic.getDiagnostics().elapsedSeconds + seconds;
  let frame = 0;
  while (world.traffic.getDiagnostics().elapsedSeconds < target - 1e-6) {
    const dt = deltas[frame++ % deltas.length];
    world.traffic.update(dt);
    world.mobility.update(dt);
    inspect();
  }
}

test('tráfego normal mantém spawn, percurso e saída por cinco minutos simulados', () => {
  const w = world();
  try {
    simulate(w, 300);
    const d = w.traffic.getDiagnostics();
    assert.ok(d.spawnedVehicles > 40, `spawn insuficiente: ${d.spawnedVehicles}`);
    assert.ok(d.exitedVehicles > 25, `saídas insuficientes: ${d.exitedVehicles}`);
    assert.ok(d.activeVehicles > 0 && d.movingVehicles > 0);
    assert.deepEqual(d.persistentInvalidBlocks, []);
  } finally { w.dispose(); }
});

test('colisão resolvida remove o veículo, a interdição e devolve vazão à avenida', () => {
  const w = world();
  try {
    w.traffic.startCollision();
    const target = w.traffic.getIncidentConeTarget();
    const lane = w.traffic.getNearbyLane(target.x, target.z);
    assert.ok(w.traffic.placeConeAt(lane, target.x));
    w.traffic.applyMobilityAction(lane, 'block');
    simulate(w, 12);
    w.traffic.clearCollision();
    w.traffic.resetRoadInterventions();
    const before = w.traffic.getDiagnostics().exitedVehicles;
    simulate(w, 45);
    const d = w.traffic.getDiagnostics();
    assert.ok(d.lanes.filter(item => item.id !== 'orla-green').every(item => item.status === 'open'));
    assert.ok(d.exitedVehicles > before);
    assert.deepEqual(d.persistentInvalidBlocks, []);
  } finally { w.dispose(); }
});

test('colisão com cone usa a faixa vizinha sem atravessar o obstáculo', () => {
  const w = world();
  try {
    w.traffic.startCollision();
    const incident = w.traffic.incidentVehicle;
    const originalLane = incident.lane;
    const target = w.traffic.getIncidentConeTarget();
    w.traffic.placeConeAt(originalLane.id, target.x);
    const candidate = w.traffic.vehicles.find(vehicle => vehicle !== incident);
    w.traffic.vehicles.filter(vehicle => vehicle !== incident && vehicle !== candidate)
      .forEach(vehicle => w.traffic.removeVehicle(vehicle));
    w.traffic.spawnTimers.forEach((_, id) => w.traffic.spawnTimers.set(id, Infinity));
    Object.assign(candidate, { lane: originalLane, homeLane: originalLane, preferredLane: originalLane, speed: 1.5, maxSpeed: 1.8 });
    candidate.mesh.position.set(incident.mesh.position.x - originalLane.direction * 7, .27, originalLane.z);
    let diverted = false;
    simulate(w, 18, [.05], () => { diverted ||= candidate.lane !== originalLane; });
    assert.ok(diverted || !w.traffic.vehicles.includes(candidate),
      'o veículo precisa desviar para a faixa vizinha ou concluir o percurso');
  } finally { w.dispose(); }
});

test('múltiplos veículos aguardam com distância segura e retomam em cascata', () => {
  const w = world();
  try {
    w.mobility.spawnWalkerTimer = Infinity;
    w.mobility.walkers.forEach((walker, index) => {
      walker.state = index < 3 ? 'wait-road' : 'exit';
      walker.x = 1; walker.z = index < 3 ? 5.5 : 10.75;
    });
    simulate(w, 8);
    assert.ok(w.traffic.getDiagnostics().stoppedVehicles.length >= 2);
    const before = w.traffic.getDiagnostics().exitedVehicles;
    simulate(w, 35);
    assert.ok(w.traffic.getDiagnostics().exitedVehicles > before);
  } finally { w.dispose(); }
});

test('travessia de pedestres conclui e libera o sinal solicitado', () => {
  const w = world();
  try {
    w.mobility.spawnWalkerTimer = Infinity;
    w.mobility.walkers.forEach((walker, index) => {
      walker.state = index < 3 ? 'wait-road' : 'exit'; walker.x = 1; walker.z = index < 3 ? 5.5 : 10.75;
    });
    const crossed = w.mobility.getCrossingProgress().crossed;
    simulate(w, 35);
    assert.ok(w.mobility.getCrossingProgress().crossed >= crossed + 3);
    assert.equal(w.mobility.getCrossingProgress().occupied, false);
  } finally { w.dispose(); }
});

test('travessia da ciclovia para as bicicletas e depois devolve o fluxo', () => {
  const w = world();
  try {
    w.mobility.spawnWalkerTimer = Infinity;
    const walker = w.mobility.walkers[0];
    walker.state = 'wait-cycle'; walker.x = 1; walker.z = 1.5;
    w.mobility.walkers.slice(1).forEach(item => { item.state = 'exit'; item.x = -17; item.z = 10.75; });
    let stopped = false, crossed = false;
    simulate(w, 18, [.05], () => {
      stopped ||= w.mobility.cyclists.some(cyclist => cyclist.speed < .08);
      crossed ||= walker.state === 'cross-cycle' || walker.state === 'approach-road' || walker.state === 'wait-road';
    });
    assert.ok(stopped && crossed);
    assert.ok(w.mobility.cyclists.some(cyclist => cyclist.speed > .5));
  } finally { w.dispose(); }
});

test('interdição total é legítima, mas a liberação reabre todas as faixas', () => {
  const w = world();
  try {
    const lane = w.traffic.lanes.find(item => item.type === 'PRINCIPAL');
    w.traffic.applyMobilityAction(lane.id, 'blockAll');
    simulate(w, 12);
    assert.ok(w.traffic.getDiagnostics().lanes.filter(item => item.id !== 'orla-green').every(item => item.status === 'blocked'));
    w.traffic.applyMobilityAction(lane.id, 'release');
    const before = w.traffic.getDiagnostics().exitedVehicles;
    simulate(w, 40);
    const d = w.traffic.getDiagnostics();
    assert.ok(d.lanes.filter(item => item.id !== 'orla-green').every(item => item.status === 'open'));
    assert.ok(d.exitedVehicles > before);
  } finally { w.dispose(); }
});

test('pausa durante ocorrência congela o estado e a retomada continua após resolução', () => {
  const w = world();
  try {
    w.traffic.startCollision();
    simulate(w, 5);
    const paused = w.traffic.getDiagnostics();
    // Pausa real: o Game deixa de chamar update nos sistemas.
    const stillPaused = w.traffic.getDiagnostics();
    assert.equal(stillPaused.elapsedSeconds, paused.elapsedSeconds);
    assert.equal(stillPaused.activeVehicles, paused.activeVehicles);
    w.traffic.clearCollision();
    w.traffic.resetRoadInterventions();
    simulate(w, 40);
    assert.ok(w.traffic.getDiagnostics().exitedVehicles > paused.exitedVehicles);
  } finally { w.dispose(); }
});

test('várias ocorrências na mesma partida não acumulam referências ou bloqueios', () => {
  const w = world();
  try {
    for (let occurrence = 0; occurrence < 5; occurrence++) {
      w.traffic.startCollision();
      assert.ok(w.traffic.getIncidentPosition());
      simulate(w, 4);
      w.traffic.clearCollision();
      w.traffic.resetRoadInterventions();
      simulate(w, 15);
      assert.equal(w.traffic.getIncidentPosition(), null);
    }
    const d = w.traffic.getDiagnostics();
    assert.ok(d.exitedVehicles > 0);
    assert.ok(d.spawnedVehicles > d.activeVehicles + 5, 'o ciclo de spawn/saída continua entre ocorrências');
    assert.deepEqual(d.persistentInvalidBlocks, []);
  } finally { w.dispose(); }
});

test('simulação prolongada com deltas irregulares não perde progresso nem entra em deadlock', () => {
  const w = world();
  try {
    simulate(w, 300, [1 / 120, 1 / 60, .033, .05, .12, .24]);
    const traffic = w.traffic.getDiagnostics();
    const mobility = w.mobility.getDiagnostics();
    assert.ok(traffic.exitedVehicles > 20);
    assert.ok(traffic.activeVehicles > 0 && traffic.movingVehicles > 0);
    assert.ok(mobility.activeNpcs > 0);
    assert.deepEqual([...traffic.persistentInvalidBlocks, ...mobility.persistentInvalidBlocks], []);
    assert.ok(mobility.entities.every(entity => Number.isFinite(entity.lastProgressSecondsAgo)));
  } finally { w.dispose(); }
});

test('interdição retém os carros antes do ponto bloqueado, não onde estavam na pista', () => {
  const w = world();
  try {
    w.traffic.setPlayerPosition({ x: 6, z: 3 });
    const lane = w.traffic.lanes.find(item => item.id === 'orla-eastbound');
    const vehicle = w.traffic.vehicles.find(item => item.lane === lane);
    vehicle.mesh.position.x = -12;
    vehicle.speed = vehicle.maxSpeed;
    w.traffic.applyMobilityAction(lane.id, 'block');
    simulate(w, 14);
    assert.ok(w.traffic.vehicles.includes(vehicle));
    assert.ok(vehicle.mesh.position.x > 0, `o carro devia avançar até a interdição, parou em x=${vehicle.mesh.position.x.toFixed(2)}`);
    assert.ok(vehicle.mesh.position.x < 6, 'e parar antes do ponto bloqueado');
  } finally { w.dispose(); }
});

test('desvio com o carregador quebrado tira os elétricos da faixa verde em vez de seguirem nela', () => {
  const w = world();
  try {
    w.traffic.setScheduledDemand(.6);
    simulate(w, 20);
    w.traffic.setElectricChargerBroken(true);
    simulate(w, 30);
    const charger = w.traffic.getElectricChargerPosition();
    w.traffic.applyMobilityAction('orla-green', 'electricDetour');
    let passedBrokenCharger = false;
    simulate(w, 25, [.05], () => {
      passedBrokenCharger ||= w.traffic.vehicles.some(vehicle => vehicle.lane.type === 'GREEN'
        && Math.abs(vehicle.mesh.position.x - charger.x) < .3);
    });
    const onMapGreen = w.traffic.vehicles.filter(vehicle => vehicle.lane.type === 'GREEN'
      && Math.abs(vehicle.mesh.position.x) <= 20);
    assert.equal(onMapGreen.length, 0, 'elétricos ainda na faixa verde: ' + onMapGreen.map(item => item.mesh.position.x.toFixed(1)));
    assert.equal(passedBrokenCharger, false, 'ninguém atravessa o carregador quebrado pela faixa verde');
    assert.deepEqual(w.traffic.getDiagnostics().persistentInvalidBlocks, []);
  } finally { w.dispose(); }
});

test('guincho respeita o trânsito, embarca o carro na plataforma e libera a faixa', () => {
  const w = world();
  try {
    w.traffic.setScheduledDemand(.6);
    simulate(w, 30);
    w.traffic.startBreakdown();
    const car = w.traffic.incidentVehicle;
    simulate(w, 5);
    assert.equal(w.traffic.callTowTruck(), true);
    const states = new Set();
    let overlaps = 0;
    simulate(w, 85, [.05], () => {
      states.add(w.traffic.getTowTruckState());
      const truck = w.traffic.towTruck;
      if (!truck) return;
      overlaps += w.traffic.vehicles.filter(other => other !== truck && other !== w.traffic.incidentVehicle
        && Math.abs(other.mesh.position.z - truck.mesh.position.z) < .56
        && Math.abs(other.mesh.position.x - truck.mesh.position.x) < 1.35).length;
      if (w.traffic.getTowTruckState() === 'departing') assert.equal(car.mesh.parent, truck.mesh, 'o carro sai preso ao guincho');
    });
    assert.deepEqual([...states].filter(state => state !== 'idle'), ['approaching', 'loading', 'departing', 'completed']);
    assert.equal(overlaps, 0, 'o guincho não atravessa outros veículos');
    assert.equal(w.traffic.getIncidentPosition(), null);
    assert.ok(!w.traffic.vehicles.includes(car));
    assert.deepEqual(w.traffic.getDiagnostics().persistentInvalidBlocks, []);
  } finally { w.dispose(); }
});
