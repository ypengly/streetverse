import { useGameStore } from '../../store/gameStore';
import { useSettingsStore } from '../../store/settingsStore';
import { MenuButton } from '../components/MenuButton';

export function PauseMenu(): JSX.Element {
  const resume = useGameStore((s) => s.resume);
  const endSession = useGameStore((s) => s.endSession);
  const openControls = useGameStore((s) => s.openControls);
  const mode = useSettingsStore((s) => s.drivingMode);
  const setMode = useSettingsStore((s) => s.setDrivingMode);

  return (
    <div className="overlay">
      <section className="menu-card" role="dialog" aria-label="Paused">
        <h2>Paused</h2>
        <MenuButton variant="primary" onClick={resume} autoFocus>
          Resume
        </MenuButton>
        <MenuButton onClick={() => setMode(mode === 'arcade' ? 'sport' : 'arcade')}>
          Driving mode: {mode === 'arcade' ? 'Arcade' : 'Sport'}
        </MenuButton>
        <MenuButton onClick={() => openControls(true)}>Controls</MenuButton>
        <MenuButton onClick={endSession}>Return to Main Menu</MenuButton>
      </section>
    </div>
  );
}
