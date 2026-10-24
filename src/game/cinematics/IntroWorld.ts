import { ACESFilmicToneMapping, BoxGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, MathUtils, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, Vector3, WebGLRenderer } from 'three';
import { GRID_CONFIG, ORLA_CONFIG, ORLA_CROSSING } from '../config';
import { GridMap } from '../map/GridMap';
import { GridMapView } from '../map/GridMapView';
import { ORLA_MAP } from '../map/orlaMap';
import { ROAD_LAYOUT } from '../map/roadLayout';
import { Player } from '../entities/Player';
import { AnalystCabin } from '../scenes/AnalystCabin';
import { ActiveMobilitySystem } from '../traffic/ActiveMobilitySystem';
import { TrafficSignals } from '../traffic/TrafficSignals';
import { FLEET_COLORS, FLEET_SEQUENCE, TrafficSystem } from '../traffic/TrafficSystem';
import { CROSSING_RULES, advanceWithRoom } from '../traffic/crossingRules';
import { VehicleModels, VEHICLE_VISUAL_SCALE, type VehicleKind } from '../traffic/VehicleModels';

export type IntroShot = 'city' | 'incident' | 'response' | 'team';
export type IntroPlayback = { shot: IntroShot; beat?: number; reducedMotion: boolean; paused: boolean };

type Vec3 = [number, number, number];
type Framing = { position: Vec3; target: Vec3; fov: number };
/**
 * Como o plano entra: `blend` leva a câmera do quadro atual até o novo caminho
 * (com `arc` de altura para não raspar no cenário); `fade` mergulha no escuro e corta.
 */
type Transition = { kind: 'blend' | 'fade'; seconds: number; arc?: number };
/**
 * Um plano de câmera: vai de `from` a `to` em `seconds`, a partir do momento em que entra.
 * Com `follow`, posição e alvo ficam relativos ao sujeito (travelling de acompanhamento);
 * `fixed` mantém a câmera parada e só o alvo acompanha, como uma câmera de monitoramento.
 */
type CameraShot = {
  from: Framing; to: Framing; seconds: number; enter: Transition;
  follow?: { subject: () => Vector3; fixed?: boolean }; lens?: 'cctv';
};
/** Veículo da faixa reservada ao filme (leste 1): mesma montagem do TrafficSystem, base no chão. */
type LaneCar = { group: Group; half: number; x: number; speed: number; maxSpeed: number; scripted: boolean };
type Particle = { mesh: Mesh; velocity: Vector3; spin: Vector3; life: number; resting: boolean };

const ease = (t: number) => t * t * (3 - 2 * t);
const easeInOut = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Faixa coreografada pelo filme; o TrafficSystem real preenche as outras. */
const FILM_LANE = 'orla-eastbound';
/**
 * Onde o carro da frente freia e leva a batida: logo depois da travessia (x = 1), com espaço
 * para os cones antes dela, e longe dos postes do canteiro (x = 3 e 13).
 */
const CRASH_X = 10.5;
/** O laço da faixa do filme passa dentro da neblina, então nenhum carro some ou surge em quadro. */
const TRAFFIC_REACH = 46;
const GRAVITY = 9.8;

/** A private film set: it reuses game art and systems without touching session or traffic state. */
export function createIntroWorld(host: HTMLElement, readPlayback: () => IntroPlayback) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);
  const scene = new Scene();
  scene.background = new Color(ORLA_CONFIG.background);
  // Neblina mais curta que a do jogo: as bordas das aprons (52 m+) já chegam meio dissolvidas no céu.
  scene.fog = new Fog(ORLA_CONFIG.background, 30, 85);
  scene.add(new HemisphereLight(ORLA_CONFIG.hemisphere.skyColor, ORLA_CONFIG.hemisphere.groundColor, ORLA_CONFIG.hemisphere.intensity));
  const sun = new DirectionalLight('#ffe2bc', 3);
  sun.position.set(-9, 20, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: .5, far: 65 });
  sun.shadow.normalBias = .04;
  scene.add(sun);

  // Cenário: o mesmo mapa, tráfego, pedestres, semáforos e cabine da Analista do jogo,
  // em instâncias próprias que não publicam nada no estado da partida.
  const map = new GridMap(ORLA_MAP, GRID_CONFIG.tileSize, GRID_CONFIG.playerRadius);
  const mapView = new GridMapView(map);
  const traffic = new TrafficSystem(map, { publishState: false, reservedLanes: [FILM_LANE] });
  const activeMobility = new ActiveMobilitySystem(map, traffic);
  const trafficSignals = new TrafficSignals(map, traffic);
  const cabinSpot = map.spawns[2];
  const cabin = new AnalystCabin(cabinSpot.x, cabinSpot.z);
  scene.add(mapView.group, traffic.group, activeMobility.group, trafficSignals.group, cabin.group);
  // Mar contínuo sob as aprons: em planos baixos o horizonte vira água + neblina, nunca a borda do cenário.
  const farSeaGeometry = new PlaneGeometry(600, 600);
  const farSeaMaterial = new MeshStandardMaterial({ color: '#2aa6c0', roughness: .55 });
  const farSea = new Mesh(farSeaGeometry, farSeaMaterial);
  farSea.rotation.x = -Math.PI / 2;
  farSea.position.y = -.35;
  scene.add(farSea);
  // O monitor da cabine acende em alerta quando o Suburban detecta a batida.
  const screenMaterial = new MeshStandardMaterial({ color: '#74d9d0', emissive: '#1f6f68', emissiveIntensity: .6, roughness: .4 });
  const screen = cabin.group.getObjectByName('analyst-cabin-monitor-screen') as Mesh | undefined;
  if (screen) screen.material = screenMaterial;

  const roadZ = map.depth / 2 - map.tileSize * 3;
  const incidentZ = roadZ + ROAD_LAYOUT.eastbound[0];

  // Faixa do filme: frota na mesma sequência do jogo, andando com a mesma física de frenagem.
  const models = new VehicleModels();
  const laneCars: LaneCar[] = [];
  let fleetIndex = 5;
  const createCar = (kind: VehicleKind, paint: string, x: number, maxSpeed: number, scripted = false): LaneCar => {
    const group = new Group();
    group.name = 'intro-vehicle';
    const model = models.create(kind, paint);
    model.group.rotation.y = Math.PI / 2;
    model.group.scale.setScalar(VEHICLE_VISUAL_SCALE[kind]);
    group.add(model.group);
    group.position.set(x, 0, incidentZ);
    scene.add(group);
    const car = { group, half: model.length * VEHICLE_VISUAL_SCALE[kind] / 2, x, speed: maxSpeed, maxSpeed, scripted };
    laneCars.push(car);
    return car;
  };
  for (let i = 0; i < 8; i++) {
    const kind = FLEET_SEQUENCE[fleetIndex % FLEET_SEQUENCE.length];
    createCar(kind, FLEET_COLORS[fleetIndex++ % FLEET_COLORS.length], -TRAFFIC_REACH + i * TRAFFIC_REACH / 4 + 3, 1.9 + (i % 3) * .2);
  }
  /** Afasta da área do evento os carros da faixa do filme; eles voltam por trás e formam a fila. */
  const clearFilmLane = (from: number, to: number) => {
    laneCars.filter(car => !car.scripted && car.x > from && car.x < to)
      .sort((a, b) => b.x - a.x)
      .forEach((car, k) => { car.x = from - 6 - k * 5; });
  };

  // Batida: o carro acompanhado pela câmera de monitoramento (hero) acerta a traseira do sedã que freia.
  let hero: LaneCar | null = null;
  let victim: LaneCar | null = null;
  const spawnHero = () => {
    if (hero) return;
    clearFilmLane(-17, -3);
    hero = createCar('hatch', '#c85d51', -10, 2.3);
    hero.speed = 2.2;
  };
  const crash = { started: false, impacted: false, time: 0, sinceImpact: 0 };
  const bodies = { victim: { vx: 0, yaw: 0, yawTarget: 0, pitch: 0 }, hero: { vx: 0, yaw: 0, yawTarget: 0, pitch: 0 } };
  let trauma = 0;
  const startCrash = () => {
    if (crash.started) return;
    spawnHero();
    crash.started = true;
    clearFilmLane(CRASH_X - 14, CRASH_X + 8);
    victim = createCar('sedan', '#e3b85f', CRASH_X - 1.6, 2.2, true);
    victim.speed = 2.2;
    hero!.scripted = true;
    hero!.x = victim.x - victim.half - 1.7 - hero!.half;
    hero!.speed = 2.6;
    hero!.group.rotation.set(0, 0, 0);
  };

  // Efeitos do impacto: faíscas, peças soltas, fumaça e pisca-alerta.
  const sparkGeometry = new BoxGeometry(.035, .035, .16);
  const sparkMaterial = new MeshStandardMaterial({ color: '#fff2a3', emissive: '#ff8a22', emissiveIntensity: 2.4 });
  const debrisGeometry = new BoxGeometry(.09, .03, .07);
  const debrisMaterials = ['#2f3b40', '#bfe3e6', '#c85d51', '#e3b85f'].map(color => new MeshStandardMaterial({ color, roughness: .6 }));
  const smokeGeometry = new SphereGeometry(.24, 10, 8);
  const smokeMaterial = new MeshStandardMaterial({ color: '#b7c0c1', transparent: true, opacity: 0, roughness: 1, depthWrite: false });
  const hazardGeometry = new BoxGeometry(.08, .06, .06);
  const hazardMaterial = new MeshStandardMaterial({ color: '#ffb547', emissive: '#ff9a1f', emissiveIntensity: 0 });
  const particles: Particle[] = [];
  const smoke = Array.from({ length: 6 }, () => {
    const puff = new Mesh(smokeGeometry, smokeMaterial);
    puff.visible = false;
    scene.add(puff);
    return puff;
  });
  const burst = (x: number, y: number, z: number) => {
    for (let i = 0; i < 22; i++) {
      const spark = new Mesh(sparkGeometry, sparkMaterial);
      spark.position.set(x, y, z);
      scene.add(spark);
      const angle = Math.random() * Math.PI * 2;
      particles.push({ mesh: spark, life: .45 + Math.random() * .4, resting: false, spin: new Vector3(),
        velocity: new Vector3(Math.cos(angle) * (1 + Math.random() * 1.6), 1.2 + Math.random() * 2.2, Math.sin(angle) * (1 + Math.random() * 1.6)) });
    }
    for (let i = 0; i < 14; i++) {
      const piece = new Mesh(debrisGeometry, debrisMaterials[i % debrisMaterials.length]);
      piece.position.set(x, y, z + (Math.random() - .5) * .4);
      piece.castShadow = true;
      scene.add(piece);
      particles.push({ mesh: piece, life: Infinity, resting: false,
        spin: new Vector3(Math.random() * 14 - 7, Math.random() * 14 - 7, Math.random() * 14 - 7),
        velocity: new Vector3((Math.random() - .3) * 2.4, .9 + Math.random() * 1.6, (Math.random() - .5) * 2.2) });
    }
  };
  const addHazards = (car: LaneCar) => {
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const light = new Mesh(hazardGeometry, hazardMaterial);
      light.position.set(sx * car.half * .92, .48, sz * .25);
      car.group.add(light);
    }
  };
  const stepCrash = (dt: number) => {
    if (!crash.started || !hero || !victim) return;
    crash.time += dt;
    if (!crash.impacted) {
      // Freada brusca à frente; quem vem atrás chega rápido demais.
      victim.speed = Math.max(0, victim.speed - 6.5 * dt);
      victim.x += victim.speed * dt;
      hero.x += hero.speed * dt;
      bodies.victim.pitch = victim.speed > 0 ? -.045 : bodies.victim.pitch * .9;
      if (hero.x + hero.half >= victim.x - victim.half) {
        crash.impacted = true;
        hero.x = victim.x - victim.half - hero.half;
        bodies.victim.vx = 1.8; bodies.victim.yawTarget = .42;
        bodies.hero.vx = -.45; bodies.hero.yawTarget = -.26;
        hero.speed = victim.speed = 0;
        burst(victim.x - victim.half, .42, incidentZ);
        addHazards(hero); addHazards(victim);
        trauma = 1;
      }
    } else {
      crash.sinceImpact += dt;
      const t = crash.sinceImpact;
      for (const [car, body] of [[victim, bodies.victim], [hero, bodies.hero]] as const) {
        const sliding = Math.abs(body.vx);
        car.x += body.vx * dt;
        body.vx = Math.sign(body.vx) * Math.max(0, sliding - 4.2 * dt);
        // O carro gira enquanto ainda escorrega, como num tranco de verdade.
        body.yaw += (body.yawTarget - body.yaw) * (1 - Math.exp(-dt * 7));
      }
      // Mergulho de frente do hero e traseira do sedã subindo, com amortecimento.
      const spring = Math.exp(-5 * t) * Math.cos(15 * t);
      bodies.hero.pitch = -.1 * spring;
      bodies.victim.pitch = -.07 * spring;
    }
    for (const [car, body] of [[victim, bodies.victim], [hero, bodies.hero]] as const) {
      const hop = crash.impacted ? .04 * Math.exp(-6 * crash.sinceImpact) * Math.abs(Math.sin(16 * crash.sinceImpact)) : 0;
      car.group.position.set(car.x, hop + Math.abs(body.pitch) * car.half, incidentZ);
      car.group.rotation.set(0, body.yaw, body.pitch);
    }
  };

  /** Física de seguir o carro da frente na faixa do filme, com a mesma frenagem do TrafficSystem. */
  const stepLane = (dt: number) => {
    const crossingX = ORLA_CROSSING.centerX;
    const signal = traffic.getPedestrianSignalPhase();
    // Quem chega à batida guarda distância, deixando espaço para os cones.
    const crashStop = crash.started && hero ? hero.x - hero.half - 4.2 : Infinity;
    for (const car of laneCars) {
      if (car.scripted) continue;
      let ahead = Infinity, leader: LaneCar | null = null;
      for (const other of laneCars) {
        if (other === car || other.x <= car.x) continue;
        const gap = other.x - other.half - (car.x + car.half);
        if (gap < ahead) { ahead = gap; leader = other; }
      }
      let room = Math.max(0, ahead - .5);
      if (car.x < crashStop) room = Math.min(room, Math.max(0, crashStop - (car.x + car.half)));
      const crossingDistance = crossingX - car.x;
      if (crossingDistance >= CROSSING_RULES.roadStopDistance) {
        // Para no semáforo e não fecha a faixa de pedestres quando a fila não cabe depois dela.
        const exitRoom = leader && leader.speed < .3 ? leader.x - leader.half - (crossingX + CROSSING_RULES.roadConflictHalfWidth) : Infinity;
        const stuck = Math.min(exitRoom, crashStop - (crossingX + CROSSING_RULES.roadConflictHalfWidth)) < car.half * 2 + .5;
        if (signal !== 'green' || stuck) room = Math.min(room, crossingDistance - CROSSING_RULES.roadStopDistance);
      }
      const desired = car.maxSpeed * MathUtils.clamp((ahead - 1.2) / 3.5, 0, 1);
      const motion = advanceWithRoom(car.speed, desired, room, dt);
      car.speed = motion.speed;
      car.x += motion.distance;
      if (car.x > TRAFFIC_REACH) car.x -= TRAFFIC_REACH * 2;
      car.group.position.set(car.x, 0, incidentZ);
    }
  };

  // Equipe: a Analista fica sentada na cabine; Infraestrutura e Mobilidade conversam ao lado e depois vão à batida.
  const analyst = new Player(3);
  analyst.setPosition(cabinSpot.x, cabinSpot.z - .3);
  analyst.setSeated(true);
  const infra = new Player(1), mobility = new Player(2);
  infra.setPosition(cabinSpot.x - 2.5, cabinSpot.z + .9); infra.mesh.rotation.y = 1.19;
  mobility.setPosition(cabinSpot.x - 1.5, cabinSpot.z + 1.3); mobility.mesh.rotation.y = -1.95;
  scene.add(analyst.mesh, infra.mesh, mobility.mesh);
  const curbZ = roadZ - .55;
  const walks = [
    { player: infra, path: [new Vector3(cabinSpot.x + .8, 0, curbZ - 1.1), new Vector3(CRASH_X - .6, 0, curbZ)], index: 0, walking: false },
    { player: mobility, path: [new Vector3(cabinSpot.x + 1.6, 0, curbZ - 1.3), new Vector3(CRASH_X - 3.8, 0, curbZ)], index: 0, walking: false },
  ];
  const stepCrew = (dt: number) => {
    analyst.animateWalking(dt, 0);
    for (const walk of walks) {
      const { player } = walk;
      const goal = walk.path[walk.index];
      let traveled = 0, turning = 0;
      let heading = walk.walking ? Math.atan2(goal.x - player.mesh.position.x, goal.z - player.mesh.position.z) : player.mesh.rotation.y;
      if (walk.walking) {
        const distance = Math.hypot(goal.x - player.mesh.position.x, goal.z - player.mesh.position.z);
        traveled = Math.min(distance, 2.1 * dt);
        player.mesh.position.x += Math.sin(heading) * traveled;
        player.mesh.position.z += Math.cos(heading) * traveled;
        if (distance - traveled < .02) {
          if (walk.index < walk.path.length - 1) walk.index++;
          else { walk.walking = false; heading = 0; }
        }
      }
      if (!walk.walking && walk.index > 0) heading = 0; // Chegou: fica de frente para a batida.
      const difference = Math.atan2(Math.sin(heading - player.mesh.rotation.y), Math.cos(heading - player.mesh.rotation.y));
      turning = difference * (1 - Math.exp(-dt * 9));
      player.mesh.rotation.y += turning;
      player.animateWalking(dt, traveled, turning / Math.max(dt, 1e-3));
    }
  };

  // Cones da Mobilidade: afunilam a faixa atrás da batida.
  const coneGeometry = new ConeGeometry(.16, .48, 16);
  const stripeGeometry = new CylinderGeometry(.065, .10, .10, 16);
  const baseGeometry = new BoxGeometry(.4, .065, .4);
  const orange = new MeshStandardMaterial({ color: '#f4873e', roughness: .75 });
  const white = new MeshStandardMaterial({ color: '#fff4da', roughness: .75 });
  const black = new MeshStandardMaterial({ color: '#263b3d' });
  const cones = Array.from({ length: 8 }, () => {
    const cone = new Group();
    const body = new Mesh(coneGeometry, orange); body.position.y = .28; body.castShadow = true;
    const stripe = new Mesh(stripeGeometry, white); stripe.position.y = .32;
    const base = new Mesh(baseGeometry, black); base.position.y = .04;
    cone.add(body, stripe, base);
    cone.visible = false;
    scene.add(cone);
    return cone;
  });
  const placeCones = () => {
    const rear = hero ? hero.x - hero.half : CRASH_X - 3;
    cones.forEach((cone, i) => {
      if (i < 5) cone.position.set(rear - 3.4 + i * .75, .04, incidentZ - .46 + i * .23);
      else cone.position.set(rear + .5 + (i - 5) * 1.1, .04, incidentZ - .56);
    });
  };

  // Estados da cena por beat: cada um entra quando o plano do beat aparece (no escuro, num fade).
  let stagedBeat = 0, responseTime = 0, conesForced = false;
  const fastForward = (seconds: number, step: (dt: number) => void) => { for (let t = 0; t < seconds; t += 1 / 60) step(1 / 60); };
  const enterBeat = (beat: number) => {
    if (beat === 2) spawnHero();
    if (beat === 3) startCrash();
    if (beat === 4) {
      startCrash();
      if (crash.time < 2.5) fastForward(2.5 - crash.time, stepCrash);
      placeCones();
      walks.forEach(walk => { walk.walking = true; });
    }
    if (beat === 5) {
      enterBeat(4);
      fastForward(6, dt => stepCrew(dt));
      conesForced = true;
    }
  };

  const heroPosition = new Vector3(CRASH_X - 6, 0, incidentZ), crewPosition = new Vector3();
  const heroSubject = () => hero ? heroPosition.copy(hero.group.position) : heroPosition;
  const crewSubject = () => crewPosition.copy(infra.mesh.position).add(mobility.mesh.position).multiplyScalar(.5);

  // Roteiro de câmera por beat, em coordenadas derivadas do mapa: mar ao norte (−z), calçadão e
  // ciclovia no meio, avenida a partir de roadZ e frente urbana ao sul. Regra de enquadramento:
  // a câmera olha para o mar ou para o chão, nunca para o sul aberto, e foge dos postes do
  // canteiro (x = −17, −7, 3, 13). Os planos duram mais que o beat para nunca congelarem no quadro.
  const frame = (position: Vec3, target: Vec3, fov = 40): Framing => ({ position, target, fov });
  const blend = (seconds: number, arc = 0): Transition => ({ kind: 'blend', seconds, arc });
  const fade = (seconds: number): Transition => ({ kind: 'fade', seconds });
  const crashOrbit = (angle: number, radius: number, height: number): Vec3 =>
    [CRASH_X - 1.5 + Math.cos(angle) * radius, height, incidentZ + Math.sin(angle) * radius];
  const crashCenter: Vec3 = [CRASH_X - 1.5, .2, incidentZ];
  const CAMERA_SCRIPT: CameraShot[][] = [
    // 0 · A cidade e seu ritmo: grua aérea por cima dos telhados, descendo e fechando o zoom sobre a orla.
    [{ from: frame([-8, 18, 28], [2, 0, 3], 36), to: frame([-3, 12.5, 22], [3, 0, 4], 30), seconds: 10, enter: blend(0) }],
    // 1 · As três amigas: a grua desce até a calçada e avança sobre elas na cabine, com a ciclovia em primeiro plano.
    [{ from: frame([-3.2, 1.5, 4.9], [1.6, 1, 1.5], 40), to: frame([-1.6, 1.35, 4.3], [2, 1, 1.3], 33), seconds: 9, enter: blend(2.6, 2.5) }],
    // 2 · Câmeras e chamados: corte para a câmera de monitoramento, que acompanha e dá zoom no carro vermelho.
    [{ from: frame([19, 6.5, 4.2], [1.2, .3, 0], 30), to: frame([19, 6.5, 4.2], [1.2, .3, 0], 17), seconds: 8, enter: fade(.6),
      follow: { subject: heroSubject, fixed: true }, lens: 'cctv' }],
    // 3 · O acidente: no escuro, plano baixo da calçada vendo a batida; zoom-in no tranco e órbita sobre a fila que cresce.
    [
      { from: frame([CRASH_X - 6.5, 1.6, roadZ - .25], [CRASH_X - 2.4, .5, incidentZ], 34), to: frame([CRASH_X - 5.4, 1.35, roadZ - .15], [CRASH_X - 1.6, .55, incidentZ], 24), seconds: 3.4, enter: fade(.9) },
      { from: frame(crashOrbit(1.2, 9.5, 6.8), crashCenter), to: frame(crashOrbit(1.9, 7.5, 5), crashCenter), seconds: 7, enter: blend(1.6, 1.2) },
    ],
    // 4 · A resposta: zoom na Analista acionando a equipe, travelling atrás das duas a caminho da batida e 3/4 alto com os cones.
    [
      { from: frame([cabinSpot.x + .9, 1.9, cabinSpot.z + 2.4], [cabinSpot.x, 1, cabinSpot.z - .3], 38), to: frame([cabinSpot.x + .45, 1.6, cabinSpot.z + 1.45], [cabinSpot.x, 1, cabinSpot.z - .3], 28), seconds: 2.8, enter: blend(1.8, 1.2) },
      { from: frame([-3.4, 3.2, -1.6], [1.4, .7, .7], 40), to: frame([-3, 3, -1.4], [1.4, .7, .7], 36), seconds: 3.4, enter: blend(1), follow: { subject: crewSubject } },
      { from: frame([CRASH_X + 6, 8.5, 17.5], [CRASH_X - 2.5, .3, 7]), to: frame([CRASH_X + 4.5, 7.2, 15.5], [CRASH_X - 2.5, .3, 7], 36), seconds: 7, enter: blend(1.6, 1) },
    ],
    // 5 · Agora é com você: parte da equipe junto à batida e sobe recuando até revelar a orla inteira para o título.
    [{ from: frame([CRASH_X + 1.2, 2, roadZ + .45], [CRASH_X - 1.6, 1, curbZ - .1], 38), to: frame([CRASH_X - 6, 11, 19], [CRASH_X - 4, 0, 2], 44), seconds: 10, enter: blend(2.2, 1.2) }],
  ];

  // Ensaia alguns segundos antes do primeiro quadro, para o filme já abrir com a orla povoada.
  fastForward(12, dt => { traffic.update(dt); activeMobility.update(dt); stepLane(dt); });
  trafficSignals.update();

  const camera = new PerspectiveCamera(40, 1, .1, 150);
  const opening = CAMERA_SCRIPT[0][0].from;
  camera.position.set(...opening.position);
  const target = new Vector3(...opening.target);
  camera.lookAt(target);
  const wantedPosition = new Vector3(), wantedTarget = new Vector3(), endPosition = new Vector3(), endTarget = new Vector3();
  const blendPosition = new Vector3(), blendTarget = new Vector3();
  let blendFov = camera.fov;
  const resize = () => { const w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  renderer.render(scene, camera);
  // beatTime escolhe o plano do roteiro; shownTime é o tempo do plano que está na tela,
  // que pode ficar alguns quadros atrás durante um fade.
  let lastTime = 0, beatTime = 0, shownTime = 0, clockTime = 0, fadeTime = 0;
  let lastBeat = 0, sceneBeat = 0;
  let shown: CameraShot | null = null, fadingTo: CameraShot | null = null;
  let lens = '';
  let disposed = false;
  renderer.setAnimationLoop((now: number) => {
    if (disposed) return;
    const { beat = 0, paused, reducedMotion } = readPlayback();
    const dt = lastTime ? Math.min((now - lastTime) / 1000, .05) : 0;
    lastTime = now;
    if (paused || document.hidden) return;
    if (beat !== lastBeat) { lastBeat = beat; beatTime = 0; }
    beatTime += dt; shownTime += dt; clockTime += dt;

    const shots = CAMERA_SCRIPT[MathUtils.clamp(beat, 0, CAMERA_SCRIPT.length - 1)];
    let index = 0, start = 0;
    while (index < shots.length - 1 && beatTime >= start + shots[index].seconds) start += shots[index++].seconds;
    const desired = shots[index];
    let snap = false;
    if (!shown) { shown = desired; shownTime = 0; snap = true; }
    else if (desired !== (fadingTo ?? shown)) {
      if (desired.enter.kind === 'fade' || fadingTo) { if (!fadingTo) fadeTime = 0; fadingTo = desired; }
      else {
        shown = desired; shownTime = 0;
        blendPosition.copy(camera.position); blendTarget.copy(target); blendFov = camera.fov;
      }
    }
    // Fade: escurece no plano antigo, corta no ponto mais escuro e clareia no novo.
    let exposure = 1;
    if (fadingTo) {
      fadeTime += dt;
      const half = fadingTo.enter.seconds / 2;
      if (fadeTime < half) exposure = 1 - easeInOut(fadeTime / half);
      else {
        if (shown !== fadingTo) { shown = fadingTo; shownTime = fadeTime - half; snap = true; }
        exposure = easeInOut(Math.min((fadeTime - half) / half, 1));
        if (fadeTime >= half * 2) fadingTo = null;
      }
    }
    renderer.domElement.style.opacity = exposure.toFixed(3);
    // A cena só avança de estado quando o plano novo entra (no escuro, num fade), para não revelar a troca.
    if (!fadingTo || shown === fadingTo) sceneBeat = beat;
    while (stagedBeat < sceneBeat) enterBeat(++stagedBeat);

    // Cenário vivo: tráfego, pedestres, semáforos, mar, faixa do filme, batida e equipe.
    traffic.update(dt); activeMobility.update(dt); trafficSignals.update(); mapView.update(dt);
    stepLane(dt); stepCrash(dt); stepCrew(dt);
    if (stagedBeat >= 4) responseTime += dt;
    cones.forEach((cone, i) => {
      const grow = conesForced ? 1 : MathUtils.clamp((responseTime - 3 - .3 * i) * 3, 0, 1);
      cone.visible = grow > 0;
      cone.scale.setScalar(Math.max(.001, 1 - Math.pow(1 - grow, 3)));
    });
    for (const particle of [...particles]) {
      const { mesh, velocity, spin } = particle;
      particle.life -= dt;
      if (particle.life <= 0) { scene.remove(mesh); particles.splice(particles.indexOf(particle), 1); continue; }
      if (particle.resting) continue;
      velocity.y -= GRAVITY * dt;
      mesh.position.addScaledVector(velocity, dt);
      mesh.rotation.x += spin.x * dt; mesh.rotation.y += spin.y * dt; mesh.rotation.z += spin.z * dt;
      if (Number.isFinite(particle.life)) mesh.scale.setScalar(Math.max(.2, particle.life * 1.6));
      if (mesh.position.y <= .02) {
        mesh.position.y = .02;
        velocity.set(velocity.x * .35, -velocity.y * .25, velocity.z * .35);
        spin.multiplyScalar(.4);
        if (Math.abs(velocity.y) < .25) { particle.resting = true; mesh.rotation.set(0, mesh.rotation.y, 0); }
      }
    }
    const smoking = crash.impacted && hero;
    smoke.forEach((puff, i) => {
      puff.visible = !!smoking;
      if (!smoking) return;
      const phase = clockTime * 1.4 + i / smoke.length;
      const rise = phase % 1;
      puff.position.set(hero!.x + hero!.half * .7 + Math.sin(phase * 3) * .12, .7 + rise * 1.3, incidentZ + Math.cos(phase * 2) * .12);
      puff.scale.setScalar(.6 + rise * 1.1);
    });
    smokeMaterial.opacity = smoking ? Math.min(.42, crash.sinceImpact * .5) : 0;
    hazardMaterial.emissiveIntensity = crash.impacted && Math.floor(clockTime * 3) % 2 === 0 ? 2.2 : 0;
    const alert = crash.started ? .5 + .5 * Math.sin(clockTime * 9) : 0;
    screenMaterial.color.set(alert ? '#ff7a5c' : '#74d9d0');
    screenMaterial.emissive.set(alert ? '#9e2a14' : '#1f6f68');
    screenMaterial.emissiveIntensity = alert ? .6 + alert * 1.4 : .6;

    const current = shown;
    const progress = ease(MathUtils.clamp(shownTime / current.seconds, 0, 1));
    wantedPosition.set(...current.from.position).lerp(endPosition.set(...current.to.position), progress);
    wantedTarget.set(...current.from.target).lerp(endTarget.set(...current.to.target), progress);
    if (current.follow) {
      const subject = current.follow.subject();
      wantedTarget.add(subject);
      if (!current.follow.fixed) wantedPosition.add(subject);
    }
    let fov = MathUtils.lerp(current.from.fov, current.to.fov, progress);
    if (!reducedMotion) {
      // Leve respiração de câmera na mão para o quadro não parecer de computador.
      wantedTarget.x += Math.sin(clockTime * .7) * .05;
      wantedTarget.y += Math.sin(clockTime * 1.1) * .035;
    }
    if (camera.aspect < 1) {
      const zoomOut = Math.min(1.7, 1 / camera.aspect);
      wantedPosition.sub(wantedTarget).multiplyScalar(zoomOut).add(wantedTarget);
    }
    // Blend: parte do quadro em que a câmera estava e converge para o caminho do novo plano em arco.
    const { kind, seconds: blendSeconds, arc = 0 } = current.enter;
    if (kind === 'blend' && blendSeconds > 0 && !snap && shownTime < blendSeconds) {
      const k = easeInOut(shownTime / blendSeconds);
      wantedPosition.lerpVectors(blendPosition, wantedPosition, k).y += Math.sin(k * Math.PI) * arc;
      wantedTarget.lerpVectors(blendTarget, wantedTarget, k);
      fov = MathUtils.lerp(blendFov, fov, k);
    }
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const smoothing = snap ? 1 : 1 - Math.exp(-dt * 10);
    camera.position.lerp(wantedPosition, smoothing); target.lerp(wantedTarget, smoothing); camera.lookAt(target);
    // Tremor do impacto: decai rápido e fica de fora com movimento reduzido.
    trauma = Math.max(0, trauma - dt * 1.3);
    if (trauma > 0 && !reducedMotion) {
      const shake = trauma * trauma * .22;
      camera.position.x += Math.sin(clockTime * 53) * shake;
      camera.position.y += Math.sin(clockTime * 61 + 1.3) * shake * .7;
      camera.rotation.z += Math.sin(clockTime * 47 + 2.1) * shake * .12;
    }
    const nextLens = current.lens ?? '';
    if (nextLens !== lens) { lens = nextLens; host.dataset.lens = lens; }
    renderer.render(scene, camera);
  });
  return () => {
    disposed = true; renderer.setAnimationLoop(null); observer.disconnect();
    [analyst, infra, mobility].forEach(player => player.dispose());
    traffic.dispose(); activeMobility.dispose(); trafficSignals.dispose(); cabin.dispose();
    models.dispose(); mapView.dispose(); screenMaterial.dispose();
    farSeaGeometry.dispose(); farSeaMaterial.dispose();
    [sparkGeometry, debrisGeometry, smokeGeometry, hazardGeometry, coneGeometry, stripeGeometry, baseGeometry].forEach(geometry => geometry.dispose());
    [sparkMaterial, smokeMaterial, hazardMaterial, orange, white, black, ...debrisMaterials].forEach(material => material.dispose());
    sun.shadow.map?.dispose();
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); scene.clear();
  };
}
