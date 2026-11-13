import { CAMERA_LABELS } from '../../camera/CameraManager';
import { useGameStore } from '../../store/gameStore';

const REDLINE = 7000;

function gearLabel(gear: number, speedKmh: number): string {
  if (gear < 0) return 'R';
  if (speedKmh < 0.5) return 'N';
  return String(gear);
}

export function Hud(): JSX.Element {
  const hud = useGameStore((s) => s.hud);
  const cameraMode = useGameStore((s) => s.cameraMode);
  const fps = useGameStore((s) => s.fps);
  const debug = new URLSearchParams(window.location.search).has('debug');
  const rpmFrac = Math.min(1, hud.rpm / REDLINE);
  const hot = rpmFrac > 0.88;

  return (
    <div className="hud">
      <div className="hud-speed" data-testid="speedometer">
        <div className="speed-value" data-testid="speed-value">
          {Math.round(hud.speedKmh)}
        </div>
        <div className="speed-unit">km/h</div>
        <div className="rpm-bar" aria-label="Engine RPM">
          <div className={hot ? 'rpm-fill hot' : 'rpm-fill'} style={{ width: `${rpmFrac * 100}%` }} />
          <div className="rpm-redline" />
        </div>
        <div className="gear-row">
          <span className="gear" data-testid="gear">
            {gearLabel(hud.gear, hud.speedKmh)}
          </span>
          <span className="rpm-text">{Math.round(hud.rpm / 100) * 100} rpm</span>
        </div>
      </div>

      <div className="hud-badges">
        {hud.handbrake && <span className="badge warn">HANDBRAKE</span>}
        {hud.drifting && <span className="badge accent">DRIFT</span>}
      </div>

      <div className="hud-camera">
        <kbd>C</kbd> {CAMERA_LABELS[cameraMode]}
      </div>
      <div className="hud-hints">
        <kbd>R</kbd> Recover · <kbd>Esc</kbd> Pause
      </div>
      {debug && <div className="hud-fps">{Math.round(fps)} fps</div>}
    </div>
  );
}
