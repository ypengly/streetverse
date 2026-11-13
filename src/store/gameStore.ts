import { create } from 'zustand';
import type { CameraMode } from '../camera/CameraManager';
import type { VehicleTelemetry } from '../vehicles/VehicleController';

export type Screen = 'menu' | 'loading' | 'playing' | 'paused';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn';
}

export const EMPTY_TELEMETRY: Pick<
  VehicleTelemetry,
  'speedKmh' | 'rpm' | 'gear' | 'drifting' | 'handbrake' | 'braking' | 'reversing' | 'upright'
> = {
  speedKmh: 0,
  rpm: 900,
  gear: 1,
  drifting: false,
  handbrake: false,
  braking: false,
  reversing: false,
  upright: 1,
};

export type HudTelemetry = typeof EMPTY_TELEMETRY;

interface GameStore {
  screen: Screen;
  /** Incremented to start a new session; 0 means no session. */
  sessionId: number;
  controlsOpen: boolean;
  loadingProgress: number;
  loadingLabel: string;
  error: string | null;
  cameraMode: CameraMode;
  hud: HudTelemetry;
  toasts: Toast[];
  fps: number;

  startSession: () => void;
  endSession: () => void;
  setLoading: (p: number, label: string) => void;
  loaded: () => void;
  pause: () => void;
  resume: () => void;
  openControls: (open: boolean) => void;
  setCameraMode: (m: CameraMode) => void;
  setHud: (h: HudTelemetry, fps: number) => void;
  toast: (text: string, kind?: 'info' | 'warn') => void;
  dismissToast: (id: number) => void;
  fail: (message: string) => void;
}

let toastId = 1;

export const useGameStore = create<GameStore>((set, get) => ({
  screen: 'menu',
  sessionId: 0,
  controlsOpen: false,
  loadingProgress: 0,
  loadingLabel: '',
  error: null,
  cameraMode: 'chase',
  hud: EMPTY_TELEMETRY,
  toasts: [],
  fps: 0,

  startSession: () =>
    set((s) => ({
      screen: 'loading',
      sessionId: s.sessionId + 1,
      loadingProgress: 0,
      loadingLabel: 'Starting',
      error: null,
      toasts: [],
      cameraMode: 'chase',
    })),
  endSession: () => set({ screen: 'menu', sessionId: 0, hud: EMPTY_TELEMETRY, controlsOpen: false, toasts: [] }),
  setLoading: (loadingProgress, loadingLabel) => set({ loadingProgress, loadingLabel }),
  loaded: () => set({ screen: 'playing' }),
  pause: () => {
    if (get().screen === 'playing') set({ screen: 'paused' });
  },
  resume: () => {
    if (get().screen === 'paused') set({ screen: 'playing', controlsOpen: false });
  },
  openControls: (controlsOpen) => set({ controlsOpen }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setHud: (hud, fps) => set({ hud, fps }),
  toast: (text, kind = 'info') => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), 2600);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  fail: (error) => set({ error, screen: 'menu', sessionId: 0 }),
}));
