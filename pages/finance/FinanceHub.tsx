import React, { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { FinanceHubView } from '../../components/finance/FinanceHubView';
import { ProjectFinanceView } from '../../components/finance/ProjectFinanceView';
import { StateBox } from '../../components/procurement/hub/hubUi';
import { useApp } from '../../context/AppContext';
import { financeService } from '../../lib/financeService';

// /finance/<phần> (menu bên) hoặc /finance?section=<phần> (link cũ, thông báo). /finance/project mở cho cả người chỉ được
// bật công tắc xem tài chính dự án (không có Tài chính — Xem): họ thấy riêng màn Tài chính dự án, chỉ đọc.
const FinanceHub: React.FC = () => {
  const { user } = useApp();
  const { section: pathSection } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const section = pathSection || params.get('section');
  const [companyView, setCompanyView] = useState<boolean | null>(section === 'project' ? null : true);
  useEffect(() => {
    if (section !== 'project' || companyView !== null) return;
    financeService.myScope().then(s => setCompanyView(s.companyView)).catch(() => setCompanyView(false));
  }, [section, companyView]);
  if (companyView === null) return <main className="px-3 py-4 sm:px-5"><StateBox kind="loading" title="Đang tải…" /></main>;
  if (section === 'project' && !companyView) return <main className="min-h-screen space-y-4 bg-slate-50 px-3 py-4 text-foreground dark:bg-slate-950 sm:px-5 md:py-5">
    <header className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-700 to-mint-500 text-white shadow-sm"><Building2 size={22} /></span>
      <div><h1 className="text-xl font-bold tracking-tight md:text-2xl">Tài chính dự án</h1>
        <p className="text-sm text-muted-foreground">Thu, chi, công nợ, ngân sách của dự án bạn được giao xem.</p></div></header>
    <ProjectFinanceView standalone initialProjectId={params.get('project')} />
  </main>;
  return <FinanceHubView key={user.id} currentUserId={user.id} initialSection={section} initialSupplierId={params.get('supplier')} initialRequestId={params.get('request')}
    initialContractId={params.get('contract')} initialProjectId={params.get('project')} initialView={params.get('view')} initialSubcontractId={params.get('subcontract')}
    onSectionChange={s => navigate(`/finance/${s}`)} />;
};

export default FinanceHub;
