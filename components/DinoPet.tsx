import React, { useState, useEffect, useRef, useCallback } from 'react';

// ══════════════════════════════════════════
//  DINO PET 🦕 — Animated pixel dinosaur
//  Walks around the screen corner, has idle/walk/jump animations
// ══════════════════════════════════════════

type DinoState = 'idle' | 'walk-left' | 'walk-right' | 'jump' | 'sit' | 'sleep' | 'eat' | 'wave';

interface DinoProps {
  visible: boolean;
  onClose?: () => void;
}

// Pixel art frames as SVG paths
const DINO_FRAMES: Record<string, string[]> = {
  idle: [
    // Frame 1: standing
    `<svg viewBox="0 0 32 32" fill="none"><rect x="12" y="2" width="10" height="8" rx="2" fill="#22c55e"/><rect x="18" y="4" width="2" height="2" fill="#111"/><rect x="14" y="8" width="3" height="2" fill="#ef4444"/><rect x="10" y="10" width="12" height="10" rx="2" fill="#22c55e"/><rect x="8" y="14" width="4" height="4" rx="1" fill="#22c55e"/><rect x="20" y="18" width="4" height="2" fill="#16a34a"/><rect x="22" y="20" width="2" height="4" fill="#16a34a"/><rect x="12" y="20" width="3" height="6" fill="#22c55e"/><rect x="17" y="20" width="3" height="6" fill="#22c55e"/><rect x="12" y="26" width="4" height="2" rx="1" fill="#15803d"/><rect x="17" y="26" width="4" height="2" rx="1" fill="#15803d"/></svg>`,
    // Frame 2: blink
    `<svg viewBox="0 0 32 32" fill="none"><rect x="12" y="2" width="10" height="8" rx="2" fill="#22c55e"/><rect x="18" y="5" width="2" height="1" fill="#111"/><rect x="14" y="8" width="3" height="2" fill="#ef4444"/><rect x="10" y="10" width="12" height="10" rx="2" fill="#22c55e"/><rect x="8" y="14" width="4" height="4" rx="1" fill="#22c55e"/><rect x="20" y="18" width="4" height="2" fill="#16a34a"/><rect x="22" y="20" width="2" height="4" fill="#16a34a"/><rect x="12" y="20" width="3" height="6" fill="#22c55e"/><rect x="17" y="20" width="3" height="6" fill="#22c55e"/><rect x="12" y="26" width="4" height="2" rx="1" fill="#15803d"/><rect x="17" y="26" width="4" height="2" rx="1" fill="#15803d"/></svg>`,
  ],
  walk: [
    // Frame 1: left leg forward
    `<svg viewBox="0 0 32 32" fill="none"><rect x="12" y="2" width="10" height="8" rx="2" fill="#22c55e"/><rect x="18" y="4" width="2" height="2" fill="#111"/><rect x="14" y="8" width="3" height="2" fill="#ef4444"/><rect x="10" y="10" width="12" height="10" rx="2" fill="#22c55e"/><rect x="8" y="14" width="4" height="4" rx="1" fill="#22c55e"/><rect x="20" y="18" width="4" height="2" fill="#16a34a"/><rect x="22" y="20" width="2" height="4" fill="#16a34a"/><rect x="10" y="20" width="3" height="6" fill="#22c55e"/><rect x="18" y="20" width="3" height="6" fill="#22c55e"/><rect x="10" y="26" width="4" height="2" rx="1" fill="#15803d"/><rect x="18" y="26" width="4" height="2" rx="1" fill="#15803d"/></svg>`,
    // Frame 2: right leg forward
    `<svg viewBox="0 0 32 32" fill="none"><rect x="12" y="2" width="10" height="8" rx="2" fill="#22c55e"/><rect x="18" y="4" width="2" height="2" fill="#111"/><rect x="14" y="8" width="3" height="2" fill="#ef4444"/><rect x="10" y="10" width="12" height="10" rx="2" fill="#22c55e"/><rect x="8" y="14" width="4" height="4" rx="1" fill="#22c55e"/><rect x="20" y="18" width="4" height="2" fill="#16a34a"/><rect x="22" y="20" width="2" height="4" fill="#16a34a"/><rect x="14" y="20" width="3" height="6" fill="#22c55e"/><rect x="16" y="20" width="3" height="6" fill="#22c55e"/><rect x="13" y="26" width="4" height="2" rx="1" fill="#15803d"/><rect x="16" y="26" width="4" height="2" rx="1" fill="#15803d"/></svg>`,
  ],
  jump: [
    `<svg viewBox="0 0 32 32" fill="none"><rect x="12" y="0" width="10" height="8" rx="2" fill="#22c55e"/><rect x="18" y="2" width="2" height="2" fill="#111"/><rect x="14" y="6" width="3" height="2" fill="#ef4444"/><rect x="10" y="8" width="12" height="10" rx="2" fill="#22c55e"/><rect x="8" y="12" width="4" height="4" rx="1" fill="#22c55e"/><rect x="20" y="16" width="4" height="2" fill="#16a34a"/><rect x="22" y="18" width="2" height="3" fill="#16a34a"/><rect x="10" y="18" width="3" height="5" fill="#22c55e"/><rect x="19" y="18" width="3" height="5" fill="#22c55e"/><rect x="10" y="23" width="4" height="2" rx="1" fill="#15803d"/><rect x="19" y="23" width="4" height="2" rx="1" fill="#15803d"/></svg>`,
  ],
  wave: [
    `<svg viewBox="0 0 32 32" fill="none"><rect x="12" y="2" width="10" height="8" rx="2" fill="#22c55e"/><rect x="18" y="4" width="2" height="2" fill="#111"/><rect x="14" y="8" width="3" height="2" fill="#ef4444"/><rect x="10" y="10" width="12" height="10" rx="2" fill="#22c55e"/><rect x="6" y="8" width="4" height="4" rx="1" fill="#22c55e"/><rect x="20" y="18" width="4" height="2" fill="#16a34a"/><rect x="22" y="20" width="2" height="4" fill="#16a34a"/><rect x="12" y="20" width="3" height="6" fill="#22c55e"/><rect x="17" y="20" width="3" height="6" fill="#22c55e"/><rect x="12" y="26" width="4" height="2" rx="1" fill="#15803d"/><rect x="17" y="26" width="4" height="2" rx="1" fill="#15803d"/></svg>`,
    `<svg viewBox="0 0 32 32" fill="none"><rect x="12" y="2" width="10" height="8" rx="2" fill="#22c55e"/><rect x="18" y="4" width="2" height="2" fill="#111"/><rect x="14" y="8" width="3" height="2" fill="#ef4444"/><rect x="10" y="10" width="12" height="10" rx="2" fill="#22c55e"/><rect x="6" y="6" width="4" height="4" rx="1" fill="#22c55e"/><rect x="20" y="18" width="4" height="2" fill="#16a34a"/><rect x="22" y="20" width="2" height="4" fill="#16a34a"/><rect x="12" y="20" width="3" height="6" fill="#22c55e"/><rect x="17" y="20" width="3" height="6" fill="#22c55e"/><rect x="12" y="26" width="4" height="2" rx="1" fill="#15803d"/><rect x="17" y="26" width="4" height="2" rx="1" fill="#15803d"/></svg>`,
  ],
};

// Speech bubbles
const DINO_SPEECHES = [
  'Chăm chỉ quá! 💪',
  'Rawr! 🦖',
  'Cố lên nào! 🔥',
  'Bạn tuyệt lắm! ⭐',
  'Đói quá! 🍖',
  '...zzZ 😴',
  'Vioo! 🎉',
  'Level up! 🚀',
  'Yay! 🎊',
  '♪♪♪ 🎵',
];

const DinoPet: React.FC<DinoProps> = ({ visible, onClose }) => {
  const [x, setX] = useState(100);
  const [y, setY] = useState(0);
  const [state, setState] = useState<DinoState>('idle');
  const [frame, setFrame] = useState(0);
  const [facingLeft, setFacingLeft] = useState(false);
  const [speech, setSpeech] = useState<string | null>(null);
  const [showSpeech, setShowSpeech] = useState(false);
  const [isJumping, setIsJumping] = useState(false);
  const animRef = useRef<ReturnType<typeof setInterval>>();
  const stateRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Frame animation
  useEffect(() => {
    if (!visible) return;
    animRef.current = setInterval(() => {
      setFrame(f => f + 1);
    }, 250);
    return () => clearInterval(animRef.current);
  }, [visible]);

  // AI behavior — randomly change state
  useEffect(() => {
    if (!visible) return;

    const decideNextAction = () => {
      const actions: DinoState[] = ['idle', 'idle', 'walk-left', 'walk-right', 'jump', 'sit', 'wave', 'idle'];
      const next = actions[Math.floor(Math.random() * actions.length)];
      setState(next);

      // Random speech
      if (Math.random() < 0.25) {
        const msg = DINO_SPEECHES[Math.floor(Math.random() * DINO_SPEECHES.length)];
        setSpeech(msg);
        setShowSpeech(true);
        setTimeout(() => setShowSpeech(false), 2500);
      }

      // Schedule next action
      const delay = 2000 + Math.random() * 4000;
      stateRef.current = setTimeout(decideNextAction, delay);
    };

    stateRef.current = setTimeout(decideNextAction, 1000);
    return () => clearTimeout(stateRef.current);
  }, [visible]);

  // Movement logic
  useEffect(() => {
    if (!visible) return;
    if (state === 'walk-left' || state === 'walk-right') {
      const dir = state === 'walk-left' ? -1 : 1;
      setFacingLeft(dir < 0);
      const moveInterval = setInterval(() => {
        setX(prev => {
          const next = prev + dir * 2;
          // Bounce off edges (within bottom area)
          const maxX = (typeof window !== 'undefined' ? window.innerWidth : 1200) - 80;
          if (next < 20 || next > maxX) {
            setState('idle');
            return prev;
          }
          return next;
        });
      }, 50);
      return () => clearInterval(moveInterval);
    }
    if (state === 'jump') {
      setIsJumping(true);
      setTimeout(() => setIsJumping(false), 600);
    }
  }, [state, visible]);

  // Click handler
  const handleClick = useCallback(() => {
    setState('wave');
    const msg = DINO_SPEECHES[Math.floor(Math.random() * DINO_SPEECHES.length)];
    setSpeech(msg);
    setShowSpeech(true);
    setTimeout(() => setShowSpeech(false), 2500);
    setTimeout(() => setState('idle'), 1500);
  }, []);

  if (!visible) return null;

  const currentFrames = state === 'walk-left' || state === 'walk-right' 
    ? DINO_FRAMES.walk 
    : state === 'jump' 
    ? DINO_FRAMES.jump
    : state === 'wave'
    ? DINO_FRAMES.wave
    : DINO_FRAMES.idle;
  
  const currentFrame = currentFrames[frame % currentFrames.length];

  return (
    <div
      ref={containerRef}
      className="fixed z-[997] cursor-pointer select-none"
      style={{
        bottom: isJumping ? 40 : 8,
        left: x,
        transition: isJumping ? 'bottom 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'bottom 0.3s ease-out',
      }}
      onClick={handleClick}
    >
      {/* Speech bubble */}
      {showSpeech && speech && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-1 rounded-xl bg-white dark:bg-slate-700 shadow-lg border border-slate-200 dark:border-slate-600 text-[10px] font-bold text-slate-700 dark:text-slate-200"
          style={{ animation: 'dinoBubble 0.3s ease-out' }}>
          {speech}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white dark:bg-slate-700 border-r border-b border-slate-200 dark:border-slate-600 rotate-45" />
        </div>
      )}

      {/* Dino SVG */}
      <div
        className="w-10 h-10"
        style={{ transform: facingLeft ? 'scaleX(-1)' : 'scaleX(1)' }}
        dangerouslySetInnerHTML={{ __html: currentFrame }}
      />

      {/* Close button */}
      {onClose && (
        <button
          onClick={e => { e.stopPropagation(); onClose(); }}
          className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-400 text-white text-[8px] font-bold flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity shadow"
        >
          ×
        </button>
      )}

      {/* Shadow */}
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-1.5 rounded-full bg-black/10 dark:bg-white/5"
        style={{ transform: `scaleX(${isJumping ? 0.5 : 1})`, transition: 'transform 0.3s ease' }}
      />

      <style>{`
        @keyframes dinoBubble {
          from { transform: translateX(-50%) scale(0.5) translateY(8px); opacity: 0; }
          to { transform: translateX(-50%) scale(1) translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default DinoPet;
