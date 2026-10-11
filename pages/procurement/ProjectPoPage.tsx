import React, { Suspense, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { projectMasterService } from '../../lib/projectMasterService';
import { useProjectMaterialAccess } from '../../hooks/project/material/useProjectMaterialAccess';
import type { Project } from '../../types';

const SupplyChainTab = React.lazy(() => import('../project/SupplyChainTab'));

/**
 * Màn PO theo dự án (trước nằm ở Dự án → Vật tư → Đơn hàng PO), chuyển sang Mua hàng 12/10/2026.
 * Dùng cho đơn lập ở dự án trước khi có Mua hàng và các thao tác công trường trên PO; lập đơn mới ở Mua hàng.
 * Link cũ giữ nguyên tham số: projectId, siteId, poId.
 */
const ProjectPoPage: React.FC = () => {
  const { user } = useApp();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const projectId = params.get('projectId') || '';
  const siteParam = params.get('siteId') || params.get('constructionSiteId') || '';
  const poId = params.get('poId');
  const [project, setProject] = useState<Project | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>(projectId ? 'loading' : 'missing');

  useEffect(() => {
    if (!projectId) { setState('missing'); return; }
    let cancelled = false;
    setState('loading');
    projectMasterService.getById(projectId)
      .then(row => { if (!cancelled) { setProject(row); setState(row ? 'ready' : 'missing'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [projectId]);

  const constructionSiteId = siteParam || project?.constructionSiteId || '';
  const access = useProjectMaterialAccess({
    canManageTab: false,
    projectId: projectId || undefined,
    constructionSiteId: constructionSiteId || undefined,
    user,
  });

  const header = <header className="flex flex-wrap items-center gap-3">
    <Link to="/procurement?mode=orders" className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground" aria-label="Về Mua hàng">
      <ArrowLeft size={16} />
    </Link>
    <div className="min-w-0">
      <h1 className="text-lg font-bold tracking-tight md:text-xl">Đơn hàng theo dự án{project ? ` · ${project.code || project.name}` : ''}</h1>
      <p className="text-sm text-muted-foreground">Xử lý đơn lập ở dự án và giao nhận tại công trường. Lập đơn mới ở Mua hàng.</p>
    </div>
  </header>;

  const box = (text: string) => <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">{text}</div>;

  return <main className="min-h-screen space-y-4 bg-slate-50 px-3 py-4 text-foreground dark:bg-slate-950 sm:px-5 md:py-5">
    {header}
    {state === 'loading' || (state === 'ready' && !access.boqPbacLoaded)
      ? <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />Đang tải đơn hàng của dự án…</div>
      : state === 'error' ? box('Chưa tải được dự án. Thử tải lại trang.')
        : state === 'missing' || !project ? box('Không tìm thấy dự án của đơn này. Mở đơn từ danh sách Mua hàng.')
          : !access.canViewPo ? box('Bạn chưa có quyền xem đơn hàng của dự án này. Nhờ quản trị cấp quyền phòng "Đơn hàng PO" của dự án.')
            : <Suspense fallback={<div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />Đang mở đơn hàng…</div>}>
              <SupplyChainTab
                constructionSiteId={constructionSiteId || undefined}
                projectId={project.id}
                canManageTab={access.canEditPo || access.canSubmitPo || access.canApprovePo || access.canConfirmPo || access.canDeletePo
                  || access.canCreateDirectPurchase || access.canEditDirectPurchase || access.canDeleteDirectPurchase || access.canRecordDirectPurchaseAp
                  || access.canCreateSupplierDelivery || access.canEditSupplierDelivery || access.canDeleteSupplierDelivery
                  || access.canRecordSupplierDelivery || access.canUnrecordSupplierDelivery || access.canReconcileSupplierDelivery}
                poCapabilities={{
                  canViewPo: access.canViewPo,
                  canEditPo: access.canEditPo,
                  canSubmitPo: access.canSubmitPo,
                  canApprovePo: access.canApprovePo,
                  canConfirmPo: access.canConfirmPo,
                  canDeletePo: access.canDeletePo,
                }}
                directPurchaseCapabilities={{
                  canViewDirectPurchase: access.canViewDirectPurchase,
                  canCreateDirectPurchase: access.canCreateDirectPurchase,
                  canEditDirectPurchase: access.canEditDirectPurchase,
                  canDeleteDirectPurchase: access.canDeleteDirectPurchase,
                  canRecordDirectPurchaseAp: access.canRecordDirectPurchaseAp,
                }}
                supplierDeliveryCapabilities={{
                  canViewSupplierDelivery: access.canViewSupplierDelivery,
                  canCreateSupplierDelivery: access.canCreateSupplierDelivery,
                  canEditSupplierDelivery: access.canEditSupplierDelivery,
                  canDeleteSupplierDelivery: access.canDeleteSupplierDelivery,
                  canRecordSupplierDelivery: access.canRecordSupplierDelivery,
                  canUnrecordSupplierDelivery: access.canUnrecordSupplierDelivery,
                  canReconcileSupplierDelivery: access.canReconcileSupplierDelivery,
                }}
                deepLinkPoId={poId}
                compact
              />
            </Suspense>}
  </main>;
};

export default ProjectPoPage;
