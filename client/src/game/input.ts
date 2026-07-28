/**
 * Raw input, kept outside React entirely — the frame loop reads this object
 * directly so a keypress never triggers a re-render of the scene graph.
 */

export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  ads: boolean;

  /** Left mouse held — continuous fire for automatics. */
  fireDown: boolean;
  /** Right mouse held — web attached while true. */
  swingDown: boolean;

  /** Accumulated mouse movement since the last frame, in pixels. */
  mouseDX: number;
  mouseDY: number;
  /** Accumulated wheel notches; positive reels the web in. */
  wheel: number;

  // Edge-triggered actions, cleared by the consumer each frame.
  firePressed: boolean;
  swingPressed: boolean;
  reloadPressed: boolean;
  cyclePressed: boolean;
  slotPressed: 1 | 2 | 3 | null;

  pointerLocked: boolean;
}

export const input: InputState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  ads: false,
  fireDown: false,
  swingDown: false,
  mouseDX: 0,
  mouseDY: 0,
  wheel: 0,
  firePressed: false,
  swingPressed: false,
  reloadPressed: false,
  cyclePressed: false,
  slotPressed: null,
  pointerLocked: false,
};

export function clearEdges(): void {
  input.firePressed = false;
  input.swingPressed = false;
  input.reloadPressed = false;
  input.cyclePressed = false;
  input.slotPressed = null;
  input.mouseDX = 0;
  input.mouseDY = 0;
  input.wheel = 0;
}

/** Releases everything — used when pointer lock drops so keys don't stick down. */
function releaseAll(): void {
  input.forward = input.back = input.left = input.right = false;
  input.jump = input.ads = false;
  input.fireDown = input.swingDown = false;
}

/**
 * Largest movement accepted from one mouse event. A genuine fast flick is well
 * under this; anything past it is a driver or pointer-lock artefact, and letting
 * it through would fling the view across the map in a single frame.
 */
const MAX_MOUSE_DELTA = 400;
/** Look input is dropped this long after pointer lock engages. */
const LOCK_SETTLE_MS = 120;

function clampDelta(d: number): number {
  return d > MAX_MOUSE_DELTA ? MAX_MOUSE_DELTA : d < -MAX_MOUSE_DELTA ? -MAX_MOUSE_DELTA : d;
}

export function installInputHandlers(canvas: HTMLElement): () => void {
  let settleUntil = 0;

  const onKey = (e: KeyboardEvent, down: boolean) => {
    switch (e.code) {
      case 'KeyW': input.forward = down; break;
      case 'KeyS': input.back = down; break;
      case 'KeyA': input.left = down; break;
      case 'KeyD': input.right = down; break;
      case 'Space':
        input.jump = down;
        // Stop the page scrolling underneath the canvas.
        e.preventDefault();
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        // ADS lives on Shift because right-click is reserved for the web.
        input.ads = down;
        break;
      case 'KeyR': if (down) input.reloadPressed = true; break;
      case 'KeyQ': if (down) input.cyclePressed = true; break;
      case 'Digit1': if (down) input.slotPressed = 1; break;
      case 'Digit2': if (down) input.slotPressed = 2; break;
      case 'Digit3': if (down) input.slotPressed = 3; break;
      default: break;
    }
  };

  const onKeyDown = (e: KeyboardEvent) => onKey(e, true);
  const onKeyUp = (e: KeyboardEvent) => onKey(e, false);

  const onMouseDown = (e: MouseEvent) => {
    if (!input.pointerLocked) return;
    if (e.button === 0) {
      input.fireDown = true;
      input.firePressed = true;
    } else if (e.button === 2) {
      input.swingDown = true;
      input.swingPressed = true;
    }
  };

  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) input.fireDown = false;
    else if (e.button === 2) input.swingDown = false;
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!input.pointerLocked) return;
    // Browsers deliver one enormous movementX/Y right after pointer lock
    // engages — the jump from the old cursor position to the screen centre.
    // Taking it as look input snaps the view somewhere else entirely.
    if (performance.now() < settleUntil) return;
    input.mouseDX += clampDelta(e.movementX);
    input.mouseDY += clampDelta(e.movementY);
  };

  const onWheel = (e: WheelEvent) => {
    if (!input.pointerLocked) return;
    input.wheel += Math.sign(e.deltaY);
    e.preventDefault();
  };

  // Right-click is a game control, so the browser menu must never appear.
  const onContextMenu = (e: Event) => e.preventDefault();

  const onPointerLockChange = () => {
    input.pointerLocked = document.pointerLockElement === canvas;
    if (input.pointerLocked) {
      settleUntil = performance.now() + LOCK_SETTLE_MS;
      // Anything banked before the lock is stale and would be applied in one go.
      input.mouseDX = 0;
      input.mouseDY = 0;
    } else {
      releaseAll();
    }
  };

  const onCanvasClick = () => {
    if (!input.pointerLocked) canvas.requestPointerLock();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('blur', releaseAll);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('click', onCanvasClick);
  document.addEventListener('pointerlockchange', onPointerLockChange);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('blur', releaseAll);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('click', onCanvasClick);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
  };
}
