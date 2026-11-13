import { useGameStore } from '../../store/gameStore';
import { MenuButton } from '../components/MenuButton';

const ROWS: [string, string][] = [
  ['W / ↑', 'Accelerate'],
  ['S / ↓', 'Brake, then reverse'],
  ['A D / ← →', 'Steer'],
  ['Space', 'Handbrake (drift)'],
  ['C', 'Change camera'],
  ['R', 'Recover vehicle'],
  ['Esc', 'Pause / resume'],
];

export function ControlsPanel(): JSX.Element {
  const openControls = useGameStore((s) => s.openControls);
  return (
    <div className="overlay">
      <section className="menu-card wide" role="dialog" aria-label="Controls">
        <h2>Controls</h2>
        <dl className="controls-list">
          {ROWS.map(([key, action]) => (
            <div key={key} className="controls-row">
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <MenuButton variant="primary" onClick={() => openControls(false)} autoFocus>
          Back
        </MenuButton>
      </section>
    </div>
  );
}
