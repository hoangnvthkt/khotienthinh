// ══════════════════════════════════════════
//  FUN MESSAGES — Greeting, Loading, Motivation
// ══════════════════════════════════════════

// ── Time-based Greetings ──
const MORNING_GREETINGS = [
  'Chào buổi sáng! ☀️ Hôm nay sẽ là ngày tuyệt vời!',
  'Good morning! 🌅 Cà phê xong chưa, bắt đầu thôi!',
  'Sáng rồi! 🐓 Năng suất hôm nay x2 nhé!',
  'Ohayo! ☀️ Ngày mới, năng lượng mới!',
  'Chào sếp! ☕ Uống cà phê rồi chiến thôi!',
];

const AFTERNOON_GREETINGS = [
  'Buổi chiều vui vẻ! 🌤️ Cố gắng thêm nào!',
  'Good afternoon! 🌞 Hết nửa ngày rồi, giỏi lắm!',
  'Chiều rồi! 🍵 Nghỉ ngơi chút rồi tiếp tục nha!',
  'Keep going! 💪 Bạn đang làm rất tốt!',
  'Hơn nửa ngày rồi! 🎯 Sắp hoàn thành nhiệm vụ!',
];

const EVENING_GREETINGS = [
  'Buổi tối rồi! 🌙 Cảm ơn vì sự chăm chỉ!',
  'Good evening! ✨ Hôm nay bạn thật tuyệt!',
  'Tối rồi à! 🌃 Nghỉ ngơi sớm nhé, mai chiến tiếp!',
  'Wow, vẫn còn làm! 🦉 Bạn siêng năng quá!',
  'Muộn rồi đấy! 😴 Về nhà nghỉ thôi nào!',
];

const WEEKEND_GREETINGS = [
  'Cuối tuần mà vẫn vào! 🌟 Chăm chỉ quá trời!',
  'Weekend warrior! 💪 Bạn thật sự rất ngầu!',
  'Wow, cuối tuần còn cày! 🎖️ Respect!',
  'Cuối tuần vui vẻ! 🎉 Tranh thủ nghỉ ngơi nha!',
];

// ── Fun Loading Messages ──
export const LOADING_MESSAGES = [
  'Đang pha cà phê cho bạn... ☕',
  'Đang xếp gạch... 🧱',
  'Sắp xong rồi, kiên nhẫn nào 😊',
  'Đang tính toán vũ trụ... 🌌',
  'Loading... nhưng nhanh thôi! ⚡',
  'Đang gọi anh IT... 👨‍💻',
  'Chờ xíu, AI đang suy nghĩ... 🤔',
  'Đang sắp xếp dữ liệu gọn gàng... 📦',
  'Vui lòng đợi, đang phóng tên lửa... 🚀',
  'Quay tay phát điện... ⚙️',
  'Đang cho hamster chạy nhanh hơn... 🐹',
  'Almost there! Đợi chút xíu nha! 🏁',
  'Chuẩn bị rồi nè... 3... 2... 1... 🔥',
  'Đang warm-up cho server... 🏋️',
];

// ── Motivational Quotes ──
export const MOTIVATIONAL_QUOTES = [
  { text: 'Bắt đầu từ việc nhỏ, thành công từ sự kiên trì.', author: 'Vioo' },
  { text: 'Mỗi ngày một bước, xa dần mục tiêu sẽ tới.', author: 'Vioo' },
  { text: 'Kỷ luật là cầu nối giữa mục tiêu và thành công.', author: 'Jim Rohn' },
  { text: 'Công việc tốt nhất là công việc bạn yêu thích.', author: 'Confucius' },
  { text: 'Đừng sợ chậm, chỉ sợ dừng lại.', author: 'Tục ngữ' },
  { text: 'Hành trình ngàn dặm bắt đầu từ một bước chân.', author: 'Lão Tử' },
  { text: 'Ngày hôm nay khó khăn, ngày mai sẽ dễ dàng hơn.', author: 'Jack Ma' },
  { text: 'Không có gì là không thể nếu bạn đủ quyết tâm.', author: 'Napoleon' },
];

// ── Empty State Messages ──
export const EMPTY_STATE_MESSAGES: Record<string, { emoji: string; title: string; subtitle: string }> = {
  inventory: { emoji: '📦', title: 'Kho trống trơn!', subtitle: 'Thêm vật tư đầu tiên để bắt đầu quản lý nào!' },
  requests: { emoji: '📋', title: 'Chưa có yêu cầu nào!', subtitle: 'Tạo yêu cầu đầu tiên, đội ngũ sẵn sàng hỗ trợ!' },
  employees: { emoji: '👥', title: 'Chưa có nhân sự!', subtitle: 'Thêm nhân viên đầu tiên vào đội ngũ nào!' },
  notifications: { emoji: '🔔', title: 'Yên ắng quá!', subtitle: 'Không có thông báo mới. Tận hưởng sự bình yên!' },
  chat: { emoji: '💬', title: 'Chưa có tin nhắn!', subtitle: 'Bắt đầu cuộc trò chuyện đầu tiên nào!' },
  missions: { emoji: '🎯', title: 'Hết nhiệm vụ rồi!', subtitle: 'Giỏi quá! Quay lại ngày mai nhé!' },
  leaderboard: { emoji: '🏆', title: 'Chưa có ai xếp hạng!', subtitle: 'Bạn sẽ là người đầu tiên!' },
};

// ── Helper Functions ──
export const getTimeGreeting = (): string => {
  const hour = new Date().getHours();
  const dayOfWeek = new Date().getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  if (isWeekend) {
    return WEEKEND_GREETINGS[Math.floor(Math.random() * WEEKEND_GREETINGS.length)];
  }
  if (hour < 12) {
    return MORNING_GREETINGS[Math.floor(Math.random() * MORNING_GREETINGS.length)];
  }
  if (hour < 17) {
    return AFTERNOON_GREETINGS[Math.floor(Math.random() * AFTERNOON_GREETINGS.length)];
  }
  return EVENING_GREETINGS[Math.floor(Math.random() * EVENING_GREETINGS.length)];
};

export const getRandomLoadingMessage = (): string => {
  return LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
};

export const getRandomQuote = () => {
  return MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
};

export const getEmptyState = (key: string) => {
  return EMPTY_STATE_MESSAGES[key] || { emoji: '📭', title: 'Chưa có dữ liệu', subtitle: 'Hãy thêm dữ liệu đầu tiên!' };
};
