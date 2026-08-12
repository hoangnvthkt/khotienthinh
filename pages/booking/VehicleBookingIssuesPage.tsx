import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Eye,
  Loader2,
  MessageSquareWarning,
  RefreshCw,
  ShieldAlert,
  Star,
  XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
  fetchVehicleBookingIssues,
  getVehicleBookingIssueTransitions,
  transitionVehicleBookingIssue,
  validateVehicleBookingIssueTransition,
} from '../../lib/vehicleBookingIssueService';
import { canResolveSensitiveVehicleIssues } from '../../lib/vehicleBookingPermissions';
import type {
  VehicleBookingIssueStatus,
  VehicleBookingSensitiveIssue,
} from '../../types';

const STATUS_LABELS: Record<VehicleBookingIssueStatus, string> = {
  PENDING: 'Chờ tiếp nhận',
  IN_REVIEW: 'Đang xử lý',
  RESOLVED: 'Đã giải quyết',
  DISMISSED: 'Đã đóng',
};

const CATEGORY_LABELS: Record<string, string> = {
  SAFETY: 'An toàn / tốc độ',
  DRIVER_CONDUCT: 'Thái độ tài xế',
  VEHICLE_CONDITION: 'Tình trạng xe',
  SERVICE_DELAY: 'Chậm phục vụ',
  COST: 'Chi phí',
  OTHER: 'Khác',
};

const formatDateTime = (value: string): string => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  dateStyle: 'short',
  timeStyle: 'short',
}).format(new Date(value));

const statusClass = (status: VehicleBookingIssueStatus): string => ({
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  IN_REVIEW: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  RESOLVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  DISMISSED: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
})[status];

const VehicleBookingIssuesPage: React.FC = () => {
  const { user } = useApp();
  const toast = useToast();
  const canResolve = canResolveSensitiveVehicleIssues(user);
  const [status, setStatus] = useState<VehicleBookingIssueStatus | 'ALL'>('PENDING');
  const [items, setItems] = useState<VehicleBookingSensitiveIssue[]>([]);
  const [nextCursor, setNextCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<VehicleBookingSensitiveIssue | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<VehicleBookingIssueStatus | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [saving, setSaving] = useState(false);

  const loadIssues = async (append = false) => {
    try {
      append ? setLoadingMore(true) : setLoading(true);
      setError(null);
      const result = await fetchVehicleBookingIssues({
        status: status === 'ALL' ? undefined : status,
        limit: 50,
        cursor: append ? nextCursor : null,
      });
      setItems(current => append ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
      if (!append && selectedIssue) {
        setSelectedIssue(result.items.find(item => item.id === selectedIssue.id) || null);
      }
    } catch (loadError: any) {
      setError(loadError.message || 'Không thể tải phản ánh nhạy cảm.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    setSelectedIssue(null);
    setNextCursor(null);
    void loadIssues(false);
  }, [status]);

  const openTransition = (target: VehicleBookingIssueStatus) => {
    setTransitionTarget(target);
    setResolutionNote('');
  };

  const handleTransition = async () => {
    if (!selectedIssue || !transitionTarget) return;
    const validationError = validateVehicleBookingIssueTransition(
      selectedIssue.resolutionStatus,
      transitionTarget,
      resolutionNote,
    );
    if (validationError) {
      toast.error(validationError);
      return;
    }
    try {
      setSaving(true);
      await transitionVehicleBookingIssue({
        issueId: selectedIssue.id,
        targetStatus: transitionTarget,
        resolutionNote,
      });
      toast.success('Đã cập nhật trạng thái phản ánh.');
      setTransitionTarget(null);
      setResolutionNote('');
      setSelectedIssue(null);
      await loadIssues(false);
    } catch (transitionError: any) {
      toast.error(transitionError.message || 'Không thể cập nhật phản ánh.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Phản ánh dịch vụ nhạy cảm
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Nội dung được giới hạn cho tài khoản có quyền xem phản ánh.
          </p>
        </div>
        <button type="button" onClick={() => void loadIssues(false)} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Làm mới
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(['ALL', 'PENDING', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const).map(value => (
          <button key={value} type="button" onClick={() => setStatus(value)} className={`whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold transition ${status === value ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'}`}>
            {value === 'ALL' ? 'Tất cả' : STATUS_LABELS[value]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3" aria-label="Đang tải phản ánh">
          {[0, 1, 2].map(item => <div key={item} className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />)}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">{error}</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-800">
          <MessageSquareWarning className="mx-auto h-8 w-8 text-slate-400" />
          <h3 className="mt-3 text-sm font-bold">Không có phản ánh trong trạng thái này</h3>
          <p className="mt-1 text-xs text-slate-500">Chọn trạng thái khác để xem lịch sử xử lý.</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-3">
            {items.map(issue => (
              <button key={issue.id} type="button" onClick={() => setSelectedIssue(issue)} className={`w-full rounded-2xl border bg-white p-4 text-left transition hover:border-amber-300 dark:bg-slate-800 ${selectedIssue?.id === issue.id ? 'border-amber-500 ring-2 ring-amber-500/15' : 'border-slate-200 dark:border-slate-700'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{issue.bookingCode}</span>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass(issue.resolutionStatus)}`}>{STATUS_LABELS[issue.resolutionStatus]}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{issue.comment}</p>
                    <p className="mt-2 text-[11px] text-slate-500">{CATEGORY_LABELS[issue.issueCategory] || issue.issueCategory} · {issue.reporterName} · {formatDateTime(issue.createdAt)}</p>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                </div>
              </button>
            ))}
            {nextCursor && <button type="button" onClick={() => void loadIssues(true)} disabled={loadingMore} className="w-full rounded-xl border border-slate-300 py-2.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">{loadingMore ? 'Đang tải...' : 'Tải thêm'}</button>}
          </div>

          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800 xl:sticky xl:top-28">
            {selectedIssue ? (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-mono text-xs font-bold">{selectedIssue.bookingCode}</p><p className="mt-1 text-[11px] text-slate-500">{formatDateTime(selectedIssue.createdAt)}</p></div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass(selectedIssue.resolutionStatus)}`}>{STATUS_LABELS[selectedIssue.resolutionStatus]}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><p className="text-slate-500">Người phản ánh</p><p className="mt-1 font-semibold">{selectedIssue.reporterName}</p></div>
                  <div><p className="text-slate-500">Phòng ban</p><p className="mt-1 font-semibold">{selectedIssue.departmentName || 'Chưa xác định'}</p></div>
                  <div><p className="text-slate-500">Nhóm vấn đề</p><p className="mt-1 font-semibold">{CATEGORY_LABELS[selectedIssue.issueCategory] || selectedIssue.issueCategory}</p></div>
                  <div><p className="text-slate-500">Đánh giá</p><p className="mt-1 flex items-center gap-1 font-semibold"><Star className="h-4 w-4 fill-amber-400 text-amber-400" />{selectedIssue.rating ?? '—'}</p></div>
                </div>
                <div><p className="text-xs font-semibold text-slate-500">Nội dung riêng tư</p><p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 dark:bg-slate-900 dark:text-slate-200">{selectedIssue.comment}</p></div>
                {selectedIssue.resolutionNote && <div><p className="text-xs font-semibold text-slate-500">Kết quả xử lý</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{selectedIssue.resolutionNote}</p><p className="mt-1 text-[11px] text-slate-500">{selectedIssue.resolvedByName || 'Người xử lý'}{selectedIssue.resolvedAt ? ` · ${formatDateTime(selectedIssue.resolvedAt)}` : ''}</p></div>}
                {canResolve && getVehicleBookingIssueTransitions(selectedIssue.resolutionStatus).length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
                    {getVehicleBookingIssueTransitions(selectedIssue.resolutionStatus).map(target => (
                      <button key={target} type="button" onClick={() => openTransition(target)} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-white ${target === 'DISMISSED' ? 'bg-slate-600' : target === 'RESOLVED' ? 'bg-emerald-600' : 'bg-blue-600'}`}>
                        {target === 'IN_REVIEW' ? <Eye className="h-4 w-4" /> : target === 'RESOLVED' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        {STATUS_LABELS[target]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 text-center"><CircleDot className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-xs text-slate-500">Chọn một phản ánh để xem chi tiết.</p></div>
            )}
          </aside>
        </div>
      )}

      {transitionTarget && selectedIssue && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-800">
            <div><h3 className="text-sm font-bold">Chuyển sang “{STATUS_LABELS[transitionTarget]}”</h3><p className="mt-1 text-xs text-slate-500">Booking {selectedIssue.bookingCode}</p></div>
            {['RESOLVED', 'DISMISSED'].includes(transitionTarget) && <label className="block space-y-2 text-xs font-semibold">Kết quả xử lý<textarea rows={5} maxLength={4000} value={resolutionNote} onChange={event => setResolutionNote(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900" /></label>}
            <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setTransitionTarget(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold dark:border-slate-600">Đóng</button><button type="button" disabled={saving} onClick={() => void handleTransition()} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Xác nhận</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleBookingIssuesPage;
