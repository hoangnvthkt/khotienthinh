import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { xpService, UserXP, XPEvent, LEVELS, BADGE_DEFS } from '../lib/xpService';
import {
  Trophy, Star, Flame, Zap, Award, Target, Medal,
  TrendingUp, Calendar, ChevronRight, Gift, Crown, Sparkles
} from 'lucide-react';

// ══════════════════════════════════════════
//  ACHIEVEMENT WALL — Gamification Profile
// ══════════════════════════════════════════

// ── XP Sparkline ──
const XPSparkline: React.FC<{ events: XPEvent[] }> = ({ events }) => {
  // Group events by day, last 14 days
  const dailyXP = useMemo(() => {
    const now = new Date();
    const days: { date: string; xp: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = d.toISOString().split('T')[0];
      const dayEvents = events.filter(e => e.createdAt.startsWith(key));
      days.push({ date: key, xp: dayEvents.reduce((s, e) => s + e.xpAmount, 0) });
    }
    return days;
  }, [events]);

  const maxXP = Math.max(...dailyXP.map(d => d.xp), 1);
  const w = 300;
  const h = 80;
  const padding = 4;

  const points = dailyXP.map((d, i) => {
    const x = padding + (i / (dailyXP.length - 1)) * (w - padding * 2);
    const y = h - padding - (d.xp / maxXP) * (h - padding * 2);
    return { x, y, xp: d.xp, date: d.date };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = pathD + ` L ${points[points.length-1].x} ${h} L ${points[0].x} ${h} Z`;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">
        <defs>
          <linearGradient id="xpGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#xpGrad)" />
        <path d={pathD} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.xp > 0 ? 3 : 0}
            fill="#6366f1" stroke="white" strokeWidth="1.5"
            className="transition-all duration-300" />
        ))}
      </svg>
      <div className="flex justify-between text-[9px] text-slate-400 px-1">
        <span>{dailyXP[0]?.date.slice(5)}</span>
        <span>Hôm nay</span>
      </div>
    </div>
  );
};

// ── Badge Card ──
const BadgeCard: React.FC<{ id: string; def: typeof BADGE_DEFS[string]; earned: boolean; earnedAt?: string }> = ({ id, def, earned, earnedAt }) => {
  return (
    <div className={`group relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all duration-300 ${
      earned
        ? 'border-indigo-200 dark:border-indigo-700 bg-gradient-to-b from-indigo-50 to-white dark:from-indigo-900/20 dark:to-slate-800/50 hover:shadow-xl hover:shadow-indigo-500/10 hover:-translate-y-1'
        : 'border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/20 opacity-50'
    }`}>
      {/* Glow for earned badges */}
      {earned && (
        <div className="absolute inset-0 rounded-2xl bg-indigo-400/5 animate-pulse pointer-events-none" />
      )}

      <span className={`text-3xl transition-transform duration-300 ${earned ? 'group-hover:scale-125' : 'grayscale'}`}>
        {def.icon}
      </span>
      <span className={`text-xs font-bold text-center ${earned ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`}>
        {def.name}
      </span>
      <span className="text-[9px] text-slate-400 text-center leading-relaxed">
        {def.description}
      </span>
      {earned && earnedAt && (
        <span className="text-[8px] text-emerald-500 font-bold">
          ✅ {new Date(earnedAt).toLocaleDateString('vi-VN')}
        </span>
      )}
      {!earned && (
        <span className="text-[8px] text-slate-300 dark:text-slate-600 font-bold">🔒 Chưa đạt</span>
      )}

      {/* Star badge for earned */}
      {earned && (
        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gradient-to-br from-amber-400 to-yellow-500 rounded-full flex items-center justify-center shadow-lg shadow-amber-400/30">
          <Star size={10} className="text-white" />
        </div>
      )}
    </div>
  );
};

// ── Main Component ──
const AchievementWall: React.FC = () => {
  const { user } = useApp();
  const [profile, setProfile] = useState<UserXP | null>(null);
  const [events, setEvents] = useState<XPEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [p, e] = await Promise.all([
          xpService.getProfile(user.id),
          xpService.getRecentEvents(user.id, 100),
        ]);
        setProfile(p);
        setEvents(e);
      } catch {}
      setLoading(false);
    };
    load();
  }, [user.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) return null;

  const levelInfo = LEVELS.find(l => l.level === profile.level);
  const nextLevel = LEVELS.find(l => l.level === profile.level + 1);
  const progress = xpService.getProgress(profile.totalXp, profile.level);
  const allBadges = Object.entries(BADGE_DEFS);
  const earnedIds = new Set((profile.badges || []).map(b => b.id));

  // Stats
  const todayEvents = events.filter(e => e.createdAt.startsWith(new Date().toISOString().split('T')[0]));
  const todayXP = todayEvents.reduce((s, e) => s + e.xpAmount, 0);
  const weekEvents = events.filter(e => {
    const d = new Date(e.createdAt);
    const now = new Date();
    return (now.getTime() - d.getTime()) < 7 * 86400000;
  });
  const weekXP = weekEvents.reduce((s, e) => s + e.xpAmount, 0);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Hero Card */}
      <div className="glass-card rounded-2xl p-6 bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-900/20 dark:to-violet-900/20 border border-indigo-100 dark:border-indigo-800">
        <div className="flex items-center gap-4 mb-4">
          {/* Level Badge */}
          <div className="relative">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-4xl shadow-2xl shadow-indigo-500/30">
              {levelInfo?.icon || '🌱'}
            </div>
            <div className="absolute -bottom-1 -right-1 px-2 py-0.5 rounded-lg bg-white dark:bg-slate-800 shadow-md text-[10px] font-black text-indigo-600 border border-indigo-200">
              Lv.{profile.level}
            </div>
          </div>

          <div className="flex-1">
            <h2 className="text-xl font-black text-slate-800 dark:text-white">
              {levelInfo?.title || 'Nhân viên mới'}
            </h2>
            <p className="text-sm text-indigo-500 font-bold">{profile.totalXp.toLocaleString()} XP Tổng</p>

            {/* Progress to next level */}
            {nextLevel && (
              <div className="mt-2">
                <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                  <span>Level {profile.level}</span>
                  <span>{progress}%</span>
                  <span>Level {nextLevel.level}</span>
                </div>
                <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500"
                    style={{ width: `${progress}%`, transition: 'width 1s ease-out' }} />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Còn {(nextLevel.minXp - profile.totalXp).toLocaleString()} XP → {nextLevel.icon} {nextLevel.title}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Hôm nay', value: todayXP, icon: <Zap size={14} />, color: 'text-green-500 bg-green-50 dark:bg-green-900/20' },
            { label: 'Tuần này', value: weekXP, icon: <TrendingUp size={14} />, color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' },
            { label: 'Streak', value: `${profile.streakDays}🔥`, icon: <Flame size={14} />, color: 'text-orange-500 bg-orange-50 dark:bg-orange-900/20' },
            { label: 'Huy hiệu', value: `${(profile.badges || []).length}/${allBadges.length}`, icon: <Award size={14} />, color: 'text-purple-500 bg-purple-50 dark:bg-purple-900/20' },
          ].map(stat => (
            <div key={stat.label} className={`text-center p-3 rounded-xl ${stat.color}`}>
              <div className="flex items-center justify-center mb-1">{stat.icon}</div>
              <div className="text-base font-black">{stat.value}</div>
              <div className="text-[9px] uppercase font-bold opacity-60">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* XP Timeline Chart */}
      <div className="glass-card rounded-2xl p-5 border border-slate-100 dark:border-slate-700">
        <h3 className="text-sm font-black text-slate-700 dark:text-white mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-indigo-500" />
          XP 14 ngày gần đây
        </h3>
        <XPSparkline events={events} />
      </div>

      {/* Badge Showcase */}
      <div className="glass-card rounded-2xl p-5 border border-slate-100 dark:border-slate-700">
        <h3 className="text-sm font-black text-slate-700 dark:text-white mb-4 flex items-center gap-2">
          <Medal size={16} className="text-amber-500" />
          Bộ sưu tập Huy hiệu ({(profile.badges || []).length}/{allBadges.length})
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {allBadges.map(([id, def]) => {
            const badge = (profile.badges || []).find(b => b.id === id);
            return (
              <BadgeCard
                key={id}
                id={id}
                def={def}
                earned={earnedIds.has(id)}
                earnedAt={badge?.earnedAt}
              />
            );
          })}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="glass-card rounded-2xl p-5 border border-slate-100 dark:border-slate-700">
        <h3 className="text-sm font-black text-slate-700 dark:text-white mb-3 flex items-center gap-2">
          <Sparkles size={16} className="text-violet-500" />
          Hoạt động gần đây
        </h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {events.slice(0, 20).map((evt, i) => (
            <div key={evt.id || i}
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
                  <Zap size={12} className="text-indigo-500" />
                </div>
                <div>
                  <span className="text-xs text-slate-600 dark:text-slate-300">{evt.description}</span>
                  <div className="text-[9px] text-slate-400">
                    {new Date(evt.createdAt).toLocaleString('vi-VN')}
                  </div>
                </div>
              </div>
              <span className="text-xs font-black text-green-500 whitespace-nowrap">+{evt.xpAmount} XP</span>
            </div>
          ))}
          {events.length === 0 && (
            <div className="text-center py-6 text-sm text-slate-400">
              <div className="text-2xl mb-1">🎯</div>
              Chưa có hoạt động nào. Bắt đầu kiếm XP nào!
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AchievementWall;
