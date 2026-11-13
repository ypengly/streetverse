/**
 * Central input system. Keyboard (and, later, touch) both feed the same `DriveInput` shape.
 *
 * Safety properties:
 *  - Driving keys never scroll the page while driving is enabled.
 *  - Keys typed into form fields are ignored.
 *  - Window blur / tab hide clears all held keys so controls can't get "stuck".
 *  - When disabled (menus, pause), held state is cleared and neutral input is returned.
 */
import { NEUTRAL_INPUT, type DriveInput } from '../vehicles/VehicleController';

export type InputAction = 'camera' | 'recover' | 'pause' | 'map' | 'interact';

const ACTION_KEYS: Record<string, InputAction> = {
  KeyC: 'camera',
  KeyR: 'recover',
  Escape: 'pause',
  KeyM: 'map',
  KeyE: 'interact',
};

const DRIVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight',
]);

export type TouchInput = Partial<Pick<DriveInput, 'throttle' | 'brake' | 'steer' | 'handbrake' | 'nitro'>>;

export class InputManager {
  private down = new Set<string>();
  private actionHandlers: ((a: InputAction) => void)[] = [];
  private touch: TouchInput = {};
  private _enabled = false;
  private attached = false;
  private readonly out: DriveInput = { ...NEUTRAL_INPUT };

  constructor(private readonly target: Window = window) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('blur', this.reset);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.reset);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.reset();
    this.actionHandlers = [];
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
    if (!on) this.reset();
  }

  onAction(handler: (a: InputAction) => void): () => void {
    this.actionHandlers.push(handler);
    return () => {
      this.actionHandlers = this.actionHandlers.filter((h) => h !== handler);
    };
  }

  setTouch(input: TouchInput): void {
    this.touch = input;
  }

  /** Clear all held keys (focus loss, pause, menu transitions). */
  reset = (): void => {
    this.down.clear();
    this.touch = {};
  };

  private onVisibility = (): void => {
    if (document.hidden) this.reset();
  };

  private static isEditable(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || !el.tagName) return false;
    return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (InputManager.isEditable(e.target)) return;
    const action = ACTION_KEYS[e.code];
    // Escape must always work (it pauses/resumes), even when driving input is disabled.
    if (action === 'pause') {
      if (!e.repeat) this.emit(action);
      e.preventDefault();
      return;
    }
    if (!this._enabled) return;
    if (DRIVE_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    if (action) this.emit(action);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
    if (this._enabled && DRIVE_KEYS.has(e.code)) e.preventDefault();
  };

  private emit(a: InputAction): void {
    this.actionHandlers.forEach((h) => h(a));
  }

  private held(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** Current driving input. Returns a shared object; copy if you need to keep it. */
  poll(): DriveInput {
    const o = this.out;
    if (!this._enabled) {
      Object.assign(o, NEUTRAL_INPUT);
      return o;
    }
    const kbThrottle = this.held('KeyW', 'ArrowUp') ? 1 : 0;
    const kbBrake = this.held('KeyS', 'ArrowDown') ? 1 : 0;
    const kbSteer = (this.held('KeyD', 'ArrowRight') ? 1 : 0) - (this.held('KeyA', 'ArrowLeft') ? 1 : 0);
    o.throttle = Math.max(kbThrottle, this.touch.throttle ?? 0);
    o.brake = Math.max(kbBrake, this.touch.brake ?? 0);
    o.steer = kbSteer !== 0 ? kbSteer : (this.touch.steer ?? 0);
    o.handbrake = this.held('Space') || !!this.touch.handbrake;
    o.nitro = this.held('ShiftLeft', 'ShiftRight') || !!this.touch.nitro;
    return o;
  }
}
