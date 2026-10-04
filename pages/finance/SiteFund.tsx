import React, { useCallback, useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinanceSiteExpense, type FinanceSiteFund, type FinanceSiteFunds } from '../../lib/financeService';
import { StateBox } from '../../components/procurement/hub/hubUi';
import { SiteExpenseDrawer, SiteExpenseList, SiteFundHolderHeader } from '../../components/finance/SiteFundViews';

// Quỹ công trường của tôi: người giữ quỹ (thường là CHT) ghi từng khoản chi kèm ảnh hóa đơn trên điện thoại.
// Không cần quyền Tài chính — máy chủ chỉ trả quỹ mà người này giữ.
const SiteFund: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<FinanceSiteFunds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<{ fund: FinanceSiteFund; expense?: FinanceSiteExpense } | null>(null);
  const load = useCallback(() => { setError(null); financeService.siteFunds().then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);
  const mine = data?.funds.filter(f => f.mine) || [];
  return <main className="mx-auto min-h-screen max-w-xl space-y-3 bg-slate-50 px-3 py-4 text-foreground dark:bg-slate-950 sm:px-5">
    <header className="flex items-start gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-700 to-mint-500 text-white shadow-sm"><Wallet size={22} /></span>
      <div><h1 className="text-xl font-bold">Quỹ công trường của tôi</h1><p className="text-sm text-muted-foreground">Ghi từng khoản đã chi kèm ảnh hóa đơn; kế toán duyệt rồi ghi vào chi phí dự án.</p></div>
    </header>
    {error ? <StateBox kind="error" title="Chưa tải được quỹ công trường" message={error} onRetry={load} />
      : !data ? <StateBox kind="loading" title="Đang tải quỹ công trường…" />
        : mine.length === 0 ? <StateBox kind="empty" title="Bạn chưa giữ quỹ công trường nào" message="Khi kế toán giao quỹ công trường cho bạn (Tài chính → Thu chi & quỹ), quỹ sẽ hiện ở đây." />
          : mine.map(f => <div key={f.id} className="space-y-3">
            <SiteFundHolderHeader fund={f} onAdd={() => setDrawer({ fund: f })} />
            <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <h3 className="font-semibold">Khoản đã chi</h3>
              <SiteExpenseList fund={f} busy={busy} onEdit={x => setDrawer({ fund: f, expense: x })} onWithdraw={async x => {
                setBusy(true); try { await financeService.withdrawSiteExpense({ id: x.id, expectedRowVersion: x.rowVersion }); toast.success('Quỹ công trường', 'Đã rút khoản chi.'); load(); }
                catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); } }} />
            </section>
          </div>)}
    {drawer && data && <SiteExpenseDrawer data={data} fund={drawer.fund} expense={drawer.expense} onClose={() => setDrawer(null)} onSaved={m => { toast.success('Quỹ công trường', m); setDrawer(null); load(); }} />}
  </main>;
};

export default SiteFund;
