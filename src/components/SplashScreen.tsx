import { useState, useEffect } from 'react';
import { ClaudeIcon } from './icons/ProviderIcons';

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<'reveal' | 'shimmer' | 'fadeout'>('reveal');

  useEffect(() => {
    // Skip on hot reload
    if (sessionStorage.getItem('splash-shown')) {
      onComplete();
      return;
    }

    const t1 = setTimeout(() => setPhase('shimmer'), 800);
    const t2 = setTimeout(() => setPhase('fadeout'), 1500);
    const t3 = setTimeout(() => {
      sessionStorage.setItem('splash-shown', '1');
      onComplete();
    }, 2000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onComplete]);

  return (
    <div className={`splash-screen splash-screen--${phase}`}>
      <div className="splash-content">
        <div className="splash-icon">
          <ClaudeIcon size={64} />
        </div>
        <div className="splash-title">Claude GUI</div>
        <div className="splash-subtitle">Multi-instance Claude Code IDE</div>
      </div>
      <div className="splash-shimmer" />
    </div>
  );
}
