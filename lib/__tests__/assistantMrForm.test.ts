import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), nextCode: vi.fn(), getById: vi.fn(), getProjectCatalog: vi.fn(),
  getConfiguration: vi.fn(), getTemplateStartContext: vi.fn(), startWorkflow: vi.fn(), listRecipients: vi.fn(),
}));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock('../materialRequestService', () => ({
  materialRequestService: { nextCode: mocks.nextCode, getById: mocks.getById, getProjectCatalog: mocks.getProjectCatalog },
  getMaterialRequestWorkflowPatch: (step: string, userId: string) => ({ workflowStep: step, workflowStepActorUserId: userId }),
}));
vi.mock('../projectWorkflowService', () => ({
  projectWorkflowService: { getConfiguration: mocks.getConfiguration, getTemplateStartContext: mocks.getTemplateStartContext, startMaterialRequestWorkflowV2: mocks.startWorkflow },
}));
vi.mock('../projectPermissionRoomService', () => ({ projectPermissionRoomService: { listRecipients: mocks.listRecipients } }));

import { MaterialRequestFulfillmentMode, RequestStatus } from '../../types';
import { OUTSIDE_BOQ_BUDGET, toMaterialRequestRecord, toRequestItem } from '../materialRequestBuild';
import { MaterialRequestNotSavedError, saveAndStartWorkflow, toSubmittedProjectRequest } from '../materialRequestSend';
import { chooseItem, createMrFormActions, formProblems, parseQty, searchCatalog, toFormRows, type MrCatalogItem } from '../assistantMrForm';
import { parseCommand } from '../assistantCommands';

afterEach(() => { Object.values(mocks).forEach(m => m.mockReset()); });

const CATALOG: MrCatalogItem[] = [
  { id: 'xm', name: 'Xi măng PCB40', unit: 'Tấn', sku: 'VT00045' },
  { id: 'd16-cay', name: 'Thép XD D16', unit: 'Cây', sku: 'T16' },
  { id: 'd16-kg', name: 'Thép tròn trơn D16', unit: 'Kg', sku: 'TT16' },
  { id: 'pvc42', name: 'Ống PVC 42', unit: 'Cây' },
  { id: 'pvc34', name: 'Ống PVC 34', unit: 'Mét' },
  { id: 'pvc140', name: 'Ống PVC 140', unit: 'Cây' },
  { id: 'old', name: 'Xi măng PCB40 cũ', unit: 'Tấn', status: 'retired' },
];
const LINES = [
  { name: 'Xi măng PCB40', spec: null, qty: 2, unit: 'tấn', note: null },
  { name: 'Thép', spec: 'D16', qty: 50, unit: 'cây', note: null },
  { name: 'Ống PVC', spec: null, qty: 20, unit: 'cây', note: 'tầng 4' },
];
const COMMAND = parseCommand({ id: 'cmd-1', kind: 'material_request', status: 'prepared', title: 'Đề xuất vật tư SMB-2026', createdAt: '2026-10-18T02:00:00Z',
  payload: { projectId: 'p-smb', projectCode: 'SMB-2026', siteId: 's-1', title: 'Vật tư sàn tầng 4', purpose: 'Đổ sàn tầng 4', neededDate: '2026-10-23', lines: LINES } })!;

describe('Dựng phiếu đề xuất dùng chung (form Đề xuất + form trong chat)', () => {
  it('dòng ngoài BOQ: số chụp BOQ = 0, lý do ngoài BOQ ghi cả overReason, snapshot tên / ĐV / mã theo danh mục', () => {
    const item = toRequestItem({ lineId: 'l1', itemId: 'xm', qty: '2,5', specification: ' bao 50kg ', overBudgetReason: 'Đổ sàn' }, OUTSIDE_BOQ_BUDGET, CATALOG[0]);
    expect(item).toMatchObject({ lineId: 'l1', itemId: 'xm', requestQty: 2.5, approvedQty: 0, workBoqItemId: null, materialBudgetItemId: null,
      budgetQtySnapshot: 0, isOverBoq: false, overQty: 0, overReason: 'Đổ sàn', overBudgetReason: 'Đổ sàn', isManualItem: false,
      itemNameSnapshot: 'Xi măng PCB40', unitSnapshot: 'Tấn', skuSnapshot: 'VT00045', specification: 'bao 50kg' });
  });

  it('phiếu nháp: trạng thái Nháp, chưa giao ai, nhật ký "tạo nháp"; sửa nháp cũ thì giữ id + nhật ký cũ', () => {
    const base = { code: 'MR-1', title: '  ', projectId: 'p', constructionSiteId: 's', requestOrigin: 'project' as const, siteWarehouseId: 'wh', requesterId: 'u1',
      workflowPatch: { workflowStep: 'draft' as const }, now: '2026-10-18T03:00:00Z', expectedDate: '2026-10-23T00:00:00Z', note: '', fulfillmentMode: MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
      items: [], userId: 'u1' };
    const fresh = toMaterialRequestRecord(base);
    expect(fresh).toMatchObject({ code: 'MR-1', title: 'Đề xuất vật tư', status: RequestStatus.DRAFT, submittedToUserId: null, workflowStep: 'draft', requesterId: 'u1',
      logs: [{ action: 'CREATED_DRAFT', userId: 'u1' }] });
    const again = toMaterialRequestRecord({ ...base, base: { ...fresh, id: 'mr-old', requesterId: 'u0' } });
    expect(again).toMatchObject({ id: 'mr-old', requesterId: 'u0', logs: [{ action: 'CREATED_DRAFT' }, { action: 'UPDATED_DRAFT' }] });
  });

  it('gửi duyệt: ghi "đã gửi", lưu bằng hàm của app rồi bắt đầu workflow với người duyệt đã chọn; lưu hỏng → báo, không bắt đầu workflow', async () => {
    const draft = toMaterialRequestRecord({ code: 'MR-2', title: 'X', projectId: 'p', requestOrigin: 'project', siteWarehouseId: 'wh', requesterId: 'u1', workflowPatch: {},
      now: '2026-10-18T03:00:00Z', fulfillmentMode: MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK, items: [], userId: 'u1' });
    const sent = toSubmittedProjectRequest(draft, 'u1', 'nhờ duyệt sớm', '2026-10-18T03:05:00Z');
    expect(sent).toMatchObject({ status: RequestStatus.DRAFT, workflowStep: 'draft', lastActionBy: 'u1' });
    expect(sent.logs?.at(-1)).toEqual({ action: 'SUBMITTED', userId: 'u1', timestamp: '2026-10-18T03:05:00Z', note: 'nhờ duyệt sớm' });
    const addRequest = vi.fn().mockResolvedValue(true);
    mocks.getById.mockResolvedValue({ ...sent, workflowStep: 'site_manager_review' });
    const saved = await saveAndStartWorkflow(sent, { workflowTemplateId: 'tpl' }, { userId: 'a', userIds: ['a', 'b'], note: 'gấp' }, { addRequest });
    expect(addRequest).toHaveBeenCalledWith(sent);
    expect(mocks.startWorkflow).toHaveBeenCalledWith({ requestId: sent.id, templateId: 'tpl', firstAssigneeUserIds: ['a', 'b'], comment: 'gấp' });
    expect(saved.workflowStep).toBe('site_manager_review');
    mocks.startWorkflow.mockReset();
    await expect(saveAndStartWorkflow(sent, { workflowTemplateId: 'tpl' }, { userId: 'a' }, { addRequest: vi.fn().mockResolvedValue(false) })).rejects.toBeInstanceOf(MaterialRequestNotSavedError);
    expect(mocks.startWorkflow).not.toHaveBeenCalled();
  });
});

describe('Form đề xuất trong chat', () => {
  it('khớp mã như Gõ nhanh: trùng khít chọn sẵn, đơn vị phân định (cây → Thép XD), mơ hồ để chọn; bỏ mã ngừng dùng', () => {
    const rows = toFormRows(LINES, CATALOG);
    expect(rows.map(r => r.itemId)).toEqual(['xm', 'd16-cay', null]);
    expect(rows[0].qty).toBe('2');
    expect(rows[2].candidates.length).toBeGreaterThan(1);
    expect(rows[2].reason).toBe('tầng 4');
    expect(rows.flatMap(r => r.candidates.map(c => c.item.id))).not.toContain('old');
    // Chọn mã khác đơn vị (Mét) mà câu không ghi số theo mét → để trống bắt nhập lại.
    expect(chooseItem(rows[2], CATALOG[4]).qty).toBe('');
    expect(chooseItem(rows[2], CATALOG[3])).toMatchObject({ itemId: 'pvc42', qty: '20' });
    expect(searchCatalog('pvc 140', CATALOG).map(i => i.id)[0]).toBe('pvc140');
    expect(searchCatalog('p', CATALOG)).toEqual([]);
    expect(parseQty('2,5')).toBe(2.5);
    expect(parseQty('1.200')).toBe(1200);
  });

  it('kiểm như form Đề xuất: tên, kho, có mã, số lượng, quy cách khi trùng mã, lý do ngoài BOQ, người duyệt (chỉ khi gửi)', () => {
    const rows = toFormRows(LINES, CATALOG);
    const ok = { title: 'Vật tư', warehouseId: 'wh', rows, purpose: 'Đổ sàn', approverIds: ['a'] };
    expect(formProblems(ok, CATALOG, 'send')).toEqual([]);
    expect(formProblems({ ...ok, approverIds: [] }, CATALOG, 'send')).toEqual(['Chọn người duyệt.']);
    expect(formProblems({ ...ok, approverIds: [] }, CATALOG, 'draft')).toEqual([]);
    expect(formProblems({ ...ok, title: ' ', warehouseId: '' }, CATALOG, 'draft')).toEqual(['Nhập tên đề xuất.', 'Chọn kho nhận.']);
    expect(formProblems({ ...ok, rows: rows.map(r => ({ ...r, itemId: null })) }, CATALOG, 'draft')).toContain('Chọn mã cho ít nhất một dòng.');
    expect(formProblems({ ...ok, rows: [{ ...rows[0], qty: '0' }] }, CATALOG, 'draft')).toEqual(['Xi măng PCB40: nhập số lượng.']);
    expect(formProblems({ ...ok, rows: [rows[0], { ...rows[0], key: 'k2' }] }, CATALOG, 'draft')).toEqual(['Xi măng PCB40 có nhiều dòng — ghi quy cách khác nhau.']);
    expect(formProblems({ ...ok, purpose: '', rows: [rows[0]] }, CATALOG, 'draft')).toEqual(['Xi măng PCB40: nhập lý do (dòng ngoài BOQ).']);
  });

  const setupLoad = () => {
    mocks.getProjectCatalog.mockResolvedValue(CATALOG);
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ limit: async () => ({ data: [
      { id: 'wh-other', name: 'Kho XinHai', type: 'SITE', project_id: 'p-da29', is_default_for_site: true },
      { id: 'wh-smb-2', name: 'Kho phụ SMB', type: 'SITE', project_id: 'p-smb', is_default_for_site: false },
      { id: 'wh-smb', name: 'Kho Sơn Miền Bắc', type: 'SITE', project_id: 'p-smb', is_default_for_site: true },
      { id: 'wh-hq', name: 'Kho tổng', type: 'GENERAL', project_id: null, is_default_for_site: false },
    ], error: null }) }) }) });
    mocks.getConfiguration.mockResolvedValue({ valid: true, binding: { workflowTemplateId: 'tpl' }, errors: [] });
    mocks.getTemplateStartContext.mockResolvedValue({ firstNode: { id: 'n1' } });
    mocks.listRecipients.mockResolvedValue([{ userId: 'u-chuan', userName: 'Hà Đức Chuẩn' }]);
  };

  it('tải: danh mục của dự án, kho của dự án lên đầu (kho mặc định chọn sẵn), người duyệt đúng Room; chưa có workflow → chỉ lưu nháp', async () => {
    setupLoad();
    const actions = createMrFormActions({ userId: 'u1', addRequest: vi.fn() });
    const ctx = await actions.load(COMMAND);
    expect(mocks.getProjectCatalog).toHaveBeenCalledWith('p-smb', 's-1');
    expect(mocks.listRecipients).toHaveBeenCalledWith('p-smb', 's-1', 'material_request', 'approve');
    expect(ctx).toMatchObject({ defaultWarehouseId: 'wh-smb', approvers: [{ id: 'u-chuan', name: 'Hà Đức Chuẩn' }], sendBlocked: null });
    expect(ctx.warehouses.map(w => w.id)).toEqual(['wh-smb', 'wh-smb-2', 'wh-other']);
    mocks.getConfiguration.mockResolvedValue({ valid: false, binding: null, errors: ['Dự án chưa gắn mẫu workflow.'] });
    expect((await actions.load(COMMAND)).sendBlocked).toBe('Dự án chưa gắn mẫu workflow.');
  });

  it('gửi duyệt: cấp mã, lưu bằng addRequest, bắt đầu workflow, ghi biên nhận; lỗi giữa chừng → gửi lại dùng đúng mã + id cũ', async () => {
    setupLoad();
    mocks.nextCode.mockResolvedValueOnce('MR-2026-0042').mockResolvedValueOnce('MR-2026-0043');
    mocks.getById.mockResolvedValue(null);
    mocks.startWorkflow.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValueOnce({});
    mocks.rpc.mockImplementation(async (_fn: string, args: Record<string, unknown>) => ({ data: { ...COMMAND, status: args.p_status, result: args.p_result, error: args.p_error }, error: null }));
    const saved: Array<Record<string, unknown>> = [];
    const actions = createMrFormActions({ userId: 'u1', addRequest: async r => { saved.push(r as never); return true; } });
    const input = { mode: 'send' as const, title: 'Vật tư sàn tầng 4', warehouseId: 'wh-smb', neededDate: '2026-10-23', approverIds: ['u-chuan'], approverNames: ['Hà Đức Chuẩn'],
      lines: [{ item: CATALOG[0], qty: 2, spec: '', reason: 'Đổ sàn tầng 4' }] };
    await expect(actions.submit(COMMAND, input)).rejects.toThrow('Mất kết nối');
    expect(mocks.rpc).toHaveBeenLastCalledWith('assistant_command_finish_v1', expect.objectContaining({ p_status: 'failed', p_result: { code: 'MR-2026-0042', id: saved[0].id }, p_error: 'Mất kết nối' }));
    const done = await actions.submit(COMMAND, input);
    expect(mocks.nextCode).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(2);
    expect(saved[1].id).toBe(saved[0].id);
    expect(saved[1]).toMatchObject({ code: 'MR-2026-0042', projectId: 'p-smb', constructionSiteId: 's-1', siteWarehouseId: 'wh-smb', requestOrigin: 'project', requesterId: 'u1',
      status: RequestStatus.DRAFT, expectedDate: '2026-10-22T17:00:00.000Z' });
    expect((saved[1].items as Array<Record<string, unknown>>)[0]).toMatchObject({ itemId: 'xm', requestQty: 2, overBudgetReason: 'Đổ sàn tầng 4', neededDate: '2026-10-23', isOverBoq: false });
    expect((saved[1].logs as Array<Record<string, unknown>>).map(l => l.action)).toEqual(['CREATED_DRAFT', 'SUBMITTED']);
    expect(mocks.startWorkflow).toHaveBeenLastCalledWith({ requestId: saved[0].id, templateId: 'tpl', firstAssigneeUserIds: ['u-chuan'], comment: undefined });
    expect(done).toMatchObject({ status: 'done', result: { code: 'MR-2026-0042', submitted: true, approvers: ['Hà Đức Chuẩn'] } });
  });

  it('lưu nháp: không cần người duyệt, không bắt đầu workflow, biên nhận "chưa gửi"', async () => {
    mocks.nextCode.mockResolvedValue('MR-2026-0050');
    mocks.rpc.mockImplementation(async (_fn: string, args: Record<string, unknown>) => ({ data: { ...COMMAND, status: args.p_status, result: args.p_result }, error: null }));
    const addRequest = vi.fn().mockResolvedValue(true);
    const done = await createMrFormActions({ userId: 'u1', addRequest }).submit(COMMAND, { mode: 'draft', title: 'Nháp', warehouseId: 'wh-smb', neededDate: null,
      approverIds: [], approverNames: [], lines: [{ item: CATALOG[1], qty: 50, spec: '', reason: 'Cột' }] });
    expect(addRequest.mock.calls[0][0]).toMatchObject({ code: 'MR-2026-0050', status: RequestStatus.DRAFT, logs: [{ action: 'CREATED_DRAFT' }] });
    expect(mocks.startWorkflow).not.toHaveBeenCalled();
    expect(done.result).toMatchObject({ code: 'MR-2026-0050', submitted: false });
  });
});
