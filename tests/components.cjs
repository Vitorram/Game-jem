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
