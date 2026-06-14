import { beforeEach, describe, expect, it, vi } from 'vitest';

let votes: any[] = [];
const calls: any[] = [];

class MockQuery {
  private filters: Record<string, any> = {};
  private operation: 'select' | 'insert' | 'delete' = 'select';
  private payload: any = null;

  constructor(private readonly tableName: string) {}

  select() { return this; }

  insert(payload: any) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column: string, value: any) {
    this.filters[column] = value;
    return this;
  }

  maybeSingle() {
    const row = this.rows()[0] || null;
    return Promise.resolve({ data: row, error: null });
  }

  then(resolve: any, reject: any) {
    return Promise.resolve(this.execute()).then(resolve, reject);
  }

  private rows() {
    if (this.tableName !== 'feedback_votes') return [];
    return votes.filter(row => Object.entries(this.filters).every(([key, value]) => row[key] === value));
  }

  private execute() {
    calls.push({ tableName: this.tableName, operation: this.operation, payload: this.payload, filters: this.filters });
    if (this.tableName !== 'feedback_votes') return { data: [], error: null };
    if (this.operation === 'insert') {
      votes.push({ id: `vote-${votes.length + 1}`, ...this.payload });
      return { data: [this.payload], error: null };
    }
    if (this.operation === 'delete') {
      const rows = this.rows();
      const ids = new Set(rows.map(row => row.id));
      votes = votes.filter(row => !ids.has(row.id));
      return { data: rows, error: null };
    }
    return { data: this.rows(), error: null };
  }
}

vi.doMock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: 'auth-user-1' } } }, error: null })),
    },
    rpc: vi.fn(() => Promise.resolve({ data: 'user-1', error: null })),
    from: vi.fn((tableName: string) => new MockQuery(tableName)),
  },
}));

beforeEach(() => {
  votes = [];
  calls.length = 0;
});

describe('feedbackService helpers', () => {
  it('maps feedback rows from snake_case', async () => {
    const { mapFeedbackItemFromDb } = await import('../feedbackService');
    const item = mapFeedbackItemFromDb({
      id: 'fb-1',
      title: 'Lỗi mobile',
      description: 'Không mở được màn hình kho',
      type: 'bug',
      module: 'mobile',
      impact_level: 'high',
      priority: 'medium',
      status: 'new',
      visibility: 'public',
      created_by: 'user-1',
      assigned_to: null,
      related_route: '/inventory',
      device_info: { platform: 'iOS' },
      app_version: '1.0.0',
      created_at: '2026-06-14T03:00:00.000Z',
      updated_at: '2026-06-14T03:00:00.000Z',
      last_activity_at: '2026-06-14T03:00:00.000Z',
    });

    expect(item).toMatchObject({
      id: 'fb-1',
      impactLevel: 'high',
      createdBy: 'user-1',
      relatedRoute: '/inventory',
      deviceInfo: { platform: 'iOS' },
      voteCount: 0,
      hasVoted: false,
    });
  });

  it('filters by exact fields and diacritic-insensitive search', async () => {
    const { filterFeedbackItems, mapFeedbackItemFromDb } = await import('../feedbackService');
    const items = [
      mapFeedbackItemFromDb({
        id: 'fb-1',
        title: 'Cải thiện giao diện BOQ',
        description: 'Nút lưu khó nhìn',
        type: 'ui',
        module: 'boq',
        impact_level: 'medium',
        priority: 'high',
        status: 'planned',
        visibility: 'public',
        created_by: 'user-1',
        created_at: '2026-06-14T03:00:00.000Z',
        updated_at: '2026-06-14T03:00:00.000Z',
      }),
      mapFeedbackItemFromDb({
        id: 'fb-2',
        title: 'Lỗi kho',
        description: 'Không nhập được vật tư',
        type: 'bug',
        module: 'warehouse',
        impact_level: 'urgent',
        priority: 'urgent',
        status: 'new',
        visibility: 'public',
        created_by: 'user-2',
        created_at: '2026-06-14T03:00:00.000Z',
        updated_at: '2026-06-14T03:00:00.000Z',
      }),
    ];

    expect(filterFeedbackItems(items, { search: 'giao dien', type: 'ui', priority: 'high' }).map(item => item.id)).toEqual(['fb-1']);
    expect(filterFeedbackItems(items, { module: 'warehouse', status: 'planned' })).toHaveLength(0);
  });

  it('builds admin update payload with only allowed fields', async () => {
    const { buildFeedbackAdminUpdatePayload } = await import('../feedbackService');

    expect(buildFeedbackAdminUpdatePayload({
      status: 'rejected',
      priority: 'urgent',
      rejectedReason: 'Trùng góp ý khác',
    })).toEqual({
      status: 'rejected',
      priority: 'urgent',
      rejected_reason: 'Trùng góp ý khác',
    });

    expect(buildFeedbackAdminUpdatePayload({ status: 'done', rejectedReason: 'old' })).toEqual({
      status: 'done',
      rejected_reason: null,
    });

    expect(buildFeedbackAdminUpdatePayload({
      dueAt: '2026-06-20T00:00:00.000Z',
      targetRelease: ' V3.1 ',
      roadmapStage: 'planned',
      tags: [' mobile ', 'mobile', 'ux'],
    })).toEqual({
      due_at: '2026-06-20T00:00:00.000Z',
      target_release: 'V3.1',
      roadmap_stage: 'planned',
      tags: ['mobile', 'ux'],
    });
  });

  it('builds safe attachment storage paths and maps attachment rows', async () => {
    const {
      buildFeedbackAttachmentStoragePath,
      mapFeedbackAttachmentFromDb,
      sanitizeFeedbackAttachmentFileName,
    } = await import('../feedbackService');

    expect(sanitizeFeedbackAttachmentFileName('Ảnh lỗi mobile #1.png')).toBe('Anh-loi-mobile-1.png');
    expect(buildFeedbackAttachmentStoragePath('fb-1', 'att-1', 'Ảnh lỗi mobile #1.png')).toBe('feedback/fb-1/att-1-Anh-loi-mobile-1.png');

    expect(mapFeedbackAttachmentFromDb({
      id: 'att-1',
      feedback_id: 'fb-1',
      comment_id: null,
      uploaded_by: 'user-1',
      storage_bucket: 'feedback-attachments',
      storage_path: 'feedback/fb-1/att-1-image.png',
      file_name: 'image.png',
      mime_type: 'image/png',
      file_size: 1234,
      metadata: { width: 100 },
      created_at: '2026-06-14T04:00:00.000Z',
    })).toMatchObject({
      id: 'att-1',
      feedbackId: 'fb-1',
      uploadedBy: 'user-1',
      kind: 'image',
      fileSize: 1234,
      metadata: { width: 100 },
    });
  });

  it('creates feedback with a non-returning insert payload', async () => {
    const { feedbackService } = await import('../feedbackService');

    const created = await feedbackService.createItem({
      title: 'Lỗi tạo góp ý',
      description: 'Tạo mới không được vì RLS.',
      type: 'bug',
      module: 'other',
      impactLevel: 'high',
      visibility: 'public',
      createdBy: 'stale-user-id',
      relatedRoute: '/feedback',
      deviceInfo: { platform: 'test' },
      appVersion: 'test',
    });

    const insertCall = calls.find(call => call.tableName === 'feedback_items' && call.operation === 'insert');
    expect(insertCall?.payload).toMatchObject({
      id: created.id,
      created_by: 'user-1',
      priority: 'medium',
      status: 'new',
      assigned_to: null,
      visibility: 'public',
    });
    expect(created.createdBy).toBe('user-1');
    expect(created.status).toBe('new');
  });

  it('builds board groups, dashboard metrics, and roadmap ordering', async () => {
    const {
      buildFeedbackDashboardMetrics,
      getFeedbackRoadmapItems,
      groupFeedbackByStatus,
      mapFeedbackItemFromDb,
    } = await import('../feedbackService');
    const items = [
      mapFeedbackItemFromDb({
        id: 'fb-1',
        title: 'Urgent bug',
        description: 'Bug',
        type: 'bug',
        module: 'mobile',
        impact_level: 'urgent',
        priority: 'urgent',
        status: 'planned',
        visibility: 'public',
        created_by: 'user-1',
        roadmap_stage: 'planned',
        vote_count: 5,
        due_at: '2026-06-01T00:00:00.000Z',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-02T00:00:00.000Z',
        last_activity_at: '2026-06-02T00:00:00.000Z',
      }),
      mapFeedbackItemFromDb({
        id: 'fb-2',
        title: 'Done feature',
        description: 'Done',
        type: 'feature',
        module: 'boq',
        impact_level: 'medium',
        priority: 'medium',
        status: 'done',
        visibility: 'public',
        created_by: 'user-2',
        completed_at: '2026-06-03T00:00:00.000Z',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-03T00:00:00.000Z',
        last_activity_at: '2026-06-03T00:00:00.000Z',
      }),
      mapFeedbackItemFromDb({
        id: 'fb-3',
        title: 'High UI',
        description: 'UI',
        type: 'ui',
        module: 'mobile',
        impact_level: 'high',
        priority: 'high',
        status: 'planned',
        visibility: 'public',
        created_by: 'user-1',
        roadmap_stage: 'planned',
        vote_count: 1,
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-04T00:00:00.000Z',
        last_activity_at: '2026-06-04T00:00:00.000Z',
      }),
    ];

    expect(groupFeedbackByStatus(items).get('planned')?.map(item => item.id)).toEqual(['fb-1', 'fb-3']);
    expect(getFeedbackRoadmapItems(items).map(item => item.id)).toEqual(['fb-1', 'fb-3', 'fb-2']);
    const metrics = buildFeedbackDashboardMetrics(items);
    expect(metrics).toMatchObject({
      total: 3,
      open: 2,
      done: 1,
      urgentHighBugs: 1,
      overdue: 1,
      averageResolutionHours: 48,
    });
    expect(metrics.topModules[0]).toEqual({ module: 'mobile', count: 2 });
    expect(metrics.topContributors[0]).toEqual({ userId: 'user-1', count: 2 });
  });
});

describe('feedbackService vote toggle', () => {
  it('inserts a vote when the user has not voted', async () => {
    const { feedbackService } = await import('../feedbackService');
    const hasVoted = await feedbackService.toggleVote('fb-1', 'user-1');

    expect(hasVoted).toBe(true);
    expect(votes).toHaveLength(1);
    expect(votes[0]).toMatchObject({ feedback_id: 'fb-1', user_id: 'user-1' });
  });

  it('deletes an existing vote for the same user', async () => {
    votes = [{ id: 'vote-1', feedback_id: 'fb-1', user_id: 'user-1' }];

    const { feedbackService } = await import('../feedbackService');
    const hasVoted = await feedbackService.toggleVote('fb-1', 'user-1');

    expect(hasVoted).toBe(false);
    expect(votes).toHaveLength(0);
    expect(calls.some(call => call.operation === 'delete' && call.filters.id === 'vote-1')).toBe(true);
  });
});
