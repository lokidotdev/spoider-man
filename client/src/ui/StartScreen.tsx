import { useGame } from '../net/store';
import { connect } from '../net/socket';
import { initAudio } from '../audio/sfx';
import spideyImage from '../assets/spidey.jpeg';

/**
 * The whole pre-game flow: title, one line of description, one button.
 * No login, no name entry — the server assigns a random name on join.
 */
export function StartScreen() {
  const phase = useGame((s) => s.phase);
  const errorMessage = useGame((s) => s.errorMessage);

  if (phase === 'playing') return null;

  const connecting = phase === 'connecting';

  const play = () => {
    // Must happen inside the click: browsers block audio until a user gesture.
    initAudio();
    connect();
  };

  return (
    <div className="screen start-screen">
      <div className="start-card">
        <img className="title-art" src={spideyImage} alt="" />
        <h1 className="title">
          Spoider<span className="title-accent"> Man</span>
        </h1>
        <p className="tagline">
          Swing between rooftops on real physics webs and fight up to four rivals for the
          highest score before the clock runs out.
        </p>

        {phase === 'error' && errorMessage && <p className="error">{errorMessage}</p>}

        <button className="play-button" onClick={play} disabled={connecting}>
          {connecting ? 'Joining…' : 'Play'}
        </button>

        <div className="controls-hint">
          <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Space</kbd> jump</div>
          <div><span className="mouse">Right&nbsp;Mouse</span> hold to swing · <span className="mouse">Scroll</span> reel in</div>
          <div><span className="mouse">Left&nbsp;Mouse</span> attack · <kbd>R</kbd> reload · <kbd>Shift</kbd> aim</div>
          <div><kbd>Q</kbd> cycle weapon · <kbd>1</kbd> gun <kbd>2</kbd> gloves <kbd>3</kbd> stones</div>
        </div>
      </div>
    </div>
  );
}
