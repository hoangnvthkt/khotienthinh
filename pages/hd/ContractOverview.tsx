import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileSignature, Building2, Users, HardHat, Search, Loader2,
  DollarSign, ArrowUpRight, ArrowDownRight, Folder, ChevronDown, ChevronUp,
  Percent, Eye, AlertCircle, TrendingUp, HelpCircle
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { Project, CustomerContract, SubcontractorContract, SupplierContract } from '../../types';
import { projectMasterService } from '../../lib/projectMasterService';
import { customerContractService, subcontractorContractService, supplierContractService } from '../../lib/hdService';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';

interface ContractPaymentSummary {
  totalValue: number;
  totalPaid: number;
  remaining: number;
  progressPercent: number;
}

interface ProjectContractGroup {
  project: Project | { id: string; name: string; code: string };
  mainContracts: CustomerContract[];
  subContracts: (SubcontractorContract | SupplierContract)[];
  mainStats: ContractPaymentSummary;
  subStats: ContractPaymentSummary;
}

const formatCurrency = (v: number, currency = 'VND') =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);

const ContractOverview: React.FC = () => {
  const { user } = useApp();
  const navigate = useNavigate();
  const toast = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  const [customerContracts, setCustomerContracts] = useState<CustomerContract[]>([]);
  const [subcontractorContracts, setSubcontractorContracts] = useState<SubcontractorContract[]>([]);
  const [supplierContracts, setSupplierContracts] = useState<SupplierContract[]>([]);
  const [paymentCertificates, setPaymentCertificates] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProjectWithNoContracts, setFilterProjectWithNoContracts] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [projectsData, customerData, subcontractorData, supplierData] = await Promise.all([
          projectMasterService.list().catch(() => [] as Project[]),
          customerContractService.list().catch(() => [] as CustomerContract[]),
          subcontractorContractService.list().catch(() => [] as SubcontractorContract[]),
          supplierContractService.list().catch(() => [] as SupplierContract[])
        ]);

        setProjects(projectsData);
        setCustomerContracts(customerData);
        setSubcontractorContracts(subcontractorData);
        setSupplierContracts(supplierData);

        if (isSupabaseConfigured) {
          const { data: certs, error } = await supabase
            .from('payment_certificates')
            .select('contract_id, contract_type, status, payable_this_period, current_payable_amount');
          if (!error && certs) {
            setPaymentCertificates(certs);
          }
        }
      } catch (err: any) {
        console.error('Error loading contracts overview data:', err);
        toast.error('Lỗi tải dữ liệu', err?.message || 'Không thể đồng bộ dữ liệu từ máy chủ.');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [toast]);

  // Clean mapped payment certificates
  const mappedCerts = useMemo(() => {
    return paymentCertificates.map((c: any) => ({
      contractId: c.contract_id || c.contractId,
      contractType: c.contract_type || c.contractType,
      status: c.status,
      paidAmount: Number(c.payable_this_period ?? c.current_payable_amount ?? 0)
    }));
  }, [paymentCertificates]);

  // In-memory payment summary calculator per contract ID
  const contractPaymentMap = useMemo(() => {
    const map = new Map<string, number>();
    mappedCerts.forEach(cert => {
      if (cert.status === 'paid') {
        const current = map.get(cert.contractId) || 0;
        map.set(cert.contractId, current + cert.paidAmount);
      }
    });
    return map;
  }, [mappedCerts]);

  const getContractSummary = (id: string, value: number): ContractPaymentSummary => {
    const totalPaid = contractPaymentMap.get(id) || 0;
    const remaining = Math.max(0, value - totalPaid);
    const progressPercent = value > 0 ? (totalPaid / value) * 100 : 0;
    return { totalValue: value, totalPaid, remaining, progressPercent };
  };

  // Group contracts by project
  const projectGroups = useMemo<ProjectContractGroup[]>(() => {
    const groups: Record<string, ProjectContractGroup> = {};

    // Initialize with all projects
    projects.forEach(p => {
      groups[p.id] = {
        project: p,
        mainContracts: [],
        subContracts: [],
        mainStats: { totalValue: 0, totalPaid: 0, remaining: 0, progressPercent: 0 },
        subStats: { totalValue: 0, totalPaid: 0, remaining: 0, progressPercent: 0 }
      };
    });

    // Virtual project for contracts without project ID
    const UNASSIGNED_KEY = 'unassigned';
    groups[UNASSIGNED_KEY] = {
      project: { id: UNASSIGNED_KEY, name: 'Hợp đồng chưa phân dự án', code: 'CHƯA PHÂN' },
      mainContracts: [],
      subContracts: [],
      mainStats: { totalValue: 0, totalPaid: 0, remaining: 0, progressPercent: 0 },
      subStats: { totalValue: 0, totalPaid: 0, remaining: 0, progressPercent: 0 }
    };

    // Group customer contracts (main)
    customerContracts.forEach(c => {
      const pid = c.projectId || UNASSIGNED_KEY;
      if (!groups[pid]) {
        groups[pid] = {
          project: { id: pid, name: `Dự án ID: ${pid}`, code: 'DỰ ÁN LẠ' },
          mainContracts: [],
          subContracts: [],
          mainStats: { totalValue: 0, totalPaid: 0, remaining: 0, progressPercent: 0 },
          subStats: { totalValue: 0, totalPaid: 0, remaining: 0, progressPercent: 0 }
        };
      }
      groups[pid].mainContracts.push(c);
    });

    // Group subcontracts & supplier contracts (sub)
    subcontractorContracts.forEach(c => {
      const pid = c.projectId || UNASSIGNED_KEY;
      if (!groups[pid]) {
        groups[pid] = {
          project: { id: pid, name: `Dự án ID: ${pid}`, code: 'DỰ ÁN LẠ' },
          mainContracts: [],
          subContracts: [],
          mainStats: { totalValue: 0, totalPaid: 0, remaining: 0, progressPercent: 0 },
          subStats: { totalValue: 0, totalPaid: 0, remaining: 0, progressPercent: 0 }
        };
      }
      groups[pid].subContracts.push(c);
    });

    supplierContracts.forEach(c => {
      const pid = c.projectId || UNASSIGNED_KEY;
      if (!groups[pid]) {
        groups[pid] = {
          project: { id: pid, name: `Dự án ID: ${pid}`, code: 'DỰ ÁN LẠ' },
          mainContracts: [],
          subContracts: [],
          mainStats: { totalValue: 0, totalPaid: 0, remaining: 0, progressPercent: 0 },
          subStats: { totalValue: 0, totalPaid: 0, remaining: 0, progressPercent: 0 }
        };
      }
      groups[pid].subContracts.push(c);
    });

    // Compute stats aggregates at project level
    return Object.values(groups)
      .map(group => {
        let mainVal = 0, mainPaid = 0;
        group.mainContracts.forEach(c => {
          const sum = getContractSummary(c.id, c.value);
          mainVal += sum.totalValue;
          mainPaid += sum.totalPaid;
        });

        let subVal = 0, subPaid = 0;
        group.subContracts.forEach(c => {
          const sum = getContractSummary(c.id, c.value);
          subVal += sum.totalValue;
          subPaid += sum.totalPaid;
        });

        group.mainStats = {
          totalValue: mainVal,
          totalPaid: mainPaid,
          remaining: Math.max(0, mainVal - mainPaid),
          progressPercent: mainVal > 0 ? (mainPaid / mainVal) * 100 : 0
        };

        group.subStats = {
          totalValue: subVal,
          totalPaid: subPaid,
          remaining: Math.max(0, subVal - subPaid),
          progressPercent: subVal > 0 ? (subPaid / subVal) * 100 : 0
        };

        return group;
      })
      .filter(g => {
        // Exclude unassigned if it's completely empty
        if (g.project.id === UNASSIGNED_KEY && g.mainContracts.length === 0 && g.subContracts.length === 0) {
          return false;
        }
        return true;
      });
  }, [projects, customerContracts, subcontractorContracts, supplierContracts, contractPaymentMap]);

  // Overall system metrics
  const globalMetrics = useMemo(() => {
    let revenueVal = 0;
    let revenuePaid = 0;
    let costVal = 0;
    let costPaid = 0;

    customerContracts.forEach(c => {
      const sum = getContractSummary(c.id, c.value);
      revenueVal += sum.totalValue;
      revenuePaid += sum.totalPaid;
    });

    subcontractorContracts.forEach(c => {
      const sum = getContractSummary(c.id, c.value);
      costVal += sum.totalValue;
      costPaid += sum.totalPaid;
    });

    supplierContracts.forEach(c => {
      const sum = getContractSummary(c.id, c.value);
      costVal += sum.totalValue;
      costPaid += sum.totalPaid;
    });

    const netRevenueRemaining = Math.max(0, revenueVal - revenuePaid);
    const netCostRemaining = Math.max(0, costVal - costPaid);
    const marginPercent = revenueVal > 0 ? ((revenueVal - costVal) / revenueVal) * 100 : 0;

    return {
      revenueVal,
      revenuePaid,
      revenueRemaining: netRevenueRemaining,
      revenueProgress: revenueVal > 0 ? (revenuePaid / revenueVal) * 100 : 0,

      costVal,
      costPaid,
      costRemaining: netCostRemaining,
      costProgress: costVal > 0 ? (costPaid / costVal) * 100 : 0,

      marginPercent,
      netMarginValue: revenueVal - costVal
    };
  }, [customerContracts, subcontractorContracts, supplierContracts, contractPaymentMap]);

  // Filter and Search results
  const filteredGroups = useMemo(() => {
    return projectGroups.filter(g => {
      const matchSearch = !searchTerm.trim() ||
        matchesSearchQueryMultiple([
          g.project.name,
          g.project.code,
          ...g.mainContracts.map(c => `${c.name} ${c.code} ${c.customerName}`),
          ...g.subContracts.map(c => `${c.name} ${c.code} ${'subcontractorName' in c ? c.subcontractorName : c.supplierName || ''}`)
        ], searchTerm);

      const hasContracts = g.mainContracts.length > 0 || g.subContracts.length > 0;
      const matchNoContractsFilter = !filterProjectWithNoContracts || hasContracts;

      return matchSearch && matchNoContractsFilter;
    });
  }, [projectGroups, searchTerm, filterProjectWithNoContracts]);

  const toggleExpandProject = (id: string) => {
    setExpandedProjects(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const allExpanded = filteredGroups.reduce<Record<string, boolean>>((acc, g) => {
      acc[g.project.id] = true;
      return acc;
    }, {});
    setExpandedProjects(allExpanded);
  };

  const collapseAll = () => {
    setExpandedProjects({});
  };

  if (loading) {
    return (
      <div className="h-96 flex flex-col items-center justify-center text-slate-400 gap-3">
        <Loader2 className="animate-spin text-blue-600" size={32} />
        <span className="text-sm font-black uppercase tracking-wider">Đang kết xuất dữ liệu hợp đồng...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Global System Summary Metrics ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Income / Revenue (HĐ Chính) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-bl-full flex items-start justify-end p-4">
            <ArrowUpRight className="text-emerald-500" size={24} />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tổng thu (Hợp đồng chính)</span>
            <h4 className="text-xl font-black text-slate-800 dark:text-white mt-1">
              {formatCurrency(globalMetrics.revenueVal)}
            </h4>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs border-t border-slate-100 dark:border-slate-800 pt-3">
            <div>
              <span className="text-slate-400 block font-medium">Đã thu:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(globalMetrics.revenuePaid)}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Còn lại:</span>
              <span className="font-bold text-slate-700 dark:text-slate-300">{formatCurrency(globalMetrics.revenueRemaining)}</span>
            </div>
          </div>
          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-bold">
              <span className="text-slate-400">Tiến độ thu tiền</span>
              <span className="text-emerald-600 dark:text-emerald-400">{globalMetrics.revenueProgress.toFixed(1)}%</span>
            </div>
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-500"
                style={{ width: `${globalMetrics.revenueProgress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Expenses / Costs (HĐ Phụ) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 dark:bg-rose-500/10 rounded-bl-full flex items-start justify-end p-4">
            <ArrowDownRight className="text-rose-500" size={24} />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tổng chi thầu (Hợp đồng phụ)</span>
            <h4 className="text-xl font-black text-slate-800 dark:text-white mt-1">
              {formatCurrency(globalMetrics.costVal)}
            </h4>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs border-t border-slate-100 dark:border-slate-800 pt-3">
            <div>
              <span className="text-slate-400 block font-medium">Đã chi:</span>
              <span className="font-bold text-rose-600 dark:text-rose-400">{formatCurrency(globalMetrics.costPaid)}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Còn lại:</span>
              <span className="font-bold text-slate-700 dark:text-slate-300">{formatCurrency(globalMetrics.costRemaining)}</span>
            </div>
          </div>
          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-bold">
              <span className="text-slate-400">Tiến độ chi tiền</span>
              <span className="text-rose-600 dark:text-rose-400">{globalMetrics.costProgress.toFixed(1)}%</span>
            </div>
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rose-400 to-pink-500 transition-all duration-500"
                style={{ width: `${globalMetrics.costProgress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Net Margin / Health */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 dark:bg-blue-500/10 rounded-bl-full flex items-start justify-end p-4">
            <TrendingUp className="text-blue-500" size={24} />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Biên lợi nhuận định mức HĐ</span>
            <h4 className="text-xl font-black text-slate-800 dark:text-white mt-1">
              {formatCurrency(globalMetrics.netMarginValue)}
            </h4>
          </div>
          <div className="flex items-center gap-2 text-xs border-t border-slate-100 dark:border-slate-800 pt-3">
            <span className="text-slate-400">Tỷ suất biên:</span>
            <span className={`font-black px-2 py-0.5 rounded-lg text-xs ${globalMetrics.netMarginValue >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'}`}>
              {globalMetrics.marginPercent.toFixed(1)}%
            </span>
          </div>
          <div className="text-[10px] text-slate-450 italic font-medium">
            (Tính trên tổng chênh lệch HĐ chính và tổng HĐ phụ ký thầu phụ/mua hàng)
          </div>
        </div>
      </div>

      {/* ─── Search and Controls ─── */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-850 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
            placeholder="Tìm kiếm dự án, mã HĐ, tên đối tác..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-4 text-sm font-bold">
          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={filterProjectWithNoContracts}
              onChange={e => setFilterProjectWithNoContracts(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 w-4 h-4"
            />
            Ẩn dự án chưa có HĐ
          </label>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />

          <button onClick={expandAll} className="text-blue-600 dark:text-blue-400 hover:underline">Mở tất cả</button>
          <button onClick={collapseAll} className="text-slate-400 hover:text-slate-650 dark:hover:text-slate-200">Thu gọn</button>
        </div>
      </div>

      {/* ─── Projects Contract Group List ─── */}
      <div className="space-y-4">
        {filteredGroups.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center text-slate-400 space-y-3 shadow-sm">
            <AlertCircle className="mx-auto text-slate-300" size={40} />
            <h3 className="text-base font-black text-slate-800 dark:text-white">Không tìm thấy dự án hoặc hợp đồng phù hợp</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">Vui lòng thay đổi từ khóa hoặc bộ lọc để mở rộng kết quả tìm kiếm.</p>
          </div>
        ) : (
          filteredGroups.map(group => {
            const hasContracts = group.mainContracts.length > 0 || group.subContracts.length > 0;
            const isExpanded = !!expandedProjects[group.project.id]; // Default collapsed

            return (
              <div
                key={group.project.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm transition-all"
              >
                {/* Project Header */}
                <div
                  onClick={() => toggleExpandProject(group.project.id)}
                  className="flex items-center justify-between p-5 cursor-pointer bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-100/30 transition select-none"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                      <Folder size={18} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2 truncate">
                        <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-mono tracking-wider shrink-0 text-slate-650 dark:text-slate-400">
                          {group.project.code}
                        </span>
                        {group.project.name}
                      </h4>
                      <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                        {group.mainContracts.length} HĐ chính • {group.subContracts.length} HĐ phụ
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    {!hasContracts && (
                      <span className="text-[10px] font-bold px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200/40 rounded-full dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40">
                        Chưa liên kết hợp đồng
                      </span>
                    )}
                    {hasContracts && (
                      <div className="hidden sm:flex items-center gap-6 text-xs mr-3">
                        {/* Revenue Quick view */}
                        {group.mainStats.totalValue > 0 && (
                          <div className="text-right">
                            <span className="text-[9px] text-slate-400 block uppercase font-bold">Thu từ CĐT:</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300">
                              {formatCurrency(group.mainStats.totalPaid)} / {formatCurrency(group.mainStats.totalValue)}
                            </span>
                          </div>
                        )}
                        {/* Expense Quick view */}
                        {group.subStats.totalValue > 0 && (
                          <div className="text-right">
                            <span className="text-[9px] text-slate-400 block uppercase font-bold">Chi thầu phụ/NCC:</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300">
                              {formatCurrency(group.subStats.totalPaid)} / {formatCurrency(group.subStats.totalValue)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    <button className="text-slate-400">
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {/* Project Body */}
                {isExpanded && (
                  <div className="p-5 space-y-6">
                    {/* Project financial dashboard overview */}
                    {hasContracts && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                        {/* Revenue Card (Main Contract) */}
                        <div className="p-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2.5">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-black text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Hợp đồng chính (Thu CĐT)
                            </span>
                            {group.mainStats.totalValue > 0 && (
                              <span className="font-black text-emerald-600 dark:text-emerald-400">
                                {group.mainStats.progressPercent.toFixed(1)}%
                              </span>
                            )}
                          </div>
                          {group.mainStats.totalValue > 0 ? (
                            <div className="space-y-2">
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div>
                                  <span className="text-slate-450 block text-[9px] uppercase font-bold">Tổng Giá Trị:</span>
                                  <span className="font-bold text-slate-850 dark:text-white">{formatCurrency(group.mainStats.totalValue)}</span>
                                </div>
                                <div>
                                  <span className="text-slate-450 block text-[9px] uppercase font-bold">Đã Thanh Toán:</span>
                                  <span className="font-bold text-emerald-600 dark:text-emerald-450">{formatCurrency(group.mainStats.totalPaid)}</span>
                                </div>
                                <div>
                                  <span className="text-slate-450 block text-[9px] uppercase font-bold">Còn Phải Thu:</span>
                                  <span className="font-bold text-slate-700 dark:text-slate-300">{formatCurrency(group.mainStats.remaining)}</span>
                                </div>
                              </div>
                              <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-850 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${group.mainStats.progressPercent}%` }} />
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400 italic py-2">Dự án này chưa có HĐ chính ký với chủ đầu tư</div>
                          )}
                        </div>

                        {/* Expense Card (Subcontracts & Suppliers) */}
                        <div className="p-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2.5">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-black text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Hợp đồng phụ (Chi thầu/NCC)
                            </span>
                            {group.subStats.totalValue > 0 && (
                              <span className="font-black text-blue-600 dark:text-blue-450">
                                {group.subStats.progressPercent.toFixed(1)}%
                              </span>
                            )}
                          </div>
                          {group.subStats.totalValue > 0 ? (
                            <div className="space-y-2">
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div>
                                  <span className="text-slate-450 block text-[9px] uppercase font-bold">Tổng Giá Trị:</span>
                                  <span className="font-bold text-slate-850 dark:text-white">{formatCurrency(group.subStats.totalValue)}</span>
                                </div>
                                <div>
                                  <span className="text-slate-450 block text-[9px] uppercase font-bold">Đã Thanh Toán:</span>
                                  <span className="font-bold text-blue-600 dark:text-blue-450">{formatCurrency(group.subStats.totalPaid)}</span>
                                </div>
                                <div>
                                  <span className="text-slate-450 block text-[9px] uppercase font-bold">Còn Phải Chi:</span>
                                  <span className="font-bold text-slate-700 dark:text-slate-300">{formatCurrency(group.subStats.remaining)}</span>
                                </div>
                              </div>
                              <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-850 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${group.subStats.progressPercent}%` }} />
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400 italic py-2">Chưa ký HĐ phụ (thầu phụ/nhà cung cấp) nào cho dự án này</div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Detailed contract tables list */}
                    <div className="space-y-4">
                      {/* MAIN CONTRACTS */}
                      <div className="space-y-2">
                        <div className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                          A. Hợp đồng chính (Ký với Chủ đầu tư)
                        </div>
                        {group.mainContracts.length === 0 ? (
                          <div className="p-4 bg-slate-50/40 dark:bg-slate-900/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-450 text-xs italic">
                            Chưa khai báo hợp đồng chính chủ đầu tư.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-2">
                            {group.mainContracts.map(c => {
                              const sum = getContractSummary(c.id, c.value);
                              return (
                                <div
                                  key={c.id}
                                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-card hover:bg-slate-50/50 dark:hover:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-2xl shadow-sm transition-colors gap-3"
                                >
                                  <div className="flex items-start gap-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                                      <Users size={15} />
                                    </div>
                                    <div className="min-w-0">
                                      <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 block">
                                        {c.code}
                                      </span>
                                      <p className="font-black text-sm text-slate-800 dark:text-white truncate max-w-sm mt-0.5">
                                        {c.name}
                                      </p>
                                      <span className="text-[10px] text-slate-400 block font-medium mt-0.5">
                                        Chủ đầu tư: <b>{c.customerName}</b>
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between sm:justify-end gap-6 text-xs shrink-0">
                                    <div className="grid grid-cols-3 gap-4 text-right">
                                      <div>
                                        <span className="text-[8px] text-slate-400 block font-black uppercase">Giá Trị:</span>
                                        <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(sum.totalValue)}</span>
                                      </div>
                                      <div>
                                        <span className="text-[8px] text-slate-400 block font-black uppercase">Đã Thu:</span>
                                        <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(sum.totalPaid)}</span>
                                      </div>
                                      <div>
                                        <span className="text-[8px] text-slate-400 block font-black uppercase">Tiến Độ:</span>
                                        <span className="font-black text-slate-700 dark:text-slate-350">{sum.progressPercent.toFixed(1)}%</span>
                                      </div>
                                    </div>

                                    <button
                                      onClick={() => navigate(`/hd/customer/${c.id}`)}
                                      className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"
                                      title="Vào Chi tiết HĐ"
                                    >
                                      <Eye size={15} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* SUBCONTRACTS & SUPPLIERS */}
                      <div className="space-y-2">
                        <div className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                          B. Hợp đồng phụ (Ký với Thầu phụ & Nhà cung cấp)
                        </div>
                        {group.subContracts.length === 0 ? (
                          <div className="p-4 bg-slate-50/40 dark:bg-slate-900/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-450 text-xs italic">
                            Chưa khai báo hợp đồng thầu phụ/NCC nào.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-2">
                            {group.subContracts.map(c => {
                              const sum = getContractSummary(c.id, c.value);
                              const isSub = 'subcontractorName' in c;
                              const partner = isSub ? (c as SubcontractorContract).subcontractorName : (c as SupplierContract).supplierName || 'NCC Vãng Lai';
                              const path = isSub ? `/hd/subcontractor/${c.id}` : `/hd/supplier`; // Supplier lacks workspace subpage, redirect to list

                              return (
                                <div
                                  key={c.id}
                                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-card hover:bg-slate-50/50 dark:hover:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-2xl shadow-sm transition-colors gap-3"
                                >
                                  <div className="flex items-start gap-2.5 min-w-0">
                                    <div className={`w-8 h-8 rounded-lg ${isSub ? 'bg-amber-50 dark:bg-amber-955/20 text-amber-600 dark:text-amber-400' : 'bg-blue-50 dark:bg-blue-955/20 text-blue-600 dark:text-blue-400'} flex items-center justify-center shrink-0 mt-0.5`}>
                                      {isSub ? <HardHat size={15} /> : <Building2 size={15} />}
                                    </div>
                                    <div className="min-w-0">
                                      <span className={`font-mono text-xs font-bold ${isSub ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'} block`}>
                                        {c.code}
                                      </span>
                                      <p className="font-black text-sm text-slate-800 dark:text-white truncate max-w-sm mt-0.5">
                                        {c.name}
                                      </p>
                                      <span className="text-[10px] text-slate-450 block font-medium mt-0.5">
                                        {isSub ? 'Thầu phụ' : 'Nhà cung cấp'}: <b>{partner}</b>
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between sm:justify-end gap-6 text-xs shrink-0">
                                    <div className="grid grid-cols-3 gap-4 text-right">
                                      <div>
                                        <span className="text-[8px] text-slate-400 block font-black uppercase">Giá Trị:</span>
                                        <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(sum.totalValue)}</span>
                                      </div>
                                      <div>
                                        <span className="text-[8px] text-slate-400 block font-black uppercase">Đã Chi:</span>
                                        <span className="font-bold text-rose-600 dark:text-rose-400">{formatCurrency(sum.totalPaid)}</span>
                                      </div>
                                      <div>
                                        <span className="text-[8px] text-slate-400 block font-black uppercase">Tiến Độ:</span>
                                        <span className="font-black text-slate-700 dark:text-slate-350">{sum.progressPercent.toFixed(1)}%</span>
                                      </div>
                                    </div>

                                    <button
                                      onClick={() => isSub ? navigate(path) : navigate(`/hd/supplier`)}
                                      className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"
                                      title={isSub ? 'Vào Chi tiết HĐ' : 'Xem danh sách HĐ NCC'}
                                    >
                                      <Eye size={15} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ContractOverview;
