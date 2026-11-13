import { test, expect, type Page } from '@playwright/test';

/** Collects console errors / uncaught exceptions so every test can assert a clean console. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

async function startGame(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: 'Start Driving' }).click();
  await expect(page.getByTestId('speedometer')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => !!window.__SV_DEBUG__);
}

type DebugApi = NonNullable<Window['__SV_DEBUG__']>;

/** Run `fn` inside the page with the game's debug API as its argument (fn must be self-contained). */
const debug = <T,>(page: Page, fn: (d: DebugApi) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__SV_DEBUG__)`) as Promise<T>;

test.describe('STREETVERSE stage 1', () => {
  test('menu -> loading -> in-game HUD with a clean console', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /STREETVERSE/i })).toBeVisible();
    await page.getByRole('button', { name: 'Start Driving' }).click();
    await expect(page.getByTestId('speedometer')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('canvas')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('holding W accelerates the car forward; releasing W stops applying throttle', async ({ page }) => {
    const errors = trackErrors(page);
    await startGame(page);
    const start = await debug(page, (d) => d.position());
    await page.keyboard.down('w');
    await debug(page, (d) => d.advance(4));
    const moving = await debug(page, (d) => d.telemetry());
    const mid = await debug(page, (d) => d.position());
    expect(moving.speedKmh).toBeGreaterThan(40);
    expect(moving.throttle).toBe(1);
    expect(Math.hypot(mid.x - start.x, mid.z - start.z)).toBeGreaterThan(20);

    await page.keyboard.up('w');
    await debug(page, (d) => d.advance(0.5));
    expect((await debug(page, (d) => d.telemetry())).throttle).toBe(0);
    expect(errors).toEqual([]);
  });

  test('brake slows the car and holding S from rest reverses', async ({ page }) => {
    await startGame(page);
    await page.keyboard.down('w');
    await debug(page, (d) => d.advance(4));
    await page.keyboard.up('w');
    const fast = (await debug(page, (d) => d.telemetry())).speedKmh;
    await page.keyboard.down('s');
    await debug(page, (d) => d.advance(3));
    const braked = await debug(page, (d) => d.telemetry());
    expect(braked.speedKmh).toBeLessThan(fast * 0.3);
    await debug(page, (d) => d.advance(5));
    const rev = await debug(page, (d) => d.telemetry());
    expect(rev.forwardSpeed).toBeLessThan(-2);
    expect(rev.gear).toBe(-1);
    await page.keyboard.up('s');
  });

  test('steering keys turn the car in the correct directions', async ({ page }) => {
    await startGame(page);
    // Short manoeuvres: the first straight of the circuit is only ~60 m before the first bend.
    await page.keyboard.down('w');
    await debug(page, (d) => d.advance(2));
    await page.keyboard.up('w');
    expect(await debug(page, (d) => d.surface())).toBe('asphalt');
    await page.keyboard.down('a');
    await debug(page, (d) => d.advance(0.6));
    expect((await debug(page, (d) => d.telemetry())).yawRate).toBeGreaterThan(0.1);
    await page.keyboard.up('a');
    await page.keyboard.down('d');
    await debug(page, (d) => d.advance(1.0));
    expect((await debug(page, (d) => d.telemetry())).yawRate).toBeLessThan(-0.1);
    await page.keyboard.up('d');
  });

  test('handbrake drift shows the DRIFT state in telemetry and HANDBRAKE badge in the HUD', async ({ page }) => {
    await startGame(page);
    await page.keyboard.down('w');
    await debug(page, (d) => d.advance(2.5));
    await page.keyboard.up('w');
    expect(await debug(page, (d) => d.surface())).toBe('asphalt');
    await page.keyboard.down('a');
    await page.keyboard.down('Space');
    await debug(page, (d) => d.advance(0.8));
    const t = await debug(page, (d) => d.telemetry());
    expect(t.drifting).toBe(true);
    expect(Math.abs(t.driftAngle)).toBeGreaterThan(0.25);
    await expect(page.getByText('HANDBRAKE')).toBeVisible({ timeout: 30_000 });
    await page.keyboard.up('Space');
    await page.keyboard.up('a');
  });

  test('C cycles chase -> close -> hood -> chase', async ({ page }) => {
    await startGame(page);
    const modes: string[] = [await debug(page, (d) => d.cameraMode())];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('c');
      modes.push(await debug(page, (d) => d.cameraMode()));
    }
    expect(modes).toEqual(['chase', 'close', 'hood', 'chase']);
  });

  test('Escape pauses (sim frozen, driving keys cleared) and resumes', async ({ page }) => {
    await startGame(page);
    await page.keyboard.down('w');
    await debug(page, (d) => d.advance(2));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    const p1 = await debug(page, (d) => d.position());
    await page.waitForTimeout(3000);
    const p2 = await debug(page, (d) => d.position());
    expect(p2).toEqual(p1); // no simulation while paused
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeHidden();
    // Held key was cleared by the pause, so no stuck throttle after resume.
    await debug(page, (d) => d.advance(0.3));
    expect((await debug(page, (d) => d.telemetry())).throttle).toBe(0);
    await page.keyboard.up('w');
  });

  test('losing window focus pauses the game and clears stuck keys', async ({ page }) => {
    await startGame(page);
    await page.keyboard.down('w');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume' }).click();
    await debug(page, (d) => d.advance(0.3));
    expect((await debug(page, (d) => d.telemetry())).throttle).toBe(0);
    await page.keyboard.up('w');
  });

  test('R recovers an overturned car onto the road; overturned cars auto-recover', async ({ page }) => {
    const errors = trackErrors(page);
    await startGame(page);
    await debug(page, (d) => d.flip());
    await debug(page, (d) => d.advance(2));
    expect((await debug(page, (d) => d.telemetry())).upright).toBeLessThan(0);
    await page.keyboard.press('r');
    await debug(page, (d) => d.advance(1.5));
    const t = await debug(page, (d) => d.telemetry());
    expect(t.upright).toBeGreaterThan(0.95);
    expect(t.groundedWheels).toBe(4);
    expect(await debug(page, (d) => d.surface())).toBe('asphalt');
    await expect(page.getByText(/recovered/i).first()).toBeVisible({ timeout: 30_000 });

    // Auto recovery after being overturned for too long.
    await debug(page, (d) => d.flip());
    await debug(page, (d) => d.advance(7));
    expect((await debug(page, (d) => d.telemetry())).upright).toBeGreaterThan(0.95);
    expect(errors).toEqual([]);
  });

  test('driving into the world boundary collides and keeps the car inside the map', async ({ page }) => {
    await startGame(page);
    await debug(page, (d) => d.teleport(150, -120, -Math.PI / 2)); // face +X across open ground
    await page.keyboard.down('w');
    await debug(page, (d) => d.advance(14));
    await page.keyboard.up('w');
    const p = await debug(page, (d) => d.position());
    expect(Math.abs(p.x)).toBeLessThan(300);
    expect(Math.abs(p.z)).toBeLessThan(300);
    expect(p.y).toBeGreaterThan(0.3);
    await expect(page.getByText('Collision')).toBeVisible({ timeout: 30_000 });
  });

  test('returning to the menu fully disposes the game, and a second session does not leak', async ({ page }) => {
    const errors = trackErrors(page);
    await startGame(page);
    await debug(page, (d) => d.advance(0.5));
    await page.waitForTimeout(2500);
    const first = await debug(page, (d) => d.counts());

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Return to Main Menu' }).click();
    await expect(page.getByRole('button', { name: 'Start Driving' })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await page.evaluate(() => window.__SV_DEBUG__)).toBeUndefined();

    await page.getByRole('button', { name: 'Start Driving' }).click();
    await expect(page.getByTestId('speedometer')).toBeVisible({ timeout: 60_000 });
    await page.waitForFunction(() => !!window.__SV_DEBUG__);
    await page.waitForTimeout(2500);
    const second = await debug(page, (d) => d.counts());
    expect(second.geometries).toBe(first.geometries);
    expect(second.textures).toBe(first.textures);
    expect(errors).toEqual([]);
  });

  test('resizing the window keeps the canvas matched to its container', async ({ page }) => {
    const errors = trackErrors(page);
    await startGame(page);
    await page.setViewportSize({ width: 640, height: 900 });
    await page.waitForTimeout(800);
    const dims = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    expect(dims).toEqual({ w: 640, h: 900 });
    expect(errors).toEqual([]);
  });

  test('driving mode toggle on the menu persists across reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sport' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sport' })).toHaveAttribute('aria-pressed', 'true');
  });
});
