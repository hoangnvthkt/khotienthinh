// Trợ lý v2 · form đề xuất vật tư NGAY TRONG khung chat (chủ SP duyệt 18/10/2026): đủ dự án + dòng vật tư thì thẻ nháp thành form gọn —
// chọn mã (gợi ý bấm), số lượng, lý do, kho nhận, ngày cần, người duyệt bước đầu — rồi Gửi duyệt / Lưu nháp ngay tại chỗ.
// Lưu / gửi đi ĐÚNG đường của form Đề xuất (lib/materialRequestBuild + lib/materialRequestSend, addRequest của app). AI không gửi gì.
import { supabase } from './supabase';
import { MaterialRequestFulfillmentMode, type InventoryItem, type MaterialRequest } from '../types';
import { finishCommand, mrView, type AssistantCommand, type MrDraftLine } from './assistantCommands';
import { isMeasureNote, matchLines, qtyInUnit, rankItems, sameUnit, type ItemCandidate } from './materialRequestText';
import { parseNonNegativeLocaleNumber } from './localeNumberInput';
import { OUTSIDE_BOQ_BUDGET, toMaterialRequestRecord, toRequestItem } from './materialRequestBuild';
import { MaterialRequestNotSavedError, getMaterialRequestBinding, saveAndStartWorkflow, toSubmittedProjectRequest } from './materialRequestSend';
import { getMaterialRequestWorkflowPatch, materialRequestService } from './materialRequestService';
import { projectWorkflowService } from './projectWorkflowService';
import { projectPermissionRoomService } from './projectPermissionRoomService';
import { duplicateItemSpecProblems } from './materialLineDescription';
import { aiLearning, recall, type LearnedAlias } from './aiLearning';
import { aiMemory, habitKey, rememberedIds, type PersonalMemory } from './aiMemory';

export type MrCatalogItem = Pick<InventoryItem, 'id' | 'name' | 'unit'> & { sku?: string; status?: string; mergedIntoId?: string | null };
export interface MrFormContext {
  catalog: MrCatalogItem[];
  warehouses: Array<{ id: string; name: string }>;
  defaultWarehouseId: string | null;
  approvers: Array<{ id: string; name: string }>;
  /** Chưa gửi duyệt được (dự án chưa cấu hình workflow / chưa có người duyệt) — vẫn Lưu nháp được. */
  sendBlocked: string | null;
  /** T4a: cách gọi đã được người dùng xác nhận ở dự án này ("xi măng PCB40" → mã). */
  memory: LearnedAlias[];
  /** T4b: kho nhận / người duyệt người dùng đã chọn ở lần gửi trước của dự án này (còn chọn được hôm nay). */
  rememberedWarehouseId?: string | null;
  rememberedApproverIds?: string[];
}
/** said: chữ Trợ lý tách từ lời người dùng — dạy AI cặp "chữ → mã" sau khi lưu / gửi thành công. */
export interface MrFormSubmitLine { item: MrCatalogItem; qty: number; spec: string; reason: string; said?: string }
export interface MrFormSubmit {
  mode: 'draft' | 'send';
  title: string;
  warehouseId: string;
  neededDate: string | null;
  lines: MrFormSubmitLine[];
  approverIds: string[];
  approverNames: string[];
  warehouseName?: string;
}
export interface MrFormActions {
  load: (command: AssistantCommand) => Promise<MrFormContext>;
  /** Lưu nháp / gửi duyệt rồi ghi biên nhận vào lệnh; trả lệnh đã xong. */
  submit: (command: AssistantCommand, input: MrFormSubmit) => Promise<AssistantCommand>;
}

// ── Dòng của form: khớp mã như Gõ nhanh ──────────────────────────────────────────────────────────────────────────────
export interface MrFormRow {
  key: string;
  line: MrDraftLine;
  candidates: ItemCandidate<MrCatalogItem>[];
  itemId: string | null;
  qty: string;
  spec: string;
  reason: string;
  /** Mã chọn theo trí nhớ (người dùng đã xác nhận cách gọi này trước đây). */
  remembered?: boolean;
}
const qtyText = (q: number | null) => (q == null ? '' : String(q).replace('.', ','));
export const toFormRows = (lines: MrDraftLine[], catalog: MrCatalogItem[], memory: readonly LearnedAlias[] = []): MrFormRow[] => {
  const live = catalog.filter(i => i.status !== 'retired' && !i.mergedIntoId);
  const byId = new Map(live.map(i => [i.id, i]));
  const matched = matchLines(lines.map(l => ({ ...l, raw: [l.name, l.spec].filter(Boolean).join(' ') })), live);
  return matched.map((m, i) => {
    // Trí nhớ trước (cách gọi người dùng đã xác nhận), rồi mới tới khớp chữ.
    const known = recall(memory, 'item', [lines[i].name, lines[i].spec].filter(Boolean).join(' '), lines[i].name);
    const knownItem = known ? byId.get(known.targetId) : undefined;
    if (knownItem) {
      const base: MrFormRow = { key: `${i}:${m.raw}`, line: lines[i], candidates: m.candidates, itemId: null, qty: qtyText(m.qty), spec: m.specGuess || '',
        reason: lines[i].note && !isMeasureNote(lines[i].note) ? lines[i].note! : '' };
      return { ...chooseItem(base, knownItem), remembered: true };
    }
    const item = m.pick;
    return {
      key: `${i}:${m.raw}`, line: lines[i], candidates: m.candidates, itemId: item?.id ?? null,
      // Lệch đơn vị (câu ghi "tấn", mã tính "kg") → lấy số theo đơn vị của mã nếu câu có ghi, không thì để trống bắt nhập lại.
      qty: item && !sameUnit(m.unit, item.unit) ? qtyText(m.qtyFromText) : qtyText(m.qty),
      spec: m.specGuess || '', reason: lines[i].note && !isMeasureNote(lines[i].note) ? lines[i].note! : '',
    };
  });
};
/** Chọn mã cho dòng: đổi đơn vị thì lấy số theo đơn vị mã (nếu câu có), không thì giữ số đã nhập. */
export const chooseItem = (row: MrFormRow, item: MrCatalogItem): MrFormRow => ({
  ...row, itemId: item.id,
  qty: sameUnit(row.line.unit, item.unit) ? (row.qty || qtyText(row.line.qty)) : qtyText(qtyInUnit({ note: row.line.note, raw: row.line.name, spec: row.line.spec }, item.unit)),
});
export const searchCatalog = (query: string, catalog: MrCatalogItem[], limit = 5) =>
  query.trim().length < 2 ? [] : rankItems(query, catalog.filter(i => i.status !== 'retired' && !i.mergedIntoId), { limit }).map(c => c.item);

/** Số lượng gõ kiểu Việt (2,5 / 1.200) — cùng cách đọc với form Đề xuất. */
export const parseQty = (s: string) => parseNonNegativeLocaleNumber(s);

/** Lỗi chặn gửi, theo đúng kiểm tra của form Đề xuất (tên, kho, dòng, số lượng, quy cách trùng mã, lý do ngoài BOQ, người duyệt). */
export const formProblems = (f: { title: string; warehouseId: string; rows: MrFormRow[]; purpose: string; approverIds: string[] }, catalog: MrCatalogItem[], mode: 'draft' | 'send'): string[] => {
  const out: string[] = [];
  const name = (row: MrFormRow) => catalog.find(i => i.id === row.itemId)?.name || row.line.name;
  if (!f.title.trim()) out.push('Nhập tên đề xuất.');
  if (!f.warehouseId) out.push('Chọn kho nhận.');
  const kept = f.rows.filter(r => r.itemId);
  if (!kept.length) out.push('Chọn mã cho ít nhất một dòng.');
  const noQty = kept.find(r => parseQty(r.qty) <= 0);
  if (noQty) out.push(`${name(noQty)}: nhập số lượng.`);
  const dup = duplicateItemSpecProblems(kept.map(r => ({ key: r.key, itemId: r.itemId!, specification: r.spec })));
  const dupRow = kept.find(r => dup.has(r.key));
  if (dupRow) out.push(`${name(dupRow)} có nhiều dòng — ghi quy cách khác nhau.`);
  const noReason = kept.find(r => !(r.reason.trim() || f.purpose.trim()));
  if (noReason) out.push(`${name(noReason)}: nhập lý do (dòng ngoài BOQ).`);
  if (mode === 'send' && !f.approverIds.length) out.push('Chọn người duyệt.');
  return out;
};

// ── Bản thật: dùng dịch vụ của module + addRequest của app ──────────────────────────────────────────────────────────
const dayToIso = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00+07:00`).toISOString() : undefined);

export const createMrFormActions = (deps: { userId: string; addRequest: (request: MaterialRequest) => Promise<boolean> }): MrFormActions => {
  // Mã + id phiếu đã cấp cho từng lệnh: gửi lỗi giữa chừng rồi bấm lại thì ghi đè đúng phiếu đó (không cấp mã mới, không sinh phiếu trùng).
  const issued = new Map<string, { id: string; code: string }>();
  return {
    async load(command) {
      const v = mrView(command);
      const [catalog, warehouses, approvers, memory, personal] = await Promise.all([
        materialRequestService.getProjectCatalog(v.projectId, v.siteId),
        supabase.from('warehouses').select('id, name, type, project_id, is_default_for_site').eq('is_archived', false).limit(500)
          .then(({ data, error }) => { if (error) throw error; return (data || []) as Array<{ id: string; name: string; type: string; project_id: string | null; is_default_for_site: boolean | null }>; }),
        (async (): Promise<{ list: Array<{ id: string; name: string }>; blocked: string | null }> => {
          try {
            const binding = await getMaterialRequestBinding(v.projectId, v.siteId);
            const [start, recipients] = await Promise.all([
              projectWorkflowService.getTemplateStartContext(binding.workflowTemplateId),
              projectPermissionRoomService.listRecipients(v.projectId, v.siteId, 'material_request', 'approve'),
            ]);
            if (!start.firstNode) return { list: [], blocked: 'Mẫu workflow chưa có bước xử lý đầu tiên.' };
            const list = recipients.map(r => ({ id: r.userId, name: r.userName || r.userId }));
            return { list, blocked: list.length ? null : 'Chưa có người có quyền duyệt trong Room của đề xuất vật tư.' };
          } catch (e) {
            return { list: [], blocked: e instanceof Error ? e.message : 'Chưa tải được workflow đề xuất vật tư.' };
          }
        })(),
        aiLearning.get('material_request', v.projectId).catch(() => [] as LearnedAlias[]),
        aiMemory.personal().catch(() => null as PersonalMemory | null),
      ]);
      // Kho của dự án lên đầu; kho mặc định của công trường chọn sẵn.
      const own = warehouses.filter(w => w.project_id === v.projectId).sort((a, b) => Number(Boolean(b.is_default_for_site)) - Number(Boolean(a.is_default_for_site)));
      const others = warehouses.filter(w => w.project_id !== v.projectId && w.type === 'SITE');
      const list = [...own, ...others].map(w => ({ id: w.id, name: w.name }));
      return {
        catalog,
        warehouses: list,
        defaultWarehouseId: own[0]?.id ?? null,
        approvers: approvers.list,
        sendBlocked: approvers.blocked,
        memory,
        rememberedWarehouseId: rememberedIds(personal, habitKey.mrWarehouse(v.projectId), list)[0] ?? null,
        rememberedApproverIds: rememberedIds(personal, habitKey.mrApprovers(v.projectId), approvers.list),
      };
    },

    async submit(command, input) {
      const v = mrView(command);
      // Lần trước lỗi giữa chừng (trong phiên này, hoặc lệnh đã ghi 'failed' kèm mã): dùng lại mã + id đã cấp.
      const prior = issued.get(command.id) || (command.status === 'failed' && typeof command.result.id === 'string' && typeof command.result.code === 'string'
        ? { id: command.result.id, code: command.result.code } : null);
      const code = prior?.code || await materialRequestService.nextCode();
      const now = new Date().toISOString();
      const record = toMaterialRequestRecord({
        code, title: input.title, projectId: v.projectId, constructionSiteId: v.siteId, requestOrigin: 'project',
        siteWarehouseId: input.warehouseId, requesterId: deps.userId, workflowPatch: getMaterialRequestWorkflowPatch('draft', deps.userId),
        now, expectedDate: dayToIso(input.neededDate), note: '', fulfillmentMode: MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK, userId: deps.userId,
        items: input.lines.map(l => toRequestItem({
          lineId: crypto.randomUUID(), itemId: l.item.id, qty: l.qty, specification: l.spec, overBudgetReason: l.reason,
          neededDate: input.neededDate || undefined, itemNameSnapshot: l.item.name, unitSnapshot: l.item.unit, skuSnapshot: l.item.sku,
        }, OUTSIDE_BOQ_BUDGET, l.item)),
      });
      const draft: MaterialRequest = prior ? { ...record, id: prior.id } : record;
      issued.set(command.id, { id: draft.id, code });
      try {
        if (input.mode === 'draft') {
          if (!await deps.addRequest(draft)) throw new MaterialRequestNotSavedError();
        } else {
          const binding = await getMaterialRequestBinding(v.projectId, v.siteId);
          await saveAndStartWorkflow(toSubmittedProjectRequest(draft, deps.userId), binding, { userId: input.approverIds[0], userIds: input.approverIds }, { addRequest: deps.addRequest });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Chưa gửi được đề xuất.';
        await finishCommand(command.id, 'failed', { code, id: draft.id }, message).catch(() => null);
        throw e instanceof Error ? e : new Error(message);
      }
      issued.delete(command.id);
      // Người dùng đã xác nhận bằng hành động → dạy AI cách gọi của dự án này (không chặn biên nhận).
      void aiLearning.learn('material_request', v.projectId, input.lines.filter(l => l.said).map(l => ({ kind: 'item' as const, alias: l.said!, targetId: l.item.id, targetLabel: l.item.name })));
      // T4b: nhớ kho nhận + người duyệt người dùng vừa chọn cho dự án này (lần sau thẻ chọn sẵn).
      void aiMemory.learnHabits([
        { key: habitKey.mrWarehouse(v.projectId), value: input.warehouseId, label: input.warehouseName || input.warehouseId },
        ...(input.mode === 'send' && input.approverIds.length ? [{ key: habitKey.mrApprovers(v.projectId), value: input.approverIds.join(','), label: input.approverNames.join(', ') }] : []),
      ]);
      const result = { code, id: draft.id, submitted: input.mode === 'send', approvers: input.approverNames };
      return (await finishCommand(command.id, 'done', result).catch(() => null)) || { ...command, status: 'done', result, confirmedAt: now };
    },
  };
};
