const fs=require('node:fs'),Module=require('node:module');
const {test}=require('node:test'),assert=require('node:assert/strict'),three=require('three');
require.extensions['.ts']=(module,filename)=>{
 let source=Module.stripTypeScriptTypes(fs.readFileSync(filename,'utf8'),{mode:'transform'});
 const names=[...source.matchAll(/export (?:class|const|function) (\w+)/g)].map(m=>m[1]);
 source=source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,'const {$1} = require(\'$2\');').replace(/export (class|const|function) /g,'$1 ');
 module._compile(source+'\nObject.assign(exports, {'+names.join(',')+'});',filename);
};

test('gaivotas: duas malhas, transformações finitas e descarte único sem alterar a simulação',()=>{
 const {Seabirds}=require('../src/game/map/Seabirds.ts');
 const {suburbanGameState}=require('../src/game/core/GameState.ts');
 const before=suburbanGameState.snapshot(),birds=new Seabirds(104,-8);
 assert.equal(birds.group.children.length,2);
 const first=birds.group.children[0].instanceMatrix.array.slice();
 for(let i=0;i<600;i++)birds.update(1/60);
 birds.update(NaN);birds.update(-1);
 assert.ok(birds.group.children.every(mesh=>mesh.count===6 && [...mesh.instanceMatrix.array].every(Number.isFinite)));
 assert.notDeepEqual(birds.group.children[0].instanceMatrix.array,first);
 assert.deepEqual(suburbanGameState.snapshot(),before);
 let geometries=0,buffers=0,materials=0;
 for(const wing of birds.group.children){wing.geometry.addEventListener('dispose',()=>geometries++);wing.addEventListener('dispose',()=>buffers++);}
 birds.group.children[0].material.addEventListener('dispose',()=>materials++);
 birds.dispose();birds.dispose();birds.update(1);
 assert.equal(geometries,2);assert.equal(buffers,2);assert.equal(materials,1);assert.equal(birds.group.children.length,0);
});

test('guarda-sóis: listras usam cores por vértice e geometrias em cache, sem materiais por setor',()=>{
 const {GridMap}=require('../src/game/map/GridMap.ts'),{ORLA_MAP}=require('../src/game/map/orlaMap.ts'),{GridMapView}=require('../src/game/map/GridMapView.ts');
 const map=new GridMap(ORLA_MAP,2,.3),view=new GridMapView(map);
 try{
  const geometry=view.canopy(0),again=view.canopy(0);
  assert.equal(geometry,again);assert.ok(view.canopyMaterial.vertexColors);
  const colors=geometry.getAttribute('color'),unique=new Set();
  for(let i=0;i<colors.count;i++)unique.add([colors.getX(i),colors.getY(i),colors.getZ(i)].join(','));
  assert.equal(unique.size,2);assert.ok(view.canopies.size<=5);
  let disposals=0;geometry.addEventListener('dispose',()=>disposals++);view.dispose();view.dispose();assert.equal(disposals,1);
 }finally{view.dispose();}
});

test('avisos 3D são compactos e mantêm as cores da interface sem exposição da luz',t=>{
 const {OrlaPhase}=require('../src/game/scenes/OrlaPhase.ts');
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 const ctx=new Proxy({}, {get:(target,key)=>target[key]??(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>ctx,width:0,height:0})}});
 t.after(()=>previous?Object.defineProperty(globalThis,'document',previous):delete globalThis.document);
 const bubble=OrlaPhase.prototype.createBubble('SEMÁFORO EM FALHA');
 assert.ok(bubble.scale.x<=3 && bubble.scale.y<1);
 assert.equal(bubble.material.toneMapped,false);assert.equal(bubble.material.map.colorSpace,three.SRGBColorSpace);
 bubble.material.map.dispose();bubble.material.dispose();
});
