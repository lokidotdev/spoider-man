import { useEffect, useState } from 'react';
import { Scene } from './game/Scene';
import { HUD } from './ui/HUD';
import { StartScreen } from './ui/StartScreen';
import { MobileBlock, isMobileDevice } from './ui/MobileBlock';
import { useGame } from './net/store';

export default function App() {
  const phase = useGame((s) => s.phase);
  const [mobile, setMobile] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setMobile(isMobileDevice());
    setChecked(true);
  }, []);

  if (!checked) return null;
  // Desktop-only: the 3D scene is never mounted on a touch device.
  if (mobile) return <MobileBlock />;

  return (
    <>
      {phase === 'playing' && <Scene />}
      <StartScreen />
      <HUD />
    </>
  );
}
