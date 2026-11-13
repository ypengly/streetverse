/**
 * Game: owns the engine systems for one play session and coordinates them each frame.
 * UI never reaches into the simulation directly; it talks to Game through the callbacks/methods here.
 */
import * as THREE from 'three';
import { AssetManager } from '../engine/AssetManager';
import { InputManager, type InputAction } from '../engine/InputManager';
import { PhysicsWorld } from '../engine/PhysicsWorld';
import { Renderer } from '../engine/Renderer';
import { CAMERA_LABELS, CameraManager, type CameraMode } from '../camera/CameraManager';
import { Vehicle } from '../vehicles/Vehicle';
import type { VehicleTelemetry } from '../vehicles/VehicleController';
import { STARTER_SPEC, type DrivingMode } from '../vehicles/VehiclePhysics';
import { EnvironmentManager } from '../world/EnvironmentManager';
import { WorldManager } from '../world/WorldManager';
import type { HudTelemetry } from '../store/gameStore';
import { PHYSICS_HZ } from '../utils/constants';
import { EventBus, type GameEvents } from './EventBus';
import { GAME_CONFIG } from './GameConfig';
import { GameLoop } from './GameLoop';

export interface GameCallbacks {
  onProgress: (fraction: number, label: string) => void;
  onTogglePause: () => void;
  onHud: (hud: HudTelemetry, fps: number) => void;
  onCameraMode: (mode: CameraMode) => void;
  onToast: (text: string, kind: 'info' | 'warn') => void;
  onContextLost: () => void;
}

export interface DebugApi {
  telemetry: () => VehicleTelemetry;
  position: () => { x: number; y: number; z: number };
  surface: () => string;
  cameraMode: () => string;
  counts: () => {
    barriers: number;
    lights: number;
    trees: number;
    colliders: number;
    drawCalls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  teleport: (x: number, z: number, yaw: number) => void;
  /** Run N seconds of real fixed-step simulation synchronously (uses live keyboard input). */
  advance: (seconds: number) => void;
  flip: () => void;
}

declare global {
  interface Window {
    __SV_DEBUG__?: DebugApi;
  }
}

const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export class Game {
  readonly events = new EventBus<GameEvents>();
  private hudAccumulator = 0;
  private fps = 60;
  private stuckTime = 0;
  private hintedOverturn = false;
  private hintedStuck = false;
  private lastCollisionToast = 0;
  private disposed = false;
  private offs: (() => void)[] = [];

  private constructor(
    private readonly cb: GameCallbacks,
    private readonly assets: AssetManager,
    private readonly physics: PhysicsWorld,
    private readonly renderer: Renderer,
    private readonly scene: THREE.Scene,
    private readonly env: EnvironmentManager,
    private readonly world: WorldManager,
    private readonly vehicle: Vehicle,
    private readonly camera: CameraManager,
    private readonly input: InputManager,
    private readonly loop: GameLoop,
  ) {}

  static async create(container: HTMLElement, cb: GameCallbacks, drivingMode: DrivingMode): Promise<Game> {
    const assets = new AssetManager(cb.onProgress);
    assets.expect(6);
    let physics: PhysicsWorld | undefined;
    let renderer: Renderer | undefined;
    let env: EnvironmentManager | undefined;
    let vehicle: Vehicle | undefined;
    try {
      physics = await PhysicsWorld.create();
      assets.step('Physics ready');
      await nextTick();

      renderer = new Renderer(container, cb.onContextLost);
      const gl = renderer;
      const scene = new THREE.Scene();
      const perspective = new THREE.PerspectiveCamera(60, gl.aspect, 0.1, 1200);
      gl.onResize(() => {
        perspective.aspect = gl.aspect;
        perspective.updateProjectionMatrix();
      });
      assets.step('Renderer ready');
      await nextTick();

      env = new EnvironmentManager(scene, gl.gl);
      assets.step('Sky and lighting');
      await nextTick();

      const world = new WorldManager(physics, assets);
      world.build(scene);
      assets.step('Building the circuit');
      await nextTick();

      vehicle = new Vehicle(physics, STARTER_SPEC, { gripAt: world.circuit.gripAt });
      vehicle.controller.setMode(drivingMode);
      scene.add(vehicle.model.root);
      vehicle.model.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
      const spawn = world.circuit.spawnPose();
      vehicle.teleport(spawn.x, spawn.y, spawn.z, spawn.yaw);
      assets.step('Vehicle ready');
      await nextTick();

      const camera = new CameraManager(perspective, physics, vehicle.controller.body);
      const input = new InputManager();
      assets.step('Controls ready');

      // The loop is constructed first and bound to the Game afterwards.
      let game: Game | null = null;
      const loop = new GameLoop(
        (dt) => game?.step(dt),
        (alpha, frameDt) => game?.render(alpha, frameDt),
      );
      game = new Game(cb, assets, physics, gl, scene, env, world, vehicle, camera, input, loop);
      game.wire();
      return game;
    } catch (err) {
      vehicle?.dispose();
      env?.dispose();
      renderer?.dispose();
      assets.dispose();
      physics?.dispose();
      throw err;
    }
  }

  private wire(): void {
    this.input.attach();
    this.offs.push(
      this.input.onAction((a) => this.handleAction(a)),
      this.events.on('impact', ({ magnitude }) => this.camera.shake(magnitude)),
    );
    const onBlur = (): void => {
      if (!this.loop.paused) this.cb.onTogglePause();
    };
    window.addEventListener('blur', onBlur);
    this.offs.push(() => window.removeEventListener('blur', onBlur));
    this.loop.paused = true; // wait for start()
    this.loop.start();
    // Draw one frame so the world is visible behind the loading fade.
    this.render(1, 0.016);
    this.exposeDebug();
  }

  /** Begin (or continue) simulation. */
  start(): void {
    this.setPaused(false);
  }

  setPaused(paused: boolean): void {
    if (this.disposed) return;
    this.loop.paused = paused;
    this.input.setEnabled(!paused);
    if (!paused) this.loop.resetClock();
  }

  setDrivingMode(mode: DrivingMode): void {
    this.vehicle.controller.setMode(mode);
  }

  setCameraMode(mode: CameraMode): void {
    this.camera.setMode(mode);
    this.cb.onCameraMode(mode);
  }

  /** Return the car to the nearest safe road position. */
  recover(reason: GameEvents['recovered']['reason']): void {
    const p = this.vehicle.controller.body.translation();
    const pose = this.world.circuit.recoveryPose(p.x, p.z);
    this.vehicle.teleport(pose.x, pose.y, pose.z, pose.yaw);
    this.camera.setMode(this.camera.mode);
    this.stuckTime = 0;
    this.hintedOverturn = false;
    this.hintedStuck = false;
    this.events.emit('recovered', { reason });
    this.cb.onToast(reason === 'manual' ? 'Vehicle recovered' : 'Vehicle recovered automatically', 'info');
  }

  private handleAction(a: InputAction): void {
    switch (a) {
      case 'pause':
        this.cb.onTogglePause();
        break;
      case 'camera': {
        const mode = this.camera.cycle();
        this.cb.onCameraMode(mode);
        this.cb.onToast(`Camera: ${CAMERA_LABELS[mode]}`, 'info');
        break;
      }
      case 'recover':
        this.recover('manual');
        break;
      default:
        break; // map / interact arrive with later stages
    }
  }

  // ------------------------------------------------------------------ simulation

  private step(dt: number): void {
    const c = this.vehicle.controller;
    c.update(dt, this.input.poll());
    this.physics.step();
    this.vehicle.captureState();
    const t = c.telemetry;

    if (t.impact > 0) {
      this.events.emit('impact', { magnitude: t.impact });
      const now = performance.now();
      if (t.impact > 7 && now - this.lastCollisionToast > 1500) {
        this.lastCollisionToast = now;
        this.cb.onToast('Collision', 'warn');
      }
    }

    // Overturned / stuck handling.
    if (t.overturnedTime > GAME_CONFIG.recoverHintSeconds && !this.hintedOverturn) {
      this.hintedOverturn = true;
      this.cb.onToast('Press R to recover the vehicle', 'warn');
    }
    if (t.overturnedTime === 0) this.hintedOverturn = false;
    if (t.overturnedTime > GAME_CONFIG.autoRecoverSeconds) this.recover('overturned');

    const wantsToMove = t.throttle > 0.5 || t.brake > 0.5;
    this.stuckTime = wantsToMove && t.speedKmh < 2 && t.upright > 0.35 ? this.stuckTime + dt : 0;
    if (this.stuckTime > 4 && !this.hintedStuck) {
      this.hintedStuck = true;
      this.cb.onToast('Stuck? Press R to recover', 'info');
    }
    if (this.stuckTime === 0) this.hintedStuck = false;

    if (c.body.translation().y < GAME_CONFIG.killPlaneY) this.recover('overturned');
  }

  // ------------------------------------------------------------------ rendering

  private render(alpha: number, frameDt: number): void {
    if (this.disposed) return;
    this.vehicle.syncVisual(alpha, frameDt);
    const lv = this.vehicle.controller.body.linvel();
    this.camera.update(frameDt, {
      position: this.vehicle.renderPos,
      quaternion: this.vehicle.renderQuat,
      velocity: new THREE.Vector3(lv.x, lv.y, lv.z),
      telemetry: this.vehicle.controller.telemetry,
    });
    this.env.update(this.vehicle.renderPos, this.camera.camera);
    this.renderer.render(this.scene, this.camera.camera);

    if (frameDt > 0) this.fps += (1 / frameDt - this.fps) * 0.05;
    this.hudAccumulator += frameDt;
    if (this.hudAccumulator >= 1 / GAME_CONFIG.hudRateHz) {
      this.hudAccumulator = 0;
      const t = this.vehicle.controller.telemetry;
      this.cb.onHud(
        {
          speedKmh: t.speedKmh,
          rpm: t.rpm,
          gear: t.gear,
          drifting: t.drifting,
          handbrake: t.handbrake,
          braking: t.braking,
          reversing: t.reversing,
          upright: t.upright,
        },
        this.fps,
      );
    }
  }

  // ------------------------------------------------------------------ debug / tests

  private exposeDebug(): void {
    const enabled = import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug');
    if (!enabled) return;
    const c = this.vehicle.controller;
    window.__SV_DEBUG__ = {
      telemetry: () => ({ ...c.telemetry }),
      position: () => {
        const p = c.body.translation();
        return { x: p.x, y: p.y, z: p.z };
      },
      surface: () => {
        const p = c.body.translation();
        return this.world.circuit.surfaceAt(p.x, p.z);
      },
      cameraMode: () => this.camera.mode,
      counts: () => ({
        ...this.world.stats,
        drawCalls: this.renderer.gl.info.render.calls,
        triangles: this.renderer.gl.info.render.triangles,
        geometries: this.renderer.gl.info.memory.geometries,
        textures: this.renderer.gl.info.memory.textures,
      }),
      teleport: (x, z, yaw) => this.vehicle.teleport(x, 0.8, z, yaw),
      advance: (seconds) => {
        const n = Math.round(seconds * PHYSICS_HZ);
        for (let i = 0; i < n; i++) this.step(1 / PHYSICS_HZ);
      },
      flip: () => {
        const p = c.body.translation();
        c.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
        c.body.setTranslation({ x: p.x, y: 1.2, z: p.z }, true);
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.offs.forEach((off) => off());
    this.offs = [];
    this.input.detach();
    this.events.clear();
    delete window.__SV_DEBUG__;
    this.vehicle.dispose();
    this.scene.remove(this.vehicle.model.root);
    this.world.dispose(this.scene);
    this.env.dispose();
    this.assets.dispose();
    this.physics.dispose();
    this.renderer.dispose();
  }
}
