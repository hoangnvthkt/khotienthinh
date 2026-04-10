import React, { useState, useEffect, useRef } from 'react';

// ══════════════════════════════════════════════════
//  ANIMATED NUMBER — Smooth counting transitions
// ══════════════════════════════════════════════════

interface AnimatedNumberProps {
  value: number;
  duration?: number; // ms
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}

export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  duration = 600,
  prefix = '',
  suffix = '',
  decimals = 0,
  className = '',
}) => {
  const [display, setDisplay] = useState(value);
  const prevValue = useRef(value);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const from = prevValue.current;
    const to = value;
    prevValue.current = value;

    if (from === to) return;

    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);

      if (progress < 1) {
        animRef.current = requestAnimationFrame(animate);
      }
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [value, duration]);

  const formatted = decimals > 0
    ? display.toFixed(decimals)
    : Math.round(display).toLocaleString('vi-VN');

  return (
    <span className={className}>
      {prefix}{formatted}{suffix}
    </span>
  );
};

// ══════════════════════════════════════════════════
//  SPARKLINE — 7-day trend mini chart
// ══════════════════════════════════════════════════

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  width = 80,
  height = 24,
  color = '#6366f1',
  fillOpacity = 0.15,
}) => {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * innerW;
    const y = padding + innerH - ((v - min) / range) * innerH;
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  const fillPath = `${linePath} L ${padding + innerW},${padding + innerH} L ${padding},${padding + innerH} Z`;

  // Trend: last value vs first
  const isUp = data[data.length - 1] >= data[0];

  return (
    <svg width={width} height={height} className="shrink-0" viewBox={`0 0 ${width} ${height}`}>
      <path d={fillPath} fill={color} opacity={fillOpacity} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* Last dot */}
      <circle
        cx={padding + innerW}
        cy={padding + innerH - ((data[data.length - 1] - min) / range) * innerH}
        r={2}
        fill={color}
      />
    </svg>
  );
};

// ══════════════════════════════════════════════════
//  LAST UPDATED BADGE
// ══════════════════════════════════════════════════

interface LastUpdatedProps {
  timestamp: number;
  className?: string;
}

export const LastUpdated: React.FC<LastUpdatedProps> = ({ timestamp, className = '' }) => {
  const [text, setText] = useState('');

  useEffect(() => {
    const update = () => {
      if (!timestamp) { setText(''); return; }
      const diff = Math.floor((Date.now() - timestamp) / 1000);
      if (diff < 3) setText('vừa cập nhật');
      else if (diff < 60) setText(`${diff}s trước`);
      else if (diff < 3600) setText(`${Math.floor(diff / 60)}m trước`);
      else setText(`${Math.floor(diff / 3600)}h trước`);
    };
    update();
    const interval = setInterval(update, 3000);
    return () => clearInterval(interval);
  }, [timestamp]);

  if (!text) return null;

  return (
    <span className={`text-[9px] text-slate-400 font-medium flex items-center gap-1 ${className}`}>
      <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
      Live · {text}
    </span>
  );
};
