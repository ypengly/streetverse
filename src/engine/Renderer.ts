/** WebGL renderer wrapper: sizing, tone mapping, context-loss handling, disposal. */
import * as THREE from 'three';

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private observer: ResizeObserver;
  private lost = false;
  private resizeListeners: (() => void)[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly onContextLost: () => void,
  ) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = this.gl.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.addEventListener('webglcontextlost', this.handleLost);
    container.appendChild(canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  private handleLost = (e: Event): void => {
    e.preventDefault(); // allows restoration
    this.lost = true;
    this.onContextLost();
  };

  get isLost(): boolean {
    return this.lost;
  }

  get aspect(): number {
    const { clientWidth: w, clientHeight: h } = this.container;
    return w > 0 && h > 0 ? w / h : 16 / 9;
  }

  onResize(fn: () => void): void {
    this.resizeListeners.push(fn);
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.gl.setSize(w, h, false);
    this.resizeListeners.forEach((fn) => fn());
  }

  setShadowsEnabled(on: boolean): void {
    this.gl.shadowMap.enabled = on;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.lost) return;
    this.gl.render(scene, camera);
  }

  dispose(): void {
    this.observer.disconnect();
    this.gl.domElement.removeEventListener('webglcontextlost', this.handleLost);
    this.gl.domElement.remove();
    this.gl.dispose();
  }
}
