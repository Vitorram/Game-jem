const fs = require('node:fs');
const Module = require('node:module');
const { stripTypeScriptTypes } = Module;
const assert = require('node:assert/strict');
const { test } = require('node:test');

// Mesmo carregamento dos testes de personagens; transform aceita o construtor do Game.
require.extensions['.ts'] = (module, filename) => {
  let source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'), { mode: 'transform' });
  const names = [...source.matchAll(/export (?:class|const) (\w+)/g)].map(match => match[1]);
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, 'const {$1} = require(\'$2\');')
    .replace(/export (class|const) /g, '$1 ');
  module._compile(source + '\nObject.assign(exports, {' + names.join(',') + '});', filename);
};
const { GridMap } = require('../src/game/map/GridMap.ts');
const { ORLA_MAP } = require('../src/game/map/orlaMap.ts');
const { RiskWorkflow } = require('../src/game/risks/RiskWorkflow.ts');
const { ORLA_RISKS, ORLA_ROUTE } = require('../src/game/risks/riskData.ts');
const { inspectRisk, installSensor, cycleLight, moveRouteStop } = require('../src/game/core/AbilityActions.ts');
const fixture = () => {
  const map = new GridMap(ORLA_MAP, 2, 0.3);
  return new RiskWorkflow(ORLA_RISKS.map(risk => ({ ...risk, point: map.cellCenter(risk.column, risk.row) })), {
    stops: ORLA_ROUTE.stops.map(cell => map.cellCenter(cell.column, cell.row)), movedIndex: ORLA_ROUTE.movedIndex,
    destination: map.cellCenter(ORLA_ROUTE.destination.column, ORLA_ROUTE.destination.row),
  });
};
const status = (flow, index) => flow.snapshot().risks[index].status;
const release = (flow, cell) => { flow.interact(3, cell); flow.interact(3, cell); };

test('três riscos distintos em células acessíveis sem sobrepor caixas ou bancadas', () => {
  const map = new GridMap(ORLA_MAP, 2, 0.3);
  assert.deepEqual(new Set(ORLA_RISKS.map(r => r.kind)), new Set(['light', 'sensor', 'route']));
  for (const risk of ORLA_RISKS) {
    assert.equal(map.isSolid(risk.column, risk.row), false);
    assert.equal(map.isSolid(risk.column, risk.row - 1), false);
  }
  for (const point of [...ORLA_ROUTE.stops, ORLA_ROUTE.destination]) assert.equal(map.isSolid(point.column, point.row), false);
});

test('especialistas não inspecionam, não marcam e não resolvem antes da liberação', () => {
  const flow = fixture();
  ORLA_RISKS.forEach((risk, index) => {
    for (const role of [1, 2]) { flow.interact(role, risk); assert.equal(status(flow, index), 'hidden'); }
    flow.interact(3, risk);
    assert.equal(status(flow, index), 'inspected');
    for (const role of [1, 2]) { flow.interact(role, risk); assert.equal(status(flow, index), 'inspected'); }
    flow.interact(3, risk);
    assert.equal(status(flow, index), 'released');
  });
  assert.deepEqual(flow.snapshot().sensors, []);
  assert.equal(flow.snapshot().light, null);
});

test('Análise libera e só o especialista correto resolve luz, sensor e rota', () => {
  const flow = fixture();
  ORLA_RISKS.forEach((risk, index) => {
    release(flow, risk);
    flow.interact(risk.kind === 'route' ? 1 : 2, risk);
    assert.equal(status(flow, index), 'released');
    flow.interact(3, risk);
    assert.equal(status(flow, index), 'released', 'Análise não resolve nem desmarca');
    flow.interact(risk.kind === 'route' ? 2 : 1, risk);
    if (risk.kind === 'route') {
      assert.equal(status(flow, index), 'routing');
      flow.interact(2, risk);
    }
    assert.equal(status(flow, index), 'resolved');
  });
  assert.equal(flow.snapshot().sensors.length, 1);
  assert.equal(flow.snapshot().light.level, 1);
  assert.match(flow.snapshot().message, /três riscos/);
});

test('rota mantém original até confirmar; seleção cancela só o rascunho', () => {
  const flow = fixture(), risk = ORLA_RISKS[2];
  const original = flow.snapshot().stops;
  release(flow, risk); flow.interact(2, risk);
  assert.deepEqual(flow.snapshot().stops, original);
  assert.notDeepEqual(flow.snapshot().draft, original);
  assert.equal(flow.selectRole(2), false);
  assert.equal(flow.selectRole(1), true);
  assert.equal(status(flow, 2), 'released');
  assert.equal(flow.snapshot().draft, null);
  flow.interact(2, risk);
  const draft = flow.snapshot().draft;
  flow.interact(2, risk);
  assert.deepEqual(flow.snapshot().stops, draft);
  assert.equal(flow.snapshot().draft, null);
  flow.selectRole(3);
  assert.equal(status(flow, 2), 'resolved');
  assert.deepEqual(flow.snapshot().stops, draft);
});

test('ações repetidas não duplicam sensores nem apagam luz ou rota resolvidas', () => {
  const flow = fixture();
  for (const risk of ORLA_RISKS) {
    release(flow, risk);
    flow.interact(risk.kind === 'route' ? 2 : 1, risk);
    if (risk.kind === 'route') flow.interact(2, risk);
  }
  const before = flow.snapshot();
  for (const role of [1, 2, 3]) for (const risk of ORLA_RISKS) flow.interact(role, risk);
  const after = flow.snapshot();
  assert.deepEqual(after.risks, before.risks);
  assert.deepEqual(after.light, before.light);
  assert.deepEqual(after.sensors, before.sensors);
  assert.deepEqual(after.stops, before.stops);
});

test('célula vazia é no-op e snapshots não expõem estado mutável', () => {
  const flow = fixture(), before = flow.snapshot();
  assert.equal(flow.interact(3, { column: -1, row: 0 }), false);
  assert.equal(flow.interact(3, { column: NaN, row: 7 }), false);
  assert.deepEqual(flow.snapshot(), before);
  before.risks[0].status = 'resolved'; before.stops[0].x = 999;
  assert.equal(status(flow, 0), 'hidden');
  assert.notEqual(flow.snapshot().stops[0].x, 999);
  assert.equal(Object.keys(require.cache).some(path => path.includes('/node_modules/three/')), false);
});

test('operações extraídas preservam inspeção, limite de sensores, ciclo de luz e distância de paradas', () => {
  const issue = { revealed: false, marked: false };
  assert.equal(inspectRisk(issue, true).marked, false);
  const revealed = inspectRisk(issue);
  assert.equal(inspectRisk(revealed, true).marked, true);
  assert.equal(issue.revealed, false);
  assert.equal(installSensor([{ x: 0, z: 0 }], { x: 0.1, z: 0 }).result, 'near');
  assert.equal(installSensor(Array.from({ length: 5 }, (_, x) => ({ x, z: 0 })), { x: 8, z: 0 }).result, 'limit');
  let light = cycleLight(null, { x: 0, z: 0 });
  light = cycleLight(light, { x: 8, z: 8 });
  assert.deepEqual(light, { x: 0, z: 0, level: 2 });
  assert.equal(cycleLight(light, { x: 8, z: 8 }).level, 0);
  const stops = [{ x: 0, z: 0 }, { x: 2, z: 0 }];
  assert.equal(moveRouteStop(stops, 0, { x: 2.1, z: 0 }), null);
  assert.deepEqual(stops, [{ x: 0, z: 0 }, { x: 2, z: 0 }]);
});
