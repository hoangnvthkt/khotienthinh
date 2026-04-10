import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { xpService, UserXP, LEVELS } from '../lib/xpService';
import {
  Trophy, Medal, Crown, Flame, Star, TrendingUp,
  Users, Calendar, Award, ChevronRight, Zap
} from 'lucide-react';

// ══════════════════════════════════════════
//  LEADERBOARD — Anonymous XP Rankings
// ══════════════════════════════════════════

// Generate anonymous nicknames
const ANIMAL_NAMES = [
  'Hổ Dũng Mãnh', 'Đại Bàng Bay', 'Sư Tử Vàng', 'Cá Mập Xanh',
  'Rồng Lửa', 'Phượng Hoàng', 'Báo Đen', 'Sói Bạc',
  'Kỳ Lân Trắng', 'Gấu Nâu', 'Chim Ưng', 'Cá Heo',
  'Hạc Trắng', 'Ngựa Phi', 'Voi Khôn', 'Ong Chăm',
];

const getNickname = (userId: string, index: number): string => {
  // Deterministic nickname from userId hash
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  return ANIMAL_NAMES[Math.abs(hash) % ANIMAL_NAMES.length];
};

const getAvatarEmoji = (level: number): string => {
  if (level >= 10) return '🏆';
  if (level >= 8) return '💎';
  if (level >= 6) return '🔥';
  if (level >= 4) return '⭐';
  if (level >= 2) return '🌿';
  return '🌱';
};

// ── Podium Component ──
const Podium: React.FC<{ entries: (UserXP & { rank: number; nickname: string; isMe: boolean })[] }> = ({ entries }) => {
  const top3 = entries.slice(0, 3);
  // Reorder: [2nd, 1st, 3rd] for podium display
  const podiumOrder = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3;

  const heights = ['h-24', 'h-32', 'h-20'];
  const colors = [
    'from-slate-300 to-slate-400 border-slate-300', // Silver
    'from-amber-300 to-yellow-500 border-amber-400', // Gold
    'from-orange-300 to-amber-400 border-orange-300', // Bronze
  ];
  const medals = ['🥈', '🥇', '🥉'];
  const glows = ['', 'shadow-amber-400/50 shadow-xl', ''];

  return (
    <div className="flex items-end justify-center gap-3 pt-8 pb-2">
      {podiumOrder.map((entry, i) => {
        if (!entry) return null;
        const levelInfo = LEVELS.find(l => l.level === entry.level);
        return (
          <div key={entry.userId} className="flex flex-col items-center" style={{ animation: `podiumSlide 0.5s ease-out ${i * 0.15}s both` }}>
            {/* Avatar */}
            <div className={`relative mb-2 ${entry.isMe ? 'ring-2 ring-indigo-400 ring-offset-2' : ''} rounded-full`}>
              <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${colors[i]} flex items-center justify-center text-2xl border-2 ${glows[i]}`}>
                {getAvatarEmoji(entry.level)}
              </div>
              <span className="absolute -top-2 -right-1 text-xl">{medals[i]}</span>
              {entry.isMe && (
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-indigo-500 text-white text-[7px] font-black whitespace-nowrap">BẠN</div>
              )}
            </div>

            {/* Name */}
            <div className="text-xs font-black text-slate-700 dark:text-white text-center max-w-20 truncate">
              {entry.nickname}
            </div>
            <div className="text-[10px] text-slate-400 flex items-center gap-0.5">
              <Zap size={9} className="text-indigo-400" />
              {entry.totalXp.toLocaleString()} XP
            </div>

            {/* Podium block */}
            <div className={`${heights[i]} w-20 mt-2 rounded-t-xl bg-gradient-to-b ${colors[i]} flex items-center justify-center border-t-2`}>
              <span className="text-2xl font-black text-white/80">{[2, 1, 3][i]}</span>
            </div>
          </div>
        );
      })}

      <style>{`
        @keyframes podiumSlide {
          from { transform: translateY(30px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

// ── Row Component ──
const LeaderboardRow: React.FC<{ entry: UserXP & { rank: number; nickname: string; isMe: boolean } }> = ({ entry }) => {
  const levelInfo = LEVELS.find(l => l.level === entry.level);
  const progress = xpService.getProgress(entry.totalXp, entry.level);

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
      entry.isMe
        ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 ring-1 ring-indigo-300 dark:ring-indigo-600'
        : 'bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 hover:border-slate-200 dark:hover:border-slate-600'
    }`}>
      {/* Rank */}
      <div className="w-8 text-center shrink-0">
        <span className={`text-sm font-black ${entry.rank <= 3 ? 'text-amber-500' : 'text-slate-400'}`}>
          #{entry.rank}
        </span>
      </div>

      {/* Avatar */}
      <div className={`w-10 h-10 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center text-lg shrink-0 ${
        entry.level >= 5 ? 'ring-2 ring-amber-400/50' : ''
      }`}>
        {getAvatarEmoji(entry.level)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${entry.isMe ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-700 dark:text-white'}`}>
            {entry.nickname}
          </span>
          {entry.isMe && (
            <span className="px-1.5 py-0.5 rounded bg-indigo-500 text-white text-[7px] font-black">BẠN</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-slate-400">{levelInfo?.icon} Lv.{entry.level}</span>
          {entry.streakDays > 0 && (
            <span className="text-[10px] text-orange-500 flex items-center gap-0.5">
              <Flame size={9} /> {entry.streakDays}d
            </span>
          )}
        </div>
      </div>

      {/* XP */}
      <div className="text-right shrink-0">
        <div className="text-sm font-black text-indigo-600 dark:text-indigo-400">
          {entry.totalXp.toLocaleString()}
        </div>
        <div className="text-[9px] text-slate-400 uppercase font-bold">XP</div>
      </div>
    </div>
  );
};

// ── Main Leaderboard Page ──
const Leaderboard: React.FC = () => {
  const { user } = useApp();
  const [leaderboard, setLeaderboard] = useState<UserXP[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'streak'>('all');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await xpService.getLeaderboard(50);
      setLeaderboard(data);
      setLoading(false);
    };
    load();
  }, []);

  const entries = useMemo(() => {
    let sorted = [...leaderboard];
    if (tab === 'streak') {
      sorted.sort((a, b) => b.streakDays - a.streakDays);
    } else {
      sorted.sort((a, b) => b.totalXp - a.totalXp);
    }
    return sorted.map((entry, i) => ({
      ...entry,
      rank: i + 1,
      nickname: getNickname(entry.userId, i),
      isMe: entry.userId === user.id,
    }));
  }, [leaderboard, tab, user.id]);

  const myEntry = entries.find(e => e.isMe);

  return (
    <div className="max-w-2xl mx-auto space-y-4 p-1">
      {/* Header */}
      <div className="text-center py-4">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Trophy size={28} className="text-amber-500" />
          <h1 className="text-2xl font-black text-slate-800 dark:text-white">Bảng xếp hạng</h1>
        </div>
        <p className="text-xs text-slate-400">Ai là người chăm chỉ nhất công ty?</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-slate-50 dark:bg-slate-900/50">
        {(['all', 'streak'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              tab === t
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            }`}>
            {t === 'all' ? <><Trophy size={14} /> Top XP</> : <><Flame size={14} /> Top Streak</>}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-12">
          <div className="inline-flex items-center gap-2 text-slate-400 text-sm">
            <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            Đang tải bảng xếp hạng...
          </div>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <>
          {/* Podium (top 3) */}
          <div className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-800/50 dark:to-slate-900/30 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <Podium entries={entries} />
          </div>

          {/* List (rank 4+) */}
          {entries.length > 3 && (
            <div className="space-y-2">
              {entries.slice(3).map(entry => (
                <LeaderboardRow key={entry.userId} entry={entry} />
              ))}
            </div>
          )}

          {/* My rank sticky footer */}
          {myEntry && myEntry.rank > 3 && (
            <div className="sticky bottom-4 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-2xl border border-indigo-200 dark:border-indigo-700 shadow-xl p-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-lg text-white font-black">
                  {myEntry.rank}
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400">Vị trí của bạn</div>
                  <div className="text-[10px] text-slate-400">
                    {myEntry.rank > 1 
                      ? `Còn ${(entries[myEntry.rank - 2]?.totalXp || 0) - myEntry.totalXp} XP để vươn lên hạng ${myEntry.rank - 1}`
                      : 'Bạn đang dẫn đầu! 🥇'
                    }
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-black text-indigo-600 dark:text-indigo-400">{myEntry.totalXp.toLocaleString()}</div>
                  <div className="text-[9px] text-slate-400 uppercase font-bold">XP</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && entries.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-2">🏆</div>
          <div className="text-sm font-bold text-slate-500">Chưa có ai xếp hạng!</div>
          <div className="text-xs text-slate-400">Bạn sẽ là người đầu tiên!</div>
        </div>
      )}
    </div>
  );
};

export default Leaderboard;
