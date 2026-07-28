import { useEffect, useRef } from 'react';
import { MAX_HP, SHIELD_ABSORB, WEAPONS, type WeaponId } from '@shared/constants';
import { useGame } from '../net/store';
import { sfx } from '../audio/sfx';
import { input } from '../game/input';

/** In-game overlay: health, ammo, crosshair, scoreboard, feeds and overlays. */
export function HUD() {
  const phase = useGame((s) => s.phase);
  if (phase !== 'playing') return null;

  return (
    <div className="hud">
      <AudioCues />
      <Crosshair />
      <HealthBar />
      <WeaponPanel />
      <Scoreboard />
      <RoundTimer />
      <KillFeed />
      <Toasts />
      <PickupPrompt />
      <DeathOverlay />
      <WinnerOverlay />
      <PointerLockHint />
    </div>
  );
}

/** Side-effect-only: turns state transitions into sound cues. */
function AudioCues() {
  const prev = useRef({ gun: null as WeaponId | null, hp: MAX_HP, shield: 0, stones: 0, reloading: false });
  const prevRoundPhase = useRef<string>('waiting');

  useEffect(() => {
    const unsub = useGame.subscribe((s) => {
      const self = s.self;
      const p = prev.current;

      if (self.gun !== p.gun) {
        if (self.gun) sfx.pickupWeapon();
        else sfx.switchWeapon();
      }
      if (self.hp > p.hp) sfx.pickupHealth();
      if (self.shield > p.shield) sfx.pickupShield();
      if (self.reloading && !p.reloading) sfx.reload();

      prev.current = {
        gun: self.gun,
        hp: self.hp,
        shield: self.shield,
        stones: self.stones,
        reloading: self.reloading,
      };

      if (s.round.phase !== prevRoundPhase.current) {
        if (s.round.phase === 'intermission') sfx.roundEnd();
        prevRoundPhase.current = s.round.phase;
      }
    });
    return unsub;
  }, []);

  // Join toast sound: fires when a toast is added.
  const toastCount = useGame((s) => s.toasts.length);
  const prevToasts = useRef(0);
  useEffect(() => {
    if (toastCount > prevToasts.current) sfx.join();
    prevToasts.current = toastCount;
  }, [toastCount]);

  return null;
}

function Crosshair() {
  const self = useGame((s) => s.self);
  const swingingRef = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  // Poll the raw input object rather than pushing swing state through React.
  useEffect(() => {
    const id = setInterval(() => {
      const swinging = input.swingDown;
      if (swinging !== swingingRef.current) {
        swingingRef.current = swinging;
        if (ref.current) ref.current.classList.toggle('crosshair-swinging', swinging);
      }
    }, 60);
    return () => clearInterval(id);
  }, []);

  if (!self.alive) return null;

  return (
    <div ref={ref} className="crosshair">
      <span className="ch ch-top" />
      <span className="ch ch-bottom" />
      <span className="ch ch-left" />
      <span className="ch ch-right" />
      <span className="ch-dot" />
    </div>
  );
}

function HealthBar() {
  const self = useGame((s) => s.self);
  const pct = Math.max(0, Math.min(100, (self.hp / MAX_HP) * 100));
  const shieldPct = Math.max(0, Math.min(100, (self.shield / SHIELD_ABSORB) * 100));

  return (
    <div className="health-panel">
      <div className="bar-row">
        <span className="bar-label">HP</span>
        <div className="bar">
          <div
            className="bar-fill hp"
            style={{ width: `${pct}%`, background: pct < 30 ? '#e2483d' : undefined }}
          />
        </div>
        <span className="bar-value">{self.hp}</span>
      </div>

      {self.shield > 0 && (
        <div className="bar-row">
          <span className="bar-label">SH</span>
          <div className="bar">
            <div className="bar-fill shield" style={{ width: `${shieldPct}%` }} />
          </div>
          <span className="bar-value">{self.shield}</span>
        </div>
      )}
    </div>
  );
}

function WeaponPanel() {
  const self = useGame((s) => s.self);

  const weaponId: WeaponId =
    self.equipped === 'gun' && self.gun ? self.gun : self.equipped === 'stones' ? 'stones' : 'gloves';
  const spec = WEAPONS[weaponId];

  const ammoText =
    self.equipped === 'gun' && self.gun
      ? `${self.mag} / ${self.reserve}`
      : self.equipped === 'stones'
        ? `${self.stones}`
        : '∞';

  return (
    <div className="weapon-panel">
      <div className="weapon-name" style={{ color: spec.color }}>
        {spec.name}
      </div>
      <div className="ammo">
        {self.reloading ? <span className="reloading">Reloading…</span> : ammoText}
      </div>
      <div className="slots">
        <Slot n={1} label="Gun" active={self.equipped === 'gun'} available={!!self.gun} />
        <Slot n={2} label="Gloves" active={self.equipped === 'gloves'} available />
        <Slot n={3} label="Stones" active={self.equipped === 'stones'} available={self.stones > 0} />
      </div>
    </div>
  );
}

function Slot({ n, label, active, available }: { n: number; label: string; active: boolean; available: boolean }) {
  return (
    <div className={`slot${active ? ' slot-active' : ''}${available ? '' : ' slot-empty'}`}>
      <span className="slot-key">{n}</span>
      <span className="slot-label">{label}</span>
    </div>
  );
}

function Scoreboard() {
  const scores = useGame((s) => s.scores);
  const selfId = useGame((s) => s.selfId);

  return (
    <div className="scoreboard">
      <div className="scoreboard-head">Scoreboard</div>
      {scores.map((entry) => (
        <div
          key={entry.id}
          className={`score-row${entry.id === selfId ? ' score-self' : ''}${entry.ghost ? ' score-ghost' : ''}`}
        >
          <span className="score-dot" style={{ background: entry.color }} />
          <span className="score-name">
            {entry.name}
            {entry.ghost && <span className="ghost-tag"> left</span>}
          </span>
          <span className="score-kd">
            {entry.kills}/{entry.deaths}
          </span>
          <span className="score-points">{entry.score}</span>
        </div>
      ))}
    </div>
  );
}

function RoundTimer() {
  const round = useGame((s) => s.round);
  if (round.phase === 'intermission') return null;

  if (round.msRemaining === null) {
    return <div className="round-timer waiting">Waiting for another player…</div>;
  }

  const total = Math.max(0, Math.floor(round.msRemaining / 1000));
  const mm = Math.floor(total / 60);
  const ss = String(total % 60).padStart(2, '0');
  const paused = round.phase === 'waiting';

  return (
    <div className={`round-timer${total <= 30 && !paused ? ' urgent' : ''}`}>
      {mm}:{ss}
      {paused && <span className="paused-tag">paused</span>}
    </div>
  );
}

function KillFeed() {
  const killFeed = useGame((s) => s.killFeed);

  return (
    <div className="kill-feed">
      {killFeed.map((k) => (
        <div key={k.key} className="kill-row">
          {k.killerName ? (
            <>
              <strong>{k.killerName}</strong>
              <span className="kill-verb"> eliminated </span>
              <strong>{k.victimName}</strong>
            </>
          ) : (
            <>
              <strong>{k.victimName}</strong>
              <span className="kill-verb">
                {k.weapon === 'fall' ? ' fell to their death' : ' was eliminated'}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.key} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

function PickupPrompt() {
  const nearby = useGame((s) => s.nearbyPickup);
  const self = useGame((s) => s.self);
  if (!nearby || !self.alive) return null;

  const isWeapon = nearby.type !== 'health' && nearby.type !== 'shield';
  // Weapons only auto-equip into an empty gun slot; otherwise it's a manual swap.
  if (!isWeapon || !self.gun) return null;

  const spec = WEAPONS[nearby.type as WeaponId];
  if (!spec) return null;

  return (
    <div className="pickup-prompt">
      Press <kbd>1</kbd> to swap for <strong style={{ color: spec.color }}>{spec.name}</strong>
    </div>
  );
}

function DeathOverlay() {
  const self = useGame((s) => s.self);
  if (self.alive) return null;

  const seconds = Math.ceil(self.respawnInMs / 1000);
  return (
    <div className="death-overlay">
      <div className="death-title">You were eliminated</div>
      {seconds > 0 && <div className="death-sub">Respawning in {seconds}…</div>}
    </div>
  );
}

function WinnerOverlay() {
  const round = useGame((s) => s.round);
  if (round.phase !== 'intermission') return null;

  return (
    <div className="winner-overlay">
      <div className="winner-card">
        <div className="winner-label">Round over</div>
        {round.winner ? (
          <>
            <div className="winner-name">{round.winner.name}</div>
            <div className="winner-score">{round.winner.score} points</div>
          </>
        ) : (
          <div className="winner-name">No winner</div>
        )}
        <div className="winner-next">Next round starting…</div>
      </div>
    </div>
  );
}

/** Reminds the player to click back in after pointer lock is released. */
function PointerLockHint() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      if (ref.current) ref.current.style.display = input.pointerLocked ? 'none' : 'block';
    };
    const id = setInterval(update, 150);
    return () => clearInterval(id);
  }, []);

  return (
    <div ref={ref} className="lock-hint">
      Click to capture the mouse
    </div>
  );
}
