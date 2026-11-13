import { useGameStore } from '../../store/gameStore';
import { useSettingsStore } from '../../store/settingsStore';
import { MenuButton } from '../components/MenuButton';

export function MainMenu({ error }: { error: string | null }): JSX.Element {
  const startSession = useGameStore((s) => s.startSession);
  const openControls = useGameStore((s) => s.openControls);
  const mode = useSettingsStore((s) => s.drivingMode);
  const setMode = useSettingsStore((s) => s.setDrivingMode);

  return (
    <main className="menu-screen">
      <div className="menu-road" aria-hidden="true" />
      <section className="menu-card">
        <h1 className="logo">
          STREET<span>VERSE</span>
        </h1>
        <p className="tagline">Open-city driving simulator</p>
        {error && (
          <p className="menu-error" role="alert">
            {error}
          </p>
        )}
        <MenuButton variant="primary" onClick={startSession} autoFocus>
          Start Driving
        </MenuButton>
        <div className="mode-row" role="group" aria-label="Driving mode">
          <button
            type="button"
            className={mode === 'arcade' ? 'seg active' : 'seg'}
            aria-pressed={mode === 'arcade'}
            onClick={() => setMode('arcade')}
          >
            Arcade
          </button>
          <button
            type="button"
            className={mode === 'sport' ? 'seg active' : 'seg'}
            aria-pressed={mode === 'sport'}
            onClick={() => setMode('sport')}
          >
            Sport
          </button>
        </div>
        <p className="mode-hint">
          {mode === 'arcade'
            ? 'Forgiving grip and stability assist.'
            : 'Less assistance. Aggressive inputs have consequences.'}
        </p>
        <MenuButton onClick={() => openControls(true)}>Controls</MenuButton>
      </section>
    </main>
  );
}
