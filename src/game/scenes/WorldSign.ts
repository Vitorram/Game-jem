import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

/** Small painted identity plate; no external fonts, images or loading. */
export class WorldSign {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private texture?: CanvasTexture;
  private disposed = false;
  constructor(title: string, subtitle: string, width: number, height: number) {
    if (typeof document !== 'undefined') {
      const canvas=document.createElement('canvas'); canvas.width=512;canvas.height=144;
      const ctx=canvas.getContext('2d');
      if(ctx){
        ctx.fillStyle='#173c42';ctx.fillRect(0,0,512,144);
        ctx.strokeStyle='#f0c260';ctx.lineWidth=5;ctx.strokeRect(6,6,500,132);
        ctx.fillStyle='#fff3d1';ctx.font='900 48px Arial';ctx.textAlign='center';ctx.fillText(title,256,66);
        ctx.fillStyle='#c2e8de';ctx.font='bold 20px Arial';ctx.fillText(subtitle,256,104);
        ['#e7ab52','#b9a2df','#73c1b4'].forEach((color,index)=>{ctx.fillStyle=color;ctx.fillRect(200+index*40,120,32,5)});
        this.texture=new CanvasTexture(canvas);this.texture.colorSpace=SRGBColorSpace;
      }
    }
    this.mesh=new Mesh(new PlaneGeometry(width,height),new MeshBasicMaterial({color:this.texture?'#ffffff':'#173c42',map:this.texture,toneMapped:false}));
    this.mesh.name='central-orla-painted-sign';
  }
  dispose(): void {
    if(this.disposed)return;this.disposed=true;
    this.texture?.dispose();this.mesh.geometry.dispose();this.mesh.material.dispose();this.mesh.removeFromParent();
  }
}
