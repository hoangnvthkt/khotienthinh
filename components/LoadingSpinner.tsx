import React, { useState, useEffect } from 'react';
import { getRandomLoadingMessage, LOADING_MESSAGES } from '../lib/funMessages';

const FUN_TIPS = [
  { icon: '🚀', text: 'Mẹo: Nhấn phím tắt Ctrl+K để tìm kiếm nhanh!' },
  { icon: '💡', text: 'Mẹo: Quét QR để tra cứu vật tư siêu tốc!' },
  { icon: '📊', text: 'Mẹo: Xuất báo cáo Excel chỉ với 1 click!' },
  { icon: '🔔', text: 'Mẹo: Bật thông báo để không bỏ lỡ phê duyệt!' },
  { icon: '📱', text: 'Mẹo: Thêm vào màn hình chính để dùng như app!' },
  { icon: '🌙', text: 'Mẹo: Chuyển Dark Mode để bảo vệ mắt ban đêm!' },
  { icon: '⚡', text: 'Bạn biết không? Hệ thống xử lý 1000+ phiếu/giây!' },
  { icon: '🎯', text: 'Bạn biết không? Dữ liệu được mã hóa AES-256!' },
  ...LOADING_MESSAGES.map(msg => ({ icon: msg.slice(msg.length - 2), text: msg })),
];

const LoadingSpinner: React.FC = () => {
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * FUN_TIPS.length));
  const [fadeIn, setFadeIn] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFadeIn(false);
      setTimeout(() => {
        setTipIndex(prev => (prev + 1) % FUN_TIPS.length);
        setFadeIn(true);
      }, 400);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  const tip = FUN_TIPS[tipIndex];

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-6">
        {/* Animated cube loader */}
        <div className="loading-cube-grid">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="loading-cube" style={{ animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>

        {/* Loading text */}
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-black text-slate-500 dark:text-slate-400 tracking-wide">Đang tải</span>
          <span className="loading-dots flex gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" style={{ animationDelay: '0s' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" style={{ animationDelay: '0.15s' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" style={{ animationDelay: '0.3s' }} />
          </span>
        </div>

        {/* Fun rotating tip */}
        <div
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 max-w-xs transition-all duration-400 ${fadeIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
        >
          <span className="text-lg shrink-0">{tip.icon}</span>
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-relaxed">{tip.text}</span>
        </div>
      </div>

      <style>{`
        .loading-cube-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 4px;
          width: 48px;
          height: 48px;
        }
        .loading-cube {
          width: 14px;
          height: 14px;
          border-radius: 3px;
          background: linear-gradient(135deg, #3b82f6, #6366f1);
          animation: cubeScale 1.2s ease-in-out infinite;
        }
        @keyframes cubeScale {
          0%, 70%, 100% { transform: scale(0.7); opacity: 0.3; }
          35% { transform: scale(1); opacity: 1; }
        }
        .loading-dots span {
          animation: dotBounce 1s ease-in-out infinite;
        }
        @keyframes dotBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
};

export default LoadingSpinner;
