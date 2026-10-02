import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, ClipboardCheck, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type CheckKey = 'startDate' | 'dateOfBirth' | 'phone' | 'orgUnit' | 'position' | 'manager'
  | 'identity' | 'insurance' | 'contract' | 'bankAccount' | 'leaveBalance';

interface CompletenessRow {
  employeeId: string;
  employeeCode: string | null;
  fullName: string;
  orgUnitName: string | null;
  checks: Record<CheckKey, boolean>;
  missingCount: number;
}

// Ordered by what blocks daily work first: approvals, leave, payroll.
const CHECKS: Array<{ key: CheckKey; label: string; why: string }> = [
  { key: 'manager', label: 'Người duyệt', why: 'Đơn nghỉ không tìm được trưởng bộ phận' },
  { key: 'leaveBalance', label: 'Số phép năm', why: 'Không xin được phép năm' },
  { key: 'orgUnit', label: 'Đơn vị', why: 'Thiếu trong sơ đồ tổ chức' },
  { key: 'position', label: 'Vị trí', why: 'Thiếu vị trí công việc' },
  { key: 'contract', label: 'HĐLĐ', why: 'Không có hợp đồng đang hiệu lực' },
  { key: 'identity', label: 'CCCD', why: 'Thiếu giấy tờ định danh' },
  { key: 'insurance', label: 'Số BHXH', why: 'Thiếu số sổ BHXH' },
  { key: 'bankAccount', label: 'Tài khoản lương', why: 'Thiếu tài khoản nhận lương' },
  { key: 'startDate', label: 'Ngày vào làm', why: 'Không tính được thâm niên' },
  { key: 'dateOfBirth', label: 'Ngày sinh', why: 'Thiếu ngày sinh' },
  { key: 'phone', label: 'Điện thoại', why: 'Thiếu số điện thoại' },
];

/** HR to-do: which employee records still miss what, worst first. */
const HrmProfileCompletenessPanel: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CompletenessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<CheckKey | ''>('');

  const load = async () => {
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('list_hrm_profile_completeness');
    if (rpcError) setError(rpcError.message || 'Không tải được bảng hồ sơ còn thiếu.');
    else setRows((data || []) as CompletenessRow[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => CHECKS.map(check => ({
    ...check, missing: rows.filter(row => row.checks[check.key] === false).length,
  })), [rows]);
  const complete = rows.filter(row => row.missingCount === 0).length;
  const visible = rows.filter(row => row.missingCount > 0 && (!filter || row.checks[filter] === false));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center gap-3 p-4 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mint-100 text-mint-700 dark:bg-mint-900/40 dark:text-mint-300">
          <ClipboardCheck size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-slate-800 dark:text-white">Hồ sơ còn thiếu</p>
          <p className="text-xs text-slate-500">
            {loading ? 'Đang kiểm tra…' : error ? error : `${complete}/${rows.length} hồ sơ đã đủ thông tin chính · ${rows.length - complete} hồ sơ cần bổ sung`}
          </p>
        </div>
        {open ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4 dark:border-slate-800">
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setFilter('')}
              className={`rounded-full px-3 py-1 text-[11px] font-bold ${filter === '' ? 'bg-mint-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
              Tất cả
            </button>
            {totals.filter(total => total.missing > 0).map(total => (
              <button key={total.key} type="button" onClick={() => setFilter(total.key)} title={total.why}
                className={`rounded-full px-3 py-1 text-[11px] font-bold ${filter === total.key ? 'bg-mint-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                Thiếu {total.label} · {total.missing}
              </button>
            ))}
            <button type="button" onClick={() => void load()} className="ml-auto rounded-full p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Tải lại">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          {filter && <p className="mb-2 text-xs text-slate-500">{CHECKS.find(check => check.key === filter)?.why}.</p>}
          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">{loading ? 'Đang tải…' : 'Không còn hồ sơ nào thiếu mục này.'}</p>
          ) : (
            <div className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {visible.map(row => (
                <button key={row.employeeId} type="button" onClick={() => navigate(`/ep/${row.employeeId}`)}
                  className="flex w-full items-start gap-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-mint-700 dark:text-mint-300">
                      {row.fullName} <span className="font-mono text-[11px] text-slate-400">{row.employeeCode}</span>
                    </p>
                    <p className="text-[11px] text-slate-500">{row.orgUnitName || 'Chưa có đơn vị'}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {CHECKS.filter(check => row.checks[check.key] === false).map(check => (
                        <span key={check.key} className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                          {check.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    Thiếu {row.missingCount}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default HrmProfileCompletenessPanel;
