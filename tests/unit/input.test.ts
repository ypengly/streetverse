// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputManager } from '../../src/engine/InputManager';

const key = (type: 'keydown' | 'keyup', code: string, target: EventTarget = window) => {
  const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};

describe('InputManager', () => {
  let input: InputManager;
  beforeEach(() => {
    input = new InputManager(window);
    input.attach();
    input.setEnabled(true);
  });
  afterEach(() => input.detach());

  it('maps WASD and arrow keys to throttle, brake and steering', () => {
    key('keydown', 'KeyW');
    expect(input.poll().throttle).toBe(1);
    key('keyup', 'KeyW');
    key('keydown', 'ArrowDown');
    expect(input.poll().brake).toBe(1);
    key('keydown', 'KeyD');
    expect(input.poll().steer).toBe(1);
    key('keydown', 'KeyA');
    expect(input.poll().steer).toBe(0); // opposite keys cancel
  });

  it('supports simultaneous inputs and release events', () => {
    key('keydown', 'KeyW');
    key('keydown', 'KeyA');
    key('keydown', 'Space');
    let p = input.poll();
    expect([p.throttle, p.steer, p.handbrake]).toEqual([1, -1, true]);
    key('keyup', 'Space');
    p = input.poll();
    expect(p.handbrake).toBe(false);
    expect(p.throttle).toBe(1);
  });

  it('prevents default (page scroll) on driving keys while enabled', () => {
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
    expect(key('keydown', 'ArrowUp').defaultPrevented).toBe(true);
  });

  it('does not capture keys when disabled and returns neutral input', () => {
    input.setEnabled(false);
    expect(key('keydown', 'Space').defaultPrevented).toBe(false);
    key('keydown', 'KeyW');
    const p = input.poll();
    expect([p.throttle, p.brake, p.steer, p.handbrake]).toEqual([0, 0, 0, false]);
  });

  it('clears held keys on window blur so controls cannot stick', () => {
    key('keydown', 'KeyW');
    key('keydown', 'KeyD');
    window.dispatchEvent(new Event('blur'));
    const p = input.poll();
    expect([p.throttle, p.steer]).toEqual([0, 0]);
  });

  it('clears held keys when the game is paused (disabled) and does not resume them', () => {
    key('keydown', 'KeyW');
    input.setEnabled(false);
    input.setEnabled(true);
    expect(input.poll().throttle).toBe(0);
  });

  it('ignores typing inside text fields', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    const e = key('keydown', 'KeyW', field);
    expect(e.defaultPrevented).toBe(false);
    expect(input.poll().throttle).toBe(0);
    field.remove();
  });

  it('emits one-shot actions without repeats, and Escape works even when disabled', () => {
    const seen: string[] = [];
    input.onAction((a) => seen.push(a));
    key('keydown', 'KeyC');
    key('keydown', 'KeyR');
    input.setEnabled(false);
    key('keydown', 'Escape');
    key('keydown', 'KeyC'); // ignored while disabled
    expect(seen).toEqual(['camera', 'recover', 'pause']);
  });

  it('merges touch input with keyboard input', () => {
    input.setTouch({ throttle: 1, steer: -1 });
    const p = input.poll();
    expect([p.throttle, p.steer]).toEqual([1, -1]);
  });
});
