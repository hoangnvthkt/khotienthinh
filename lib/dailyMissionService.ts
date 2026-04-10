import { supabase } from './supabase';
import { xpService, XP_RULES } from './xpService';

// ══════════════════════════════════════════
//  DAILY & WEEKLY MISSION SERVICE
// ══════════════════════════════════════════

export interface Mission {
  id: string;
  type: 'daily' | 'weekly';
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  targetAction: string;       // matches XP_RULES keys or custom
  targetCount: number;        // how many times to do
  currentCount: number;       // progress
  completed: boolean;
  completedAt?: string;
}

export interface MissionState {
  userId: string;
  date: string;             // YYYY-MM-DD for daily, YYYY-Www for weekly
  missions: Mission[];
  allCompleted: boolean;
  bonusClaimed: boolean;
}

// ═════════ Mission Pools ═════════

const DAILY_MISSION_POOL: Omit<Mission, 'id' | 'currentCount' | 'completed' | 'completedAt'>[] = [
  { type: 'daily', title: 'Đăng nhập hệ thống', description: 'Mở Vioo và đăng nhập', icon: '🌅', xpReward: 5, targetAction: 'daily_login', targetCount: 1 },
  { type: 'daily', title: 'Check-in chấm công', description: 'Thực hiện check-in trong ngày', icon: '📍', xpReward: 15, targetAction: 'daily_checkin', targetCount: 1 },
  { type: 'daily', title: 'Tạo phiếu yêu cầu', description: 'Tạo 1 yêu cầu mới', icon: '📝', xpReward: 20, targetAction: 'create_rq', targetCount: 1 },
  { type: 'daily', title: 'Duyệt phiếu đang chờ', description: 'Duyệt ít nhất 1 phiếu', icon: '✅', xpReward: 15, targetAction: 'approve_request', targetCount: 1 },
  { type: 'daily', title: 'Nhắn tin cho đồng nghiệp', description: 'Gửi 1 tin nhắn trong Chat', icon: '💬', xpReward: 10, targetAction: 'send_chat', targetCount: 1 },
  { type: 'daily', title: 'Kiểm tra tồn kho', description: 'Xem danh sách vật tư 1 lần', icon: '📦', xpReward: 10, targetAction: 'view_inventory', targetCount: 1 },
  { type: 'daily', title: 'Cập nhật hồ sơ', description: 'Chỉnh sửa 1 thông tin nhân sự', icon: '👤', xpReward: 10, targetAction: 'update_employee', targetCount: 1 },
  { type: 'daily', title: 'Xem Dashboard', description: 'Mở Dashboard tổng quan', icon: '📊', xpReward: 5, targetAction: 'view_dashboard', targetCount: 1 },
  { type: 'daily', title: 'Sử dụng Tìm kiếm', description: 'Tìm kiếm bằng Cmd+K', icon: '🔍', xpReward: 10, targetAction: 'use_search', targetCount: 1 },
  { type: 'daily', title: 'Xem Thông báo', description: 'Đọc 1 thông báo mới', icon: '🔔', xpReward: 5, targetAction: 'read_notification', targetCount: 1 },
];

const WEEKLY_MISSION_POOL: Omit<Mission, 'id' | 'currentCount' | 'completed' | 'completedAt'>[] = [
  { type: 'weekly', title: 'Streak 5 ngày', description: 'Đăng nhập 5 ngày liên tiếp trong tuần', icon: '🔥', xpReward: 100, targetAction: 'streak_week', targetCount: 5 },
  { type: 'weekly', title: 'Tạo 5 phiếu yêu cầu', description: 'Tạo tổng cộng 5 yêu cầu trong tuần', icon: '📋', xpReward: 80, targetAction: 'create_rq', targetCount: 5 },
  { type: 'weekly', title: 'Duyệt 10 phiếu', description: 'Duyệt tổng cộng 10 phiếu trong tuần', icon: '✔️', xpReward: 120, targetAction: 'approve_request', targetCount: 10 },
  { type: 'weekly', title: 'Master Inventory', description: 'Tạo 3 giao dịch kho trong tuần', icon: '📦', xpReward: 60, targetAction: 'complete_transaction', targetCount: 3 },
  { type: 'weekly', title: 'Social Butterfly', description: 'Gửi 20 tin nhắn trong tuần', icon: '🦋', xpReward: 50, targetAction: 'send_chat', targetCount: 20 },
  { type: 'weekly', title: 'Hoàn thành 5 nhiệm vụ ngày', description: 'All-clear 5 ngày trong tuần', icon: '🏆', xpReward: 150, targetAction: 'daily_all_clear', targetCount: 5 },
  { type: 'weekly', title: 'Team Player', description: 'Tương tác với 3 module khác nhau', icon: '🤝', xpReward: 60, targetAction: 'multi_module', targetCount: 3 },
  { type: 'weekly', title: 'Nhà phân tích', description: 'Xem báo cáo/dashboard 5 lần', icon: '📈', xpReward: 40, targetAction: 'view_dashboard', targetCount: 5 },
];

// ═════════ Helpers ═════════

const getTodayKey = (): string => new Date().toISOString().split('T')[0];

const getWeekKey = (): string => {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
};

const generateId = () => Math.random().toString(36).substring(2, 10);

/** Pick N random missions from a pool */
const pickRandom = <T>(pool: T[], count: number): T[] => {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, pool.length));
};

// ═════════ LOCAL STORAGE for missions ═════════
// We store missions in localStorage for simplicity (no extra DB tables needed)

const STORAGE_KEY = 'vioo_missions';

interface StoredMissions {
  daily: { date: string; missions: Mission[]; bonusClaimed: boolean };
  weekly: { week: string; missions: Mission[]; bonusClaimed: boolean };
}

const loadStored = (): StoredMissions | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

const saveStored = (data: StoredMissions) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

// ═════════ Service ═════════

export const missionService = {
  /** Get today's daily missions (generates if needed) */
  getDailyMissions(): Mission[] {
    const today = getTodayKey();
    const stored = loadStored();

    if (stored?.daily?.date === today) {
      return stored.daily.missions;
    }

    // Generate new daily missions (pick 4)
    const picked = pickRandom(DAILY_MISSION_POOL, 4);
    const missions: Mission[] = picked.map(m => ({
      ...m,
      id: generateId(),
      currentCount: 0,
      completed: false,
    }));

    const data: StoredMissions = {
      daily: { date: today, missions, bonusClaimed: false },
      weekly: stored?.weekly || { week: getWeekKey(), missions: this.generateWeeklyMissions(), bonusClaimed: false },
    };
    saveStored(data);
    return missions;
  },

  /** Get this week's weekly missions (generates if needed) */
  getWeeklyMissions(): Mission[] {
    const week = getWeekKey();
    const stored = loadStored();

    if (stored?.weekly?.week === week) {
      return stored.weekly.missions;
    }

    const missions = this.generateWeeklyMissions();
    const data: StoredMissions = {
      daily: stored?.daily || { date: getTodayKey(), missions: this.getDailyMissions(), bonusClaimed: false },
      weekly: { week, missions, bonusClaimed: false },
    };
    saveStored(data);
    return missions;
  },

  generateWeeklyMissions(): Mission[] {
    const picked = pickRandom(WEEKLY_MISSION_POOL, 3);
    return picked.map(m => ({
      ...m,
      id: generateId(),
      currentCount: 0,
      completed: false,
    }));
  },

  /** Track progress on a mission action */
  trackAction(actionKey: string): { completedMission?: Mission; dailyAllClear?: boolean } {
    const stored = loadStored();
    if (!stored) return {};

    let completedMission: Mission | undefined;
    let dailyAllClear = false;

    // Check daily missions
    for (const m of stored.daily.missions) {
      if (!m.completed && m.targetAction === actionKey) {
        m.currentCount = Math.min(m.currentCount + 1, m.targetCount);
        if (m.currentCount >= m.targetCount) {
          m.completed = true;
          m.completedAt = new Date().toISOString();
          completedMission = m;
        }
        break; // only match one per action
      }
    }

    // Check weekly missions
    if (!completedMission) {
      for (const m of stored.weekly.missions) {
        if (!m.completed && m.targetAction === actionKey) {
          m.currentCount = Math.min(m.currentCount + 1, m.targetCount);
          if (m.currentCount >= m.targetCount) {
            m.completed = true;
            m.completedAt = new Date().toISOString();
            completedMission = m;
          }
          break;
        }
      }
    }

    // Check daily all-clear
    dailyAllClear = stored.daily.missions.every(m => m.completed);

    // Track daily all-clear for weekly mission
    if (dailyAllClear && !stored.daily.bonusClaimed) {
      for (const m of stored.weekly.missions) {
        if (!m.completed && m.targetAction === 'daily_all_clear') {
          m.currentCount = Math.min(m.currentCount + 1, m.targetCount);
          if (m.currentCount >= m.targetCount) {
            m.completed = true;
            m.completedAt = new Date().toISOString();
          }
        }
      }
    }

    saveStored(stored);
    return { completedMission, dailyAllClear };
  },

  /** Claim daily bonus (when all daily missions complete) */
  claimDailyBonus(): boolean {
    const stored = loadStored();
    if (!stored) return false;
    const allDone = stored.daily.missions.every(m => m.completed);
    if (!allDone || stored.daily.bonusClaimed) return false;
    stored.daily.bonusClaimed = true;
    saveStored(stored);
    return true;
  },

  /** Claim weekly bonus */
  claimWeeklyBonus(): boolean {
    const stored = loadStored();
    if (!stored) return false;
    const allDone = stored.weekly.missions.every(m => m.completed);
    if (!allDone || stored.weekly.bonusClaimed) return false;
    stored.weekly.bonusClaimed = true;
    saveStored(stored);
    return true;
  },

  /** Get completion stats */
  getStats(): { dailyDone: number; dailyTotal: number; weeklyDone: number; weeklyTotal: number; dailyBonusClaimed: boolean; weeklyBonusClaimed: boolean } {
    const stored = loadStored();
    if (!stored) return { dailyDone: 0, dailyTotal: 0, weeklyDone: 0, weeklyTotal: 0, dailyBonusClaimed: false, weeklyBonusClaimed: false };
    return {
      dailyDone: stored.daily.missions.filter(m => m.completed).length,
      dailyTotal: stored.daily.missions.length,
      weeklyDone: stored.weekly.missions.filter(m => m.completed).length,
      weeklyTotal: stored.weekly.missions.length,
      dailyBonusClaimed: stored.daily.bonusClaimed,
      weeklyBonusClaimed: stored.weekly.bonusClaimed,
    };
  },
};
