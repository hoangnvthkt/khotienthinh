import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileSearch, Link2, Loader2, Lock, Plus, RefreshCcw, Search, Send, Trash2, Undo2 } from 'lucide-react';
import {
  BoqReconciliationContractLine,
  BoqReconciliationGroup,
  BoqReconciliationWorkLine,
  ContractItem,
  ContractItemType,
  ProjectSubmissionTarget,
  ProjectWorkBoqItem,
} from '../../types';
import {
  boqReconciliationService,
  buildContractReconciliationLine,
  buildWorkReconciliationLine,
} from '../../lib/boqReconciliationService';
import { contractItemService } from '../../lib/contractItemService';
import { workBoqService } from '../../lib/projectService';
import { useApp } from '../../context/AppContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import ProjectSubmissionDialog from './ProjectSubmissionDialog';
import { ProjectPermissionCode, projectStaffService } from '../../lib/projectStaffService';
import { formatPolicyMessage, getProjectDocumentPolicy } from '../../lib/projectDocumentPolicy';
import { projectDocumentActionLogService } from '../../lib/projectDocumentActionLogService';

interface Props {
  projectId?: string | null;
  constructionSiteId?: string | null;
}

const fmt = (value: number) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const money = (value: number) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });

const statusLabel: Record<BoqReconciliationGroup['status'], string> = {
  draft: 'Nháp',
  submitted: 'Chờ rà soát',
  reviewed: 'Đã rà soát',
  locked: 'Đã khóa',
};

const statusClass: Record<BoqReconciliationGroup['status'], string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-amber-50 text-amber-700',
  reviewed: 'bg-emerald-50 text-emerald-700',
  locked: 'bg-indigo-50 text-indigo-700',
};

const statusOrder: Record<BoqReconciliationGroup['status'], number> = {
  draft: 0,
  submitted: 1,
  reviewed: 2,
  locked: 3,
};

const statusActionLabel: Record<BoqReconciliationGroup['status'], string> = {
  draft: 'Trả về nháp',
  submitted: 'Gửi rà soát',
  reviewed: 'Xác nhận đã rà soát',
  locked: 'Khóa nhóm đối chiếu',
};

const numberInput = 'w-24 px-2 py-1 rounded-lg border border-slate-200 text-right text-[10px] font-bold outline-none focus:ring-1 focus:ring-indigo-400';
const textInput = 'w-full px-2 py-1 rounded-lg border border-slate-200 text-[10px] outline-none focus:ring-1 focus:ring-indigo-400';

const lineConverted = (line: { convertedQuantity?: number; allocatedQuantity: number; conversionFactor: number }) =>
  Number(line.convertedQuantity || 0) || Number(line.allocatedQuantity || 0) * (Number(line.conversionFactor || 0) || 1);

const BoqReconciliationPanel: React.FC<Props> = ({ projectId, constructionSiteId }) => {
  const effectiveId = projectId || constructionSiteId || '';
  const toast = useToast();
  const confirm = useConfirm();
  const reasonConfirm = useReasonConfirm();
  const { user } = useApp();
  const isAdminUser = user?.role === 'ADMIN';
  const [contractType, setContractType] = useState<ContractItemType>('customer');
  const [groups, setGroups] = useState<BoqReconciliationGroup[]>([]);
  const [contractItems, setContractItems] = useState<ContractItem[]>([]);
  const [workItems, setWorkItems] = useState<ProjectWorkBoqItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [contractSearch, setContractSearch] = useState('');
  const [workSearch, setWorkSearch] = useState('');
  const [selectedContractIds, setSelectedContractIds] = useState<string[]>([]);
  const [selectedWorkIds, setSelectedWorkIds] = useState<string[]>([]);
  const [submittingGroup, setSubmittingGroup] = useState<BoqReconciliationGroup | null>(null);

  const load = useCallback(async () => {
    if (!effectiveId) return;
    setLoading(true);
    try {
      const [groupRows, contractRows, workRows] = await Promise.all([
        boqReconciliationService.listByProject(effectiveId, constructionSiteId || null, contractType),
        contractItemService.listBySite(effectiveId, contractType, constructionSiteId || null),
        workBoqService.list(effectiveId, constructionSiteId || null),
      ]);
      setGroups(groupRows);
      setContractItems(contractRows);
      setWorkItems(workRows);
      setActiveId(prev => prev && groupRows.some(group => group.id === prev) ? prev : groupRows[0]?.id || '');
    } catch (error: any) {
      toast.error('Không tải được đối chiếu BOQ', error?.message || 'Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, [constructionSiteId, contractType, effectiveId, toast]);

  useEffect(() => { load(); }, [load]);

  const activeGroup = groups.find(group => group.id === activeId) || null;
  const contractMap = useMemo(() => new Map(contractItems.map(item => [item.id, item])), [contractItems]);
  const workMap = useMemo(() => new Map(workItems.map(item => [item.id, item])), [workItems]);
  const activeContractIds = new Set(activeGroup?.contractLines?.map(line => line.contractItemId) || []);
  const activeWorkIds = new Set(activeGroup?.workLines?.map(line => line.workBoqItemId) || []);

  const filteredContractItems = useMemo(() => {
    const query = contractSearch.trim().toLowerCase();
    return contractItems
      .filter(item => !activeContractIds.has(item.id))
      .filter(item => !query || `${item.code} ${item.name} ${item.unit}`.toLowerCase().includes(query))
      .slice(0, 12);
  }, [activeContractIds, contractItems, contractSearch]);

  const filteredWorkItems = useMemo(() => {
    const query = workSearch.trim().toLowerCase();
    return workItems
      .filter(item => !activeWorkIds.has(item.id))
      .filter(item => !query || `${item.wbsCode || ''} ${item.name} ${item.unit}`.toLowerCase().includes(query))
      .slice(0, 12);
  }, [activeWorkIds, workItems, workSearch]);

  const createGroup = async () => {
    if (!effectiveId || !newName.trim()) return;
    setSaving(true);
    try {
      const group: BoqReconciliationGroup = {
        id: crypto.randomUUID(),
        projectId: projectId || null,
        constructionSiteId: constructionSiteId || null,
        contractType,
        code: `DQ-${String(groups.length + 1).padStart(3, '0')}`,
        name: newName.trim(),
        description: null,
        status: 'draft',
        preparedById: user?.id || null,
        preparedByName: user?.name || user?.username || null,
        contractLines: [],
        workLines: [],
      };
      await boqReconciliationService.upsertGroup(group);
      setNewName('');
      await load();
      setActiveId(group.id);
      toast.success('Đã tạo nhóm đối chiếu');
    } catch (error: any) {
      toast.error('Không tạo được nhóm đối chiếu', error?.message || 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: BoqReconciliationGroup['status'], submissionTarget?: ProjectSubmissionTarget) => {
    if (!activeGroup) return;
    if (status === 'submitted' && !submissionTarget) {
      setSubmittingGroup(activeGroup);
      return;
    }
    const isRollback = statusOrder[status] < statusOrder[activeGroup.status];
    const hasContractLines = (activeGroup.contractLines || []).length > 0;
    const hasWorkLines = (activeGroup.workLines || []).length > 0;
    if (!isRollback && (status === 'reviewed' || status === 'locked') && (!hasContractLines || !hasWorkLines)) {
      toast.error(
        'Chưa đủ dữ liệu đối chiếu',
        'Nhóm cần có cả dòng BOQ hợp đồng và đầu mục BOQ thi công trước khi chốt bảng tham khảo.',
      );
      return;
    }
    if (isRollback && !isAdminUser) {
      toast.error('Không đủ quyền', 'Chỉ admin được hạ trạng thái nhóm đối chiếu để chỉnh sửa.');
      return;
    }
    const rollbackReason = isRollback
      ? await reasonConfirm({
        title: 'Hạ trạng thái đối chiếu',
        targetName: activeGroup.name,
        warningText: `Admin sẽ đưa nhóm từ "${statusLabel[activeGroup.status]}" về "${statusLabel[status]}" để chỉnh sửa.`,
        reasonPlaceholder: 'Nhập lý do rollback/hạ trạng thái nhóm đối chiếu...',
        actionLabel: 'Hạ trạng thái',
        intent: 'danger',
        countdownSeconds: 1,
      })
      : undefined;
    if (isRollback && !rollbackReason) return;
    if (!(status === 'submitted' && submissionTarget) && !isRollback) {
      const ok = await confirm({
        title: isRollback ? 'Hạ trạng thái đối chiếu' : statusActionLabel[status],
        targetName: activeGroup.name,
        warningText: isRollback
          ? `Admin sẽ đưa nhóm từ "${statusLabel[activeGroup.status]}" về "${statusLabel[status]}" để chỉnh sửa.`
          : status === 'locked'
            ? 'Khóa chỉ để chốt bảng đối chiếu tham khảo; không còn là điều kiện tạo nghiệm thu/thanh toán.'
            : undefined,
        intent: status === 'locked' || isRollback ? 'danger' : 'success',
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const requiredPermission: ProjectPermissionCode = status === 'submitted'
        ? 'submit'
        : status === 'reviewed'
          ? 'verify'
          : 'approve';
      if (!isAdminUser) {
        await projectStaffService.requireProjectPermission({
          userId: user?.id,
          projectId: projectId || undefined,
          constructionSiteId: constructionSiteId || undefined,
          code: requiredPermission,
          actionLabel: statusActionLabel[status].toLowerCase(),
        });
      }
      const action = isRollback
        ? 'rollback'
        : status === 'submitted'
          ? 'submit'
          : status === 'reviewed'
            ? 'verify'
            : 'approve';
      const policy = getProjectDocumentPolicy({
        action,
        documentType: 'boq_item',
        status: activeGroup.status,
        user,
        permissions: isAdminUser
          ? ['view', 'edit', 'delete', 'submit', 'verify', 'confirm', 'approve']
          : ['view', requiredPermission],
        currentHandlerIds: [activeGroup.submittedToUserId],
        relatedUserIds: [activeGroup.preparedById],
        reason: rollbackReason,
        everSubmitted: activeGroup.everSubmitted,
        documentLabel: activeGroup.name,
      });
      if (!policy.allowed) {
        await projectDocumentActionLogService.logBlocked({
          projectId: projectId || activeGroup.projectId || effectiveId,
          constructionSiteId: constructionSiteId || activeGroup.constructionSiteId || null,
          documentType: 'boq_item',
          documentId: activeGroup.id,
          documentLabel: activeGroup.name,
          action,
          fromStatus: activeGroup.status,
          toStatus: status,
          reason: rollbackReason,
          blockedReason: policy.reason,
          requiredRollbackSteps: policy.requiredRollbackSteps,
          createdBy: user?.id,
        });
        toast.error('Không thể cập nhật đối chiếu BOQ', formatPolicyMessage(policy));
        return;
      }
      await boqReconciliationService.setStatus(activeGroup.id, status, { id: user?.id, name: user?.name || user?.username }, submissionTarget);
      await projectDocumentActionLogService.log({
        projectId: projectId || activeGroup.projectId || effectiveId,
        constructionSiteId: constructionSiteId || activeGroup.constructionSiteId || null,
        documentType: 'boq_item',
        documentId: activeGroup.id,
        documentLabel: activeGroup.name,
        action,
        fromStatus: activeGroup.status,
        toStatus: status,
        reason: rollbackReason,
        warningAcknowledged: true,
        createdBy: user?.id,
      });
      await load();
      if (status === 'submitted') setSubmittingGroup(null);
      toast.success('Đã cập nhật trạng thái đối chiếu');
    } catch (error: any) {
      toast.error('Không cập nhật được trạng thái', error?.message || 'Vui lòng thử lại.');
      if (status === 'submitted' && submissionTarget) throw error;
    } finally {
      setSaving(false);
    }
  };

  const removeGroup = async () => {
    if (!activeGroup) return;
    const ok = await confirm({
      title: 'Xóa nhóm đối chiếu',
      targetName: activeGroup.name,
      warningText: 'Các dòng BOQ hợp đồng và BOQ thi công trong nhóm này cũng sẽ bị xóa khỏi bảng đối chiếu.',
      intent: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await boqReconciliationService.removeGroup(activeGroup.id);
      await load();
      toast.success('Đã xóa nhóm đối chiếu');
    } catch (error: any) {
      toast.error('Không xóa được nhóm', error?.message || 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const addContractLines = async () => {
    if (!activeGroup || selectedContractIds.length === 0) return;
    const selected = selectedContractIds.map(id => contractMap.get(id)).filter(Boolean) as ContractItem[];
    setSaving(true);
    try {
      await boqReconciliationService.addContractLines(activeGroup.id, selected.map(item => buildContractReconciliationLine(activeGroup.id, item)));
      setSelectedContractIds([]);
      await load();
    } catch (error: any) {
      toast.error('Không thêm được BOQ hợp đồng', error?.message || 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const addWorkLines = async () => {
    if (!activeGroup || selectedWorkIds.length === 0) return;
    const selected = selectedWorkIds.map(id => workMap.get(id)).filter(Boolean) as ProjectWorkBoqItem[];
    setSaving(true);
    try {
      await boqReconciliationService.addWorkLines(activeGroup.id, selected.map(item => buildWorkReconciliationLine(activeGroup.id, item)));
      setSelectedWorkIds([]);
      await load();
    } catch (error: any) {
      toast.error('Không thêm được BOQ thi công', error?.message || 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const updateLocalContractLine = (line: BoqReconciliationContractLine) => {
    setGroups(prev => prev.map(group => group.id === line.groupId
      ? { ...group, contractLines: (group.contractLines || []).map(item => item.id === line.id ? line : item) }
      : group));
  };

  const updateLocalWorkLine = (line: BoqReconciliationWorkLine) => {
    setGroups(prev => prev.map(group => group.id === line.groupId
      ? { ...group, workLines: (group.workLines || []).map(item => item.id === line.id ? line : item) }
      : group));
  };

  const saveContractLine = async (line: BoqReconciliationContractLine) => {
    try {
      await boqReconciliationService.updateContractLine({
        ...line,
        convertedQuantity: lineConverted(line),
      });
      await load();
    } catch (error: any) {
      toast.error('Không lưu được dòng BOQ hợp đồng', error?.message || 'Vui lòng thử lại.');
    }
  };

  const saveWorkLine = async (line: BoqReconciliationWorkLine) => {
    try {
      await boqReconciliationService.updateWorkLine({
        ...line,
        convertedQuantity: lineConverted(line),
      });
      await load();
    } catch (error: any) {
      toast.error('Không lưu được dòng BOQ thi công', error?.message || 'Vui lòng thử lại.');
    }
  };

  const removeContractLine = async (line: BoqReconciliationContractLine) => {
    if (!line.id) return;
    await boqReconciliationService.removeContractLine(line.id);
    await load();
  };

  const removeWorkLine = async (line: BoqReconciliationWorkLine) => {
    if (!line.id) return;
    await boqReconciliationService.removeWorkLine(line.id);
    await load();
  };

  const summary = useMemo(() => {
    const contractAmount = (activeGroup?.contractLines || []).reduce((sum, line) => sum + Number(line.amountSnapshot || 0), 0);
    const workAmount = (activeGroup?.workLines || []).reduce((sum, line) => sum + Number(line.amountSnapshot || 0), 0);
    const contractConverted = (activeGroup?.contractLines || []).reduce((sum, line) => sum + lineConverted(line), 0);
    const workConverted = (activeGroup?.workLines || []).reduce((sum, line) => sum + lineConverted(line), 0);
    return { contractAmount, workAmount, contractConverted, workConverted };
  }, [activeGroup]);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
            <FileSearch size={16} className="text-indigo-500" /> Đối chiếu BOQ hợp đồng tham khảo
          </h3>
          <p className="text-[10px] text-slate-400 font-bold mt-1">Bảng này chỉ dùng để so sánh nội bộ; nghiệm thu/thanh toán lấy nguồn từ nhật ký verified và liên kết task với BOQ hợp đồng.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={contractType} onChange={event => setContractType(event.target.value as ContractItemType)} className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600">
            <option value="customer">HĐ chủ đầu tư</option>
            <option value="subcontractor">HĐ thầu phụ</option>
          </select>
          <button onClick={load} disabled={loading} className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-bold text-slate-500 hover:bg-slate-50">
            <RefreshCcw size={12} className={loading ? 'animate-spin' : ''} /> Tải lại
          </button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 xl:grid-cols-[290px_1fr] gap-4">
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-100 p-3">
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Nhóm công tác quy đổi</label>
            <div className="flex gap-2">
              <input value={newName} onChange={event => setNewName(event.target.value)} placeholder="VD: Công tác bê tông móng" className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold outline-none focus:ring-1 focus:ring-indigo-400" />
              <button onClick={createGroup} disabled={saving || !newName.trim()} className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center disabled:opacity-50">
                <Plus size={15} />
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 overflow-hidden">
            {loading ? (
              <div className="p-5 text-center text-xs font-bold text-slate-400"><Loader2 size={14} className="inline animate-spin mr-2" />Đang tải...</div>
            ) : groups.length === 0 ? (
              <div className="p-5 text-center text-xs font-bold text-slate-400">Chưa có nhóm đối chiếu.</div>
            ) : groups.map(group => (
              <button
                key={group.id}
                onClick={() => setActiveId(group.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-50 last:border-b-0 hover:bg-indigo-50 ${group.id === activeId ? 'bg-indigo-50' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-slate-700 truncate">{group.code || 'DQ'} - {group.name}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${statusClass[group.status]}`}>{statusLabel[group.status]}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-bold mt-0.5">{group.contractLines?.length || 0} dòng HĐ • {group.workLines?.length || 0} đầu mục thi công</div>
              </button>
            ))}
          </div>
        </div>

        {!activeGroup ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs font-bold text-slate-400">Tạo hoặc chọn một nhóm công tác để bắt đầu đối chiếu.</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-black text-slate-800">{activeGroup.name}</div>
                <div className="text-[10px] text-slate-400 font-bold">Quy đổi KL HĐ: {fmt(summary.contractConverted)} • KL thi công: {fmt(summary.workConverted)} • Chênh GT: {money(summary.workAmount - summary.contractAmount)} đ</div>
              </div>
              <div className="flex gap-1.5">
                {activeGroup.status === 'draft' && <button onClick={() => setStatus('submitted')} className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-amber-700 bg-amber-50 flex items-center gap-1"><Send size={11} /> Gửi rà soát</button>}
                {activeGroup.status === 'submitted' && <button onClick={() => setStatus('reviewed')} className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-emerald-700 bg-emerald-50 flex items-center gap-1"><CheckCircle2 size={11} /> Đã rà soát</button>}
                {activeGroup.status === 'reviewed' && <button onClick={() => setStatus('locked')} className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-indigo-700 bg-indigo-50 flex items-center gap-1"><Lock size={11} /> Khóa</button>}
                {isAdminUser && activeGroup.status === 'submitted' && <button onClick={() => setStatus('draft')} className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-slate-600 bg-slate-100 flex items-center gap-1"><Undo2 size={11} /> Về nháp</button>}
                {isAdminUser && activeGroup.status === 'reviewed' && <button onClick={() => setStatus('submitted')} className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-slate-600 bg-slate-100 flex items-center gap-1"><Undo2 size={11} /> Về chờ rà soát</button>}
                {isAdminUser && activeGroup.status === 'locked' && <button onClick={() => setStatus('reviewed')} className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-red-700 bg-red-50 flex items-center gap-1"><Undo2 size={11} /> Mở khóa</button>}
                {activeGroup.status !== 'locked' && <button onClick={removeGroup} className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-red-600 bg-red-50"><Trash2 size={11} /></button>}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <PickerPanel
                title="Thêm dòng BOQ hợp đồng"
                search={contractSearch}
                onSearch={setContractSearch}
                onAdd={addContractLines}
                disabled={saving || selectedContractIds.length === 0 || activeGroup.status === 'locked'}
                count={selectedContractIds.length}
              >
                {filteredContractItems.map(item => (
                  <label key={item.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-xs">
                    <input type="checkbox" checked={selectedContractIds.includes(item.id)} onChange={event => setSelectedContractIds(prev => event.target.checked ? [...prev, item.id] : prev.filter(id => id !== item.id))} className="mt-0.5 accent-indigo-500" />
                    <span className="min-w-0">
                      <span className="font-black text-indigo-600">{item.code}</span>
                      <span className="font-bold text-slate-700"> - {item.name}</span>
                      <span className="block text-[10px] text-slate-400">{fmt(item.revisedQuantity ?? item.quantity)} {item.unit} • {money(item.revisedTotalPrice ?? item.totalPrice)} đ</span>
                    </span>
                  </label>
                ))}
              </PickerPanel>

              <PickerPanel
                title="Thêm đầu mục BOQ thi công"
                search={workSearch}
                onSearch={setWorkSearch}
                onAdd={addWorkLines}
                disabled={saving || selectedWorkIds.length === 0 || activeGroup.status === 'locked'}
                count={selectedWorkIds.length}
              >
                {filteredWorkItems.map(item => (
                  <label key={item.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-xs">
                    <input type="checkbox" checked={selectedWorkIds.includes(item.id)} onChange={event => setSelectedWorkIds(prev => event.target.checked ? [...prev, item.id] : prev.filter(id => id !== item.id))} className="mt-0.5 accent-indigo-500" />
                    <span className="min-w-0">
                      <span className="font-black text-indigo-600">{item.wbsCode || '-'}</span>
                      <span className="font-bold text-slate-700"> - {item.name}</span>
                      <span className="block text-[10px] text-slate-400">{fmt(item.plannedQty)} {item.unit} • {money(item.totalAmount ?? item.plannedQty * item.unitPrice)} đ</span>
                    </span>
                  </label>
                ))}
              </PickerPanel>
            </div>

            <LineTable
              title="BOQ hợp đồng trong nhóm"
              type="contract"
              lines={activeGroup.contractLines || []}
              locked={activeGroup.status === 'locked'}
              labelOf={line => {
                const item = contractMap.get((line as BoqReconciliationContractLine).contractItemId);
                return `${item?.code || ''} ${item?.name || ''}`.trim() || 'Dòng hợp đồng';
              }}
              onChange={line => updateLocalContractLine(line as BoqReconciliationContractLine)}
              onSave={line => saveContractLine(line as BoqReconciliationContractLine)}
              onRemove={line => removeContractLine(line as BoqReconciliationContractLine)}
            />

            <LineTable
              title="BOQ thi công trong nhóm"
              type="work"
              lines={activeGroup.workLines || []}
              locked={activeGroup.status === 'locked'}
              labelOf={line => {
                const item = workMap.get((line as BoqReconciliationWorkLine).workBoqItemId);
                return `${item?.wbsCode || ''} ${item?.name || ''}`.trim() || 'Đầu mục thi công';
              }}
              onChange={line => updateLocalWorkLine(line as BoqReconciliationWorkLine)}
              onSave={line => saveWorkLine(line as BoqReconciliationWorkLine)}
              onRemove={line => removeWorkLine(line as BoqReconciliationWorkLine)}
            />
          </div>
        )}
      </div>
      {submittingGroup && (
        <ProjectSubmissionDialog
          title="Gửi nhóm đối chiếu BOQ"
          actionLabel="Gửi rà soát"
          documentLabel="Đối chiếu BOQ"
          documentName={`${submittingGroup.code || 'DQ'} • ${submittingGroup.name}`}
          documentSubtitle={`Trạng thái hiện tại: ${statusLabel[submittingGroup.status]}`}
          projectId={projectId || undefined}
          constructionSiteId={constructionSiteId || undefined}
          recipientPermissionCodes={['verify']}
          recipientHint="Chọn đích danh người có quyền rà soát bảng đối chiếu tham khảo."
          details={[
            { label: 'Dòng BOQ hợp đồng', value: `${submittingGroup.contractLines?.length || 0} dòng` },
            { label: 'Đầu mục BOQ thi công', value: `${submittingGroup.workLines?.length || 0} đầu mục` },
            { label: 'Giá trị HĐ tham chiếu', value: `${money((submittingGroup.contractLines || []).reduce((sum, line) => sum + Number(line.amountSnapshot || 0), 0))} đ` },
            { label: 'Giá trị thi công tham chiếu', value: `${money((submittingGroup.workLines || []).reduce((sum, line) => sum + Number(line.amountSnapshot || 0), 0))} đ` },
          ]}
          onCancel={() => setSubmittingGroup(null)}
          onConfirm={target => setStatus('submitted', target)}
        />
      )}
    </div>
  );
};

const PickerPanel: React.FC<{
  title: string;
  search: string;
  onSearch: (value: string) => void;
  onAdd: () => void;
  disabled: boolean;
  count: number;
  children: React.ReactNode;
}> = ({ title, search, onSearch, onAdd, disabled, count, children }) => (
  <div className="rounded-xl border border-slate-100 p-3">
    <div className="flex items-center justify-between gap-2 mb-2">
      <div className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1"><Link2 size={11} /> {title}</div>
      <button onClick={onAdd} disabled={disabled} className="px-2 py-1 rounded-lg text-[10px] font-bold text-indigo-600 bg-indigo-50 disabled:opacity-50">Thêm {count || ''}</button>
    </div>
    <div className="relative mb-2">
      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input value={search} onChange={event => onSearch(event.target.value)} placeholder="Tìm theo mã/tên/đơn vị..." className="w-full pl-8 pr-2 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:ring-1 focus:ring-indigo-400" />
    </div>
    <div className="max-h-44 overflow-y-auto">{children}</div>
  </div>
);

const LineTable: React.FC<{
  title: string;
  type: 'contract' | 'work';
  lines: Array<BoqReconciliationContractLine | BoqReconciliationWorkLine>;
  locked: boolean;
  labelOf: (line: BoqReconciliationContractLine | BoqReconciliationWorkLine) => string;
  onChange: (line: BoqReconciliationContractLine | BoqReconciliationWorkLine) => void;
  onSave: (line: BoqReconciliationContractLine | BoqReconciliationWorkLine) => void;
  onRemove: (line: BoqReconciliationContractLine | BoqReconciliationWorkLine) => void;
}> = ({ title, lines, locked, labelOf, onChange, onSave, onRemove }) => (
  <div className="rounded-xl border border-slate-100 overflow-hidden">
    <div className="px-3 py-2 bg-slate-50 text-[10px] font-black text-slate-500 uppercase">{title}</div>
    {lines.length === 0 ? (
      <div className="p-4 text-center text-xs font-bold text-slate-400">Chưa có dòng nào trong nhóm.</div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-xs">
          <thead className="bg-slate-50/70 text-[9px] font-black text-slate-400 uppercase">
            <tr>
              <th className="text-left px-3 py-2">Dòng</th>
              <th className="text-right px-3 py-2">KL gốc</th>
              <th className="text-center px-3 py-2">ĐVT gốc</th>
              <th className="text-right px-3 py-2">KL phân bổ</th>
              <th className="text-right px-3 py-2">Hệ số</th>
              <th className="text-right px-3 py-2">KL quy đổi</th>
              <th className="text-center px-3 py-2">ĐVT quy đổi</th>
              <th className="text-left px-3 py-2">Công thức/Ghi chú</th>
              <th className="text-right px-3 py-2">GT snapshot</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {lines.map(line => (
              <tr key={line.id || `${labelOf(line)}-${line.createdAt}`} className="hover:bg-slate-50/60">
                <td className="px-3 py-2 font-bold text-slate-700 max-w-[220px] truncate">{labelOf(line)}</td>
                <td className="px-3 py-2 text-right">{fmt(line.originalQuantity)}</td>
                <td className="px-3 py-2 text-center text-slate-500">{line.originalUnit || '-'}</td>
                <td className="px-3 py-2 text-right">
                  <input disabled={locked} type="number" className={numberInput} value={line.allocatedQuantity || ''} onChange={event => onChange({ ...line, allocatedQuantity: Number(event.target.value || 0) })} onBlur={() => onSave(line)} />
                </td>
                <td className="px-3 py-2 text-right">
                  <input disabled={locked} type="number" step="0.0001" className={numberInput} value={line.conversionFactor || ''} onChange={event => onChange({ ...line, conversionFactor: Number(event.target.value || 1) })} onBlur={() => onSave(line)} />
                </td>
                <td className="px-3 py-2 text-right font-black text-indigo-600">{fmt(lineConverted(line))}</td>
                <td className="px-3 py-2 text-center">
                  <input disabled={locked} className="w-20 px-2 py-1 rounded-lg border border-slate-200 text-center text-[10px] font-bold outline-none focus:ring-1 focus:ring-indigo-400" value={line.convertedUnit || ''} onChange={event => onChange({ ...line, convertedUnit: event.target.value })} onBlur={() => onSave(line)} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <input disabled={locked} className={textInput} placeholder="Công thức" value={line.conversionFormula || ''} onChange={event => onChange({ ...line, conversionFormula: event.target.value })} onBlur={() => onSave(line)} />
                    <input disabled={locked} className={textInput} placeholder="Ghi chú" value={line.note || ''} onChange={event => onChange({ ...line, note: event.target.value })} onBlur={() => onSave(line)} />
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-bold">{money(line.amountSnapshot)} đ</td>
                <td className="px-3 py-2 text-right">
                  {!locked && <button onClick={() => onRemove(line)} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

export default BoqReconciliationPanel;
