import { Color, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';

/** One continuous shoreline, shaded in world units instead of alternating square tiles. */
export class BeachSurface {
  readonly mesh: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private readonly time = { value: 0 };
  private disposed = false;
  constructor(width: number, northZ: number, southZ: number, shoreZ: number) {
    const geometry = new PlaneGeometry(width, southZ - northZ, 128, 64);
    geometry.rotateX(-Math.PI / 2); geometry.translate(0, 0, (northZ + southZ) / 2);
    const material = new MeshStandardMaterial({ color: '#ffffff', roughness: .82 });
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, {
        coastTime: this.time, coastShore: { value: shoreZ },
        coastDeep: { value: new Color('#126f91') }, coastShallow: { value: new Color('#53cfc0') },
        coastSand: { value: new Color('#efcf91') }, coastWet: { value: new Color('#bba572') },
      });
      const common = `
        uniform float coastTime; uniform float coastShore;
        varying vec2 coastPosition;
        float coastEdge(float x) { return coastShore + sin(x*.17)*.46 + sin(x*.43+1.3)*.16; }
      `;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + common)
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          coastPosition = position.xz;
          float coastDistance = position.z - coastEdge(position.x);
          float coastLand = smoothstep(-.3, 1.4, coastDistance);
          transformed.y = mix(-.12, .018, coastLand);
          transformed.y += (sin(position.x*.35+coastTime*.7) * sin(position.z*.65-coastTime*.9))*.018*(1.-coastLand);
        `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + common + `
        uniform vec3 coastDeep; uniform vec3 coastShallow; uniform vec3 coastSand; uniform vec3 coastWet;
        float coastHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      `).replace('#include <color_fragment>', `
        #include <color_fragment>
        vec2 p = coastPosition;
        float d = p.y - coastEdge(p.x);
        float shoreWash = sin(coastTime*.65+p.x*.12)*.18;
        float land = smoothstep(-.12+shoreWash,.46+shoreWash,d);
        float depth = smoothstep(-15.,-.6,d);
        vec3 water = mix(coastDeep,coastShallow,depth);
        float ripples = sin(p.x*1.5+p.y*3.3+coastTime*.8) * sin(p.x*.7-p.y*2.1+coastTime*.6);
        water += ripples * .018;
        vec3 sand = mix(coastWet,coastSand,smoothstep(.35,2.4,d));
        sand *= .97 + coastHash(floor(p*72.))*.06;
        float foamPhase = d*4.6 + sin(p.x*.63+coastTime*.3)*.35 + coastTime*1.1;
        float foam = pow(max(0.,sin(foamPhase)),12.) * smoothstep(-3.8,-.7,d) * (1.-smoothstep(.15,.7,d));
        float lace = .55 + .45*coastHash(floor(p*14.));
        vec3 coastColor = mix(water,sand,land);
        coastColor = mix(coastColor,vec3(.93,.98,.94),foam*lace*.8);
        diffuseColor.rgb *= coastColor;
      `).replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(.32,.94,smoothstep(0.,1.2,coastPosition.y-coastEdge(coastPosition.x)));
      `);
    };
    material.customProgramCacheKey = () => 'orla-continuous-coast-v1';
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'continuous-beach-and-sea';
    this.mesh.receiveShadow = true;
    // Vertex displacement remains inside this conservative vertical envelope.
    geometry.computeBoundingBox();
    geometry.boundingBox!.min.y = -.15; geometry.boundingBox!.max.y = .04;
    geometry.computeBoundingSphere();
  }
  update(dt: number): void { if (!this.disposed && Number.isFinite(dt) && dt > 0) this.time.value += dt; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose();
  }
}
