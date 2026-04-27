import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useCelebration } from './Celebration';
import DinoPet from './DinoPet';

// ══════════════════════════════════════════
//  EASTER EGGS — Konami Code, Party Mode, Dino Pet
// ══════════════════════════════════════════

// Konami code sequence: ↑↑↓↓←→←→BA
const KONAMI_CODE = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];

// Logo click count for dino
const LOGO_CLICKS_TO_DINO = 5;

interface EasterEggsProps {
  /** Whether it's the user's birthday today */
  isBirthday?: boolean;
  /** User's display name for birthday */
  userName?: string;
}

const EasterEggs: React.FC<EasterEggsProps> = ({ isBirthday, userName }) => {
  const [konamiIndex, setKonamiIndex] = useState(0);
  const [partyMode, setPartyMode] = useState(false);
  const [showDino, setShowDino] = useState(() => {
    return localStorage.getItem('vioo_dino_active') === 'true';
  });
  const [birthdayShown, setBirthdayShown] = useState(false);
  const partyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { celebrate, showToast } = useCelebration();

  // ── Konami Code Listener ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const expected = KONAMI_CODE[konamiIndex];
      if (e.key.toLowerCase() === expected.toLowerCase()) {
        const next = konamiIndex + 1;
        if (next === KONAMI_CODE.length) {
          // KONAMI CODE ACTIVATED! 🎉
          activatePartyMode();
          setKonamiIndex(0);
        } else {
          setKonamiIndex(next);
        }
      } else {
        setKonamiIndex(0);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [konamiIndex]);

  // ── Birthday Check ──
  useEffect(() => {
    if (isBirthday && !birthdayShown) {
      const alreadyShown = sessionStorage.getItem('vioo_birthday_shown');
      if (!alreadyShown) {
        // Delay to ensure UI is ready
        setTimeout(() => {
          celebrate({
            variant: 'milestone',
            title: `🎂 Chúc mừng sinh nhật ${userName || 'bạn'}!`,
            subtitle: 'Chúc bạn một ngày thật vui vẻ! 🎉🎈🎁',
            confetti: true,
            duration: 4000,
          });
          sessionStorage.setItem('vioo_birthday_shown', 'true');
          setBirthdayShown(true);
        }, 2000);
      }
    }
  }, [isBirthday, userName, birthdayShown]);

  // ── Party Mode ──
  const activatePartyMode = useCallback(() => {
    setPartyMode(true);
    // Also activate dino!
    setShowDino(true);
    localStorage.setItem('vioo_dino_active', 'true');

    celebrate({
      variant: 'streak',
      title: '🎮 Konami Code!',
      subtitle: 'Party Mode Activated! 🎉',
      confetti: true,
      duration: 3000,
    });

    showToast({
      type: 'info',
      title: '🦕 Dino đã xuất hiện!',
      message: 'Chú khủng long nhỏ đã đến chơi!',
      duration: 3000,
    });

    // Party mode lasts 15 seconds
    if (partyTimerRef.current) clearTimeout(partyTimerRef.current);
    partyTimerRef.current = setTimeout(() => setPartyMode(false), 15000);
  }, [celebrate, showToast]);

  // ── Logo Click Handler (exposed via global) ──
  useEffect(() => {
    let clickCount = 0;
    let resetTimer: ReturnType<typeof setTimeout>;

    const handleLogoClick = () => {
      clickCount++;
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { clickCount = 0; }, 3000);

      if (clickCount >= LOGO_CLICKS_TO_DINO) {
        clickCount = 0;
        const isActive = !showDino;
        setShowDino(isActive);
        localStorage.setItem('vioo_dino_active', String(isActive));
        if (isActive) {
          showToast({
            type: 'info',
            title: '🦕 Bạn đã tìm thấy bí mật!',
            message: 'Chú khủng long nhỏ xuất hiện rồi!',
            duration: 3000,
          });
        } else {
          showToast({
            type: 'info',
            title: '👋 Tạm biệt Dino!',
            message: 'Click logo 5 lần để gọi lại nhé',
            duration: 2000,
          });
        }
      }
    };

    // Expose for Sidebar logo
    (window as any).__viooLogoClick = handleLogoClick;
    return () => { delete (window as any).__viooLogoClick; clearTimeout(resetTimer); };
  }, [showDino, showToast]);

  const handleCloseDino = useCallback(() => {
    setShowDino(false);
    localStorage.setItem('vioo_dino_active', 'false');
  }, []);

  return (
    <>
      {/* Party Mode Rainbow Effect */}
      {partyMode && (
        <div className="fixed inset-0 z-[99] pointer-events-none"
          style={{ animation: 'partyRainbow 3s linear infinite' }}>
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-blue-500 to-purple-500"
            style={{ animation: 'partySlide 2s linear infinite' }} />
        </div>
      )}

      {/* Dino Pet */}
      <DinoPet visible={showDino} onClose={handleCloseDino} />

      <style>{`
        @keyframes partyRainbow {
          0% { opacity: 0.3; }
          50% { opacity: 0.8; }
          100% { opacity: 0.3; }
        }
        @keyframes partySlide {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
      `}</style>
    </>
  );
};

export default EasterEggs;
