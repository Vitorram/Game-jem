const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

// Componentes React são transpilados com o SWC que já vem com o Next: nenhum pacote novo.
const swc = require('next/dist/build/swc');
const SRC = path.join(__dirname, '..', 'src');

before(async () => {
  await swc.loadBindings();
  const compile = (module, filename) => {
    const { code } = swc.transformSync(fs.readFileSync(filename, 'utf8'), {
      filename,
      jsc: { parser: { syntax: 'typescript', tsx: filename.endsWith('.tsx') }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' },
      module: { type: 'commonjs' },
    });
    module._compile(code, filename);
  };
  require.extensions['.ts'] = compile;
  require.extensions['.tsx'] = compile;
  // CSS Modules viram um objeto que devolve o próprio nome da classe.
  require.extensions['.css'] = module => {
    module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
  };
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith('@/')) request = path.join(SRC, request.slice(2));
    return resolve.call(this, request, ...rest);
  };
});

const render = (file, props) => {
  const { renderToStaticMarkup } = require('react-dom/server');
  const { createElement } = require('react');
  const Component = require(path.join(SRC, 'components', 'game', file)).default;
  return renderToStaticMarkup(createElement(Component, props));
};
const buttons = html => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)]
  .map(([, attributes, inner]) => ({ attributes, text: inner.replace(/<[^>]+>/g, '').trim() }));
const noop = () => {};

test('CT-6.1: guias de Mobilidade e Infraestrutura anunciam a lição, não bloqueiam a tela e só usam botões com texto', () => {
  const guides = [
    ['MobilityTutorialGuide.tsx', [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]],
    ['InfrastructureTutorialGuide.tsx', [0, 2, 4, 5, 6]],
  ];
  for (const [file, steps] of guides) for (const step of steps) {
    const html = render(file, { step, onBegin: noop, onContinue: noop, onComplete: noop, onSkip: noop });
    const label = `${file} etapa ${step}`;
    assert.match(html, /aria-live="polite"/, `${label}: mudança de lição anunciada ao leitor de tela`);
    assert.match(html, /<aside[^>]*aria-label="[^"]+"/, `${label}: cartão com rótulo acessível`);
    assert.doesNotMatch(html, /guide-scrim/, `${label}: sem máscara bloqueando o jogo (CT-5.2)`);
    const actions = buttons(html);
    assert.ok(actions.length >= 2, `${label}: ação principal e pular tutorial`);
    for (const action of actions) assert.ok(action.text.length > 0, `${label}: botão sem texto`);
    const skip = actions.find(action => action.text.startsWith('Pular tutorial'));
    assert.ok(skip && /type="button"/.test(skip.attributes), `${label}: pular tutorial é um botão de verdade`);
    assert.match(skip.attributes, /aria-keyshortcuts="P"/, `${label}: atalho de teclado anunciado`);
  }
});

test('CT-6.1: guia da Analista anuncia a lição e oferece pular o tutorial', () => {
  for (const step of [0, 1, 5]) {
    const html = render('AnalystTutorialGuide.tsx', { step, onBegin: noop, onComplete: noop, onSkip: noop });
    assert.match(html, /aria-live="polite"/);
    assert.ok(buttons(html).some(action => action.text.startsWith('Pular tutorial') && /aria-keyshortcuts="P"/.test(action.attributes)), `etapa ${step}: pular tutorial disponível com atalho`);
  }
});

test('tablet portátil: botão para guardar acessível e tutorial sem fechamento antecipado', () => {
  const html = render('OrlaTablet.tsx', { onAction: noop, onClose: noop });
  assert.match(html, /id="analyst-tablet"/);
  const close = buttons(html).find(action => action.text.includes('Guardar tablet'));
  assert.ok(close);
  assert.match(close.attributes, /type="button"/);
  assert.match(close.attributes, /aria-keyshortcuts="Q"/);
  const tutorial = render('OrlaTablet.tsx', { onAction: noop, tutorialStep: 0 });
  assert.ok(!buttons(tutorial).some(action => action.text.includes('Guardar tablet')));
});

test('coop em dupla: tablet identifica a equipe que opera a central compartilhada', () => {
  assert.match(render('OrlaTablet.tsx', { onAction: noop, onClose: noop }), /ANALISTA <b>◆<\/b> DISPOSITIVO SINCRONIZADO/);
  const shared = render('OrlaTablet.tsx', { onAction: noop, onClose: noop, operator: 'MOBILIDADE · CENTRAL COMPARTILHADA' });
  assert.match(shared, /MOBILIDADE · CENTRAL COMPARTILHADA <b>◆<\/b>/);
  assert.ok(buttons(shared).some(action => action.text.includes('Guardar tablet')), 'cada pessoa guarda o próprio tablet');
});

test('CT-6.1: alertas do tablet usam cor junto com símbolo e texto', () => {
  const { suburbanGameState } = require(path.join(SRC, 'game', 'core', 'GameState.ts'));
  suburbanGameState.reset();
  suburbanGameState.setPhase({ elapsedMs: 0, recovery: false, waitingPedestrians: 6, queuedVehicles: 12 });
  const html = render('OrlaTablet.tsx', { onAction: noop });
  // Cada indicador de fluxo combina classe de cor, ícone e a condição dita em texto.
  const zones = [...html.matchAll(/<span class="flow-zone (green|yellow|red)"[^>]*aria-label="([^"]+)"[^>]*>([\s\S]*?)<\/span>/g)];
  assert.ok(zones.length >= 2, 'indicadores de veículos e de pedestres renderizados');
  for (const [, color, label, inner] of zones) {
    assert.match(label, /condição \S+/, `indicador ${color}: condição dita em texto, não só na cor`);
    assert.match(inner, /<i aria-hidden="true">[^<]+<\/i>/, `indicador ${color}: tem símbolo além da cor`);
  }
  assert.ok(zones.some(([, color, label]) => color !== 'green' && /Pedestres: 6 esperando/.test(label)), 'pedestres em alerta aparecem com outra cor e o número');
  for (const action of buttons(html)) assert.ok(action.text.length > 0 || /aria-label="[^"]+"/.test(action.attributes), 'botão do tablet sem nome acessível');
});

test('CT-6.1: nenhum componente usa clique em elemento não focável sem papel acessível', () => {
  const files = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else if (full.endsWith('.tsx')) files.push(full);
  });
  walk(path.join(SRC, 'components'));
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/onClick=/g)) {
      const open = source.lastIndexOf('<', match.index);
      const tag = source.slice(open + 1).match(/^[A-Za-z][\w.]*/)?.[0];
      // Elementos nativos interativos já são focáveis/anunciados; <dialog> fecha também por Esc e botão.
      if (!tag || /^[A-Z]/.test(tag) || ['button', 'a', 'dialog', 'input', 'select', 'summary'].includes(tag)) continue;
      const element = source.slice(open, match.index);
      if (!/\brole=/.test(element)) offenders.push(`${path.relative(SRC, file)}: <${tag}> clicável sem role`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('CT-4.2: pictograma do carro elétrico tem contraste mínimo de 3:1 (WCAG 1.4.11)', () => {
  const source = fs.readFileSync(path.join(SRC, 'game', 'map', 'GridMapView.ts'), 'utf8');
  const color = key => source.match(new RegExp(`'mark:${key}', '(#[0-9a-f]{6})'`))?.[1];
  const lane = source.match(/electric: '(#[0-9a-f]{6})'/)?.[1];
  const body = color('electric-pictogram'), bolt = color('electric-bolt');
  assert.ok(lane && body && bolt, 'cores do pictograma encontradas no código');
  const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  assert.ok(contrast(body, lane) >= 3, `carro sobre a faixa verde: ${contrast(body, lane).toFixed(2)}:1`);
  // O raio fica desenhado em cima do corpo do carro, então o contraste que importa é com o corpo.
  assert.ok(contrast(bolt, body) >= 3, `raio sobre o carro: ${contrast(bolt, body).toFixed(2)}:1`);
});

test('StoryIntro: prólogo inicia com a cena 3D ativa desde o primeiro beat e oferece controles acessíveis', () => {
  const html = render('StoryIntro.tsx', { onComplete: noop });
  assert.match(html, /role="dialog"[^>]*aria-label="Prólogo do Suburban"/);
  assert.match(html, /\bcinema\b/, 'cena 3D ativa já no beat inicial');
  assert.match(html, /data-shot="city"/);
  const actions = buttons(html);
  assert.ok(actions.some(a => /Pular/.test(a.text)), 'botão de pular prólogo presente');
  assert.ok(actions.some(a => /Revelar texto|Continuar/.test(a.text)), 'botão de avanço presente');
});

test('IntroWorld: monta o cenário do jogo, mantém o tráfego vivo, encena a batida e encadeia os planos de cada beat', t => {
  const three = require('three');
  const { ROAD_LAYOUT } = require(path.join(SRC, 'game', 'map', 'roadLayout.ts'));
  let loop = null, renderedScene = null, renderedCamera = null, renderer = null;
  class MockRenderer {
    shadowMap = {};
    domElement = { setAttribute: noop, remove: noop, style: {} };
    constructor() { renderer = this; }
    setPixelRatio() {}
    setSize() {}
    setAnimationLoop(fn) { loop = fn; }
    render(scene, camera) { renderedScene = scene; renderedCamera = camera; }
    dispose() {}
    forceContextLoss() {}
  }
  const originalLoad = Module._load;
  t.mock.method(Module, '_load', function (id, ...args) {
    if (id === 'three') return { ...three, WebGLRenderer: MockRenderer };
    return originalLoad.call(this, id, ...args);
  });
  globalThis.window = globalThis.window ?? { devicePixelRatio: 1 };
  globalThis.document = globalThis.document ?? { hidden: false, createElement: () => ({ getContext: () => null }) };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };

  const { suburbanGameState } = require(path.join(SRC, 'game', 'core', 'GameState.ts'));
  const roadsBefore = JSON.stringify(suburbanGameState.snapshot().roads);
  const introPath = path.join(SRC, 'game', 'cinematics', 'IntroWorld.ts');
  delete require.cache[introPath];
  const { createIntroWorld } = require(introPath);
  const host = { clientWidth: 1280, clientHeight: 720, prepend: noop, dataset: {} };
  let state = { shot: 'city', beat: 0, reducedMotion: true, paused: false };
  const dispose = createIntroWorld(host, () => state);

  assert.ok(renderedScene && renderedCamera, 'primeiro quadro renderizado imediatamente na montagem');
  const names = new Set();
  renderedScene.traverse(obj => { if (obj.name) names.add(obj.name); });
  for (const name of ['analyst-observation-cabin', 'traffic-flow', 'cycleway-and-pedestrians', 'traffic-signals', 'electric-charger-1'])
    assert.ok(names.has(name), `elemento do jogo presente no prólogo: ${name}`);
  assert.ok([...names].some(n => n.startsWith('city-building-')), 'frente urbana sul fecha o fundo dos planos baixos');
  const kinds = [...names].filter(n => n.startsWith('vehicle-'));
  assert.ok(kinds.length >= 5, `frota variada como no jogo: ${kinds.join(', ')}`);

  const roadZ = 6;
  const vehicles = () => {
    const found = [];
    renderedScene.traverse(obj => { if (obj.name === 'traffic-vehicle' || obj.name === 'intro-vehicle') found.push(obj); });
    return found;
  };
  // Todo veículo com as rodas no chão: o wrapper do jogo sobe 0,27 e o modelo desce 0,27.
  for (const vehicle of vehicles()) assert.ok(Math.abs(vehicle.position.y + vehicle.children[0].position.y) < 1e-6, 'veículo apoiado no chão');
  const filmLane = vehicles().filter(v => v.name === 'intro-vehicle');
  assert.ok(filmLane.length && filmLane.every(v => Math.abs(v.position.z - (roadZ + ROAD_LAYOUT.eastbound[0])) < 1e-4 && v.rotation.y === 0),
    'faixa do filme alinhada à leste 1, com carros retos');

  let time = 16;
  const play = (frames, onFrame = noop) => { for (let i = 0; i < frames; i++, time += 50) { loop(time); onFrame(); } };
  // O tráfego anda mesmo com movimento reduzido: o prólogo é um filme.
  const before = new Map(vehicles().map(v => [v, v.position.x]));
  play(20);
  assert.ok([...before].filter(([v, x]) => Math.abs(v.position.x - x) > .5).length >= 4, 'veículos em movimento');

  const framings = [];
  const canvas = renderer.domElement;
  for (const [beat, shot] of ['city', 'city', 'city', 'incident', 'response', 'team'].entries()) {
    let darkest = 1, lens = '';
    for (const reducedMotion of [false, true]) {
      state = { shot, beat, reducedMotion, paused: false };
      play(30, () => { darkest = Math.min(darkest, Number(canvas.style.opacity)); if (host.dataset.lens) lens = host.dataset.lens; });
      assert.ok(Number.isFinite(renderedCamera.position.x) && Number.isFinite(renderedCamera.position.z));
    }
    framings.push(renderedCamera.position.clone());
    // A câmera de monitoramento e o acidente entram por um mergulho no escuro; os demais encadeiam movimentos.
    if (beat === 2 || beat === 3) assert.ok(darkest < .1, `fade do beat ${beat} escurece a tela (${darkest})`);
    else assert.equal(darkest, 1, `beat ${beat} entra sem fade`);
    if (beat === 2) assert.equal(lens, 'cctv', 'beat 2 usa a lente de monitoramento');
    assert.equal(canvas.style.opacity, '1.000', `beat ${beat} termina com a imagem visível`);
    if (beat === 3) {
      // A batida tira os dois carros do eixo e espalha peças pela pista.
      const crashed = vehicles().filter(v => v.name === 'intro-vehicle' && Math.abs(v.rotation.y) > .15);
      assert.equal(crashed.length, 2, 'os dois carros da batida giram com o impacto');
      const debris = renderedScene.children.filter(c => c.isMesh && c.geometry?.parameters?.width === .09);
      assert.ok(debris.length >= 10, 'peças soltas no asfalto');
    }
  }
  // Cada beat termina num ângulo próprio, inclusive com movimento reduzido.
  framings.forEach((position, i) => i && assert.ok(position.distanceTo(framings[i - 1]) > 2, `beat ${i} troca de ângulo`));
  dispose();
  assert.equal(JSON.stringify(suburbanGameState.snapshot().roads), roadsBefore, 'prólogo não publica estado das vias da partida');
});

test('OrdersHud: tolera 3 expirações sem declarar derrota e exibe fim por 4 missões expiradas', t => {
  const { GameSession } = require(path.join(SRC, 'game', 'session', 'GameSession.ts'));
  const { ORLA_SESSION_CONFIG } = require(path.join(SRC, 'game', 'session', 'sessionData.ts'));
  const { sessionStore } = require(path.join(SRC, 'game', 'session', 'sessionStore.ts'));
  t.mock.method(sessionStore, 'getServerSnapshot', () => sessionStore.getSnapshot());
  const session = new GameSession(ORLA_SESSION_CONFIG);
  sessionStore.bind(session);
  sessionStore.start();
  // Expira os 4 primeiros chamados em série até encerrar a partida.
  for (let i = 0; i < 4; i++) sessionStore.tick(200_000);
  assert.equal(session.snapshot().status, 'finished');
  assert.equal(session.snapshot().expiredOrders, 4);
  const html = render('OrdersHud.tsx', { paused: false });
  assert.match(html, /VOCÊ PERDEU/);
  assert.match(html, /Quatro missões venceram sem ser concluídas/);
  assert.match(html, /Quatro missões expiraram/);
  sessionStore.unbind(session);
});
