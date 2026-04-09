import React, { useState } from 'react';
import { Flame, Award, Trophy, Star, ChevronRight, X } from 'lucide-react';
import { Badge, BADGE_DEFS, LEVELS, xpService } from '../lib/xpService';

// ══════════════════════════════════════════
//  STREAK BADGE — Gamification UI Components
// ══════════════════════════════════════════

interface StreakBadgeProps {
  streakDays: number;
  compact?: boolean;
  onClick?: () => void;
}

export const StreakBadge: React.FC<StreakBadgeProps> = ({ streakDays, compact = false, onClick }) => {
  if (streakDays <= 0) return null;

  const tier = streakDays >= 60 ? 'gold' : streakDays >= 20 ? 'silver' : streakDays >= 5 ? 'bronze' : 'normal';
  const colors = {
    gold: 'from-amber-400 to-yellow-500 shadow-amber-500/30 text-amber-900',
    silver: 'from-slate-300 to-slate-400 shadow-slate-400/30 text-slate-700',
    bronze: 'from-orange-400 to-amber-500 shadow-orange-500/30 text-orange-900',
    normal: 'from-slate-200 to-slate-300 shadow-slate-300/20 text-slate-600',
  };

  if (compact) {
    return (
      <button onClick={onClick}
        className={`flex items-center gap-1 px-2 py-1 rounded-lg bg-gradient-to-r ${colors[tier]} text-[10px] font-black shadow-md transition hover:scale-105`}>
        <Flame size={12} className="animate-pulse" />
        {streakDays}
      </button>
    );
  }

  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r ${colors[tier]} text-xs font-black shadow-lg transition hover:scale-105`}>
      <Flame size={14} className={streakDays >= 5 ? 'animate-pulse' : ''} />
      <span>🔥 {streakDays} ngày liên tiếp</span>
      {tier !== 'normal' && (
        <span className="bg-white/30 backdrop-blur-sm px-1.5 py-0.5 rounded text-[9px] uppercase font-black">
          {tier}
        </span>
      )}
    </button>
  );
};

// ═════════ Badge Gallery ═════════

interface BadgeGalleryProps {
  badges: Badge[];
  showAll?: boolean;
}

export const BadgeGallery: React.FC<BadgeGalleryProps> = ({ badges, showAll = false }) => {
  const [expanded, setExpanded] = useState(false);
  
  const allBadges = Object.entries(BADGE_DEFS);
  const earnedIds = new Set(badges.map(b => b.id));

  if (!showAll && badges.length === 0) return null;

  const displayBadges = showAll ? allBadges : allBadges.filter(([id]) => earnedIds.has(id));
  const visibleBadges = expanded ? displayBadges : displayBadges.slice(0, 6);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {visibleBadges.map(([id, def]) => {
          const earned = earnedIds.has(id);
          const badge = badges.find(b => b.id === id);
          return (
            <div key={id}
              className={`group relative flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all ${
                earned
                  ? 'border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 hover:shadow-lg hover:-translate-y-0.5'
                  : 'border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 opacity-40'
              }`}
              title={`${def.name}: ${def.description}${badge ? '\nĐạt: ' + new Date(badge.earnedAt).toLocaleDateString('vi-VN') : ''}`}
            >
              <span className="text-xl">{def.icon}</span>
              <span className={`text-[9px] font-bold ${earned ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`}>
                {def.name}
              </span>
              {earned && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                  <Star size={8} className="text-white" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {displayBadges.length > 6 && (
        <button onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs text-indigo-500 font-bold flex items-center gap-1 hover:underline">
          {expanded ? 'Thu gọn' : `Xem thêm ${displayBadges.length - 6} huy hiệu`}
          <ChevronRight size={12} className={expanded ? 'rotate-90' : ''} />
        </button>
      )}
    </div>
  );
};

// ═════════ Level Progress Card ═════════

interface LevelProgressProps {
  totalXp: number;
  level: number;
  streakDays: number;
  badges: Badge[];
}

export const LevelProgressCard: React.FC<LevelProgressProps> = ({ totalXp, level, streakDays, badges }) => {
  const levelInfo = xpService.getLevelInfo(level);
  const nextLevel = xpService.getNextLevel(level);
  const progress = xpService.getProgress(totalXp, level);

  return (
    <div className="glass-card rounded-2xl p-5 space-y-4">
      {/* Level Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-2xl shadow-lg shadow-indigo-500/30">
            {levelInfo?.icon || '🌱'}
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-800 dark:text-white">
              Level {level} — {levelInfo?.title}
            </h3>
            <p className="text-xs text-slate-400 font-bold">{totalXp.toLocaleString()} XP tổng</p>
          </div>
        </div>
        <StreakBadge streakDays={streakDays} />
      </div>

      {/* XP Progress Bar */}
      {nextLevel && (
        <div>
          <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
            <span>Lv.{level}</span>
            <span>{progress}%</span>
            <span>Lv.{nextLevel.level}</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 transition-all duration-700 animate-progress"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-1 text-center">
            Còn {(nextLevel.minXp - totalXp).toLocaleString()} XP để lên {nextLevel.icon} {nextLevel.title}
          </p>
        </div>
      )}

      {/* Badges */}
      {badges.length > 0 && (
        <div>
          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
            🏅 Huy hiệu ({badges.length}/{Object.keys(BADGE_DEFS).length})
          </h4>
          <BadgeGallery badges={badges} showAll />
        </div>
      )}

      {/* Next Milestones */}
      <div>
        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">🎯 Mục tiêu tiếp theo</h4>
        <div className="space-y-1.5">
          {Object.entries(BADGE_DEFS)
            .filter(([id]) => !badges.some(b => b.id === id))
            .slice(0, 3)
            .map(([id, def]) => (
              <div key={id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/30 text-xs">
                <span className="text-lg">{def.icon}</span>
                <div className="flex-1">
                  <span className="font-bold text-slate-600 dark:text-slate-300">{def.name}</span>
                  <span className="text-slate-400 ml-1">— {def.description}</span>
                </div>
                <Award size={14} className="text-slate-300" />
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default StreakBadge;
