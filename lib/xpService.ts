import { isSupabaseConfigured, supabase } from './supabase';

// ══════════════════════════════════════════
//  XP SERVICE — Gamification Engine
// ══════════════════════════════════════════

export interface UserXP {
  id: string;
  userId: string;
  totalXp: number;
  level: number;
  streakDays: number;
  lastActiveDate: string | null;
  badges: Badge[];
  createdAt: string;
  updatedAt: string;
}

export interface Badge {
  id: string;
  name: string;
  icon: string;
  description: string;
  earnedAt: string;
}

export interface XPEvent {
  id: string;
  userId: string;
  eventType: string;
  xpAmount: number;
  description: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export type DailyXPEventType = 'daily_login' | 'daily_checkin';

export interface XPAwardResult {
  awarded: boolean;
  xpGained: number;
  profile: UserXP;
  newBadges: Badge[];
}

// ═════════ XP Rules ═════════
export const XP_RULES: Record<string, { xp: number; label: string; icon: string }> = {
  // Daily actions
  daily_login: { xp: 5, label: 'Đăng nhập hàng ngày', icon: '🌅' },
  daily_checkin: { xp: 10, label: 'Check-in hàng ngày', icon: '✅' },

  // WMS actions
  create_request: { xp: 15, label: 'Tạo phiếu đề xuất', icon: '📝' },
  approve_request: { xp: 10, label: 'Duyệt phiếu đề xuất', icon: '✔️' },
  complete_transaction: { xp: 8, label: 'Hoàn thành giao dịch', icon: '📦' },

  // Workflow actions  
  create_workflow: { xp: 20, label: 'Tạo phiếu quy trình', icon: '🔄' },
  approve_workflow: { xp: 15, label: 'Duyệt phiếu quy trình', icon: '🎯' },

  // Request actions
  create_rq: { xp: 15, label: 'Tạo yêu cầu', icon: '📋' },
  approve_rq: { xp: 10, label: 'Duyệt yêu cầu', icon: '👍' },

  // HRM actions
  update_employee: { xp: 5, label: 'Cập nhật nhân sự', icon: '👤' },

  // Streak bonuses
  streak_7: { xp: 50, label: 'Streak 7 ngày', icon: '🔥' },
  streak_30: { xp: 200, label: 'Streak 30 ngày', icon: '💎' },
  streak_100: { xp: 500, label: 'Streak 100 ngày', icon: '🏆' },
};

// ═════════ Level Thresholds ═════════
export const LEVELS = [
  { level: 1, minXp: 0, title: 'Nhân viên mới', icon: '🌱' },
  { level: 2, minXp: 100, title: 'Đã quen việc', icon: '🌿' },
  { level: 3, minXp: 300, title: 'Chuyên cần', icon: '⭐' },
  { level: 4, minXp: 600, title: 'Thành thạo', icon: '🌟' },
  { level: 5, minXp: 1000, title: 'Chuyên gia', icon: '💫' },
  { level: 6, minXp: 1500, title: 'Bậc thầy', icon: '🔥' },
  { level: 7, minXp: 2500, title: 'Huyền thoại', icon: '👑' },
  { level: 8, minXp: 4000, title: 'Siêu nhân', icon: '🦸' },
  { level: 9, minXp: 6000, title: 'Phi thường', icon: '💎' },
  { level: 10, minXp: 10000, title: 'Bất khả chiến bại', icon: '🏆' },
];

// ═════════ Badge Definitions ═════════
export const BADGE_DEFS: Record<string, { name: string; icon: string; description: string; condition: (xp: UserXP) => boolean }> = {
  first_login: { name: 'Lần đầu', icon: '🎉', description: 'Đăng nhập lần đầu', condition: () => true },
  streak_7: { name: 'Chuyên cần', icon: '🔥', description: 'Đăng nhập 7 ngày liên tục', condition: (u) => u.streakDays >= 7 },
  streak_30: { name: 'Không nghỉ', icon: '💪', description: 'Đăng nhập 30 ngày liên tục', condition: (u) => u.streakDays >= 30 },
  xp_100: { name: 'Tích luỹ 100 XP', icon: '⭐', description: 'Đạt 100 XP tổng cộng', condition: (u) => u.totalXp >= 100 },
  xp_500: { name: 'Tích luỹ 500 XP', icon: '🌟', description: 'Đạt 500 XP tổng cộng', condition: (u) => u.totalXp >= 500 },
  xp_1000: { name: 'Ngàn XP', icon: '💎', description: 'Đạt 1000 XP tổng cộng', condition: (u) => u.totalXp >= 1000 },
  level_5: { name: 'Chuyên gia', icon: '🏅', description: 'Đạt Level 5', condition: (u) => u.level >= 5 },
  level_10: { name: 'Bất khả chiến bại', icon: '🏆', description: 'Đạt Level 10', condition: (u) => u.level >= 10 },
};

export const xpService = {
  /** Read an XP profile. Profile creation happens only inside authoritative server RPCs. */
  async getProfile(userId: string): Promise<UserXP | null> {
    const { data, error } = await supabase
      .from('user_xp')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      id: data.id,
      userId: data.user_id,
      totalXp: data.total_xp,
      level: data.level,
      streakDays: data.streak_days,
      lastActiveDate: data.last_active_date,
      badges: data.badges || [],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },

  /** Award daily XP atomically. The server derives actor, amount and idempotency. */
  async awardDailyXP(
    eventType: DailyXPEventType,
    sourceId?: string,
  ): Promise<XPAwardResult> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured; daily XP awards are disabled in mock mode.');
    }

    const { data, error } = await supabase.rpc('award_my_daily_xp', {
      p_event_type: eventType,
      p_source_id: sourceId ?? null,
    });

    if (error) throw error;
    if (!data) throw new Error('Daily XP RPC returned no award result.');
    return data as XPAwardResult;
  },

  /** Get recent XP events */
  async getRecentEvents(userId: string, limit = 20): Promise<XPEvent[]> {
    const { data, error } = await supabase
      .from('xp_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data || []).map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      eventType: r.event_type,
      xpAmount: r.xp_amount,
      description: r.description,
      metadata: r.metadata || {},
      createdAt: r.created_at,
    }));
  },

  /** Get leaderboard (top users by XP) */
  async getLeaderboard(limit = 10): Promise<UserXP[]> {
    const { data, error } = await supabase
      .from('user_xp')
      .select('*')
      .order('total_xp', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data || []).map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      totalXp: r.total_xp,
      level: r.level,
      streakDays: r.streak_days,
      lastActiveDate: r.last_active_date,
      badges: r.badges || [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  /** Get level info */
  getLevelInfo(level: number) {
    return LEVELS.find(l => l.level === level) || LEVELS[0];
  },

  /** Get next level info */
  getNextLevel(level: number) {
    return LEVELS.find(l => l.level === level + 1) || null;
  },

  /** XP progress to next level (0-100%) */
  getProgress(totalXp: number, level: number): number {
    const current = LEVELS.find(l => l.level === level);
    const next = LEVELS.find(l => l.level === level + 1);
    if (!current || !next) return 100;
    const range = next.minXp - current.minXp;
    const progress = totalXp - current.minXp;
    return Math.min(100, Math.round((progress / range) * 100));
  },
};
