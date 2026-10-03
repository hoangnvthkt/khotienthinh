import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, HandCoins, Loader2, Lock, Plus, Save, Scale, ShieldCheck, SlidersHorizontal, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinanceSettings } from '../../lib/financeService';
import { Badge, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, moneyInput, parseMoney, viDate } from './financeUi';
import { CostCutoverSection } from './CostCutoverSection';

// Quản trị Tài chính: thông số chung, ma trận duyệt chi (có phiên bản) + ủy quyền, thông số tạm ứng NCC,
// trách nhiệm (ai đang giữ quyền nào) và các ràng buộc máy chủ đang chặn.
// Admin / Quản trị Tài chính sửa; mỗi lần sửa bắt buộc lý do, ghi nhật ký và báo cho Admin, Quản trị Tài chính.

type AdminTab = 'general' | 'approval' | 'advance' | 'roles';
const ROLE_ROWS: Array<{ key: 'view' | 'record' | 'confirm' | 'manage'; label: string; work: string }> = [
  { key: 'view', label: 'Xem công nợ toàn công ty', work: 'Xem Phải trả, đề nghị chi, tạm ứng mọi dự án' },
  { key: 'record', label: 'Ghi nhận', work: 'Ghi nợ phiếu nhập / bảng đối soát, lập đề nghị chi và tạm ứng, đối chiếu đầu kỳ, ghi chi ngoài, NCC hoàn tạm ứng, cấn trừ tay' },
  { key: 'confirm', label: 'Xác nhận', work: 'Xác nhận đã chi (UNC), xác nhận chi ngoài, chốt đầu kỳ, hủy công nợ, xác nhận hoàn / chuyển tạm ứng — luôn khác người lập' },
  { key: 'manage', label: 'Quản trị Tài chính', work: 'Xem Tổng quan Ban giám đốc, sửa hạn thanh toán, ma trận duyệt, thông số tạm ứng, mốc chi phí MISA' },
];
const RULES: Array<{ group: string; items: Array<{ text: string; where?: AdminTab }> }> = [
  { group: 'Đề nghị chi & tạm ứng', items: [
    { text: 'Luồng duyệt lấy theo ma trận và chốt lúc gửi; ngưỡng xét theo tổng các đề nghị cùng NCC trong 7 ngày (chống chia nhỏ).', where: 'approval' },
    { text: 'Người lập không duyệt; một người không duyệt hai bước; người xác nhận chi khác người lập và người duyệt (kể cả Admin).' },
    { text: 'Người nhận hàng / lập-chốt đối soát / lập-duyệt phiếu nhập của chứng từ không duyệt và không xác nhận chi chứng từ đó.' },
    { text: 'Xác nhận đã chi bắt buộc số UNC (không trùng theo NCC) + file UNC. Chuyển khoản cần số tài khoản NCC. Đơn vị nội bộ không chi tiền.' },
    { text: 'Tạm ứng gắn một đơn hàng hoặc một HĐ nguyên tắc + dự án; tổng tạm ứng không vượt giá trị đơn; luôn ghi lý do.' },
    { text: 'Tạm ứng vượt ngưỡng % thì thêm bước duyệt; vượt ngưỡng cảnh báo thì nhắc ghi rõ lý do.', where: 'advance' },
    { text: 'Đảo phiếu chi tạm ứng chỉ khi chưa cấn trừ và chưa có phiếu hoàn; hoàn / chuyển tạm ứng do người khác xác nhận.' },
  ] },
  { group: 'Công nợ', items: [
    { text: 'Hạn thanh toán: HĐ → NCC → mặc định công ty, tính từ ngày ghi nợ; sửa hạn từng chứng từ phải ghi lý do.', where: 'general' },
    { text: 'Không sửa / xóa công nợ trực tiếp: hủy công nợ = đề xuất có lý do → người khác xác nhận; chỉ khi chưa có khoản chi.' },
    { text: 'Đối chiếu đầu kỳ theo sổ MISA 30/09: người lập ≠ người chốt; số Vioo cao hơn MISA thì không chốt được.' },
    { text: 'Mọi thay đổi ghi nhật ký bất biến (không sửa, không xóa).' },
  ] },
  { group: 'Thu chi & quỹ', items: [
    { text: 'Từ mốc 01/10 mọi khoản chi NCC, tạm ứng, chi khác, phiếu thu CĐT, NCC hoàn tạm ứng khi xác nhận phải chọn tài khoản tiền; sổ thu chi không sửa / xóa — chỉ đảo.' },
    { text: 'Số dư đầu kỳ tài khoản theo MISA 30/09, thu khác, chuyển tiền: người lập ≠ người xác nhận.' },
    { text: 'Đối chiếu sao kê tháng: lệch phải giải thích, người khác chốt; chốt xong không ghi lùi ngày vào tháng đó.' },
    { text: 'Dự báo cảnh báo khi số dư chắc chắn xuống dưới tồn quỹ tối thiểu.', where: 'general' },
  ] },
];

const CashMinSection: React.FC<{ data: FinanceSettings; manage: boolean; onSaved: () => void }> = ({ data, manage, onSaved }) => {
  const toast = useToast();
  const [edit, setEdit] = useState<{ value: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!edit) return; const v = parseMoney(edit.value);
    if (!(v >= 0)) { setErr('Số tiền không hợp lệ.'); return; } if (!edit.reason.trim()) { setErr('Nhập lý do.'); return; }
    setBusy(true); setErr(null);
    try { await financeService.saveCashSettings({ minBalance: v, reason: edit.reason.trim(), expectedRowVersion: data.settings.rowVersion }); toast.success('Quản trị Tài chính', 'Đã đổi tồn quỹ tối thiểu.'); setEdit(null); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
    <h3 className="flex items-center gap-2 font-semibold text-foreground"><Scale size={16} className="text-teal-700" />Tồn quỹ tối thiểu</h3>
    <p className="mt-1 text-sm text-muted-foreground">Dự báo dòng tiền 8 tuần cảnh báo tuần nào số dư chắc chắn xuống dưới mức này (Thu chi & quỹ, Tổng quan, Việc cần làm).</p>
    {edit ? <div className="mt-3 flex flex-wrap items-center gap-2">
      <input inputMode="numeric" value={edit.value} onChange={e => setEdit({ ...edit, value: e.target.value })} onBlur={() => setEdit({ ...edit, value: moneyInput(parseMoney(edit.value) || 0) })} className={`w-44 text-right ${inputCls}`} aria-label="Tồn quỹ tối thiểu" /> đ
      <input value={edit.reason} onChange={e => setEdit({ ...edit, reason: e.target.value })} placeholder="Lý do (bắt buộc)" className={`min-w-[14rem] flex-1 ${inputCls}`} />
      <button type="button" disabled={busy} className={primaryBtn} onClick={() => void save()}><Save size={15} />Lưu</button>
      <button type="button" className={secondaryBtn} onClick={() => setEdit(null)}>Thôi</button>
      {err && <p role="alert" className="w-full text-sm text-rose-700">{err}</p>}
    </div> : <p className="mt-2 text-sm"><b className={NUM}>{money(data.settings.cashMinBalance)} đ</b>
      {manage && <button type="button" onClick={() => { setErr(null); setEdit({ value: moneyInput(data.settings.cashMinBalance), reason: '' }); }} className="ml-2 font-semibold text-teal-700 hover:underline">Sửa</button>}</p>}
  </section>;
};

const AdvanceSection: React.FC<{ data: FinanceSettings; manage: boolean; userName: (id: string) => string; onSaved: () => void }> = ({ data, manage, userName, onSaved }) => {
  const toast = useToast();
  const s = data.settings;
  const [edit, setEdit] = useState<{ warn: string; extra: string; grace: string; ids: string[]; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!edit) return;
    const warn = Number(edit.warn.replace(',', '.')); const extra = Number(edit.extra.replace(',', '.')); const grace = Number(edit.grace);
    if (!(warn >= 0 && extra <= 100 && warn <= extra) || !(grace >= 0 && grace <= 365)) { setErr('Ngưỡng cảnh báo ≤ ngưỡng duyệt thêm ≤ 100%; số ngày 0–365.'); return; }
    if (extra < 100 && !edit.ids.length) { setErr('Chọn ít nhất một người duyệt tạm ứng vượt ngưỡng.'); return; }
    if (!edit.reason.trim()) { setErr('Nhập lý do thay đổi.'); return; }
    setBusy(true); setErr(null);
    try {
      await financeService.saveAdvanceSettings({ warnPercent: warn, extraPercent: extra, graceDays: grace, extraApproverIds: edit.ids, expectedRowVersion: s.rowVersion, reason: edit.reason.trim() });
      toast.success('Quản trị Tài chính', 'Đã lưu thông số tạm ứng — áp cho đề nghị gửi sau thời điểm này.'); setEdit(null); onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="flex items-center gap-2 font-semibold text-foreground"><HandCoins size={16} className="text-teal-700" />Tạm ứng nhà cung cấp</h3>
      <span className="text-xs text-muted-foreground">Duyệt theo ma trận đề nghị chi; các thông số dưới đây thêm cảnh báo, bước duyệt và hạn hoàn ứng mặc định.</span>
      {manage && !edit && <button type="button" onClick={() => { setErr(null); setEdit({ warn: String(s.advanceWarnPercent), extra: String(s.advanceExtraPercent), grace: String(s.advanceGraceDays), ids: s.advanceExtraApproverIds, reason: '' }); }}
        className={`${secondaryBtn} ml-auto`}>Sửa</button>}
    </div>
    {!edit ? <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {([['Ngưỡng cảnh báo', `${Number(s.advanceWarnPercent)}% giá trị đơn`, 'Vượt thì nhắc người lập ghi rõ lý do'],
        ['Ngưỡng duyệt thêm', `${Number(s.advanceExtraPercent)}% giá trị đơn`, 'Vượt thì thêm bước duyệt sau ma trận'],
        ['Người duyệt vượt ngưỡng', s.advanceExtraApproverIds.map(userName).join(', ') || 'Chưa cài', 'Đã có trong luồng thì không thêm bước'],
        ['Hạn hoàn ứng mặc định', `Ngày hẹn giao${s.advanceGraceDays ? ` + ${s.advanceGraceDays} ngày` : ''}`, 'Quá hạn mà chưa trừ hết → cảnh báo']] as const).map(([l, v, h]) =>
        <div key={l} className="rounded-xl border border-border px-3 py-2"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="font-semibold text-foreground">{v}</dd><dd className="text-xs text-muted-foreground">{h}</dd></div>)}
    </dl> : <div className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">Ngưỡng cảnh báo (%)<input value={edit.warn} inputMode="decimal" onChange={e => setEdit({ ...edit, warn: e.target.value })} className={`mt-1 w-full text-right ${inputCls}`} /></label>
        <label className="text-sm font-medium">Ngưỡng duyệt thêm (%)<input value={edit.extra} inputMode="decimal" onChange={e => setEdit({ ...edit, extra: e.target.value })} className={`mt-1 w-full text-right ${inputCls}`} />
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">100 = không bao giờ thêm bước</span></label>
        <label className="text-sm font-medium">Cộng vào hạn hoàn ứng (ngày)<input value={edit.grace} inputMode="numeric" onChange={e => setEdit({ ...edit, grace: e.target.value })} className={`mt-1 w-full text-right ${inputCls}`} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">Người duyệt vượt ngưỡng:</span>
        {edit.ids.map(id => <span key={id} className="inline-flex items-center gap-1 rounded-full border border-mint-200 bg-mint-50 px-2 py-0.5 text-xs font-semibold text-mint-800">{userName(id)}
          <button type="button" aria-label={`Bỏ ${userName(id)}`} onClick={() => setEdit({ ...edit, ids: edit.ids.filter(x => x !== id) })}><X size={12} /></button></span>)}
        <select value="" aria-label="Thêm người duyệt" onChange={e => e.target.value && setEdit({ ...edit, ids: [...edit.ids, e.target.value] })} className={inputCls}>
          <option value="">+ Người duyệt…</option>{data.users.filter(u => !edit.ids.includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <input value={edit.reason} onChange={e => setEdit({ ...edit, reason: e.target.value })} placeholder="Lý do thay đổi (bắt buộc) — VD: Theo quyết định TGĐ ngày 03/10" className={`w-full ${inputCls}`} />
      {err && <p role="alert" className="text-sm text-rose-700">{err}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={() => setEdit(null)} className={secondaryBtn}>Thôi</button>
        <button type="button" disabled={busy} onClick={() => void save()} className={primaryBtn}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Lưu</button></div>
    </div>}
  </section>;
};

type Tier = { max: string; steps: Array<{ label: string; approverIds: string[] }> };

export const FinanceSettingsView: React.FC<{ currentUserId: string }> = ({ currentUserId }) => {
  const toast = useToast();
  const askReason = useReasonConfirm();
  const [data, setData] = useState<FinanceSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<{ value: string; reason: string; apply: boolean } | null>(null);
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [matrixNote, setMatrixNote] = useState('');
  const [deleg, setDeleg] = useState<{ from: string; to: string; validFrom: string; validTo: string; reason: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>('general');
  const load = useCallback(() => { setError(null); financeService.settings().then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);
  const run = async (fn: () => Promise<unknown>, message: string, after?: () => void) => {
    setBusy(true); setFormError(null);
    try { await fn(); toast.success('Thiết lập Tài chính', message); after?.(); load(); }
    catch (e) { setFormError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  if (error) return <StateBox kind="error" message={error} onRetry={load} />;
  if (!data) return <StateBox kind="loading" title="Đang tải thiết lập…" />;
  const manage = data.can.manage;
  const userName = (id: string) => data.users.find(u => u.id === id)?.name || id;
  const startEditMatrix = () => {
    setTiers(data.matrix.rules.map(r => ({ max: r.maxAmount == null ? '' : moneyInput(r.maxAmount), steps: r.steps.map(s => ({ label: s.label, approverIds: s.approvers.map(a => a.id) })) })));
    setMatrixNote(''); setFormError(null);
  };
  const saveMatrix = () => {
    if (!tiers) return;
    let min = 0; const rules = [];
    for (let i = 0; i < tiers.length; i += 1) {
      const last = i === tiers.length - 1; const max = last ? null : parseMoney(tiers[i].max);
      if (!last && (!Number.isFinite(max) || (max as number) <= min)) { setFormError(`Mức ${i + 1}: "đến" phải lớn hơn "từ".`); return; }
      if (tiers[i].steps.some(s => !s.label.trim() || !s.approverIds.length)) { setFormError(`Mức ${i + 1}: mỗi bước cần tên và ít nhất một người duyệt.`); return; }
      rules.push({ minAmount: min, maxAmount: max, steps: tiers[i].steps.map(s => ({ label: s.label.trim(), approverIds: s.approverIds })) });
      if (max != null) min = max;
    }
    if (!matrixNote.trim()) { setFormError('Nhập lý do thay đổi.'); return; }
    void run(() => financeService.saveMatrix({ note: matrixNote.trim(), rules }), 'Đã lưu ma trận duyệt chi phiên bản mới — áp cho đề nghị chi gửi sau thời điểm này.', () => setTiers(null));
  };
  const patchTier = (i: number, patch: Partial<Tier>) => setTiers(cur => cur!.map((t, k) => k === i ? { ...t, ...patch } : t));

  const TABS: Array<[AdminTab, string, React.ElementType, string]> = [
    ['general', 'Thông số chung', SlidersHorizontal, 'Hạn thanh toán, tồn quỹ, mốc MISA'], ['approval', 'Duyệt chi & ủy quyền', ShieldCheck, `Ma trận phiên bản ${data.matrix.versionNo}`],
    ['advance', 'Tạm ứng NCC', HandCoins, `Duyệt thêm từ ${Number(data.settings.advanceExtraPercent)}%`], ['roles', 'Trách nhiệm & ràng buộc', Users, 'Ai làm gì, máy chủ chặn gì']];
  return <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
    <nav aria-label="Mục quản trị" className="flex gap-2 overflow-x-auto lg:flex-col">
      {TABS.map(([k, l, I, h]) => <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => { setTab(k); setFormError(null); }}
        className={`flex min-w-[11rem] items-start gap-2 rounded-xl border px-3 py-2 text-left transition lg:min-w-0 ${tab === k ? 'border-teal-500 bg-teal-50/70 ring-2 ring-teal-500/20 dark:bg-teal-950/30' : 'border-border bg-card hover:border-teal-300'}`}>
        <I size={16} className="mt-0.5 shrink-0 text-teal-700" /><span><b className="block text-sm">{l}</b><span className="text-xs text-muted-foreground">{h}</span></span></button>)}
      {!manage && <p className="hidden rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground lg:block"><Lock size={12} className="mr-1 inline" />Bạn chỉ xem. Admin / Quản trị Tài chính sửa được.</p>}
    </nav>
    <div className="min-w-0 space-y-4">
    {tab === 'general' && <>
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h3 className="flex items-center gap-2 font-semibold text-foreground"><CalendarClock size={16} className="text-teal-700" />Hạn thanh toán mặc định</h3>
      <p className="mt-1 text-sm text-muted-foreground">Áp khi HĐ và NCC chưa khai số ngày trả chậm. Mốc công nợ (bắt đầu ghi chi trong Vioo): <b className="text-foreground">{viDate(data.settings.cutoverDate)}</b>.</p>
      {days ? <div className="mt-3 flex flex-wrap items-center gap-2">
        <input inputMode="numeric" value={days.value} onChange={e => setDays({ ...days, value: e.target.value })} className={`w-24 text-right ${inputCls}`} aria-label="Số ngày" /> ngày
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={days.apply} onChange={e => setDays({ ...days, apply: e.target.checked })} className="h-4 w-4 accent-teal-600" />Tính lại chứng từ đang mở theo mặc định</label>
        <input value={days.reason} onChange={e => setDays({ ...days, reason: e.target.value })} placeholder="Lý do (bắt buộc)" className={`min-w-[14rem] flex-1 ${inputCls}`} />
        <button type="button" disabled={busy || !days.reason.trim()} className={primaryBtn} onClick={() => void run(() => financeService.saveSettings({ defaultPaymentDays: Number(days.value), expectedRowVersion: data.settings.rowVersion,
          applyToOpen: days.apply, reason: days.reason.trim() }), 'Đã đổi hạn mặc định.', () => setDays(null))}><Save size={15} />Lưu</button>
        <button type="button" className={secondaryBtn} onClick={() => setDays(null)}>Thôi</button>
      </div> : <p className="mt-2 text-sm"><b className={NUM}>{data.settings.defaultPaymentDays} ngày</b> từ ngày ghi nợ
        {data.settings.updatedByName && <span className="text-muted-foreground"> · sửa bởi {data.settings.updatedByName} {viDate(data.settings.updatedAt)}</span>}
        {manage && <button type="button" onClick={() => setDays({ value: String(data.settings.defaultPaymentDays), reason: '', apply: false })} className="ml-2 font-semibold text-teal-700 hover:underline">Sửa</button>}</p>}
    </section>

    <CashMinSection data={data} manage={manage} onSaved={load} />
    <CostCutoverSection canManage={manage} />
    </>}

    {tab === 'approval' && <>
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck size={16} className="text-teal-700" />Ma trận duyệt chi</h3>
        <Badge className="border-teal-200 bg-teal-50 text-teal-800">Phiên bản {data.matrix.versionNo}</Badge>
        <span className="text-xs text-muted-foreground">Dùng cho đề nghị chi và đề nghị tạm ứng. Người duyệt luôn khác người lập; đổi ma trận không ảnh hưởng đề nghị đang chờ.</span>
        {manage && !tiers && <button type="button" onClick={startEditMatrix} className={`${secondaryBtn} ml-auto`}>Sửa ma trận</button>}
      </div>
      {!tiers ? <ul className="mt-3 space-y-2">{data.matrix.rules.map(r => <li key={r.tierNo} className="rounded-xl border border-border px-3 py-2.5">
        <p className="text-sm font-semibold text-foreground">{r.maxAmount == null ? <>Từ <span className={NUM}>{money(r.minAmount)} đ</span> trở lên</> : <>Từ <span className={NUM}>{money(r.minAmount)}</span> đến <span className={NUM}>{money(r.maxAmount)} đ</span></>}</p>
        <ol className="mt-1 flex flex-wrap items-center gap-2 text-sm">{r.steps.map((s, i) => <li key={i} className="flex items-center gap-1.5">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] font-bold">{i + 1}</span>{s.label}:
          {s.approvers.map(a => <span key={a.id} className={`${ENT} ${a.active ? '' : 'line-through opacity-60'}`}>{a.name}</span>).reduce<React.ReactNode[]>((acc, el, k) => k ? [...acc, <span key={`o${k}`} className="text-muted-foreground">hoặc</span>, el] : [el], [])}
          {i < r.steps.length - 1 && <span className="text-muted-foreground">→</span>}</li>)}</ol>
      </li>)}</ul>
        : <div className="mt-3 space-y-3">
          {tiers.map((t, i) => { const min = i === 0 ? 0 : parseMoney(tiers[i - 1].max); const last = i === tiers.length - 1;
            return <div key={i} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b>Mức {i + 1}:</b> từ <span className={NUM}>{Number.isFinite(min) ? money(min) : '?'}</span> đến
                {last ? <span className="text-muted-foreground">không giới hạn</span>
                  : <input inputMode="numeric" value={t.max} onChange={e => patchTier(i, { max: e.target.value })} className={`w-40 text-right ${inputCls}`} aria-label={`Đến mức ${i + 1}`} />}
                {tiers.length > 1 && <button type="button" aria-label={`Bỏ mức ${i + 1}`} onClick={() => setTiers(cur => cur!.filter((_, k) => k !== i).map((x, k, arr) => k === arr.length - 1 ? { ...x, max: '' } : x))}
                  className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-rose-700"><Trash2 size={14} /></button>}
              </div>
              {t.steps.map((s, j) => <div key={j} className="mt-2 flex flex-wrap items-center gap-2 pl-4">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] font-bold">{j + 1}</span>
                <input value={s.label} onChange={e => patchTier(i, { steps: t.steps.map((x, k) => k === j ? { ...x, label: e.target.value } : x) })} placeholder="Tên bước, VD: Kế toán trưởng duyệt" className={`w-56 ${inputCls}`} />
                {s.approverIds.map(id => <span key={id} className="inline-flex items-center gap-1 rounded-full border border-mint-200 bg-mint-50 px-2 py-0.5 text-xs font-semibold text-mint-800">{userName(id)}
                  <button type="button" aria-label={`Bỏ ${userName(id)}`} onClick={() => patchTier(i, { steps: t.steps.map((x, k) => k === j ? { ...x, approverIds: x.approverIds.filter(a => a !== id) } : x) })}><X size={12} /></button></span>)}
                <select value="" aria-label="Thêm người duyệt" onChange={e => e.target.value && patchTier(i, { steps: t.steps.map((x, k) => k === j ? { ...x, approverIds: [...x.approverIds, e.target.value] } : x) })} className={inputCls}>
                  <option value="">+ Người duyệt…</option>{data.users.filter(u => !s.approverIds.includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                {t.steps.length > 1 && <button type="button" aria-label="Bỏ bước" onClick={() => patchTier(i, { steps: t.steps.filter((_, k) => k !== j) })} className="rounded p-1 text-muted-foreground hover:text-rose-700"><X size={14} /></button>}
              </div>)}
              <button type="button" onClick={() => patchTier(i, { steps: [...t.steps, { label: '', approverIds: [] }] })} className="mt-2 pl-4 text-xs font-semibold text-teal-700 hover:underline">+ Thêm bước</button>
            </div>; })}
          <button type="button" onClick={() => setTiers(cur => [...cur!.map((x, k, arr) => k === arr.length - 1 && !x.max ? { ...x, max: '' } : x), { max: '', steps: [{ label: '', approverIds: [] }] }])} className={secondaryBtn}><Plus size={14} />Thêm mức tiền</button>
          <input value={matrixNote} onChange={e => setMatrixNote(e.target.value)} placeholder="Lý do thay đổi (bắt buộc) — VD: TGĐ duyệt từ 1 tỷ theo quyết định ngày 02/10" className={`w-full ${inputCls}`} />
          {formError && <p role="alert" className="text-sm text-rose-700">{formError}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => { setTiers(null); setFormError(null); }} className={secondaryBtn}>Thôi</button>
            <button type="button" disabled={busy} onClick={saveMatrix} className={primaryBtn}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Lưu phiên bản mới</button></div>
        </div>}
      {data.versions.length > 1 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-muted-foreground">Lịch sử phiên bản ({data.versions.length})</summary>
        <ul className="mt-1 space-y-0.5 text-muted-foreground">{data.versions.map(v => <li key={v.versionNo}>Phiên bản {v.versionNo}{v.current ? ' (đang dùng)' : ''} · {viDate(v.createdAt)} · {v.createdByName || 'hệ thống'} — {v.note}</li>)}</ul></details>}
    </section>

    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-foreground"><UserPlus size={16} className="text-teal-700" />Ủy quyền duyệt chi</h3>
        <span className="text-xs text-muted-foreground">Người duyệt vắng thì ủy quyền có thời hạn; hết hạn tự hết hiệu lực.</span>
        {!deleg && <button type="button" onClick={() => setDeleg({ from: manage ? '' : currentUserId, to: '', validFrom: '', validTo: '', reason: '' })} className={`${secondaryBtn} ml-auto`}><Plus size={14} />Ủy quyền</button>}
      </div>
      {deleg && <div className="mt-3 grid gap-2 rounded-xl border border-border p-3 md:grid-cols-5">
        <select value={deleg.from} disabled={!manage} onChange={e => setDeleg({ ...deleg, from: e.target.value })} className={inputCls} aria-label="Người ủy quyền">
          <option value="">Người ủy quyền…</option>{data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select value={deleg.to} onChange={e => setDeleg({ ...deleg, to: e.target.value })} className={inputCls} aria-label="Người nhận">
          <option value="">Người nhận ủy quyền…</option>{data.users.filter(u => u.id !== deleg.from).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <input type="date" value={deleg.validFrom} onChange={e => setDeleg({ ...deleg, validFrom: e.target.value })} className={inputCls} aria-label="Từ ngày" />
        <input type="date" value={deleg.validTo} min={deleg.validFrom} onChange={e => setDeleg({ ...deleg, validTo: e.target.value })} className={inputCls} aria-label="Đến ngày" />
        <input value={deleg.reason} onChange={e => setDeleg({ ...deleg, reason: e.target.value })} placeholder="Lý do (bắt buộc)" className={inputCls} />
        {formError && <p role="alert" className="text-sm text-rose-700 md:col-span-5">{formError}</p>}
        <div className="flex justify-end gap-2 md:col-span-5"><button type="button" onClick={() => setDeleg(null)} className={secondaryBtn}>Thôi</button>
          <button type="button" disabled={busy || !deleg.from || !deleg.to || !deleg.validFrom || !deleg.validTo || !deleg.reason.trim()} className={primaryBtn}
            onClick={() => void run(() => financeService.saveDelegation({ fromUserId: deleg.from, toUserId: deleg.to, validFrom: deleg.validFrom, validTo: deleg.validTo, reason: deleg.reason.trim() }),
              'Đã tạo ủy quyền duyệt chi.', () => setDeleg(null))}>Lưu ủy quyền</button></div>
      </div>}
      {data.delegations.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Chưa có ủy quyền nào.</p>
        : <ul className="mt-2 divide-y divide-border text-sm">{data.delegations.map(d => <li key={d.id} className={`flex flex-wrap items-center gap-2 py-2 ${d.revokedAt ? 'opacity-60' : ''}`}>
          <span className={ENT}>{d.fromName}</span> → <span className={ENT}>{d.toName}</span>
          <span className="text-muted-foreground">{viDate(d.validFrom)} – {viDate(d.validTo)} · {d.reason}{d.revokedAt ? ` · đã thu hồi: ${d.revokeReason}` : ''}</span>
          {!d.revokedAt && (manage || d.fromUserId === currentUserId) && <button type="button" disabled={busy} className="ml-auto text-xs font-semibold text-rose-700 hover:underline" onClick={async () => {
            const reason = await askReason({ title: 'Thu hồi ủy quyền', targetName: `${d.fromName} → ${d.toName}`, reasonLabel: 'Lý do', actionLabel: 'Thu hồi', intent: 'warning' });
            if (reason) void run(() => financeService.revokeDelegation({ id: d.id, reason }), 'Đã thu hồi ủy quyền.');
          }}>Thu hồi</button>}
        </li>)}</ul>}
    </section>
    </>}

    {tab === 'advance' && <AdvanceSection data={data} manage={manage} userName={userName} onSaved={load} />}

    {tab === 'roles' && <>
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2"><h3 className="flex items-center gap-2 font-semibold text-foreground"><Users size={16} className="text-teal-700" />Trách nhiệm — ai đang giữ quyền nào</h3>
          <a href="#/settings" className="ml-auto text-xs font-semibold text-teal-700 hover:underline">Cấp / thu quyền ở Cài đặt → Phân quyền</a></div>
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          {ROLE_ROWS.map(r => { const people = data.responsibilities?.[r.key] || []; const direct = people.filter(u => !u.admin); const admins = people.filter(u => u.admin);
            return <div key={r.key} className="grid gap-2 border-b border-border px-3 py-3 last:border-0 md:grid-cols-[14rem_minmax(0,1fr)]">
              <div><b className="text-sm">Tài chính — {r.label}</b><p className="text-xs text-muted-foreground">{r.work}</p></div>
              <div className="flex flex-wrap content-start items-center gap-1.5">
                {direct.length ? direct.map(u => <span key={u.id} className="rounded-full border border-mint-200 bg-mint-50 px-2 py-0.5 text-xs font-semibold text-mint-800 dark:border-mint-900 dark:bg-mint-950/30 dark:text-mint-200">{u.name}</span>)
                  : <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Chưa cấp cho ai ngoài Admin</span>}
                {admins.length > 0 && <span className="text-xs text-muted-foreground">+ Admin: {admins.map(u => u.name).join(', ')}</span>}
              </div></div>; })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Người duyệt chi do ma trận quyết định (mục Duyệt chi & ủy quyền), không cần quyền Ghi nhận / Xác nhận.</p>
      </section>
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h3 className="flex items-center gap-2 font-semibold text-foreground"><Scale size={16} className="text-teal-700" />Ràng buộc đang áp dụng</h3>
        <p className="mt-1 text-xs text-muted-foreground">Máy chủ chặn — giao diện không vượt qua được, kể cả Admin. Mục có nút "Cài" chỉnh được thông số.</p>
        {RULES.map(g => <div key={g.group} className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</p>
          <ul className="mt-1 space-y-1.5">{g.items.map(i => <li key={i.text} className="flex items-start gap-2 text-sm"><Lock size={13} className="mt-1 shrink-0 text-teal-700" />
            <span className="flex-1">{i.text}</span>{i.where && <button type="button" onClick={() => setTab(i.where!)} className="shrink-0 text-xs font-semibold text-teal-700 hover:underline">Cài</button>}</li>)}</ul></div>)}
      </section>
    </>}
    </div>
  </div>;
};
