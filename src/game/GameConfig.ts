/** Central tunables for the game session. */
export const GAME_CONFIG = {
  /** Seconds the car may stay overturned before it is automatically recovered. */
  autoRecoverSeconds: 5,
  /** Seconds overturned before the "press R" hint appears. */
  recoverHintSeconds: 1.5,
  /** Fall-through safety: recover if the car drops below this height. */
  killPlaneY: -5,
  /** Telemetry push rate to the React store (Hz). */
  hudRateHz: 20,
} as const;
