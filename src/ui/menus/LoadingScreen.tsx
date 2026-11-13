import { useGameStore } from '../../store/gameStore';

export function LoadingScreen(): JSX.Element {
  const progress = useGameStore((s) => s.loadingProgress);
  const label = useGameStore((s) => s.loadingLabel);
  return (
    <div className="overlay solid" role="status" aria-live="polite">
      <div className="loading">
        <h1 className="logo">
          STREET<span>VERSE</span>
        </h1>
        <div className="bar" aria-hidden="true">
          <div className="bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <p>{label}…</p>
      </div>
    </div>
  );
}
