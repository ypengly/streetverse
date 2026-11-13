import { create } from 'zustand';
import type { DrivingMode } from '../vehicles/VehiclePhysics';

const KEY = 'streetverse.settings.v1';

interface Persisted {
  drivingMode: DrivingMode;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      if (parsed.drivingMode === 'arcade' || parsed.drivingMode === 'sport') return { drivingMode: parsed.drivingMode };
    }
  } catch {
    /* corrupted or unavailable storage: fall through to defaults */
  }
  return { drivingMode: 'arcade' };
}

interface SettingsState extends Persisted {
  setDrivingMode: (m: DrivingMode) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...load(),
  setDrivingMode: (drivingMode) => {
    set({ drivingMode });
    try {
      localStorage.setItem(KEY, JSON.stringify({ drivingMode }));
    } catch {
      /* storage unavailable: setting still applies for this session */
    }
  },
}));
