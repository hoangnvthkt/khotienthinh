import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { requestTemplateService } from '../requestTemplateService';

describe('requestTemplateService', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('publishes through the atomic template command', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        requestTemplateId: 'rt-1',
        requestTemplateVersionId: 'rtv-1',
        versionNumber: 1,
        workflowTemplateId: 'wf-1',
        workflowTemplateVersionId: 'wfv-1',
      },
      error: null,
    });

    await requestTemplateService.publish({
      templateId: 'rt-1',
      expectedUpdatedAt: '2026-07-28T10:00:00.000Z',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('publish_request_template_version', {
      p_request_template_id: 'rt-1',
      p_expected_updated_at: '2026-07-28T10:00:00.000Z',
    });
  });

  it('forwards draft, list, clone, deactivate and resolver preview commands', async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    const draft = {
      name: 'Access request',
      description: '',
      formSchema: [],
      usageScope: { companyWide: true, orgUnitIds: [], permissionCodes: [], userIds: [] },
      flowMode: 'SEQUENTIAL' as const,
      completionPolicy: 'ALL' as const,
      blocks: [],
      watcherUserIds: [],
      printConfig: { browserPrintEnabled: true, docxStoragePath: null },
      notificationConfig: {},
    };

    await requestTemplateService.getDraft('rt-1');
    await requestTemplateService.list({ status: 'DRAFT', search: 'access' });
    await requestTemplateService.saveDraft(draft);
    await requestTemplateService.createDraftFromPublished('rt-1');
    await requestTemplateService.deactivate({
      templateId: 'rt-1',
      expectedUpdatedAt: '2026-07-28T10:00:00.000Z',
    });
    await requestTemplateService.previewResolvers(draft, 'creator-1');

    expect(mocks.rpc.mock.calls).toEqual([
      ['get_request_template_draft', { p_request_template_id: 'rt-1' }],
      ['list_request_templates', { p_filters: { status: 'DRAFT', search: 'access' } }],
      ['save_request_template_draft', { p_payload: draft }],
      ['create_request_template_draft_from_published', { p_request_template_id: 'rt-1' }],
      ['deactivate_request_template', {
        p_request_template_id: 'rt-1',
        p_expected_updated_at: '2026-07-28T10:00:00.000Z',
      }],
      ['preview_request_template_resolvers', {
        p_payload: draft,
        p_sample_creator_id: 'creator-1',
      }],
    ]);
  });

  it('surfaces RPC errors and empty data', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'conflict' } });
    await expect(requestTemplateService.getDraft('rt-1')).rejects.toEqual({ message: 'conflict' });

    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(requestTemplateService.getDraft('rt-1')).rejects.toThrow(
      'get_request_template_draft không trả về dữ liệu.',
    );
  });
});
