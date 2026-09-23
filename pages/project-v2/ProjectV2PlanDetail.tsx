import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { projectV2ReadService } from '../../lib/projectV2/readService';
import { projectV2CommandService } from '../../lib/projectV2/commandService';
import { getProjectV2StatusLabel } from '../../lib/projectV2/presentation';
import { ProjectV2PlanWorkflowActions } from '../../components/project-v2/ProjectV2PlanWorkflowActions';
import { ProjectV2CreatePlanDialog } from '../../components/project-v2/ProjectV2CreatePlanDialog';
import { ProjectV2MaterialPlanDialog } from '../../components/project-v2/ProjectV2MaterialPlanDialog';
import { formatDecimal6, parseQuantity6 } from '../../lib/procurement/decimal';
import { projectV2CandidateService } from '../../lib/projectV2/candidateService';

type Detail = Awaited<ReturnType<typeof projectV2ReadService.getPlan>>;
type Discussion = Awaited<ReturnType<typeof projectV2ReadService.getDiscussion>>;
type Tab = 'lines' | 'discussion' | 'activity';
const eventLabels: Record<string, string> = { saved: 'Đã lưu bản nháp', submitted: 'Đã gửi duyệt',
  returned: 'Đã trả lại', approved: 'Đã phê duyệt', revised: 'Đã tạo bản điều chỉnh',
  cancelled: 'Đã hủy', commented: 'Đã trao đổi' };
const label = (value: string | null | undefined) => value?.trim() || 'Chưa xác định';
const when = (value: string) => new Date(value).toLocaleString('vi-VN');
const amount = (quantity: string | null, price: unknown) => {
  if (quantity === null || typeof price !== 'number' && typeof price !== 'string') return 'Chưa xác định';
  try { return formatDecimal6((parseQuantity6(quantity) * parseQuantity6(String(price)) + 500_000n) / 1_000_000n); }
  catch { return 'Chưa xác định'; }
};

const ProjectV2PlanDetail: React.FC = () => {
  const { planId = '' } = useParams(); const navigate = useNavigate();
  const { user, users } = useApp();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [crewNames, setCrewNames] = useState<Record<string, string>>({});
  const [materialScope, setMaterialScope] = useState<{ projectId: string; siteId: string | null; siteName: string } | null>(null);
  const [tab, setTab] = useState<Tab>('lines');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [conflict, setConflict] = useState<{ message: string; updatedAt: string | null } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const dirty = Boolean(comment.trim());
  const previousHash = useRef(window.location.hash);
  const names = useMemo(() => Object.fromEntries(users.map(person => [person.id, person.name])), [users]);
  const reload = useCallback(() => { setRefresh(value => value + 1); }, []);

  useEffect(() => {
    let active = true;
    setDetail(null); setDiscussion(null); setError(null);
    Promise.all([projectV2ReadService.getPlan(planId), projectV2ReadService.getDiscussion(planId)])
      .then(async ([plan, thread]) => {
        if (plan.plan.planType === 'construction') {
          const crews = await projectV2CandidateService.listCrews(plan.plan.workspaceId);
          if (active) setCrewNames(Object.fromEntries(crews.map(crew => [crew.id, crew.name])));
        }
        if (plan.plan.planType === 'material') {
          const workspaces = await projectV2ReadService.listWorkspaces();
          const workspace = workspaces.workspaces.find(item => item.id === plan.plan.workspaceId);
          if (!workspace) throw new Error('Không tìm thấy dự án của kế hoạch vật tư.');
          if (active) setMaterialScope({ projectId: workspace.projectId,
            siteId: workspace.primaryConstructionSiteId, siteName: workspace.siteName ?? 'Công trường' });
        }
        if (active) { setDetail(plan); setDiscussion(thread); }
      })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Không tải được kế hoạch'); });
    return () => { active = false; };
  }, [planId, refresh]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    const onHashChange = () => {
      if (dirty && !window.confirm('Bỏ nội dung trao đổi chưa gửi?')) {
        window.location.hash = previousHash.current;
      } else previousHash.current = window.location.hash;
    };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('hashchange', onHashChange);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('hashchange', onHashChange); };
  }, [dirty]);
  const navigateBack = () => { if (!dirty || window.confirm('Bỏ nội dung trao đổi chưa gửi?')) navigate('/project-v2'); };
  const handleError = async (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : 'Thao tác không thành công';
    if (message.includes('PROJECT_V2_VERSION_STALE') || message.includes('40001')) {
      try {
        const current = await projectV2ReadService.getPlan(planId);
        setConflict({ message: 'Kế hoạch đã được người khác thay đổi. Tải lại để xem phiên bản mới.',
          updatedAt: current.plan.updatedAt });
      } catch { setConflict({ message: 'Kế hoạch đã đổi phiên bản. Tải lại trước khi thao tác.', updatedAt: null }); }
    } else setError(message);
  };
  const act = async (action: 'submit' | 'approve' | 'return' | 'revise' | 'cancel') => {
    if (!detail || busy) return;
    let reason = '';
    if (action === 'return' || action === 'cancel') {
      const entered = window.prompt(action === 'return' ? 'Lý do trả lại' : 'Lý do hủy kế hoạch');
      if (!entered?.trim()) return;
      reason = entered.trim();
    }
    setBusy(true); setError(null); setConflict(null);
    try {
      const args = { planId, expectedVersion: detail.plan.version, idempotencyKey: crypto.randomUUID() };
      if (action === 'submit') await projectV2CommandService.submit({ ...args, reason: '' });
      else if (action === 'approve') await projectV2CommandService.approve(args);
      else if (action === 'return') await projectV2CommandService.return({ ...args, reason });
      else if (action === 'revise') await projectV2CommandService.createRevision(args);
      else await projectV2CommandService.cancel({ ...args, reason });
      reload();
    } catch (cause) { await handleError(cause); }
    finally { setBusy(false); }
  };
  const sendComment = async () => {
    if (!detail || !comment.trim() || busy) return;
    setBusy(true); setError(null); setConflict(null);
    try {
      await projectV2CommandService.addComment({ planId, expectedVersion: detail.plan.version,
        idempotencyKey: crypto.randomUUID(), body: comment.trim() });
      setComment(''); reload();
    } catch (cause) { await handleError(cause); }
    finally { setBusy(false); }
  };

  if (error && !detail) return <main className="mx-auto max-w-3xl px-4 py-10"><div role="alert" className="rounded-xl bg-red-50 p-5 text-red-800">{error}</div>
    <button onClick={reload} className="mt-4 rounded-lg border px-4 py-2">Thử lại</button></main>;
  if (!detail || !discussion) return <main className="flex min-h-[40vh] items-center justify-center gap-2 text-slate-500"><Loader2 className="animate-spin" /> Đang tải kế hoạch…</main>;
  const plan = detail.plan;
  const typeLabel = plan.planType === 'month' ? 'Kế hoạch tháng' : plan.planType === 'construction' ? 'Kế hoạch thi công' : 'Kế hoạch vật tư';
  return <main className="mx-auto w-full max-w-7xl min-w-0 space-y-5 px-4 py-6 sm:px-6 lg:px-8">
    {editing && (plan.planType === 'month' || plan.planType === 'construction') &&
      <ProjectV2CreatePlanDialog workspaceId={plan.workspaceId} type={plan.planType} existing={detail}
        canUseBaselineException={detail.capabilities.baselineException === true} actorNames={names}
        onClose={() => setEditing(false)} onReload={() => { setEditing(false); reload(); }}
        onCreated={() => { setEditing(false); reload(); }} />}
    {editing && plan.planType === 'material' && materialScope &&
      <ProjectV2MaterialPlanDialog workspaceId={plan.workspaceId} projectId={materialScope.projectId}
        siteId={materialScope.siteId} siteName={materialScope.siteName} existing={detail}
        onClose={() => setEditing(false)} onReload={() => { setEditing(false); reload(); }}
        onSaved={() => { setEditing(false); reload(); }} />}
    <button type="button" onClick={navigateBack} className="inline-flex items-center gap-2 text-sm font-semibold text-teal-800 dark:text-teal-300"><ArrowLeft size={17} /> Trở về không gian kế hoạch</button>
    <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-teal-700">{typeLabel} · {plan.code} · bản {plan.revision}</p>
          <h1 className="mt-1 break-words text-2xl font-bold text-slate-950 dark:text-white sm:text-3xl">{plan.title}</h1>
          <span className="mt-3 inline-flex rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800 dark:bg-teal-950 dark:text-teal-200">{getProjectV2StatusLabel(plan.status)}</span></div>
        <div className="flex flex-wrap gap-2">
          {(plan.status === 'draft' || plan.status === 'returned') && detail.capabilities.edit === true &&
            <button type="button" onClick={() => setEditing(true)}
              className="min-h-11 rounded-xl border border-teal-700 px-4 text-sm font-semibold text-teal-800 dark:text-teal-300">Sửa bản nháp</button>}
          <ProjectV2PlanWorkflowActions plan={plan} capabilities={detail.capabilities} actorId={user.id} busy={busy} onAction={act} />
        </div>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-slate-100 pt-5 text-sm dark:border-slate-700 sm:grid-cols-4">
        <div><dt className="text-slate-500">Kỳ kế hoạch</dt><dd className="mt-1 font-semibold">{plan.periodStart} → {plan.periodEnd}</dd></div>
        <div><dt className="text-slate-500">Người phụ trách</dt><dd className="mt-1 font-semibold">{label(names[plan.ownerUserId ?? ''])}</dd></div>
        <div><dt className="text-slate-500">Theo dõi</dt><dd className="mt-1 font-semibold">{label(names[plan.followerUserId ?? ''])}</dd></div>
        <div><dt className="text-slate-500">Nguồn</dt><dd className="mt-1 font-semibold">{plan.planType === 'month'
          ? `${detail.lines.length} hạng mục hợp đồng / BOQ` : `${detail.sources.length} liên kết dòng`}</dd></div>
      </dl>
    </header>
    {conflict && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      {conflict.message} {conflict.updatedAt && <span>Lần đổi gần nhất: {when(conflict.updatedAt)}.</span>}
      <button type="button" className="ml-2 font-semibold underline" onClick={() => { setConflict(null); reload(); }}>Tải lại</button></div>}
    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    <div className="flex gap-2 overflow-x-auto border-b border-slate-200 dark:border-slate-700" role="tablist" aria-label="Chi tiết kế hoạch">
      {([['lines', 'Khối lượng kế hoạch'], ['discussion', 'Trao đổi'], ['activity', 'Hoạt động']] as const).map(([id, title]) =>
        <button type="button" key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
          className={`shrink-0 border-b-2 px-3 py-3 text-sm font-semibold ${tab === id ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-500'}`}>{title}</button>)}
    </div>
    {tab === 'lines' && <section className="min-w-0 overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" aria-label="Khối lượng kế hoạch">
      <table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr>
        <th className="px-4 py-3">{plan.planType === 'material' ? 'Mã và tên vật tư' : 'Công việc / nguồn'}</th><th className="px-4 py-3">Đơn vị</th><th className="px-4 py-3 text-right">{plan.planType === 'material' ? 'Số lượng đề nghị' : 'Khối lượng'}</th>
        {plan.planType === 'month' && detail.capabilities.priceVisible === true && <><th className="px-4 py-3 text-right">Đơn giá hợp đồng</th><th className="px-4 py-3 text-right">Thành tiền</th></>}
        <th className="px-4 py-3">{plan.planType === 'material' ? 'Ngày cần' : 'Thời gian'}</th><th className="px-4 py-3">{plan.planType === 'material' ? 'Điểm nhận' : 'Tổ đội'}</th>
      </tr></thead><tbody>{detail.lines.map(row => {
        const raw = row as Record<string, unknown>;
        return <tr key={row.id} className="border-t border-slate-100 dark:border-slate-700">
          <td className="px-4 py-3"><span className="font-medium">{raw.displayName
            ? `${raw.displayCode ? `${String(raw.displayCode)} · ` : ''}${String(raw.displayName)}`
            : 'Chưa xác định'}</span>
            {plan.planType === 'material' && <span className="mt-1 block text-xs text-slate-500">Nhu cầu tính toán: {raw.calculated_quantity == null ? 'Chưa xác định' : String(raw.calculated_quantity)}</span>}
            {plan.planType === 'material' && raw.override_reason && <span className="mt-1 block text-xs text-amber-700">Lý do điều chỉnh: {String(raw.override_reason)}</span>}
            {detail.sources.filter(source => (source as Record<string, unknown>).target_line_id === row.id).map(source => {
              const sourceRaw = source as Record<string, unknown>;
              return <Link key={source.id} to={`/project-v2/plans/${String(sourceRaw.source_plan_id)}`}
                className="mt-1 block text-xs text-teal-700 underline">Xem kế hoạch nguồn · bản {String(sourceRaw.source_plan_revision_no)}</Link>;
            })}</td>
          <td className="px-4 py-3">{label(raw.unit as string | null)}</td>
          <td className="px-4 py-3 text-right tabular-nums">{row.quantity ?? 'Chưa xác định'}</td>
          {plan.planType === 'month' && detail.capabilities.priceVisible === true && <>
            <td className="px-4 py-3 text-right tabular-nums">{raw.unit_price_snapshot == null ? 'Chưa xác định' : String(raw.unit_price_snapshot)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{amount(row.quantity, raw.unit_price_snapshot)}</td></>}
          <td className="px-4 py-3">{plan.planType === 'material' ? label(raw.needed_date as string | null)
            : raw.work_start && raw.work_end ? `${raw.work_start} → ${raw.work_end}` : '—'}</td>
          <td className="px-4 py-3">{plan.planType === 'material' ? label(materialScope?.siteId === raw.destination_id ? materialScope.siteName : raw.destination_id as string | null)
            : raw.crew_id ? crewNames[String(raw.crew_id)] ?? 'Tổ đội không còn hoạt động' : 'Chưa phân công'}</td>
        </tr>;
      })}</tbody></table>
      {!detail.lines.length && <p className="p-5 text-sm text-slate-500">Chưa có dòng kế hoạch.</p>}
    </section>}
    {tab === 'discussion' && <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-label="Trao đổi">
      {discussion.comments.length ? discussion.comments.map(item => <article key={item.id} className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800">
        <p className="font-semibold">{names[item.authorUserId] ?? 'Người dùng'} <span className="font-normal text-slate-500">· {when(item.createdAt)} · bản {item.revision}</span></p>
        <p className="mt-2 whitespace-pre-wrap">{item.body}</p></article>) : <p className="text-sm text-slate-500">Chưa có trao đổi.</p>}
      <label className="block text-sm font-medium">Thêm trao đổi<textarea value={comment} onChange={event => setComment(event.target.value)}
        className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 p-3 dark:border-slate-600 dark:bg-slate-800" /></label>
      <button type="button" disabled={!comment.trim() || busy} onClick={sendComment}
        className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50">Gửi trao đổi</button>
    </section>}
    {tab === 'activity' && <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-label="Hoạt động">
      {discussion.events.length ? discussion.events.map(event => <div key={event.id} className="border-l-2 border-teal-600 py-1 pl-4 text-sm">
        <p className="font-semibold">{eventLabels[event.eventType] ?? event.eventType}</p>
        <p className="text-slate-500">{names[event.actorUserId] ?? 'Người dùng'} · {when(event.occurredAt)} · bản {event.revision}</p>
        {event.reason && <p className="mt-1">{event.reason}</p>}
      </div>) : <p className="text-sm text-slate-500">Chưa có hoạt động.</p>}
    </section>}
    <button type="button" onClick={reload} className="inline-flex items-center gap-2 text-xs font-medium text-slate-500"><RefreshCw size={14} /> Cập nhật dữ liệu</button>
  </main>;
};
export default ProjectV2PlanDetail;
