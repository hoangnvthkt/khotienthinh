import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { xpService, UserXP, XPEvent, LEVELS, BADGE_DEFS } from '../lib/xpService';
import {
  Zap, Star, Trophy, Flame, Crown, Award, TrendingUp,
  ChevronRight, ChevronDown, Gift, Target, Medal
} from 'lucide-react';

// ══════════════════════════════════════════
//  XP PROGRESS BAR — Compact for sidebar
// ══════════════════════════════════════════

export const XPProgressBar: React.FC<{ userId: string }> = ({ userId }) => {
  const [profile, setProfile] = useState<UserXP | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [recentEvents, setRecentEvents] = useState<XPEvent[]>([]);

  useEffect(() => {
    xpService.getProfile(userId).then(setProfile).catch(() => {});
    xpService.getRecentEvents(userId, 5).then(setRecentEvents).catch(() => {});
  }, [userId]);

  if (!profile) return null;

  const levelInfo = xpService.getLevelInfo(profile.level);
  const nextLevel = xpService.getNextLevel(profile.level);
  const progress = xpService.getProgress(profile.totalXp, profile.level);

  return (
    <div className="mx-2 mb-2">
      {/* Compact bar */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 p-2 rounded-xl bg-gradient-to-r from-indigo-500/10 to-violet-500/10 hover:from-indigo-500/20 hover:to-violet-500/20 transition-all group"
      >
        <span className="text-sm">{levelInfo?.icon || '🌱'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
              Lv.{profile.level} • {profile.totalXp} XP
            </span>
            <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </div>
          <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full mt-1 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </button>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="mt-1 p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-lg animate-in slide-in-from-top-2">
          {/* Level info */}
          <div className="flex items-center gap-3 mb-3">
            <div className="text-3xl">{levelInfo?.icon}</div>
            <div>
              <div className="text-xs font-black text-slate-700 dark:text-white">{levelInfo?.title}</div>
              <div className="text-[10px] text-slate-400">
                {nextLevel ? `${nextLevel.minXp - profile.totalXp} XP để lên Level ${nextLevel.level}` : 'Max Level!'}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="text-center p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
              <div className="text-sm font-black text-indigo-600 dark:text-indigo-400">{profile.totalXp}</div>
              <div className="text-[8px] text-slate-400 uppercase font-bold">Tổng XP</div>
            </div>
            <div className="text-center p-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/20">
              <div className="text-sm font-black text-orange-600 dark:text-orange-400 flex items-center justify-center gap-0.5">
                {profile.streakDays}<Flame className="w-3 h-3" />
              </div>
              <div className="text-[8px] text-slate-400 uppercase font-bold">Streak</div>
            </div>
            <div className="text-center p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20">
              <div className="text-sm font-black text-amber-600 dark:text-amber-400">{(profile.badges || []).length}</div>
              <div className="text-[8px] text-slate-400 uppercase font-bold">Huy hiệu</div>
            </div>
          </div>

          {/* Badges */}
          {(profile.badges || []).length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Huy hiệu</div>
              <div className="flex flex-wrap gap-1">
                {(profile.badges || []).map((badge, i) => (
                  <span key={i} className="text-lg cursor-default" title={`${badge.name}: ${badge.description}`}>
                    {badge.icon}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recent XP */}
          {recentEvents.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Gần đây</div>
              <div className="space-y-1">
                {recentEvents.map((evt, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="text-slate-500 dark:text-slate-400 truncate">{evt.description}</span>
                    <span className="text-green-500 font-bold whitespace-nowrap ml-2">+{evt.xpAmount} XP</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════
//  XP TOAST — Shows when XP is awarded
// ══════════════════════════════════════════

export const XPToast: React.FC<{
  xpGained: number;
  description: string;
  levelUp?: boolean;
  newLevel?: number;
  onDone: () => void;
}> = ({ xpGained, description, levelUp, newLevel, onDone }) => {
  useEffect(() => {
    const timer = setTimeout(onDone, 3000);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="fixed top-4 right-4 z-[9999] animate-in slide-in-from-right-5 fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-indigo-200 dark:border-indigo-700 p-3 min-w-[200px]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-xs font-black text-green-500">+{xpGained} XP</div>
            <div className="text-[10px] text-slate-500">{description}</div>
          </div>
        </div>
        {levelUp && (
          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 flex items-center gap-2">
            <span className="text-lg">🎉</span>
            <span className="text-xs font-black text-indigo-500">Level Up! → Level {newLevel}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default XPProgressBar;
