'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimationMixer, Box3, CapsuleGeometry, Clock, Color, DirectionalLight, GridHelper, Group, HemisphereLight, Mesh, MeshStandardMaterial, PlaneGeometry, Scene, Vector3, WebGLRenderer, PerspectiveCamera, PCFSoftShadowMap } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = '/assets/characters/personagem.glb';

export default function CharacterPreview() {
  const host = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('Carregando personagem de exemplo…');
  const [filename, setFilename] = useState('personagem.glb');
  const [moving, setMoving] = useState(false);
  const [restart, setRestart] = useState(0);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const scene = new Scene();
    scene.background = new Color('#111a20');
    const camera = new PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 3.2, 7);
    camera.lookAt(0, 1, 0);
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    element.appendChild(renderer.domElement);
    scene.add(new HemisphereLight('#dcecff', '#36443b', 2.5));
    const sun = new DirectionalLight('#fff1d4', 3);
    sun.position.set(5, 8, 5);
    sun.castShadow = true;
    scene.add(sun);
    const floor = new Mesh(new PlaneGeometry(20, 20), new MeshStandardMaterial({ color: '#253736', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new GridHelper(20, 20, '#65806b', '#344947');
    grid.position.y = 0.01;
    scene.add(grid);

    let character: Group | null = null;
    let mixer: AnimationMixer | null = null;
    let walkingAction: ReturnType<AnimationMixer['clipAction']> | null = null;
    let wasWalking = false;
    let blobUrl: string | null = null;
    let alive = true;
    const clock = new Clock();
    const keys = new Set<string>();
    const onDown = (event: KeyboardEvent) => { if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) { keys.add(event.code); setMoving(true); } };
    const onUp = (event: KeyboardEvent) => { keys.delete(event.code); setMoving(keys.size > 0); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);

    const resize = () => {
      const width = Math.max(element.clientWidth, 1);
      const height = Math.max(element.clientHeight, 1);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    const addPlaceholder = () => {
      const mesh = new Mesh(new CapsuleGeometry(0.35, 0.9, 4, 12), new MeshStandardMaterial({ color: '#c5f77b', roughness: 0.4 }));
      mesh.position.y = 0.9;
      mesh.castShadow = true;
      const group = new Group();
      group.add(mesh);
      scene.add(group);
      character = group;
      setMessage('Exibindo cápsula provisória. Selecione um modelo .glb/.gltf para testar seu personagem.');
    };

    const loadModel = (url: string) => {
      setMessage('Carregando modelo…');
      new GLTFLoader().load(url, gltf => {
        if (!alive) return;
        if (character) scene.remove(character);
        character = gltf.scene;
        const box = new Box3().setFromObject(character);
        const size = box.getSize(new Vector3());
        const scale = 1.8 / Math.max(size.y, size.x, size.z, 0.001);
        character.scale.setScalar(scale);
        const center = box.getCenter(new Vector3());
        character.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        character.traverse(object => { const mesh = object as Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
        scene.add(character);
        mixer = new AnimationMixer(character);
        const clip = gltf.animations.find(animation => /walk|run|andar|camin/i.test(animation.name)) ?? gltf.animations[0];
        walkingAction = clip ? mixer.clipAction(clip) : null;
        if (!walkingAction) setMessage('Modelo carregado; não encontrei animação embutida. O movimento de deslocamento ainda funciona.');
        else setMessage(`Modelo carregado: ${clip?.name}. Use WASD ou as setas para andar.`);
      }, undefined, () => {
        if (!alive) return;
        if (character) scene.remove(character);
        character = null;
        if (!url.startsWith('blob:')) addPlaceholder();
        setMessage('Não foi possível carregar o modelo. Selecione um arquivo .glb/.gltf válido.');
      });
    };
    addPlaceholder();
    loadModel(MODEL_URL);
    let frame = 0;
    const tick = () => {
      if (!alive) return;
      frame = requestAnimationFrame(tick);
      const delta = Math.min(clock.getDelta(), 0.05);
      const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      const z = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
      if (character && (x || z)) {
        const direction = new Vector3(x, 0, z).normalize();
        character.position.addScaledVector(direction, delta * 2.5);
        character.rotation.y = Math.atan2(direction.x, direction.z);
      }
      if (mixer) mixer.update(delta);
      if (walkingAction) {
        if (Boolean(keys.size) !== wasWalking) {
          if (keys.size) walkingAction.reset().fadeIn(0.2).play();
          else walkingAction.fadeOut(0.2);
          wasWalking = Boolean(keys.size);
        }
      }
      renderer.render(scene, camera);
    };
    tick();

    const onFile = (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (!/\.(glb|gltf)$/i.test(file.name)) { setMessage('Escolha um arquivo .glb ou .gltf.'); return; }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(file);
      setFilename(file.name);
      loadModel(blobUrl);
    };
    const fileInput = document.getElementById('character-file') as HTMLInputElement | null;
    fileInput?.addEventListener('change', onFile);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      fileInput?.removeEventListener('change', onFile);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      scene.traverse(object => {
        const mesh = object as Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [restart]);

  return <section className="character-test">
    <header className="character-test-header"><a href="/">← Voltar ao jogo</a><span>PROJETO ZERO / BANCADA DE PERSONAGEM</span></header>
    <div ref={host} className="character-test-viewport" />
    <aside className="character-test-panel">
      <span className="eyebrow">VISUALIZADOR ISOLADO</span>
      <h1>Teste de personagem</h1>
      <p>Troque o modelo abaixo e segure WASD ou as setas para testar deslocamento e animação.</p>
      <label className="character-file-button" htmlFor="character-file">Escolher modelo (.glb/.gltf)</label>
      <input id="character-file" type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" />
      <button className="character-reset" onClick={() => { setFilename('personagem.glb'); setRestart(value => value + 1); }}>Recarregar modelo padrão</button>
      <p className="character-filename">Arquivo: {filename}</p>
      <p className="character-message" role="status">{moving ? 'Andando…' : message}</p>
      <small>Modelo padrão: <code>public/assets/characters/personagem.glb</code></small>
    </aside>
    <footer className="character-test-footer">WASD / SETAS <span>ANDAR</span><span className="character-test-note">A animação de caminhada precisa vir dentro do modelo.</span></footer>
  </section>;
}

