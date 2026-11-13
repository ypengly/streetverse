# STREETVERSE

Browser-based 3D driving game (React + TypeScript + Three.js + Rapier). **This repository currently
implements Stage 1 of the plan: a playable driving prototype.** Stages 2–7 (city districts, traffic,
missions, garage/economy, saves, audio, mobile controls, polish) are *not* built yet — see
[Status](#status).

## Run

```bash
npm install
npm run dev        # development server
npm run build      # type-check + production build -> dist/
npm run preview    # serve the production build on :4173
npm run lint
npm test           # unit tests (Vitest, real Rapier physics in Node)
npm run test:e2e   # browser tests (Playwright; builds + serves the app itself)
```

Playwright needs a Chromium. It uses `CHROME_PATH` if set, otherwise looks in
`PLAYWRIGHT_BROWSERS_PATH`, `/opt/pw-browsers` and the Puppeteer cache, otherwise Playwright's own
download (`npx playwright install chromium`).

Append `?debug` to the URL to show an FPS counter and expose `window.__SV_DEBUG__` (used by the E2E tests).

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake; hold from standstill to reverse |
| A D / ← → | Steer |
| Space | Handbrake (locks rear wheels → drift) |
| C | Cycle camera: chase → close chase → hood |
| R | Recover car to the nearest safe road position |
| Esc | Pause / resume (also pauses on window blur) |

Driving mode (Arcade / Sport) is chosen on the main menu or pause menu and is remembered.

## Architecture

```
src/
  app/GameShell.tsx     React <-> Game lifecycle (one Game per session, always disposed)
  game/                 Game (orchestrator), GameLoop (fixed step), EventBus, GameConfig
  engine/               PhysicsWorld (Rapier), Renderer, InputManager, AssetManager
  vehicles/             VehiclePhysics (pure model), VehicleController (Rapier raycast vehicle),
                        Vehicle (sim + visuals + interpolation), VehicleFactory (procedural car)
  camera/               CameraManager (3 modes, FOV, collision avoidance, shake)
  world/                Circuit (pure geometry), WorldManager (meshes + colliders), EnvironmentManager
  store/                Zustand stores (game/UI state, persisted settings)
  ui/                   React menus, HUD, toasts (the 3D canvas is separate from UI layout)
tests/unit              Vitest: vehicle behaviour, physics model, input, circuit
tests/e2e               Playwright: real-browser gameplay flows
```

Key decisions:

* **Fixed-timestep physics (120 Hz)** with render interpolation; simulation is separate from rendering.
* **Custom raycast vehicle** on a Rapier rigid body (Rapier's controller was not used). Each wheel
  has a spring/damper and an anti-roll bar. Tire force is limited by a friction ellipse
  (`mu × load`), so throttle reduces cornering grip, the handbrake locks the rear tires, and
  surface type scales grip. Weight transfer and body roll come from the real forces.
* **Speed-sensitive steering** limited to what the tires can sustain, widened during slides so the
  player can counter-steer. Arcade vs Sport differ in grip, steering assist, damping and a yaw stabiliser.
* **Instanced rendering** for barriers, streetlights and trees; their colliders are batched on one
  fixed body each. Object counts are fixed at build time.
* **Procedural assets only** (no external files). `AssetManager.loadGLTF` already falls back to a
  procedural model on failure, ready for real models in Stage 2.

## Testing — what was actually run

| Suite | Result |
| --- | --- |
| `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) | clean |
| `eslint .` | clean |
| `vitest run` | 39 / 39 passing |
| `playwright test` (headless Chrome, software WebGL) | 13 / 13 passing |
| `vite build` | succeeds |

Unit tests drive the **real Rapier simulation** headlessly: ride height, determinism, 0–100 km/h time,
gear shifting, braking distance, reverse, no-creep, grip-dependent braking, steering direction and
speed-sensitivity, no rollover under full lock (both modes), ~1 g cornering, handbrake drift,
Sport-vs-Arcade difference, wall impact without tunnelling, overturn detection and recovery.
The suite was mutation-checked: breaking the steering sign, removing the brakes, or removing ground
contact makes it fail.

E2E tests use real keyboard events in a real browser: boot with a clean console, accelerate, brake,
reverse, steer, drift + HUD badge, camera cycling, pause/resume (sim frozen, keys cleared),
blur-pause, manual and automatic recovery, world-boundary collision, full dispose with no
geometry/texture growth across sessions, canvas resize, and settings persistence.

## Status

**Stage 1 exit condition met:** the player can drive a closed 1.34 km circuit, steer, collide with
barriers/boundaries, recover, and pause.

Not implemented yet (everything after Stage 1): city districts and buildings, traffic and
pedestrians, minimap/map/route planning, missions and rewards, economy, dealership, garage and
upgrades, save system, audio, day/night and weather, graphics presets, post-processing,
touch controls (the `InputManager` accepts touch input, but there is no on-screen UI), nitro (the
input exists but nothing grants it), tire smoke / skid marks (per-wheel slip is already computed),
headlight beams (lights are emissive only).

## Known limitations

* **Performance is unmeasured on a real GPU.** The only renderer available during development was
  software (SwiftShader), which ran at about 1 fps; that is not representative. The scene is small
  (≈118 draw calls incl. shadows, ≈84k triangles, 33 geometries, 7 textures), but 60 fps is a target
  that has **not** been verified. In slow conditions the simulation slows down rather than
  spiralling (capped at 6 substeps per frame).
* After pausing, held keys must be re-pressed (held state is intentionally cleared to avoid stuck controls).
* The first straight is only ~60 m before the first bend; at full throttle you reach the curb in ~4 s.
* The unit tests do not detect changes to the height at which tire forces are applied (a deliberate
  mutation there was not caught), so rollover resistance is only checked at a coarse level.
* Debug hooks (`window.__SV_DEBUG__`) are enabled in dev builds and with `?debug`.

## Deployment

`npm run build` produces a static site in `dist/`; upload it to any static host (Netlify, Vercel,
GitHub Pages, S3 + CDN). No backend or paid service is required.

## Asset credits

None required: all geometry and textures are generated procedurally at runtime. Vehicle name
"Kestrel S1" is fictional.
