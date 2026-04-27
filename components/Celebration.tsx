import React, { useEffect, useState, useRef, useCallback, createContext, useContext } from 'react';
import { CheckCircle2, XCircle, Sparkles, Zap, PartyPopper, Trophy, Flame } from 'lucide-react';

// ══════════════════════════════════════════════
//  CELEBRATION & MICRO-INTERACTION SYSTEM
// ══════════════════════════════════════════════

// ── Types ──
type CelebrationVariant = 'success' | 'error' | 'approve' | 'reject' | 'checkin' | 'streak' | 'milestone';

interface CelebrationConfig {
  variant: CelebrationVariant;
  title: string;
  subtitle?: string;
  duration?: number; // ms
  confetti?: boolean;
  sound?: boolean;
}

interface ToastConfig {
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface CelebrationContextType {
  celebrate: (config: CelebrationConfig) => void;
  showToast: (config: ToastConfig) => void;
}

const CelebrationContext = createContext<CelebrationContextType | undefined>(undefined);

export const useCelebration = () => {
  const ctx = useContext(CelebrationContext);
  if (!ctx) throw new Error('useCelebration must be used within CelebrationProvider');
  return ctx;
};

// ── Confetti Particle ──
interface Particle {
  x: number; y: number; r: number;
  vx: number; vy: number;
  color: string; rotation: number;
  rotationDelta: number;
  opacity: number;
  width: number; height: number;
  shape: 'rect' | 'circle';
}

const CONFETTI_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F8C471', '#82E0AA',
];

// ── Celebration Overlay Component ──
const CelebrationOverlay: React.FC<{ config: CelebrationConfig | null; onDone: () => void }> = ({ config, onDone }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!config) return;
    setVisible(true);
    setExiting(false);

    // Launch confetti if enabled
    if (config.confetti !== false) {
      launchConfetti();
    }

    const duration = config.duration || 2200;
    const exitTimer = setTimeout(() => setExiting(true), duration - 400);
    const doneTimer = setTimeout(() => {
      setVisible(false);
      setExiting(false);
      onDone();
    }, duration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(doneTimer);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [config]);

  const launchConfetti = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Create particles
    const particles: Particle[] = [];
    for (let i = 0; i < 80; i++) {
      particles.push({
        x: canvas.width * 0.5 + (Math.random() - 0.5) * 200,
        y: canvas.height * 0.45,
        r: Math.random() * 4 + 2,
        vx: (Math.random() - 0.5) * 16,
        vy: -(Math.random() * 14 + 6),
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        rotation: Math.random() * 360,
        rotationDelta: (Math.random() - 0.5) * 12,
        opacity: 1,
        width: Math.random() * 8 + 4,
        height: Math.random() * 6 + 3,
        shape: Math.random() > 0.5 ? 'rect' : 'circle',
      });
    }
    particlesRef.current = particles;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of particlesRef.current) {
        p.vy += 0.35; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationDelta;
        p.opacity -= 0.006;
        p.vx *= 0.99;

        if (p.opacity <= 0) continue;
        alive = true;

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') {
          ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if (alive) animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
  };

  if (!config || !visible) return null;

  const VARIANT_MAP: Record<CelebrationVariant, {
    icon: React.ReactNode; bg: string; glow: string; emoji?: string;
  }> = {
    success: {
      icon: <CheckCircle2 size={40} />,
      bg: 'from-emerald-500 to-green-600',
      glow: 'shadow-emerald-500/50',
    },
    error: {
      icon: <XCircle size={40} />,
      bg: 'from-red-500 to-rose-600',
      glow: 'shadow-red-500/50',
    },
    approve: {
      icon: <CheckCircle2 size={40} />,
      bg: 'from-emerald-500 to-teal-600',
      glow: 'shadow-emerald-500/50',
      emoji: '✅',
    },
    reject: {
      icon: <XCircle size={40} />,
      bg: 'from-red-500 to-rose-600',
      glow: 'shadow-red-500/50',
    },
    checkin: {
      icon: <Zap size={40} />,
      bg: 'from-amber-500 to-orange-600',
      glow: 'shadow-amber-500/50',
      emoji: '📍',
    },
    streak: {
      icon: <Flame size={40} />,
      bg: 'from-orange-500 to-red-600',
      glow: 'shadow-orange-500/50',
      emoji: '🔥',
    },
    milestone: {
      icon: <Trophy size={40} />,
      bg: 'from-yellow-500 to-amber-600',
      glow: 'shadow-yellow-500/50',
      emoji: '🏆',
    },
  };

  const v = VARIANT_MAP[config.variant] || VARIANT_MAP.success;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
      {/* Confetti Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* Central Badge */}
      <div className={`relative flex flex-col items-center transition-all duration-300 ${exiting ? 'scale-75 opacity-0' : 'scale-100 opacity-100'}`}
        style={{ animation: !exiting ? 'celebrationPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined }}>
        {/* Glow ring */}
        <div className={`absolute -inset-6 rounded-full bg-gradient-to-r ${v.bg} opacity-20 blur-2xl animate-pulse`} />
        {/* Icon */}
        <div className={`relative w-20 h-20 rounded-3xl bg-gradient-to-br ${v.bg} flex items-center justify-center text-white shadow-2xl ${v.glow}`}
          style={{ animation: 'celebrationBounce 0.5s ease-out' }}>
          {v.icon}
        </div>
        {/* Text */}
        <h2 className="mt-4 text-xl font-black text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)] text-center"
          style={{ animation: 'celebrationSlideUp 0.4s ease-out 0.15s both' }}>
          {config.title}
        </h2>
        {config.subtitle && (
          <p className="mt-1 text-sm font-bold text-white/80 drop-shadow-[0_1px_8px_rgba(0,0,0,0.4)] text-center"
            style={{ animation: 'celebrationSlideUp 0.4s ease-out 0.25s both' }}>
            {config.subtitle}
          </p>
        )}
      </div>

      <style>{`
        @keyframes celebrationPop {
          0% { transform: scale(0) rotate(-12deg); opacity: 0; }
          60% { transform: scale(1.15) rotate(3deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes celebrationBounce {
          0% { transform: scale(0); }
          50% { transform: scale(1.3); }
          70% { transform: scale(0.9); }
          100% { transform: scale(1); }
        }
        @keyframes celebrationSlideUp {
          from { transform: translateY(12px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

// ── Animated Toast Component ──
const AnimatedToast: React.FC<{ config: ToastConfig; onDismiss: () => void }> = ({ config, onDismiss }) => {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const duration = config.duration || 3500;
    const exitTimer = setTimeout(() => setExiting(true), duration - 300);
    const doneTimer = setTimeout(onDismiss, duration);
    return () => { clearTimeout(exitTimer); clearTimeout(doneTimer); };
  }, [config, onDismiss]);

  const TYPE_STYLES: Record<string, { icon: React.ReactNode; border: string; bg: string; text: string; progress: string }> = {
    success: {
      icon: <CheckCircle2 size={18} />,
      border: 'border-emerald-400/40',
      bg: 'bg-emerald-50 dark:bg-emerald-950/50',
      text: 'text-emerald-600 dark:text-emerald-400',
      progress: 'bg-emerald-500',
    },
    error: {
      icon: <XCircle size={18} />,
      border: 'border-red-400/40',
      bg: 'bg-red-50 dark:bg-red-950/50',
      text: 'text-red-600 dark:text-red-400',
      progress: 'bg-red-500',
    },
    warning: {
      icon: <Sparkles size={18} />,
      border: 'border-amber-400/40',
      bg: 'bg-amber-50 dark:bg-amber-950/50',
      text: 'text-amber-600 dark:text-amber-400',
      progress: 'bg-amber-500',
    },
    info: {
      icon: <Zap size={18} />,
      border: 'border-blue-400/40',
      bg: 'bg-blue-50 dark:bg-blue-950/50',
      text: 'text-blue-600 dark:text-blue-400',
      progress: 'bg-blue-500',
    },
  };

  const st = TYPE_STYLES[config.type] || TYPE_STYLES.info;
  const dur = config.duration || 3500;

  return (
    <div className={`relative w-80 overflow-hidden rounded-2xl border ${st.border} ${st.bg} shadow-2xl backdrop-blur-xl transition-all duration-300 ${exiting ? 'translate-x-[120%] opacity-0' : 'translate-x-0 opacity-100'}`}
      style={{ animation: !exiting ? 'toastSlideIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined }}
      onClick={onDismiss}>
      <div className="flex items-start gap-3 p-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${st.text} bg-white dark:bg-slate-800 shadow-sm shrink-0`}
          style={{ animation: 'toastIconPop 0.3s ease-out 0.15s both' }}>
          {st.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 dark:text-white">{config.title}</p>
          {config.message && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{config.message}</p>}
          {config.action && (
            <button onClick={(e) => { e.stopPropagation(); config.action!.onClick(); onDismiss(); }}
              className={`mt-2 text-xs font-bold ${st.text} hover:underline`}>
              {config.action.label} →
            </button>
          )}
        </div>
      </div>
      {/* Progress bar */}
      <div className="h-0.5 w-full bg-slate-200/50 dark:bg-slate-700/50">
        <div className={`h-full ${st.progress} rounded-full`}
          style={{ animation: `toastProgress ${dur}ms linear forwards` }} />
      </div>

      <style>{`
        @keyframes toastSlideIn {
          from { transform: translateX(120%) scale(0.8); opacity: 0; }
          to { transform: translateX(0) scale(1); opacity: 1; }
        }
        @keyframes toastIconPop {
          from { transform: scale(0) rotate(-45deg); }
          to { transform: scale(1) rotate(0deg); }
        }
        @keyframes toastProgress {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
};

// ── Toast Stack Container ──
const ToastContainer: React.FC<{ toasts: (ToastConfig & { id: string })[]; onRemove: (id: string) => void }> = ({ toasts, onRemove }) => {
  return (
    <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-3">
      {toasts.map((t) => (
        <AnimatedToast key={t.id} config={t} onDismiss={() => onRemove(t.id)} />
      ))}
    </div>
  );
};

// ── Provider ──
export const CelebrationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [celebrationConfig, setCelebrationConfig] = useState<CelebrationConfig | null>(null);
  const [toasts, setToasts] = useState<(ToastConfig & { id: string })[]>([]);
  const idCounter = useRef(0);

  const celebrate = useCallback((config: CelebrationConfig) => {
    setCelebrationConfig(config);
  }, []);

  const showToast = useCallback((config: ToastConfig) => {
    const id = `toast-${Date.now()}-${idCounter.current++}`;
    setToasts(prev => [...prev.slice(-4), { ...config, id }]); // max 5 toasts
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <CelebrationContext.Provider value={{ celebrate, showToast }}>
      {children}
      <CelebrationOverlay config={celebrationConfig} onDone={() => setCelebrationConfig(null)} />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </CelebrationContext.Provider>
  );
};

export default CelebrationProvider;
