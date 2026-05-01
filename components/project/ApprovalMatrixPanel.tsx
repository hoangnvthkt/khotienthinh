import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, Save, X, Shield, Check, ToggleLeft, ToggleRight } from 'lucide-react';
import { approvalService, ApprovalRule, ApprovalModule, ApprovalAction } from '../../lib/approvalService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

interface Props {
  constructionSiteId?: string;
}

const MODULE_LABELS: Record<ApprovalModule, string> = {
  quantity_acceptance: 'Nghiệm thu KL',
  payment_certificate: 'Thanh toán',
  contract_variation: 'Phát sinh HĐ',
  purchase_order: 'Đơn hàng mua',
};

const ACTION_LABELS: Record<ApprovalAction, string> = {
  submit: 'Gửi duyệt',
  approve: 'Phê duyệt',
  paid: 'Xác nhận TT',
};

const fmtAmount = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
  if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
  return n.toLocaleString('vi-VN') + ' đ';
};

const ApprovalMatrixPanel: React.FC<Props> = ({ constructionSiteId }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ApprovalRule | null>(null);

  // Form state
  const [fName, setFName] = useState('');
  const [fModule, setFModule] = useState<ApprovalModule>('quantity_acceptance');
  const [fAction, setFAction] = useState<ApprovalAction>('approve');
  const [fMinAmount, setFMinAmount] = useState('0');
  const [fMaxAmount, setFMaxAmount] = useState('');
  const [fApproverRole, setFApproverRole] = useState('');
  const [fApproverUserId, setFApproverUserId] = useState('');
  const [fModuleAdmin, setFModuleAdmin] = useState(true);
  const [fDescription, setFDescription] = useState('');
  const [fPriority, setFPriority] = useState('0');
  const [fSiteSpecific, setFSiteSpecific] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRules(await approvalService.list(constructionSiteId));
    } catch (e: any) {
      toast.error('Lỗi tải quy tắc', e?.message);
    } finally {
      setLoading(false);
    }
  }, [constructionSiteId]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setEditing(null);
    setFName('');
    setFModule('quantity_acceptance');
    setFAction('approve');
    setFMinAmount('0');
    setFMaxAmount('');
    setFApproverRole('');
    setFApproverUserId('');
    setFModuleAdmin(true);
    setFDescription('');
    setFPriority('0');
    setFSiteSpecific(false);
    setShowForm(false);
  };

  const openAdd = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (r: ApprovalRule) => {
    setEditing(r);
    setFName(r.name);
    setFModule(r.module);
    setFAction(r.action);
    setFMinAmount(String(r.minAmount));
    setFMaxAmount(r.maxAmount != null ? String(r.maxAmount) : '');
    setFApproverRole(r.approverRole || '');
    setFApproverUserId(r.approverUserId || '');
    setFModuleAdmin(r.approverModuleAdmin);
    setFDescription(r.description || '');
    setFPriority(String(r.priority));
    setFSiteSpecific(!!r.constructionSiteId);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!fName.trim()) { toast.warning('Thiếu thông tin', 'Vui lòng nhập tên quy tắc'); return; }
    if (!fApproverRole && !fApproverUserId && !fModuleAdmin) {
      toast.warning('Thiếu người duyệt', 'Cần chọn ít nhất 1 tiêu chí: vai trò, user ID, hoặc quản trị module');
      return;
    }

    try {
      await approvalService.upsert({
        id: editing?.id,
        name: fName.trim(),
        module: fModule,
        action: fAction,
        minAmount: Number(fMinAmount) || 0,
        maxAmount: fMaxAmount ? Number(fMaxAmount) : undefined,
        approverRole: fApproverRole || undefined,
        approverUserId: fApproverUserId || undefined,
        approverModuleAdmin: fModuleAdmin,
        description: fDescription || undefined,
        priority: Number(fPriority) || 0,
        constructionSiteId: fSiteSpecific ? constructionSiteId : undefined,
        isActive: true,
      });
      await load();
      resetForm();
      toast.success(editing ? 'Đã cập nhật quy tắc' : 'Đã thêm quy tắc mới');
    } catch (e: any) {
      toast.error('Lỗi lưu', e?.message);
    }
  };

  const handleDelete = async (r: ApprovalRule) => {
    const ok = await confirm({ title: 'Xoá quy tắc duyệt', targetName: r.name });
    if (!ok) return;
    try {
      await approvalService.remove(r.id);
      await load();
      toast.success('Đã xoá quy tắc');
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
    }
  };

  const toggleActive = async (r: ApprovalRule) => {
    try {
      await approvalService.toggleActive(r.id, !r.isActive);
      await load();
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
              <Shield size={15} className="text-white" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-800 dark:text-white">Ma trận phân quyền duyệt</h3>
              <p className="text-[10px] text-slate-400">Cấu hình ai được duyệt gì, ở ngưỡng giá trị nào</p>
            </div>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold text-white bg-gradient-to-r from-violet-500 to-purple-600 shadow-lg shadow-violet-500/20 hover:shadow-xl hover:scale-[1.02] transition-all">
            <Plus size={12} /> Thêm quy tắc
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="p-4 bg-violet-50/50 dark:bg-violet-900/10 border-b border-violet-100 dark:border-violet-800">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2">
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Tên quy tắc *</label>
                <input value={fName} onChange={e => setFName(e.target.value)}
                  placeholder="VD: Admin duyệt TT > 500tr"
                  className="w-full px-3 py-2 rounded-xl border border-violet-200 text-xs outline-none focus:ring-2 focus:ring-violet-400 dark:bg-slate-800 dark:border-slate-600" />
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Module</label>
                <select value={fModule} onChange={e => setFModule(e.target.value as ApprovalModule)}
                  className="w-full px-3 py-2 rounded-xl border border-violet-200 text-xs dark:bg-slate-800 dark:border-slate-600">
                  {Object.entries(MODULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Hành động</label>
                <select value={fAction} onChange={e => setFAction(e.target.value as ApprovalAction)}
                  className="w-full px-3 py-2 rounded-xl border border-violet-200 text-xs dark:bg-slate-800 dark:border-slate-600">
                  {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Ngưỡng tối thiểu (VNĐ)</label>
                <input type="number" value={fMinAmount} onChange={e => setFMinAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-violet-200 text-xs dark:bg-slate-800 dark:border-slate-600" />
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Ngưỡng tối đa (để trống = ∞)</label>
                <input type="number" value={fMaxAmount} onChange={e => setFMaxAmount(e.target.value)} placeholder="Không giới hạn"
                  className="w-full px-3 py-2 rounded-xl border border-violet-200 text-xs dark:bg-slate-800 dark:border-slate-600" />
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Vai trò được duyệt</label>
                <select value={fApproverRole} onChange={e => setFApproverRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-violet-200 text-xs dark:bg-slate-800 dark:border-slate-600">
                  <option value="">— Không chỉ định —</option>
                  <option value="ADMIN">ADMIN (Quản trị hệ thống)</option>
                  <option value="MANAGER">MANAGER (Quản lý)</option>
                </select>
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Ưu tiên (số lớn = cao)</label>
                <input type="number" value={fPriority} onChange={e => setFPriority(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-violet-200 text-xs dark:bg-slate-800 dark:border-slate-600" />
              </div>

              <div className="col-span-2">
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Mô tả</label>
                <input value={fDescription} onChange={e => setFDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-violet-200 text-xs dark:bg-slate-800 dark:border-slate-600" />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={fModuleAdmin} onChange={e => setFModuleAdmin(e.target.checked)} className="rounded" />
                  <span className="text-[10px] font-bold text-slate-600">Quản trị module DA</span>
                </label>
                {constructionSiteId && (
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={fSiteSpecific} onChange={e => setFSiteSpecific(e.target.checked)} className="rounded" />
                    <span className="text-[10px] font-bold text-slate-600">Riêng công trình này</span>
                  </label>
                )}
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button onClick={resetForm} className="px-3 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 border border-slate-200">
                  <X size={12} className="inline mr-1" />Huỷ
                </button>
                <button onClick={handleSave} className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 shadow-sm">
                  <Save size={12} className="inline mr-1" />{editing ? 'Cập nhật' : 'Thêm'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rules list */}
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Đang tải...</div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-center">
            <Shield size={32} className="mx-auto mb-2 text-slate-200" />
            <p className="text-xs font-bold text-slate-400">Chưa có quy tắc nào</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700">
            {rules.map(r => (
              <div key={r.id} className={`px-4 py-3 flex items-center justify-between hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition-colors ${!r.isActive ? 'opacity-40' : ''}`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <button onClick={() => toggleActive(r)} title={r.isActive ? 'Tắt' : 'Bật'}
                    className="flex-shrink-0">
                    {r.isActive ? <ToggleRight size={20} className="text-emerald-500" /> : <ToggleLeft size={20} className="text-slate-300" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-800 dark:text-white truncate">{r.name}</div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200">{MODULE_LABELS[r.module]}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 border border-sky-200">{ACTION_LABELS[r.action]}</span>
                      <span className="text-[9px] text-slate-400">
                        {r.minAmount > 0 ? `≥ ${fmtAmount(r.minAmount)}` : 'Mọi giá trị'}
                        {r.maxAmount != null ? ` — ≤ ${fmtAmount(r.maxAmount)}` : ''}
                      </span>
                      {r.constructionSiteId && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">Riêng CT</span>}
                      <span className="text-[9px] text-slate-400">Ưu tiên: {r.priority}</span>
                    </div>
                    {r.description && <div className="text-[9px] text-slate-400 mt-0.5 truncate">{r.description}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  <div className="text-right">
                    {r.approverRole && <div className="text-[9px] font-bold text-indigo-600">Vai trò: {r.approverRole}</div>}
                    {r.approverModuleAdmin && <div className="text-[9px] font-bold text-emerald-600">QT Module DA</div>}
                    {r.approverUserId && <div className="text-[9px] text-slate-400 truncate max-w-[100px]">User: {r.approverUserId.slice(0, 8)}...</div>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(r)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors">
                      <Edit2 size={12} />
                    </button>
                    <button onClick={() => handleDelete(r)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ApprovalMatrixPanel;
