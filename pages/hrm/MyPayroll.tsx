import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Banknote, CalendarDays, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { hrmSensitiveProjectionService } from '../../lib/hrmSensitiveProjectionService';
import type { PayrollRecord } from '../../types';

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Number(value || 0))}đ`;
const statusLabel = (status: PayrollRecord['status']) => status === 'paid' ? 'Đã thanh toán' : 'Đã xác nhận';

const MyPayroll: React.FC = () => {
  const navigate = useNavigate();
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRecords(await hrmSensitiveProjectionService.listMyPayrolls());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải phiếu lương cá nhân.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const latest = records[0];
  const paidTotal = useMemo(
    () => records.filter(record => record.status === 'paid').reduce((sum, record) => sum + Number(record.netSalary || 0), 0),
    [records],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/employee-dashboard')}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            aria-label="Quay lại"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white">Phiếu lương của tôi</h1>
            <p className="mt-1 text-xs font-semibold text-slate-500">Chỉ hiển thị phiếu đã xác nhận hoặc đã thanh toán.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Tải lại
        </button>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
        <ShieldCheck size={20} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-black">Dữ liệu cá nhân được giới hạn tại máy chủ</p>
          <p className="mt-1 text-xs leading-5 opacity-80">Hệ thống tự xác định hồ sơ từ phiên đăng nhập; màn hình không gửi mã nhân viên để tra cứu.</p>
        </div>
      </div>

      {loading && records.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-900">
          <RefreshCw size={36} className="mx-auto animate-spin text-emerald-500" />
          <p className="mt-3 text-sm font-bold text-slate-500">Đang tải phiếu lương...</p>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center dark:border-rose-900/60 dark:bg-rose-950/30">
          <p className="text-sm font-black text-rose-700 dark:text-rose-300">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-3 text-xs font-black text-rose-600 underline">Thử lại</button>
        </div>
      )}

      {!loading && !error && records.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-900">
          <Banknote size={44} className="mx-auto text-slate-300" />
          <p className="mt-3 font-black text-slate-700 dark:text-slate-200">Chưa có phiếu lương đã phát hành</p>
          <p className="mt-1 text-xs text-slate-500">Bản nháp của bộ phận nhân sự không hiển thị tại đây.</p>
        </div>
      )}

      {latest && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white shadow-lg shadow-emerald-500/20 sm:col-span-2">
            <p className="text-xs font-black uppercase tracking-wider text-emerald-100">Thực nhận gần nhất</p>
            <p className="mt-2 text-3xl font-black">{money(latest.netSalary)}</p>
            <p className="mt-2 text-xs font-bold text-emerald-100">Tháng {latest.month}/{latest.year} · {statusLabel(latest.status)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
            <WalletCards size={20} className="text-sky-500" />
            <p className="mt-3 text-xs font-bold text-slate-500">Tổng đã thanh toán</p>
            <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{money(paidTotal)}</p>
          </div>
        </div>
      )}

      {records.length > 0 && (
        <div className="space-y-3">
          {records.map(record => {
            const allowances = Number(record.allowance || 0);
            const deductions = Number(record.deduction || 0);
            return (
              <article key={record.id} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300"><CalendarDays size={20} /></div>
                    <div>
                      <h2 className="font-black text-slate-900 dark:text-white">Tháng {record.month}/{record.year}</h2>
                      <p className="text-xs font-semibold text-slate-500">{statusLabel(record.status)}</p>
                    </div>
                  </div>
                  <p className="text-xl font-black text-emerald-600">{money(record.netSalary)}</p>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-4">
                  <div><dt className="text-xs text-slate-500">Ngày công</dt><dd className="mt-1 font-black text-slate-800 dark:text-slate-200">{record.workingDays}/{record.standardDays}</dd></div>
                  <div><dt className="text-xs text-slate-500">Lương cơ bản</dt><dd className="mt-1 font-black text-slate-800 dark:text-slate-200">{money(record.baseSalary)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Phụ cấp</dt><dd className="mt-1 font-black text-sky-600">{money(allowances)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Khấu trừ</dt><dd className="mt-1 font-black text-rose-600">{money(deductions)}</dd></div>
                </dl>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MyPayroll;
