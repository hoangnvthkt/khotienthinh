// ══════════════════════════════════════════
//  MOTIVATIONAL UX — Fun copy, mood system
// ══════════════════════════════════════════

// ── Mood Themes ──
export type Mood = 'happy' | 'focus' | 'calm';

export const MOOD_THEMES: Record<Mood, { label: string; emoji: string; accent: string; description: string }> = {
  happy: { label: 'Vui vẻ', emoji: '🌈', accent: '#f59e0b', description: 'Màu sắc rực rỡ, năng lượng tích cực' },
  focus: { label: 'Tập trung', emoji: '🎯', accent: '#6366f1', description: 'Tối giản, tập trung công việc' },
  calm: { label: 'Bình yên', emoji: '🌊', accent: '#06b6d4', description: 'Nhẹ nhàng, thư giãn' },
};

// ── Weekend/Holiday bonus messages ──
export const WEEKEND_BONUS = {
  isWeekend: () => {
    const day = new Date().getDay();
    return day === 0 || day === 6;
  },
  getMessage: () => {
    const messages = [
      'Cuối tuần mà vẫn cày! 🌟 Bạn nhận +10 XP bonus!',
      'Weekend warrior! 💪 +10 XP cho sự chăm chỉ!',
      'Wow, không nghỉ! 🔥 +10 XP đặc biệt!',
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  },
  xpBonus: 10,
};

// ── Level-up celebration phrases ──
export const LEVEL_UP_PHRASES: Record<number, string> = {
  2: 'Đã quen việc rồi! Tiếp tục phát huy nhé! 🌿',
  3: 'Chuyên cần quá! Bạn đang trên đà tuyệt vời! ⭐',
  4: 'Thành thạo rồi! Ai cũng phải nể bạn! 🌟',
  5: 'Chuyên gia chính hiệu! Tự hào về bạn lắm! 💫',
  6: 'Bậc thầy! Bạn là legend rồi đấy! 🔥',
  7: 'Huyền thoại đã xuất hiện! 👑',
  8: 'Siêu nhân! Không ai cản nổi bạn! 🦸',
  9: 'Phi thường! Bạn đã vượt qua mọi giới hạn! 💎',
  10: 'BẤT KHẢ CHIẾN BẠI! Đỉnh nóc kịch tần! 🏆',
};

// ── Progress milestones ──
export const XP_MILESTONES = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

// ── Fun action responses ──
export const ACTION_RESPONSES: Record<string, string[]> = {
  approve: [
    'Duyệt rồi! ✅ Nhanh gọn lẹ!',
    'Phiếu đã được phê duyệt! 👍 Giỏi lắm!',
    'Approved! 🎉 Bạn xử lý nhanh thật!',
  ],
  reject: [
    'Đã từ chối phiếu. 📋 Lý do rõ ràng!',
    'Rejected! ❌ Cần chỉnh sửa lại nhé.',
  ],
  create: [
    'Tạo thành công! 🎊 Thêm một sản phẩm nữa!',
    'Done! ✨ Phiếu mới đã sẵn sàng!',
    'Tuyệt! 🚀 Đã thêm vào hệ thống!',
  ],
  checkin: [
    'Check-in thành công! ⏰ Đúng giờ quá!',
    'Chấm công rồi! ✅ Ngày mới tốt lành!',
    'Đã ghi nhận! 📍 Bạn siêng năng quá!',
  ],
};

export const getActionResponse = (action: string): string => {
  const responses = ACTION_RESPONSES[action];
  if (!responses) return 'Thành công! ✅';
  return responses[Math.floor(Math.random() * responses.length)];
};

// ── Mood persistence ──
export const getMood = (): Mood => {
  return (localStorage.getItem('vioo_mood') as Mood) || 'focus';
};

export const setMood = (mood: Mood) => {
  localStorage.setItem('vioo_mood', mood);
};
