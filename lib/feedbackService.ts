export type FeedbackStatus = 'new' | 'triaged' | 'in_progress' | 'resolved' | 'closed';
export type FeedbackPriority = 'low' | 'medium' | 'high' | 'critical';

export type FeedbackItem = {
  id: string;
  code: string;
  title: string;
  description: string;
  module: string;
  priority: FeedbackPriority;
  status: FeedbackStatus;
  reporterId?: string;
  reporterName: string;
  assigneeName?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type FeedbackCreateInput = Pick<FeedbackItem, 'title' | 'description' | 'module' | 'priority' | 'reporterId' | 'reporterName'>;
export type FeedbackUpdateInput = Partial<Pick<FeedbackItem, 'title' | 'description' | 'module' | 'priority' | 'status' | 'assigneeName' | 'note'>>;

const STORAGE_KEY = 'vioo_feedback_items_v1';

const readItems = (): FeedbackItem[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeItems = (items: FeedbackItem[]) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
};

const nextCode = (items: FeedbackItem[]) => `FB-${String(items.length + 1).padStart(4, '0')}`;

export const feedbackService = {
  async list(): Promise<FeedbackItem[]> {
    return readItems().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  async create(input: FeedbackCreateInput): Promise<FeedbackItem> {
    const items = readItems();
    const now = new Date().toISOString();
    const item: FeedbackItem = {
      id: crypto.randomUUID(),
      code: nextCode(items),
      title: input.title.trim(),
      description: input.description.trim(),
      module: input.module,
      priority: input.priority,
      status: 'new',
      reporterId: input.reporterId,
      reporterName: input.reporterName,
      createdAt: now,
      updatedAt: now,
    };
    writeItems([item, ...items]);
    return item;
  },

  async update(id: string, input: FeedbackUpdateInput): Promise<FeedbackItem | null> {
    const items = readItems();
    let updated: FeedbackItem | null = null;
    const next = items.map(item => {
      if (item.id !== id) return item;
      updated = { ...item, ...input, updatedAt: new Date().toISOString() };
      return updated;
    });
    writeItems(next);
    return updated;
  },

  async remove(id: string): Promise<void> {
    writeItems(readItems().filter(item => item.id !== id));
  },
};
