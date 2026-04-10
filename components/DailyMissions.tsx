import React, { useState, useEffect, useCallback } from 'react';
import { Target, CheckCircle2, Circle, Gift, Zap, ChevronDown, ChevronUp, Flame, Trophy, Star } from 'lucide-react';
import { Mission, missionService } from '../lib/dailyMissionService';
import { useCelebration } from './Celebration';

// ══════════════════════════════════════════
//  DAILY & WEEKLY MISSIONS — Gamification Card
// ══════════════════════════════════════════

const MissionItem: React.FC<{ mission: Mission }> = ({ mission }) => {
  const progress = mission.targetCount > 1 ? `${mission.currentCount}/${mission.targetCount}` : '';
  const progressPct = Math.round((mission.currentCount / mission.targetCount) * 100);

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${
      mission.completed 
        ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800' 
        : 'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-700'
    }`}>
      {/* Check icon */}
      <div className={`shrink-0 transition-all duration-300 ${mission.completed ? 'scale-110' : ''}`}>
        {mission.completed ? (
          <CheckCircle2 size={20} className="text-emerald-500" style={{ animation: 'missionPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' }} />
        ) : (
          <Circle size={20} className="text-slate-300 dark:text-slate-600" />
        )}
      </div>

      {/* Mission info */}
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-bold ${mission.completed ? 'text-emerald-600 dark:text-emerald-400 line-through' : 'text-slate-700 dark:text-slate-200'}`}>
          <span className="mr-1.5">{mission.icon}</span>
          {mission.title}
        </div>
        <div className="text-[10px] text-slate-400 dark:text-slate-500">{mission.description}</div>
        {/* Progress bar for multi-count missions */}
        {mission.targetCount > 1 && !mission.completed && (
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-[9px] font-bold text-slate-400">{progress}</span>
          </div>
        )}
      </div>

      {/* XP reward */}
      <div className={`shrink-0 px-2 py-0.5 rounded-lg text-[10px] font-black ${
        mission.completed
          ? 'bg-emerald-100 dark:bg-emerald-800/30 text-emerald-600 dark:text-emerald-400'
          : 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500'
      }`}>
        +{mission.xpReward} XP
      </div>
    </div>
  );
};

// ── Progress Ring ──
const ProgressRing: React.FC<{ progress: number; size?: number; strokeWidth?: number }> = ({ progress, size = 56, strokeWidth = 4 }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size/2} cy={size/2} r={radius} fill="none"
        stroke="currentColor" strokeWidth={strokeWidth}
        className="text-slate-100 dark:text-slate-700" />
      <circle cx={size/2} cy={size/2} r={radius} fill="none"
        stroke="url(#missionGrad)" strokeWidth={strokeWidth}
        strokeLinecap="round" strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-700 ease-out" />
      <defs>
        <linearGradient id="missionGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
    </svg>
  );
};

// ── Main Component ──
const DailyMissions: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'daily' | 'weekly'>('daily');
  const [dailyMissions, setDailyMissions] = useState<Mission[]>([]);
  const [weeklyMissions, setWeeklyMissions] = useState<Mission[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const { celebrate, showToast } = useCelebration();

  useEffect(() => {
    setDailyMissions(missionService.getDailyMissions());
    setWeeklyMissions(missionService.getWeeklyMissions());
  }, []);

  const stats = missionService.getStats();
  const currentMissions = activeTab === 'daily' ? dailyMissions : weeklyMissions;
  const done = activeTab === 'daily' ? stats.dailyDone : stats.weeklyDone;
  const total = activeTab === 'daily' ? stats.dailyTotal : stats.weeklyTotal;
  const allDone = done === total && total > 0;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bonusClaimed = activeTab === 'daily' ? stats.dailyBonusClaimed : stats.weeklyBonusClaimed;
  const bonusXP = activeTab === 'daily' ? 50 : 200;

  const handleClaimBonus = () => {
    const claimed = activeTab === 'daily' ? missionService.claimDailyBonus() : missionService.claimWeeklyBonus();
    if (claimed) {
      celebrate({
        variant: 'milestone',
        title: activeTab === 'daily' ? '🎉 All Clear!' : '🏆 Tuần hoàn hảo!',
        subtitle: `+${bonusXP} XP Bonus!`,
        confetti: true,
        duration: 2500,
      });
      // Refresh
      setDailyMissions(missionService.getDailyMissions());
      setWeeklyMissions(missionService.getWeeklyMissions());
    }
  };

  return (
    <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden shadow-sm">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
      >
        {/* Progress ring */}
        <div className="relative shrink-0">
          <ProgressRing progress={progressPct} />
          <div className="absolute inset-0 flex items-center justify-center">
            {allDone ? (
              <Star size={20} className="text-amber-500" style={{ animation: 'missionPop 0.5s ease-out' }} />
            ) : (
              <span className="text-xs font-black text-indigo-600 dark:text-indigo-400">{done}/{total}</span>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 text-left">
          <div className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
            <Target size={16} className="text-indigo-500" />
            Nhiệm vụ {activeTab === 'daily' ? 'hôm nay' : 'tuần này'}
          </div>
          <div className="text-[10px] text-slate-400">
            {allDone ? '🎉 Đã hoàn thành tất cả!' : `Còn ${total - done} nhiệm vụ`}
          </div>
        </div>

        {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {/* Body */}
      {isExpanded && (
        <div className="px-4 pb-4">
          {/* Tab switcher */}
          <div className="flex gap-1 p-1 rounded-xl bg-slate-50 dark:bg-slate-900/50 mb-3">
            <button
              onClick={() => setActiveTab('daily')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'daily'
                  ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}>
              🌅 Hàng ngày
            </button>
            <button
              onClick={() => setActiveTab('weekly')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'weekly'
                  ? 'bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}>
              📅 Hàng tuần
            </button>
          </div>

          {/* Mission list */}
          <div className="space-y-2">
            {currentMissions.map(mission => (
              <MissionItem key={mission.id} mission={mission} />
            ))}
          </div>

          {/* Bonus claim */}
          {allDone && !bonusClaimed && (
            <button
              onClick={handleClaimBonus}
              className="mt-3 w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-white font-bold text-sm shadow-lg shadow-amber-500/30 hover:shadow-xl transition-all flex items-center justify-center gap-2"
              style={{ animation: 'missionPulse 2s ease-in-out infinite' }}
            >
              <Gift size={18} />
              Nhận thưởng +{bonusXP} XP 🎁
            </button>
          )}
          {allDone && bonusClaimed && (
            <div className="mt-3 text-center py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
              ✅ Đã nhận thưởng! Giỏi quá!
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes missionPop {
          0% { transform: scale(0); }
          60% { transform: scale(1.3); }
          100% { transform: scale(1); }
        }
        @keyframes missionPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 4px 20px rgba(245, 158, 11, 0.3); }
          50% { transform: scale(1.02); box-shadow: 0 8px 30px rgba(245, 158, 11, 0.5); }
        }
      `}</style>
    </div>
  );
};

export default DailyMissions;
