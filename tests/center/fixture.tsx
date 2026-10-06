// Dữ liệu minh họa, chỉ dùng cho kiểm thử giao diện. Không gọi Supabase.
// ?theme=dark để xem nền tối; ?inbox=empty|error để xem trạng thái rỗng / lỗi của Việc của tôi.
// Cột 64px bên trái chỉ giả lập thanh bên (Sidebar) có sẵn của app.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart3, Bell, Briefcase, FileText, LayoutDashboard, Package, PanelsTopLeft, ShoppingCart, Wallet } from 'lucide-react';
import CenterShell from '../../components/center/CenterShell';
import type { InboxTab, WorkItem, WorkItemsPage } from '../../lib/center/workItemsService';
import '../../index.css';

const params = new URLSearchParams(location.search);
const DENIED_ROUTES = new Set(['/procurement']);
const NOW = new Date(2026, 9, 7, 8, 30);
const at = (days: number, hour = 17) => new Date(2026, 9, 7 + days, hour, 0).toISOString();

const item = (partial: Partial<WorkItem> & Pick<WorkItem, 'source' | 'module' | 'kind' | 'id' | 'code' | 'title'>): WorkItem => ({
  who: null, whoId: null, meta: null, dueAt: null, status: null, ref: {}, ...partial,
});

// Số thật 06/10 trong mockup v1.1 + phiếu minh họa.
const ITEMS: Record<InboxTab, WorkItem[]> = {
  mine: [
    item({ source: 'mr', module: 'project', kind: 'approve', id: 'mr-2688', code: 'MR-2026-2688', title: 'Thép D16 + D10 móng nhà xưởng 3', who: 'Nguyễn Chấp Việt lập', meta: '4 dòng · cần 09/10 · SMB-2026', dueAt: at(0, 13), ref: { requestId: 'mr-2688', projectId: 'smb', requestOrigin: 'project' } }),
    item({ source: 'daily_log', module: 'project', kind: 'approve', id: 'dl-0510', code: 'NK 05/10', title: 'Nhật ký 05/10 · Sơn Miền Bắc', who: 'Lê Văn Tùng gửi', meta: '41 công · 5 phiếu kỹ sư', dueAt: at(0), ref: { dailyLogId: 'dl-0510', projectId: 'smb' } }),
    item({ source: 'work_plan', module: 'project', kind: 'approve', id: 'wp-41', code: 'KH-2026-41', title: 'Kế hoạch tuần 06/10–12/10', who: 'Lê Văn Tùng gửi', meta: 'SMB-2026', dueAt: at(0), ref: { planId: 'wp-41', projectId: 'smb', periodType: 'week', periodStart: '2026-10-06' } }),
    item({ source: 'rq', module: 'request', kind: 'approve', id: 'rq-61', code: 'RQ-2026-000061', title: 'Bổ sung 2 kỹ sư hoàn thiện từ 13/10', who: 'Nguyễn Thị Mơ lập', meta: 'Nhu cầu nhân sự', dueAt: at(2), ref: { requestId: 'rq-61' } }),
    item({ source: 'leave', module: 'hrm', kind: 'approve', id: 'np-41', code: 'NP-2026-041', title: 'Trần Văn Hải nghỉ phép năm 2 ngày 08/10–09/10', who: 'Trần Văn Hải gửi', meta: 'Việc gia đình', dueAt: at(1), ref: { requestId: 'np-41' } }),
    item({ source: 'makeup', module: 'hrm', kind: 'approve', id: 'cc-03', code: 'Bù công 03/10', title: 'Phạm Văn Đức đề nghị chấm công bù 03/10', who: 'Phạm Văn Đức gửi', meta: 'Quên chấm ra · 17:30', dueAt: at(3), ref: { proposalId: 'cc-03' } }),
    item({ source: 'work', module: 'work', kind: 'do', id: 'wk-1203', code: 'VW-2026-001203', title: 'Gửi biên bản nghiệm thu móng A3 cho CĐT', who: 'Nguyễn Thị Mơ giao', meta: 'Đang làm · quan trọng', dueAt: at(0, 18), ref: { taskCode: 'VW-2026-001203' } }),
    item({ source: 'po', module: 'procurement', kind: 'approve', id: 'po-116', code: 'PO-116', title: 'Kết cấu thép 568 · 1,3 tỷ', who: 'Nguyễn Thị Mơ lập', meta: '8 dòng · SMB-2026', dueAt: at(-2), ref: { poId: 'po-116' } }),
    item({ source: 'office', module: 'office', kind: 'read', id: 'tb-12', code: 'TB-12/2026', title: 'Quy định an toàn thi công mùa mưa', who: 'Ban TGĐ phát hành', meta: 'Yêu cầu xác nhận đã đọc', dueAt: at(1), ref: { documentId: 'tb-12' } }),
  ],
  sent: [
    item({ source: 'fin_site_expense', module: 'finance', kind: 'wait', id: 'qct-10', code: 'QCT-SMB-10', title: 'Đề nghị cấp vốn quỹ công trường · 150 tr', who: 'Chờ kế toán duyệt', meta: 'SMB-2026 · Quỹ công trường SMB', dueAt: at(4) }),
    item({ source: 'rq', module: 'request', kind: 'wait', id: 'rq-62', code: 'RQ-2026-000062', title: 'Xin cấp máy cắt sắt cho mũi 2', who: 'Nguyễn Thị Mơ lập', meta: 'Mua sắm thiết bị', ref: { requestId: 'rq-62' } }),
    item({ source: 'hot', module: 'procurement', kind: 'wait', id: 'mn-3', code: 'MN-2026-003', title: 'Thuê máy cắt sắt · 850.000 đ', who: 'Chờ duyệt', meta: 'SMB-2026 · đã mua', ref: { hotPurchaseId: 'mn-3' } }),
  ],
  watch: [
    item({ source: 'site_assignment', module: 'hrm', kind: 'watch', id: 'sa-7', code: 'SA-2026-007', title: 'Nguyễn Văn Nam đến Sơn Miền Bắc từ 08/10', who: 'HR lập', meta: 'Bổ sung kỹ sư hoàn thiện', dueAt: at(1), ref: { assignmentId: 'sa-7' } }),
    item({ source: 'office', module: 'office', kind: 'watch', id: 'cv-88', code: 'CV-88/2026', title: 'Công văn CĐT về tiến độ hạng mục móng', who: 'Văn thư phát hành', meta: 'Đang theo dõi', ref: { documentId: 'cv-88' } }),
  ],
};

const loadWorkItems = (tab: InboxTab): Promise<WorkItemsPage> => new Promise((resolve, reject) => setTimeout(() => {
  const mode = params.get('inbox');
  if (mode === 'error') return reject(new Error('fixture error'));
  const items = mode === 'empty' ? [] : ITEMS[tab];
  resolve({ tab, generatedAt: NOW.toISOString(), total: items.length, truncatedSources: [], items });
}, 60));

const StubRenderer: React.FC<{ renderer: string; props: Record<string, string> }> = ({ renderer, props }) => (
  <div className="vcc-card p-4" data-testid="stub-renderer">View nhúng: <b>{renderer}</b> · {JSON.stringify(props)}</div>
);

const FakeRail: React.FC = () => (
  <nav className="hidden lg:flex w-16 flex-none flex-col items-center gap-2 border-r border-slate-200 bg-white/70 py-4 text-slate-500 dark:border-slate-800 dark:bg-[#1c1f22]" aria-label="Thanh bên của app">
    <span className="mb-2 grid h-9 w-9 place-items-center rounded-xl bg-teal-700 text-[11px] font-bold text-white">TT</span>
    {[PanelsTopLeft, LayoutDashboard, BarChart3, Briefcase, ShoppingCart, Package, Wallet, FileText].map((Icon, index) => (
      <span key={index} className={`grid h-10 w-10 place-items-center rounded-xl ${index === 0 ? 'bg-teal-700 text-white' : ''}`}><Icon size={18} /></span>
    ))}
  </nav>
);

const Fixture: React.FC = () => {
  const [dark, setDark] = useState(params.get('theme') === 'dark');
  const [lastRoute, setLastRoute] = useState('');
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden" data-last-route={lastRoute}>
      <FakeRail />
      <main className="min-w-0 flex-1">
        <CenterShell
          person={{ fullName: 'Phạm Ngọc Sơn', gender: 'Nam', title: 'Chỉ huy trưởng · SMB-2026' }}
          company={{ name: 'Tiến Thịnh' }}
          isDark={dark}
          onToggleTheme={() => setDark(value => !value)}
          onOpenMenu={() => setLastRoute('menu')}
          mobileNotifications={<button type="button" className="vcc-iconbtn" aria-label="Thông báo"><Bell size={15} /></button>}
          canOpenRoute={route => !DENIED_ROUTES.has(route)}
          onNavigate={setLastRoute}
          now={NOW}
          loadWorkItems={loadWorkItems}
          Renderer={StubRenderer}
        />
      </main>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<Fixture />);
