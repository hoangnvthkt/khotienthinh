import React, { useCallback, useEffect, useState } from 'react';
import { MousePointerClick, Percent, RefreshCcw, Rows3, Sparkles, Users } from 'lucide-react';
import { StateBox, secondaryBtn } from '../../components/procurement/hub/hubUi';
import {
  fetchUiSuggestionStats, groupSuggestionRows, ratioPercent, suggestionFieldLabel, suggestionScreenLabel, type UiSuggestionStatRow, type UiSuggestionStats,
} from '../../lib/uiSuggestionStats';
import { viDate } from '../../components/finance/financeUi';

// Bảng đo gợi ý in mờ (Admin): người dùng dùng / sửa / bỏ gợi ý theo màn và ô. Chỉ số liệu, không giải thích dài — chi tiết để title.
const PERIODS = [7, 30, 90];
/** Cột: ô (co giãn) · lượt · dùng · sửa · bỏ · thanh tỷ lệ (chỉ từ tablet). */
const GRID = 'grid grid-cols-[minmax(0,1fr)_2.75rem_3.25rem_2.75rem_2.5rem] items-center gap-x-2 px-3 sm:grid-cols-[minmax(0,1fr)_3.5rem_4rem_3.5rem_3.5rem_10rem] sm:gap-x-3 sm:px-4';
const nf = new Intl.NumberFormat('vi-VN');
const pct = (part: number, whole: number) => { const value = ratioPercent(part, whole); return value == null ? '—' : `${value}%`; };

const Card: React.FC<{ icon: React.ElementType; label: string; value: string; hint: string; tone: string }> = ({ icon: Icon, label, value, hint, tone }) =>
  <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
    <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Icon size={14} className={tone} />{label}</span>
    <span className={`mt-1.5 block text-xl font-bold tabular-nums ${tone}`}>{value}</span>
    <span className="block text-xs text-muted-foreground">{hint}</span>
  </div>;

/** Thanh tỷ lệ: dùng (xanh lá) · sửa (xanh trời) · bỏ (xám). */
const OutcomeBar: React.FC<{ row: UiSuggestionStatRow }> = ({ row }) => {
  const w = (n: number) => `${(n / row.events) * 100}%`;
  return <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" title={`Dùng ${row.accepted} · Sửa ${row.edited} · Bỏ ${row.dismissed}`}>
    <span className="bg-leaf-500" style={{ width: w(row.accepted) }} />
    <span className="bg-sky-400" style={{ width: w(row.edited) }} />
  </div>;
};

const SettingsSuggestionStats: React.FC = () => {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<UiSuggestionStats | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async (period: number) => {
    setState('loading');
    try {
      setStats(await fetchUiSuggestionStats(period));
      setState('ready');
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message || e));
      setState(code === '42501' ? 'denied' : 'error');
    }
  }, []);
  useEffect(() => { load(days); }, [days, load]);

  const total = stats?.total;
  const accepted = stats?.rows.reduce((sum, r) => sum + r.accepted, 0) ?? 0;
  const suggestedRows = stats?.rows.reduce((sum, r) => sum + r.suggestedRows, 0) ?? 0;
  const acceptedRows = stats?.rows.reduce((sum, r) => sum + r.acceptedRows, 0) ?? 0;
  const groups = stats ? groupSuggestionRows(stats) : [];

  return (
    <div className="space-y-4" data-testid="suggestion-stats">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white"><Sparkles size={22} /></div>
          <div>
            <h2 className="text-xl font-bold text-foreground md:text-2xl">Gợi ý nhập liệu</h2>
            <p className="text-sm text-muted-foreground">Người dùng dùng, sửa hay bỏ gợi ý in mờ trên từng màn.</p>
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="flex flex-1 rounded-xl border border-border bg-card p-1 sm:flex-none" role="group" aria-label="Khoảng thời gian">
            {PERIODS.map(p => (
              <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold sm:flex-none ${days === p ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted'}`}>
                {p} ngày
              </button>
            ))}
          </div>
          <button type="button" onClick={() => load(days)} disabled={state === 'loading'} className={`${secondaryBtn} bg-card`} title="Tải lại số liệu">
            <RefreshCcw size={15} className={state === 'loading' ? 'animate-spin' : ''} /><span className="hidden sm:inline">Làm mới</span>
          </button>
        </div>
      </div>

      {state === 'loading' && !stats && <StateBox kind="loading" title="Đang tải số liệu…" />}
      {state === 'denied' && <StateBox kind="denied" title="Chỉ Admin xem được bảng này" />}
      {state === 'error' && <StateBox kind="error" title="Không tải được số liệu" message={error} onRetry={() => load(days)} />}

      {stats && state !== 'denied' && state !== 'error' && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card icon={MousePointerClick} label="Lượt gợi ý" value={nf.format(total?.events || 0)} hint={`${stats.days} ngày qua`} tone="text-teal-700 dark:text-teal-300" />
            <Card icon={Percent} label="Tỷ lệ dùng" value={pct(accepted, total?.events || 0)} hint="dùng nguyên, không sửa" tone="text-leaf-700 dark:text-leaf-300" />
            <Card icon={Rows3} label="Dòng tự điền" value={suggestedRows ? `${nf.format(acceptedRows)}/${nf.format(suggestedRows)}` : '—'} hint={`${pct(acceptedRows, suggestedRows)} dòng gợi ý được giữ`} tone="text-mint-700 dark:text-mint-300" />
            <Card icon={Users} label="Người dùng" value={nf.format(total?.users || 0)} hint={total?.lastAt ? `lần cuối ${viDate(total.lastAt)}` : 'đã thấy gợi ý'} tone="text-slate-700 dark:text-slate-200" />
          </div>

          {groups.length === 0
            ? <StateBox kind="empty" title={`Chưa có lượt gợi ý nào trong ${stats.days} ngày`} message="Gợi ý đang chạy ở Nhật ký, Lập đơn và Đề xuất vật tư." />
            : groups.map(group => (
              <section key={group.screen} className="rounded-2xl border border-border bg-card shadow-sm" aria-label={suggestionScreenLabel(group.screen)}>
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <h3 className="text-sm font-bold text-foreground">{suggestionScreenLabel(group.screen)}</h3>
                  <span className="text-xs text-muted-foreground tabular-nums">{nf.format(group.events)} lượt{group.users != null ? ` · ${nf.format(group.users)} người` : ''}</span>
                </header>
                {/* Lưới thay <table>: CSS chung trên điện thoại ép bảng thành cuộn ngang, cột đều nhau. */}
                <div role="table" aria-label={`Theo ô · ${suggestionScreenLabel(group.screen)}`} className="text-sm">
                  <div role="row" className={`${GRID} py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground`}>
                    <span role="columnheader">Ô</span>
                    <span role="columnheader" className="text-right">Lượt</span>
                    <span role="columnheader" className="text-right">Dùng</span>
                    <span role="columnheader" className="text-right">Sửa</span>
                    <span role="columnheader" className="text-right">Bỏ</span>
                    <span role="columnheader" className="hidden sm:block">Tỷ lệ dùng</span>
                  </div>
                  {group.rows.map(row => (
                    <div role="row" key={row.field} className={`${GRID} border-t border-border/60 py-2`}>
                      <div role="cell" className="min-w-0 font-medium text-foreground">
                        {suggestionFieldLabel(row.field)}
                        <span className="block truncate text-[11px] font-normal text-muted-foreground tabular-nums">
                          {row.suggestedRows ? `${nf.format(row.acceptedRows)}/${nf.format(row.suggestedRows)} dòng` : ''}{row.users ? `${row.suggestedRows ? ' · ' : ''}${row.users} người` : ''}
                        </span>
                      </div>
                      <span role="cell" className="text-right tabular-nums">{nf.format(row.events)}</span>
                      <span role="cell" className="text-right tabular-nums font-bold text-leaf-700 dark:text-leaf-300">{nf.format(row.accepted)}<span className="block text-[11px] font-normal text-muted-foreground">{pct(row.accepted, row.events)}</span></span>
                      <span role="cell" className="text-right tabular-nums text-sky-700 dark:text-sky-300">{nf.format(row.edited)}</span>
                      <span role="cell" className="text-right tabular-nums text-muted-foreground">{nf.format(row.dismissed)}</span>
                      <span role="cell" className="hidden sm:block"><OutcomeBar row={row} /></span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
        </>
      )}
    </div>
  );
};

export default SettingsSuggestionStats;
