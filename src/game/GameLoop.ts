/**
 * Fixed-timestep loop with render interpolation.
 * `step` runs at a constant dt (physics); `render` runs once per animation frame with alpha in [0,1).
 */
import { MAX_SUBSTEPS, PHYSICS_DT } from '../utils/constants';

export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  paused = false;

  constructor(
    private readonly step: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Avoid a huge dt spike after unpausing. */
  resetClock(): void {
    this.last = performance.now();
    this.acc = 0;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const frameDt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    if (!this.paused) {
      this.acc += frameDt;
      let steps = 0;
      while (this.acc >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
        this.step(PHYSICS_DT);
        this.acc -= PHYSICS_DT;
        steps++;
      }
      if (steps === MAX_SUBSTEPS) this.acc = 0; // drop backlog rather than spiral
    }
    this.render(this.paused ? 1 : this.acc / PHYSICS_DT, frameDt);
  };
}
