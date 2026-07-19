import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc },
}));

const importService = async () => import('../permissions/permissionQuickTemplateService');

describe('permissionQuickTemplateService', () => {
  beforeEach(() => {
    vi.resetModules();
    rpc.mockReset();
  });

  it('lists templates from the governed RPC and maps permissionCodes', async () => {
    rpc.mockResolvedValue({
      data: [{
        id: 'template-1',
        code: 'field_engineer',
        name: 'Ky su',
        description: null,
        isActive: true,
        permissionCodes: ['project.daily_log.view'],
        updatedAt: '2026-07-19T00:00:00.000Z',
      }],
      error: null,
    });

    const { permissionQuickTemplateService } = await importService();
    await expect(permissionQuickTemplateService.list()).resolves.toEqual([{
      id: 'template-1',
      code: 'field_engineer',
      name: 'Ky su',
      description: undefined,
      isActive: true,
      permissionCodes: ['project.daily_log.view'],
      updatedAt: '2026-07-19T00:00:00.000Z',
    }]);
    expect(rpc).toHaveBeenCalledWith('list_permission_quick_templates');
  });

  it('saves through the governed RPC without actor payload or role assignment fields', async () => {
    rpc.mockResolvedValue({ data: 'template-1', error: null });
    const { permissionQuickTemplateService } = await importService();

    await expect(permissionQuickTemplateService.save({
      templateId: null,
      code: 'field_engineer',
      name: 'Ky su',
      description: 'Preset du an',
      permissionCodes: ['project.daily_log.view', 'project.daily_log.create'],
      reason: 'Tao mau ky su du an',
    })).resolves.toBe('template-1');

    expect(rpc).toHaveBeenCalledWith('save_permission_quick_template', {
      p_template_id: null,
      p_code: 'field_engineer',
      p_name: 'Ky su',
      p_description: 'Preset du an',
      p_permission_codes: ['project.daily_log.view', 'project.daily_log.create'],
      p_reason: 'Tao mau ky su du an',
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/actor|principal_role_assignments|role_template_id/);
  });

  it('deactivates through the governed RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { permissionQuickTemplateService } = await importService();

    await expect(permissionQuickTemplateService.deactivate('template-1', 'Ngung dung mau cu')).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith('deactivate_permission_quick_template', {
      p_template_id: 'template-1',
      p_reason: 'Ngung dung mau cu',
    });
  });
});
