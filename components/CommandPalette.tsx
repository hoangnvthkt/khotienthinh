import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useWorkflow } from '../context/WorkflowContext';
import { useRequest } from '../context/RequestContext';
import { canAccessRoute, getRouteModuleKey } from '../lib/routeAccess';
import {
  Search, X, Users, Package, ArrowLeftRight, ClipboardCheck, Briefcase,
  FileText, Hash, ArrowRight, Command, CornerDownLeft, ChevronUp, User,
  Warehouse, DollarSign, Calendar, Settings, HardHat, Box, GitBranch,
  ShoppingCart, Truck, BarChart3, Bot, Database, ShieldCheck, Landmark,
  Building2, MessageSquarePlus
} from 'lucide-react';

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  icon: React.ReactNode;
  route: string;
  keywords: string;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  'Nhân sự': { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-600 dark:text-teal-400', icon: <Users size={12} /> },
  'Vật tư': { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', icon: <Package size={12} /> },
  'Phiếu kho': { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400', icon: <ArrowLeftRight size={12} /> },
  'Yêu cầu': { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400', icon: <ClipboardCheck size={12} /> },
  'Người dùng': { bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-400', icon: <User size={12} /> },
  'Kho': { bg: 'bg-rose-100 dark:bg-rose-900/30', text: 'text-rose-600 dark:text-rose-400', icon: <Warehouse size={12} /> },
  'Dự án': { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-600 dark:text-orange-400', icon: <HardHat size={12} /> },
  'Tài sản': { bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-600 dark:text-pink-400', icon: <Box size={12} /> },
  'Quy trình': { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-600 dark:text-indigo-400', icon: <GitBranch size={12} /> },
  'Đơn hàng PO': { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-600 dark:text-cyan-400', icon: <ShoppingCart size={12} /> },
  'Nhà cung cấp': { bg: 'bg-lime-100 dark:bg-lime-900/30', text: 'text-lime-700 dark:text-lime-400', icon: <Truck size={12} /> },
  'Báo cáo': { bg: 'bg-fuchsia-100 dark:bg-fuchsia-900/30', text: 'text-fuchsia-600 dark:text-fuchsia-400', icon: <BarChart3 size={12} /> },
  'Hợp đồng': { bg: 'bg-sky-100 dark:bg-sky-900/30', text: 'text-sky-600 dark:text-sky-400', icon: <FileText size={12} /> },
  'AI': { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400', icon: <Bot size={12} /> },
  'Góp ý': { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400', icon: <MessageSquarePlus size={12} /> },
  'Hệ thống': { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', icon: <ShieldCheck size={12} /> },
  'Trang': { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', icon: <FileText size={12} /> },
};

// Quick navigation pages
const PAGES: SearchResult[] = [
  { id: 'p-dash', title: 'Dashboard Kho', subtitle: 'Tổng quan kho vật tư', category: 'Trang', icon: <Settings size={16} />, route: '/dashboard', keywords: 'dashboard tong quan kho' },
  { id: 'p-inv', title: 'Tồn kho', subtitle: 'Danh sách vật tư', category: 'Trang', icon: <Package size={16} />, route: '/inventory', keywords: 'ton kho vat tu san pham' },
  { id: 'p-ops', title: 'Phiếu kho', subtitle: 'Nhập xuất chuyển kho', category: 'Trang', icon: <ArrowLeftRight size={16} />, route: '/operations', keywords: 'phieu kho nhap xuat chuyen' },
  { id: 'p-reports', title: 'Báo cáo kho', subtitle: 'Tổng hợp nhập xuất tồn', category: 'Báo cáo', icon: <BarChart3 size={16} />, route: '/reports', keywords: 'bao cao kho nhap xuat ton vat tu' },
  { id: 'p-audit', title: 'Nhật ký kho', subtitle: 'Audit phiếu kho và vật tư', category: 'Hệ thống', icon: <ShieldCheck size={16} />, route: '/audit', keywords: 'audit nhat ky kho lich su phieu vat tu' },
  { id: 'p-emp', title: 'Hồ sơ nhân sự', subtitle: 'Danh sách nhân viên', category: 'Trang', icon: <Users size={16} />, route: '/hrm/employees', keywords: 'nhan su nhan vien ho so' },
  { id: 'p-att', title: 'Chấm công', subtitle: 'Bảng chấm công', category: 'Trang', icon: <Calendar size={16} />, route: '/hrm/attendance', keywords: 'cham cong ngay lam' },
  { id: 'p-pay', title: 'Bảng lương', subtitle: 'Tính lương hàng tháng', category: 'Trang', icon: <DollarSign size={16} />, route: '/hrm/payroll', keywords: 'bang luong tinh luong thang' },
  { id: 'p-3p', title: 'Lương 3P', subtitle: 'Cấu hình bậc lương 3P', category: 'Trang', icon: <DollarSign size={16} />, route: '/hrm/salary-3p', keywords: 'luong 3p bac luong kpi' },
  { id: 'p-leave', title: 'Nghỉ phép', subtitle: 'Quản lý phép năm', category: 'Trang', icon: <Calendar size={16} />, route: '/hrm/leave', keywords: 'nghi phep phep nam' },
  { id: 'p-req', title: 'Yêu cầu vật tư', subtitle: 'Phiếu yêu cầu', category: 'Trang', icon: <ClipboardCheck size={16} />, route: '/requests', keywords: 'yeu cau vat tu phieu' },
  { id: 'p-mcr', title: 'Đề xuất cấp mã vật tư', subtitle: 'Cấp mã vật tư/vật liệu mới', category: 'Trang', icon: <Hash size={16} />, route: '/material-code-requests', keywords: 'de xuat cap ma vat tu vat lieu sku' },
  { id: 'p-wf', title: 'Quy trình', subtitle: 'Workflow instances', category: 'Trang', icon: <Briefcase size={16} />, route: '/wf', keywords: 'quy trinh workflow' },
  { id: 'p-project', title: 'Dự án', subtitle: 'Điều hành và danh mục dự án', category: 'Dự án', icon: <HardHat size={16} />, route: '/da', keywords: 'du an cong trinh dieu hanh portfolio' },
  { id: 'p-project-material', title: 'Vật tư dự án', subtitle: 'Tổng hợp vật tư dự án', category: 'Dự án', icon: <Package size={16} />, route: '/da/tabs/material', keywords: 'vat tu du an tong hop cung ung' },
  { id: 'p-project-material-request', title: 'Đề xuất vật tư dự án', subtitle: 'Yêu cầu vật tư theo công trình', category: 'Yêu cầu', icon: <ClipboardCheck size={16} />, route: '/da/tabs/material/request', keywords: 'de xuat yeu cau vat tu du an cong trinh material request' },
  { id: 'p-project-material-po', title: 'Đơn hàng PO', subtitle: 'Mua hàng và cung ứng vật tư', category: 'Đơn hàng PO', icon: <ShoppingCart size={16} />, route: '/da/tabs/material/po', keywords: 'po don hang mua hang nha cung cap vat tu cung ung purchase order' },
  { id: 'p-project-material-planning', title: 'Kế hoạch vật tư', subtitle: 'Kế hoạch vật tư theo tiến độ', category: 'Dự án', icon: <Calendar size={16} />, route: '/da/tabs/material/planning', keywords: 'ke hoach vat tu tien do lead time curve phan bo' },
  { id: 'p-project-material-boq', title: 'BOQ vật tư', subtitle: 'Khối lượng và ngân sách vật tư', category: 'Dự án', icon: <FileText size={16} />, route: '/da/tabs/material/boq', keywords: 'boq vat tu khoi luong ngan sach du toan' },
  { id: 'p-project-contract', title: 'Hợp đồng dự án', subtitle: 'Hợp đồng, phụ lục, nghiệm thu', category: 'Hợp đồng', icon: <FileText size={16} />, route: '/da/tabs/contract', keywords: 'hop dong du an phu luc nghiem thu thanh toan' },
  { id: 'p-hd', title: 'Quản lý hợp đồng', subtitle: 'Đối tác, loại hợp đồng, thư viện giá', category: 'Hợp đồng', icon: <FileText size={16} />, route: '/hd/overview', keywords: 'hop dong doi tac loai hop dong thu vien gia' },
  { id: 'p-cost-library', title: 'Thư viện đơn giá', subtitle: 'Danh mục chi phí và đơn giá', category: 'Hợp đồng', icon: <Landmark size={16} />, route: '/hd/cost-library', keywords: 'thu vien don gia cost library chi phi vat tu nhan cong may' },
  { id: 'p-tender-boq', title: 'Tender AI BOQ', subtitle: 'Phân tích chào thầu bằng AI', category: 'AI', icon: <Bot size={16} />, route: '/tender-ai/boq', keywords: 'tender ai chao thau boq phan tich ho so moi thau' },
  { id: 'p-ai', title: 'AI Assistant', subtitle: 'Trợ lý dữ liệu nội bộ', category: 'AI', icon: <Bot size={16} />, route: '/ai', keywords: 'ai assistant tro ly hoi dap du lieu' },
  { id: 'p-feedback', title: 'Trung tâm góp ý', subtitle: 'Gửi góp ý, báo lỗi và theo dõi xử lý', category: 'Góp ý', icon: <MessageSquarePlus size={16} />, route: '/feedback', keywords: 'feedback gop y bao loi cai tien roadmap bug' },
  { id: 'p-audit-trail', title: 'Nhật ký thay đổi', subtitle: 'Lưu vết thao tác hệ thống', category: 'Hệ thống', icon: <ShieldCheck size={16} />, route: '/audit-trail', keywords: 'nhat ky thay doi audit trail lich su thao tac' },
  { id: 'p-storage', title: 'Kho dữ liệu', subtitle: 'Data storage và đồng bộ', category: 'Hệ thống', icon: <Database size={16} />, route: '/storage', keywords: 'kho du lieu storage database dong bo' },
  { id: 'p-settings', title: 'Cài đặt', subtitle: 'Cấu hình hệ thống', category: 'Trang', icon: <Settings size={16} />, route: '/settings', keywords: 'cai dat he thong settings' },
];

// Remove Vietnamese diacritics for fuzzy matching
const removeDiacritics = (str: string) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const CommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const { user, employees, items, transactions, requests: appRequests, users, warehouses, suppliers, hrmConstructionSites, assets } = useApp();
  const { instances: wfInstances } = useWorkflow();
  const { requests: rqRequests, categories: rqCategories } = useRequest();

  // Build search index
  const allResults = useMemo<SearchResult[]>(() => {
    const results: SearchResult[] = [];
    const pushResult = (result: SearchResult) => {
      if (canAccessRoute(user, result.route)) results.push(result);
    };
    PAGES.forEach(pushResult);
    const canSearchRoute = (route: string) => canAccessRoute(user, route);
    const warehouseNameById = new Map(warehouses.map((w: any) => [w.id, w.name]));
    const itemNameById = new Map(items.map((item: any) => [item.id, `${item.name} ${item.sku || ''}`]));
    const assignedWarehouseId = user?.assignedWarehouseId;
    const isScopedWarehouseUser = Boolean(assignedWarehouseId);

    // Employees
    if (canSearchRoute('/hrm/employees')) employees.forEach((e: any) => {
      pushResult({
        id: `emp-${e.id}`,
        title: e.fullName || 'N/A',
        subtitle: `${e.employeeCode || ''} • ${e.title || 'Nhân viên'}`,
        category: 'Nhân sự',
        icon: <Users size={16} />,
        route: '/hrm/employees',
        keywords: `${e.fullName} ${e.employeeCode} ${e.phone} ${e.email} ${e.title}`,
      });
    });

    // Items
    if (canSearchRoute('/inventory')) items.forEach((item: any) => {
      const stockByWarehouse = item.stockByWarehouse || {};
      if (isScopedWarehouseUser && Number(stockByWarehouse[assignedWarehouseId || ''] || 0) <= 0) return;
      const warehouseKeywords = Object.keys(stockByWarehouse)
        .filter(warehouseId => Number(stockByWarehouse[warehouseId] || 0) > 0)
        .map(warehouseId => warehouseNameById.get(warehouseId))
        .filter(Boolean)
        .join(' ');
      pushResult({
        id: `item-${item.id}`,
        title: item.name,
        subtitle: `${item.sku} • ${item.unit} • Tồn ${isScopedWarehouseUser ? stockByWarehouse[assignedWarehouseId || ''] || 0 : item.stock}`,
        category: 'Vật tư',
        icon: <Package size={16} />,
        route: '/inventory',
        keywords: `${item.name} ${item.sku} ${item.category} ${item.unit} ${item.description || ''} ${warehouseKeywords}`,
      });
    });

    // Transactions
    if (canSearchRoute('/operations')) transactions.forEach((tx: any) => {
      if (isScopedWarehouseUser) {
        const touchedWarehouse = [tx.sourceWarehouseId, tx.targetWarehouseId, tx.warehouseId, tx.requesterWarehouseId]
          .filter(Boolean)
          .includes(assignedWarehouseId);
        if (!touchedWarehouse) return;
      }
      const typeLabels: Record<string, string> = { 'IN': 'Nhập kho', 'OUT': 'Xuất kho', 'TRANSFER': 'Chuyển kho' };
      const txItemKeywords = (tx.items || [])
        .map((line: any) => `${line.itemName || ''} ${line.sku || ''} ${itemNameById.get(line.itemId) || ''}`)
        .join(' ');
      pushResult({
        id: `tx-${tx.id}`,
        title: `${typeLabels[tx.type] || tx.type} — ${tx.date}`,
        subtitle: `${tx.status} • ${(tx.items || []).length} mặt hàng • ${warehouseNameById.get(tx.sourceWarehouseId) || warehouseNameById.get(tx.targetWarehouseId) || 'Kho'}`,
        category: 'Phiếu kho',
        icon: <ArrowLeftRight size={16} />,
        route: '/operations',
        keywords: `${tx.type} ${tx.date} ${tx.status} ${tx.note || ''} ${tx.code || ''} ${txItemKeywords} phieu nhap xuat chuyen kho`,
      });
    });

    // Requests
    if (canSearchRoute('/requests')) appRequests.forEach((req: any) => {
      if (isScopedWarehouseUser) {
        const touchedWarehouse = [req.sourceWarehouseId, req.targetWarehouseId, req.requesterWarehouseId, req.warehouseId]
          .filter(Boolean)
          .includes(assignedWarehouseId);
        if (!touchedWarehouse) return;
      }
      const requestItems = (req.items || [])
        .map((line: any) => `${line.itemName || ''} ${line.sku || ''} ${itemNameById.get(line.itemId) || ''}`)
        .join(' ');
      pushResult({
        id: `req-${req.id}`,
        title: `Yêu cầu ${req.code}`,
        subtitle: `${req.status} • ${req.createdDate || ''}`,
        category: 'Yêu cầu',
        icon: <ClipboardCheck size={16} />,
        route: '/requests',
        keywords: `${req.code} ${req.status} ${req.note || ''} ${requestItems} yeu cau vat tu cap phat de xuat`,
      });
    });

    // Users
    if (canSearchRoute('/settings')) users.forEach((u: any) => {
      pushResult({
        id: `user-${u.id}`,
        title: u.name,
        subtitle: `${u.role} • ${u.email || u.username}`,
        category: 'Người dùng',
        icon: <User size={16} />,
        route: '/settings',
        keywords: `${u.name} ${u.email} ${u.username} ${u.role}`,
      });
    });

    // Suppliers
    if (canSearchRoute('/hd/partners') || canSearchRoute('/da/tabs/material/po')) suppliers.forEach((supplier: any) => {
      pushResult({
        id: `supplier-${supplier.id}`,
        title: supplier.name,
        subtitle: `${supplier.contactPerson || 'Nhà cung cấp'} • ${supplier.phone || supplier.email || ''}`,
        category: 'Nhà cung cấp',
        icon: <Truck size={16} />,
        route: canSearchRoute('/hd/partners') ? '/hd/partners' : '/da/tabs/material/po',
        keywords: `${supplier.name} ${supplier.contactPerson || ''} ${supplier.phone || ''} ${supplier.email || ''} ${supplier.taxCode || ''} ${(supplier.categories || []).join(' ')} nha cung cap vendor supplier po mua hang`,
      });
    });

    // Warehouses
    if (canSearchRoute('/dashboard')) warehouses.forEach((w: any) => {
      if (isScopedWarehouseUser && w.id !== assignedWarehouseId) return;
      pushResult({
        id: `wh-${w.id}`,
        title: w.name,
        subtitle: `${w.address || 'Kho'} • ${w.type || ''}`,
        category: 'Kho',
        icon: <Warehouse size={16} />,
        route: '/dashboard',
        keywords: `${w.name} ${w.address} kho`,
      });
    });

    // Construction Sites (Dự án)
    if (canSearchRoute('/da')) hrmConstructionSites.forEach((site: any) => {
      pushResult({
        id: `site-${site.id}`,
        title: site.name,
        subtitle: `${site.address || 'Công trình'} • ${site.status || ''}`,
        category: 'Dự án',
        icon: <HardHat size={16} />,
        route: '/da',
        keywords: `${site.name} ${site.address || ''} ${site.status || ''} du an cong trinh`,
      });
    });

    // Assets (Tài sản)
    if (canSearchRoute('/ts/catalog')) assets.forEach((asset: any) => {
      pushResult({
        id: `asset-${asset.id}`,
        title: asset.name,
        subtitle: `${asset.code || asset.serialNumber || ''} • ${asset.status || ''}`,
        category: 'Tài sản',
        icon: <Box size={16} />,
        route: '/ts/catalog',
        keywords: `${asset.name} ${asset.code || ''} ${asset.serialNumber || ''} ${asset.status || ''} tai san`,
      });
    });

    // Workflow Instances
    if (canSearchRoute('/wf')) wfInstances.forEach((wf: any) => {
      const statusMap: Record<string, string> = { RUNNING: 'Đang xử lý', COMPLETED: 'Hoàn thành', REJECTED: 'Từ chối', CANCELLED: 'Đã hủy' };
      pushResult({
        id: `wf-${wf.id}`,
        title: `${wf.code} — ${wf.title}`,
        subtitle: statusMap[wf.status] || wf.status,
        category: 'Quy trình',
        icon: <GitBranch size={16} />,
        route: '/wf',
        keywords: `${wf.code} ${wf.title} ${wf.status} quy trinh workflow phieu`,
      });
    });

    // Request Instances
    if (canSearchRoute('/rq')) rqRequests.forEach((rq: any) => {
      const cat = rqCategories.find(c => c.id === rq.categoryId);
      pushResult({
        id: `rq-${rq.id}`,
        title: `${rq.code} — ${rq.title}`,
        subtitle: `${cat?.name || 'Yêu cầu'} • ${rq.status}`,
        category: 'Yêu cầu',
        icon: <ClipboardCheck size={16} />,
        route: '/rq',
        keywords: `${rq.code} ${rq.title} ${rq.status} ${cat?.name || ''} yeu cau phieu`,
      });
    });

    return results;
  }, [user, employees, items, transactions, appRequests, users, warehouses, suppliers, hrmConstructionSites, assets, wfInstances, rqRequests, rqCategories]);

  // Filter results
  const filteredResults = useMemo(() => {
    const currentModule = getRouteModuleKey(location.pathname);
    if (!query.trim()) {
      return PAGES
        .filter(r => canAccessRoute(user, r.route))
        .sort((a, b) => {
          const aSameModule = getRouteModuleKey(a.route) === currentModule ? 1 : 0;
          const bSameModule = getRouteModuleKey(b.route) === currentModule ? 1 : 0;
          return bSameModule - aSameModule;
        })
        .slice(0, 10);
    }
    const q = removeDiacritics(query.trim());
    const words = q.split(/\s+/);

    return allResults
      .map(r => {
        const target = removeDiacritics(r.keywords + ' ' + r.title + ' ' + r.subtitle);
        if (!words.every(w => target.includes(w))) return null;
        const title = removeDiacritics(r.title);
        const category = removeDiacritics(r.category);
        const routeModule = getRouteModuleKey(r.route);
        let score = 0;
        if (title === q) score += 80;
        if (title.startsWith(q)) score += 50;
        if (title.includes(q)) score += 35;
        if (category.includes(q)) score += 15;
        if (routeModule && routeModule === currentModule) score += 12;
        score += words.reduce((sum, word) => sum + (target.includes(word) ? 3 : 0), 0);
        return { result: r, score };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))
      .map(item => item!.result)
      .slice(0, 20);
  }, [query, allResults, location.pathname, user]);

  // Group results by category
  const groupedResults = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    filteredResults.forEach(r => {
      if (!groups[r.category]) groups[r.category] = [];
      groups[r.category].push(r);
    });
    return groups;
  }, [filteredResults]);

  const flatResults = useMemo((): SearchResult[] => {
    const flat: SearchResult[] = [];
    const groups = Object.values(groupedResults) as SearchResult[][];
    groups.forEach(group => flat.push(...group));
    return flat;
  }, [groupedResults]);

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Scroll selected into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector('[data-selected="true"]');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  const handleSelect = useCallback((result: SearchResult) => {
    setIsOpen(false);
    navigate(result.route);
  }, [navigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatResults[selectedIndex]) {
        handleSelect(flatResults[selectedIndex]);
      }
    }
  };

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh]" onClick={() => setIsOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-2xl mx-4 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'commandPaletteIn 0.15s ease-out' }}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <Search size={20} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tìm nhân sự, vật tư, phiếu, trang..."
            className="flex-1 bg-transparent text-base font-medium text-slate-800 dark:text-white placeholder-slate-400 outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {flatResults.length === 0 ? (
            <div className="py-12 text-center">
              <Search size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm font-bold text-slate-400">Không tìm thấy kết quả</p>
              <p className="text-xs text-slate-300 dark:text-slate-600 mt-1">Thử từ khóa khác hoặc tìm bằng mã</p>
            </div>
          ) : (
            (Object.entries(groupedResults) as [string, SearchResult[]][]).map(([category, results]) => {
              const catInfo = CATEGORY_COLORS[category] || CATEGORY_COLORS['Trang'];
              return (
                <div key={category} className="mb-1">
                  {/* Category header */}
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest ${catInfo.bg} ${catInfo.text}`}>
                      {catInfo.icon} {category}
                    </span>
                    <span className="text-[10px] text-slate-300 dark:text-slate-600 font-bold">{results.length}</span>
                  </div>
                  {/* Results in category */}
                  {results.map(result => {
                    const currentFlatIndex = flatIndex++;
                    const isSelected = currentFlatIndex === selectedIndex;
                    return (
                      <button
                        key={result.id}
                        data-selected={isSelected}
                        onClick={() => handleSelect(result)}
                        onMouseEnter={() => setSelectedIndex(currentFlatIndex)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-100 group ${
                          isSelected
                            ? 'bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-200 dark:ring-indigo-800'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        {/* Icon */}
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition ${
                          isSelected
                            ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                        }`}>
                          {result.icon}
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-bold truncate ${isSelected ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}>
                            {highlightMatch(result.title, query)}
                          </div>
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{result.subtitle}</div>
                        </div>
                        {/* Arrow */}
                        {isSelected && (
                          <ArrowRight size={14} className="text-indigo-400 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-4 text-[10px] font-bold text-slate-400">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">↑↓</kbd>
            di chuyển
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">↵</kbd>
            mở
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">esc</kbd>
            đóng
          </span>
          <span className="ml-auto text-slate-300 dark:text-slate-600">
            Vioo Search
          </span>
        </div>
      </div>

      {/* Animation keyframes */}
      <style>{`
        @keyframes commandPaletteIn {
          from { transform: scale(0.95) translateY(-10px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

// Highlight matching text
function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const q = removeDiacritics(query.trim());
  const normalized = removeDiacritics(text);
  const idx = normalized.indexOf(q);
  if (idx === -1) return text;

  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export default CommandPalette;
