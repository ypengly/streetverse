/** Owns the Game lifecycle and layers React UI over the 3D canvas. */
import { useEffect, useRef } from 'react';
import { Game } from '../game/Game';
import { useGameStore } from '../store/gameStore';
import { useSettingsStore } from '../store/settingsStore';
import { MainMenu } from '../ui/menus/MainMenu';
import { PauseMenu } from '../ui/menus/PauseMenu';
import { LoadingScreen } from '../ui/menus/LoadingScreen';
import { ControlsPanel } from '../ui/menus/ControlsPanel';
import { Hud } from '../ui/hud/Hud';
import { Toasts } from '../ui/hud/Toasts';

export function GameShell(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const sessionId = useGameStore((s) => s.sessionId);
  const screen = useGameStore((s) => s.screen);
  const controlsOpen = useGameStore((s) => s.controlsOpen);
  const error = useGameStore((s) => s.error);
  const drivingMode = useSettingsStore((s) => s.drivingMode);

  // One Game per session. Cleanup (return to menu, StrictMode remount) always disposes it.
  useEffect(() => {
    const container = containerRef.current;
    if (sessionId === 0 || !container) return;
    let cancelled = false;
    let game: Game | null = null;

    Game.create(
      container,
      {
        onProgress: (p, label) => useGameStore.getState().setLoading(p, label),
        onTogglePause: () => {
          const s = useGameStore.getState();
          if (s.screen === 'playing') s.pause();
          else if (s.screen === 'paused') s.resume();
        },
        onHud: (hud, fps) => useGameStore.getState().setHud(hud, fps),
        onCameraMode: (m) => useGameStore.getState().setCameraMode(m),
        onToast: (text, kind) => useGameStore.getState().toast(text, kind),
        onContextLost: () =>
          useGameStore.getState().fail('The graphics context was lost. Reload the page to continue.'),
      },
      useSettingsStore.getState().drivingMode,
    )
      .then((g) => {
        if (cancelled) {
          g.dispose();
          return;
        }
        game = g;
        gameRef.current = g;
        useGameStore.getState().loaded();
        g.start();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        useGameStore.getState().fail(`Could not start the game: ${msg}`);
      });

    return () => {
      cancelled = true;
      game?.dispose();
      gameRef.current = null;
    };
  }, [sessionId]);

  // Simulation runs only while the screen is 'playing'.
  useEffect(() => {
    gameRef.current?.setPaused(screen !== 'playing');
  }, [screen]);

  useEffect(() => {
    gameRef.current?.setDrivingMode(drivingMode);
  }, [drivingMode]);

  const inSession = screen === 'playing' || screen === 'paused';

  return (
    <div className="shell">
      <div ref={containerRef} className="game-canvas" aria-label="Game view" />
      {screen === 'menu' && <MainMenu error={error} />}
      {screen === 'loading' && <LoadingScreen />}
      {inSession && <Hud />}
      {inSession && <Toasts />}
      {screen === 'paused' && !controlsOpen && <PauseMenu />}
      {screen === 'paused' && controlsOpen && <ControlsPanel />}
      {screen === 'menu' && controlsOpen && <ControlsPanel />}
    </div>
  );
}
