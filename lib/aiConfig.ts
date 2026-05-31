export interface AiModelOption {
  id: string;
  name: string;
  provider: string;
  description: string;
  icon: string;
}

export const AVAILABLE_AI_MODELS: AiModelOption[] = [
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    description: 'Tốc độ cực nhanh, phù hợp cho hầu hết các câu hỏi thông thường.',
    icon: '⚡',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    description: 'Trí tuệ vượt trội, phù hợp cho các câu hỏi phức tạp, so sánh và lập luận sâu.',
    icon: '🧠',
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    provider: 'Google',
    description: 'Mẫu nhanh thế hệ trước, độ trễ thấp.',
    icon: '⏳',
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'Google',
    description: 'Mẫu lập luận thế hệ trước, xử lý ngữ cảnh lớn tốt.',
    icon: '📚',
  },
];

export const DEFAULT_AI_MODEL = 'gemini-2.5-flash';
