/**
 * Desktop-only gate. There is deliberately no touch control scheme — if this
 * screen shows, the game does not load at all.
 */
export function MobileBlock() {
  return (
    <div className="screen mobile-block">
      <div className="mobile-card">
        <div className="mobile-icon">🖥️</div>
        <h1>Please switch to a desktop to play</h1>
        <p>
          Spoider Man needs a mouse and keyboard for aiming, swinging and pointer lock.
          Open this page on a desktop or laptop.
        </p>
      </div>
    </div>
  );
}

/** User-agent plus viewport heuristic; either signal alone is unreliable. */
export function isMobileDevice(): boolean {
  const ua = navigator.userAgent || '';
  const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);

  // iPadOS reports a desktop UA, so treat multi-touch + no fine pointer as touch-only.
  const touchOnly =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches &&
    !window.matchMedia('(pointer: fine)').matches;

  const smallViewport = Math.min(window.innerWidth, window.innerHeight) < 500 ||
    window.innerWidth < 900;

  return (uaMobile && touchOnly) || (touchOnly && smallViewport) || (uaMobile && smallViewport);
}
