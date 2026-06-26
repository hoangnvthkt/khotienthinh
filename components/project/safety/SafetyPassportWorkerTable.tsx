import React, { useMemo, useState } from 'react';
import { CreditCard, Eye, Plus, Printer, Search } from 'lucide-react';
import { EmptyState, StatusBadge } from '../../erp';
import {
  SafetyCard,
  SafetyPassportAssignmentStatus,
  SafetyPassportContractor,
  SafetyPassportDocumentReadiness,
  SafetyProjectWorkerRow,
} from '../../../types';
import { SAFETY_WORKER_LIST_GROUPS } from '../../../lib/safetyPassportConfig';
import { getSafetyAssignmentStatusLabel } from '../../../lib/safetyPassportService';

type Props = {
  rows: SafetyProjectWorkerRow[];
  loading?: boolean;
  canManage?: boolean;
  onCreateAssignment: () => void;
  onOpenDetail: (row: SafetyProjectWorkerRow) => void;
  onIssueCard: (row: SafetyProjectWorkerRow) => void;
  onPrintCard: (card: SafetyCard) => void;
};

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const readinessLabel: Record<SafetyPassportDocumentReadiness, string> = {
  missing: 'Thiếu',
  valid: 'Đã đủ',
  expired: 'Hết hạn',
  rejected: 'Từ chối',
};

const readinessTone = (status: SafetyPassportDocumentReadiness) => {
  if (status === 'valid') return 'success';
  if (status === 'expired' || status === 'rejected') return 'danger';
  return 'warning';
};

const assignmentTone = (status: SafetyPassportAssignmentStatus) => {
  if (status === 'eligible') return 'success';
  if (status === 'suspended' || status === 'expired_certificate') return 'danger';
  return 'warning';
};

const includes = (value: string | null | undefined, keyword: string) =>
  String(value || '').toLowerCase().includes(keyword);

const SafetyPassportWorkerTable: React.FC<Props> = ({
  rows,
  loading,
  canManage = true,
  onCreateAssignment,
  onOpenDetail,
  onIssueCard,
  onPrintCard,
}) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | SafetyPassportAssignmentStatus>('all');
  const [contractorId, setContractorId] = useState('all');
  const [documentFilter, setDocumentFilter] = useState<'all' | 'missing' | 'expired'>('all');

  const contractorOptions = useMemo(() => {
    const map = new Map<string, SafetyPassportContractor>();
    rows.forEach(row => {
      if (row.contractor?.id) map.set(row.contractor.id, row.contractor);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return rows.filter(row => {
      if (status !== 'all' && row.assignment.eligibilityStatus !== status) return false;
      if (contractorId !== 'all' && row.contractor?.id !== contractorId) return false;
      if (documentFilter === 'missing' && row.profileStatus === 'valid' && row.healthStatus === 'valid' && row.insuranceStatus === 'valid') return false;
      if (documentFilter === 'expired' && row.healthStatus !== 'expired' && row.insuranceStatus !== 'expired') return false;
      if (!keyword) return true;
      return [
        row.worker?.workerCode,
        row.worker?.fullName,
        row.worker?.phone,
        row.contractor?.name,
        row.assignment.siteAccessCardCode,
        row.card?.cardCode,
      ].some(value => includes(value, keyword));
    });
  }, [contractorId, documentFilter, rows, search, status]);

  if (!loading && rows.length === 0) {
    return (
      <section className="space-y-4">
        <div className="flex justify-end">
          {canManage && <button onClick={onCreateAssignment} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white"><Plus size={14} /> Gán nhân công</button>}
        </div>
        <EmptyState icon={<CreditCard size={18} />} title="Chưa có nhân công công trình" message="Gán hồ sơ Safety Passport vào công trình để kiểm tra điều kiện." />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex flex-wrap gap-2">
          {SAFETY_WORKER_LIST_GROUPS.map(group => (
            <span key={group.title} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
              {group.title}
            </span>
          ))}
        </div>
        <div className="grid gap-2 lg:grid-cols-[1fr_180px_220px_160px_auto]">
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3">
            <Search size={14} className="text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 text-sm font-bold outline-none" placeholder="Tìm mã, họ tên, nhà thầu, thẻ..." />
          </label>
          <select value={status} onChange={event => setStatus(event.target.value as any)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
            <option value="all">Tất cả trạng thái</option>
            <option value="eligible">Đủ điều kiện</option>
            <option value="missing_profile">Thiếu hồ sơ</option>
            <option value="missing_certificate">Thiếu chứng chỉ</option>
            <option value="expired_certificate">Hết hạn chứng chỉ</option>
            <option value="missing_site_requirement">Thiếu yêu cầu CT</option>
            <option value="suspended">Tạm khóa</option>
          </select>
          <select value={contractorId} onChange={event => setContractorId(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
            <option value="all">Tất cả nhà thầu/tổ đội</option>
            {contractorOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select value={documentFilter} onChange={event => setDocumentFilter(event.target.value as any)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
            <option value="all">Tất cả hồ sơ</option>
            <option value="missing">Thiếu hồ sơ</option>
            <option value="expired">Hồ sơ hết hạn</option>
          </select>
          {canManage && <button onClick={onCreateAssignment} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white"><Plus size={14} /> Gán nhân công</button>}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1500px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky left-0 z-20 bg-slate-50 px-3 py-3">Mã giới thiệu</th>
                <th className="sticky left-[116px] z-20 bg-slate-50 px-3 py-3">Họ tên</th>
                <th className="px-3 py-3">Mã thẻ vào ra</th>
                <th className="px-3 py-3">Ngày vào</th>
                <th className="px-3 py-3">Nhà thầu / tổ đội</th>
                <th className="px-3 py-3">Loại công việc</th>
                <th className="px-3 py-3">Chức vụ</th>
                <th className="px-3 py-3">Ngày sinh</th>
                <th className="px-3 py-3">SĐT</th>
                <th className="px-3 py-3">CCCD</th>
                <th className="px-3 py-3">Sức khỏe</th>
                <th className="px-3 py-3">Bảo hiểm</th>
                <th className="px-3 py-3">Thẻ an toàn</th>
                <th className="px-3 py-3">Nội quy</th>
                <th className="px-3 py-3">PPE</th>
                <th className="px-3 py-3">Trạng thái</th>
                <th className="px-3 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.map(row => (
                <tr key={row.assignment.id} className="hover:bg-orange-50/30">
                  <td className="sticky left-0 z-10 bg-white px-3 py-3 font-mono font-black text-orange-600">{row.worker?.workerCode || '-'}</td>
                  <td className="sticky left-[116px] z-10 bg-white px-3 py-3">
                    <div className="font-black text-slate-800">{row.worker?.fullName || row.assignment.workerId}</div>
                    <div className="mt-0.5 text-[10px] font-bold text-slate-400">{row.profileStatus === 'valid' ? 'Hồ sơ gốc đủ' : 'Thiếu hồ sơ gốc'}</div>
                  </td>
                  <td className="px-3 py-3 font-mono font-bold text-slate-600">{row.assignment.siteAccessCardCode || '-'}</td>
                  <td className="px-3 py-3 font-bold text-slate-600">{formatDate(row.assignment.startDate)}</td>
                  <td className="px-3 py-3 font-bold text-slate-700">{row.contractor?.name || row.assignment.teamName || '-'}</td>
                  <td className="px-3 py-3 font-bold text-slate-600">{row.assignment.workType || '-'}</td>
                  <td className="px-3 py-3 font-bold text-slate-600">{row.assignment.roleName || row.worker?.roleName || '-'}</td>
                  <td className="px-3 py-3 font-bold text-slate-600">{formatDate(row.worker?.dateOfBirth)}</td>
                  <td className="px-3 py-3 font-bold text-slate-600">{row.worker?.phone || '-'}</td>
                  <td className="px-3 py-3 font-mono font-bold text-slate-600">{row.identityNumberMasked}</td>
                  <td className="px-3 py-3"><StatusBadge status={row.healthStatus} label={readinessLabel[row.healthStatus]} tone={readinessTone(row.healthStatus)} /></td>
                  <td className="px-3 py-3"><StatusBadge status={row.insuranceStatus} label={readinessLabel[row.insuranceStatus]} tone={readinessTone(row.insuranceStatus)} /></td>
                  <td className="px-3 py-3">{row.card ? <StatusBadge status={row.card.status} label={row.card.cardCode} tone={row.card.status === 'active' ? 'success' : 'warning'} /> : <StatusBadge status="missing" label="Chưa cấp" tone="warning" />}</td>
                  <td className="px-3 py-3"><StatusBadge status={row.assignment.siteTrainingStatus} label={row.assignment.siteTrainingStatus === 'completed' ? 'Đã xong' : 'Chưa xong'} tone={row.assignment.siteTrainingStatus === 'completed' ? 'success' : 'warning'} /></td>
                  <td className="px-3 py-3"><StatusBadge status={row.assignment.ppeStatus} label={row.assignment.ppeStatus === 'complete' ? 'Đã đủ' : 'Chưa đủ'} tone={row.assignment.ppeStatus === 'complete' ? 'success' : 'warning'} /></td>
                  <td className="px-3 py-3"><StatusBadge status={row.assignment.eligibilityStatus} label={getSafetyAssignmentStatusLabel(row.assignment.eligibilityStatus)} tone={assignmentTone(row.assignment.eligibilityStatus)} /></td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      {canManage && <button onClick={() => onOpenDetail(row)} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[11px] font-black text-slate-600 hover:bg-slate-50"><Eye size={13} /> Xem/Sửa</button>}
                      {canManage && row.assignment.eligibilityStatus === 'eligible' && !row.card && <button onClick={() => onIssueCard(row)} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-black text-emerald-700"><CreditCard size={13} /> Cấp thẻ</button>}
                      {canManage && row.card && <button onClick={() => onPrintCard(row.card as SafetyCard)} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-black text-blue-700"><Printer size={13} /> In</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={17} className="px-4 py-8 text-center text-sm font-bold text-slate-400">Không có nhân công phù hợp bộ lọc.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};

export default SafetyPassportWorkerTable;
