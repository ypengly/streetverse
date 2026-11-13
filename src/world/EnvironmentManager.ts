/** Sky, fog, sun/hemisphere lighting, and image-based reflections. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
  float sun = pow(max(dot(normalize(vDir), uSunDir), 0.0), 600.0);
  float glow = pow(max(dot(normalize(vDir), uSunDir), 0.0), 8.0) * 0.25;
  col += vec3(1.0, 0.92, 0.75) * (sun * 2.0 + glow);
  gl_FragColor = vec4(col, 1.0);
}`;

export class EnvironmentManager {
  readonly sun = new THREE.DirectionalLight('#fff1d6', 2.8);
  readonly hemi = new THREE.HemisphereLight('#bcd8ff', '#51603f', 0.7);
  readonly sunDir = new THREE.Vector3(-0.55, 0.75, -0.38).normalize();
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private envTexture: THREE.Texture;
  private snap = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    shadowMapSize = 2048,
  ) {
    const horizon = new THREE.Color('#d7e6f2');
    scene.fog = new THREE.Fog(horizon, 140, 560);

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color('#4b8fd6') },
        uHorizon: { value: horizon },
        uSunDir: { value: this.sunDir },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = -70;
    cam.right = 70;
    cam.top = 70;
    cam.bottom = -70;
    cam.near = 1;
    cam.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target, this.hemi);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    this.envTexture = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = this.envTexture;
    scene.environmentIntensity = 0.55;
    envScene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    pmrem.dispose();
  }

  /** Keep the shadow frustum centred on the player (snapped to reduce shimmering) and sky on camera. */
  update(focus: THREE.Vector3, camera: THREE.Camera): void {
    const texel = 140 / this.sun.shadow.mapSize.x;
    this.snap.set(Math.round(focus.x / texel) * texel, 0, Math.round(focus.z / texel) * texel);
    this.sun.target.position.copy(this.snap);
    this.sun.position.copy(this.snap).addScaledVector(this.sunDir, 160);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(camera.position);
  }

  dispose(): void {
    this.scene.remove(this.sky, this.sun, this.sun.target, this.hemi);
    this.sky.geometry.dispose();
    this.skyMat.dispose();
    this.sun.shadow.map?.dispose();
    this.envTexture.dispose();
    this.scene.environment = null;
  }
}
