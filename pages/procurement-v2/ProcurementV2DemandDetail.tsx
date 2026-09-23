import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, CalendarDays, CircleAlert, FolderOpen, Loader2, MapPin, UserRound } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { projectMasterService } from '../../lib/projectMasterService';
import { procurementV2Service } from '../../lib/procurement/procurementV2Service';
import { dossierSourceLabel, resolveDossierDocumentRef, resolveDossierSourceRoute } from '../../lib/procurement/procurementV2Presentation';
import { ProcurementV2DemandLines } from '../../components/procurement-v2/ProcurementV2DemandLines';
import { ProcurementV2SupplyDialog } from '../../components/procurement-v2/ProcurementV2SupplyDialog';
import { ProcurementV2PurchaseDialog, type PurchaseDialogInput } from '../../components/procurement-v2/ProcurementV2PurchaseDialog';
import { procurementPurchaseOrderService, type ProcurementPurchaseCandidate } from '../../lib/procurement/procurementPurchaseOrderService';
import type { ProcurementV2Dossier } from '../../types/procurementV2';
import type { ProcurementDocumentRef } from '../../types/procurementWorkbench';

const stageLabel: Record<ProcurementV2Dossier['stage'], string> = {
  reconcile: 'Cần đối chiếu', plan_supply: 'Cần bố trí nguồn',
  monitor_fulfillment: 'Theo dõi thực hiện', withdrawn: 'Đã rút nhu cầu',
};
const dateLabel = (value: string | null) => value
  ? new Date(`${value}T00:00:00Z`).toLocaleDateString('vi-VN', { timeZone: 'UTC' }) : 'Chưa rõ';
const issueLabel = (code: string) => {
  if (code.includes('REDUCTION')) return 'Số lượng mới thấp hơn phần đã bố trí';
  if (code.includes('CANCELLATION')) return 'Hủy kế hoạch khi vẫn còn phần đã bố trí';
  if (code.includes('REMOVED_LINE')) return 'Vật tư đã được bố trí không còn trong kế hoạch';
  return 'Dữ liệu nguồn hoặc chứng từ cần đối chiếu';
};

export const ProcurementV2DemandDetailView: React.FC<{
  dossier: ProcurementV2Dossier;
  projectName: string;
  siteName: string;
  onBack: () => void;
  onOpenSource: () => void;
  onOpenDocument: (ref: ProcurementDocumentRef) => void;
  onPlanSupply: () => void;
}> = ({ dossier, projectName, siteName, onBack, onOpenSource, onOpenDocument, onPlanSupply }) =>
  <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 dark:bg-slate-950 dark:text-white sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-slate-300 dark:hover:bg-slate-800"><ArrowLeft size={18} />Về danh sách hồ sơ</button>
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0"><div className="flex flex-wrap gap-2"><span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-200">{dossierSourceLabel(dossier.sourceAdapter)}</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${dossier.stage === 'reconcile' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'}`}>{stageLabel[dossier.stage]}</span></div>
            <h1 className="mt-3 break-words text-2xl font-bold sm:text-3xl">{dossier.sourceCode}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{dossier.lineCount} vật tư trong hồ sơ. Kế hoạch đã duyệt tạo nhu cầu; việc mua hàng được quyết định ở bước cung ứng.</p></div>
          <button type="button" onClick={onOpenSource} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-700 dark:hover:bg-slate-800"><FolderOpen size={17} />Xem chứng từ nguồn<ArrowUpRight size={16} /></button>
        </div>
        <dl className="mt-6 grid gap-4 border-t border-slate-100 pt-5 text-sm dark:border-slate-800 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="flex items-center gap-1 text-slate-500"><FolderOpen size={15} />Dự án</dt><dd className="mt-1 font-semibold">{projectName}</dd></div>
          <div><dt className="flex items-center gap-1 text-slate-500"><MapPin size={15} />Công trường / điểm nhận</dt><dd className="mt-1 font-semibold">{siteName}{dossier.destinationSummary ? ` · ${dossier.destinationSummary}` : ''}</dd></div>
          <div><dt className="flex items-center gap-1 text-slate-500"><UserRound size={15} />Phụ trách</dt><dd className="mt-1 font-semibold">{dossier.assigneeName || 'Chưa giao phụ trách'}</dd></div>
          <div><dt className="flex items-center gap-1 text-slate-500"><CalendarDays size={15} />Ngày cần sớm nhất</dt><dd className="mt-1 font-semibold">{dateLabel(dossier.earliestNeededDate)}</dd></div>
        </dl>
      </header>
      {dossier.stage === 'reconcile' && <section role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><div className="flex items-start gap-2"><CircleAlert className="shrink-0" size={20} /><div><h2 className="font-semibold">Cần đối chiếu trước khi bố trí thêm</h2><p className="mt-1 text-sm">Số lượng hoặc chứng từ nguồn chưa khớp. Các giá trị chưa xác định được giữ ở trạng thái “Chưa rõ”.</p></div></div></section>}
      <section aria-labelledby="procurement-v2-lines-title" className="space-y-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="procurement-v2-lines-title" className="text-xl font-bold">Vật tư cần xử lý</h2><p className="mt-1 text-sm text-slate-500">Xem nhu cầu đã duyệt và phần còn phải bố trí theo từng vật tư.</p></div>
        {dossier.allowedActions.includes('plan_supply') && <button type="button" onClick={onPlanSupply} className="min-h-11 rounded-xl bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">Chọn phương án cung ứng</button>}</div>
        <ProcurementV2DemandLines lines={dossier.lines} onOpenDocument={onOpenDocument} />
      </section>
      {dossier.issues.length > 0 && <details className="rounded-2xl border border-amber-200 bg-white p-4 dark:border-amber-900 dark:bg-slate-900"><summary className="cursor-pointer font-semibold">Vấn đề cần đối chiếu ({dossier.issues.length})</summary><ul className="mt-3 list-inside list-disc text-sm text-slate-600 dark:text-slate-300">{dossier.issues.map(issue => <li key={issue.id}>{issueLabel(issue.code)}</li>)}</ul></details>}
    </div>
  </main>;

const ProcurementV2DemandDetail: React.FC = () => {
  const { demandId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { constructionSites, suppliers, warehouses, user } = useApp();
  const [dossier, setDossier] = useState<ProcurementV2Dossier | null>(null);
  const [projectName, setProjectName] = useState('Dự án chưa có tên');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'denied' | 'error' | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [supplyOpen, setSupplyOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseCandidates, setPurchaseCandidates] = useState<ProcurementPurchaseCandidate[]>([]);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState('');
  const attempt = useRef<{ signature: string; id: string; key: string; number: string;
    orderDate: string; lineIds: Record<string, string> } | null>(null);
  const back = useCallback(() => navigate(`/procurement-v2${location.search}`), [location.search, navigate]);
  useEffect(() => {
    if (!demandId) { setError('error'); setLoading(false); return; }
    let active = true;
    setLoading(true); setError(null);
    procurementV2Service.get(demandId).then(result => {
      if (active) setDossier(result);
    }).catch(loadError => {
      if (active) { setDossier(null); setError(loadError?.code === '42501' ? 'denied' : 'error'); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [demandId, refresh]);
  useEffect(() => {
    if (!dossier) return;
    let active = true;
    projectMasterService.list().then(rows => {
      if (active) setProjectName(rows.find(row => row.id === dossier.projectId)?.name || 'Dự án chưa có tên');
    }).catch(() => {});
    return () => { active = false; };
  }, [dossier?.projectId]);
  useEffect(() => {
    if (supplyOpen || purchaseOpen) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, supplyOpen, purchaseOpen]);
  if (loading) return <main role="status" className="grid min-h-[50vh] place-items-center"><div className="text-center"><Loader2 className="mx-auto animate-spin" /><p className="mt-2">Đang tải hồ sơ…</p></div></main>;
  if (error || !dossier) return <main className="mx-auto max-w-3xl p-6"><button type="button" onClick={back} className="min-h-11 text-sm font-semibold">← Về danh sách</button><section role="alert" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-6"><h1 className="font-semibold">{error === 'denied' ? 'Bạn chưa được cấp quyền xem hồ sơ này' : 'Chưa tải được hồ sơ'}</h1>{error !== 'denied' && <button type="button" onClick={() => setRefresh(value => value + 1)} className="mt-3 min-h-11 rounded-xl bg-slate-900 px-4 text-white">Thử lại</button>}</section></main>;
  const siteName = constructionSites.find(site => site.id === dossier.constructionSiteId)?.name || 'Chưa rõ công trường';
  const openDocument = (ref: ProcurementDocumentRef) => {
    try { navigate(resolveDossierDocumentRef(ref, location.pathname + location.search).route); }
    catch { /* Invalid or unsupported trace refs stay in the dossier. */ }
  };
  const startPurchase = async () => {
    if (!demandId) return;
    setSupplyOpen(false); setPurchaseLoading(true); setPurchaseError('');
    try {
      const page = await procurementPurchaseOrderService.listCandidates(demandId);
      if (!page.canAllocate) throw new Error('Bạn chưa có quyền lập PO cho nhu cầu này.');
      setPurchaseCandidates(page.lines); setPurchaseOpen(true);
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : 'Chưa tải được vật tư có thể mua.');
    } finally { setPurchaseLoading(false); }
  };
  const createPurchase = async (input: PurchaseDialogInput) => {
    const selected = input.lines.filter(line => line.selected);
    const signature = JSON.stringify(input);
    if (!attempt.current || attempt.current.signature !== signature) {
      attempt.current = { signature, id: crypto.randomUUID(), key: crypto.randomUUID(),
        number: await procurementPurchaseOrderService.nextNumber(),
        orderDate: new Date().toLocaleDateString('sv-SE'),
        lineIds: Object.fromEntries(selected.map(line => [line.demandLineId, crypto.randomUUID()])) };
    }
    const order = attempt.current;
    const vendor = suppliers.find(row => row.id === input.supplierId);
    if (!vendor) throw new Error('Nhà cung cấp không còn hợp lệ.');
    const lines = selected.map(line => {
      const candidate = purchaseCandidates.find(row => row.demandLineId === line.demandLineId);
      if (!candidate || candidate.fulfilledQty === null) throw new Error('Số lượng đã thực hiện chưa rõ.');
      return { ...candidate, ...line, vendorId: vendor.id, vendorName: vendor.name,
        warehouseId: input.warehouseId, note: input.note,
        unitPrice: line.unitPrice, poLineId: order.lineIds[line.demandLineId] };
    });
    await procurementPurchaseOrderService.create(lines, {
      id: order.id, poNumber: order.number, idempotencyKey: order.key, actorUserId: user.id,
      orderDate: order.orderDate,
      expectedDeliveryDate: input.expectedDeliveryDate, note: input.note,
    });
    attempt.current = null;
    setPurchaseOpen(false); setRefresh(value => value + 1);
  };
  return <><ProcurementV2DemandDetailView dossier={dossier} projectName={projectName}
    siteName={siteName} onBack={back}
    onOpenSource={() => navigate(resolveDossierSourceRoute(dossier.sourceRef))}
    onOpenDocument={openDocument} onPlanSupply={() => setSupplyOpen(true)} />
    <ProcurementV2SupplyDialog open={supplyOpen} demandLabel={dossier.sourceCode}
      canPurchase={dossier.allowedActions.includes('plan_supply')}
      onClose={() => setSupplyOpen(false)}
      onPurchase={startPurchase} />
    {purchaseLoading && <div role="status" className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50"><div className="rounded-xl bg-white p-5"><Loader2 className="animate-spin" />Đang tải vật tư có thể mua…</div></div>}
    {purchaseError && <div role="alert" className="fixed bottom-4 right-4 z-[70] max-w-sm rounded-xl bg-rose-50 p-4 text-rose-800 shadow-lg">{purchaseError}<button type="button" onClick={() => setPurchaseError('')} className="ml-3 font-semibold">Đóng</button></div>}
    <ProcurementV2PurchaseDialog open={purchaseOpen} candidates={purchaseCandidates}
      suppliers={suppliers} warehouses={warehouses.filter(row =>
        (!row.projectId || row.projectId === dossier.projectId)
        && (!row.constructionSiteId || row.constructionSiteId === dossier.constructionSiteId))}
      onClose={() => setPurchaseOpen(false)}
      onCreate={createPurchase} />
  </>;
};
export default ProcurementV2DemandDetail;
