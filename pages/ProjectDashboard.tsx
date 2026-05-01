import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { ProjectFinance, ProjectTransaction, ProjectCostCategory, ProjectTxType, ProjectTxSource, Attachment } from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { loadXlsx } from '../lib/loadXlsx';
import { useModuleData } from '../hooks/useModuleData';
import CashFlowTab from './project/CashFlowTab';
import ContractTab from './project/ContractTab';
import GanttTab from './project/GanttTab';
import DailyLogTab from './project/DailyLogTab';
import SubcontractTab from './project/SubcontractTab';
import MaterialTab from './project/MaterialTab';
import SupplyChainTab from './project/SupplyChainTab';
import ReportTab from './project/ReportTab';
import DocumentsTab from './project/DocumentsTab';
import ProjectOrgTab from './project/ProjectOrgTab';
import { taskService } from '../lib/projectService';
import { calculateProjectProgress } from '../lib/projectScheduleRules';
import {
    BarChart3, TrendingUp, TrendingDown, DollarSign, Target, Percent,
    Plus, Edit2, Trash2, X, Check, Save, ChevronDown, FileText,
    Building2, HardHat, AlertCircle, ArrowUpRight, ArrowDownRight,
    Upload, Download, Filter, Calendar, Tag, List, Paperclip, Eye, Image
} from 'lucide-react';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    planning: { label: 'Lập kế hoạch', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
    active: { label: 'Đang thi công', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
    paused: { label: 'Tạm dừng', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
    completed: { label: 'Hoàn thành', color: 'text-violet-600', bg: 'bg-violet-50 border-violet-200' },
};

const CATEGORY_CONFIG: Record<ProjectCostCategory, { label: string; icon: string; color: string }> = {
    materials: { label: 'Vật tư', icon: '🧱', color: '#f97316' },
    labor: { label: 'Nhân công', icon: '👷', color: '#0ea5e9' },
    subcontract: { label: 'Thầu phụ', icon: '🏗️', color: '#8b5cf6' },
    machinery: { label: 'Máy móc', icon: '⚙️', color: '#10b981' },
    overhead: { label: 'Quản lý chung', icon: '📋', color: '#6366f1' },
    other: { label: 'Phát sinh khác', icon: '📦', color: '#ec4899' },
};

const TX_TYPE_CONFIG: Record<ProjectTxType, { label: string; color: string }> = {
    expense: { label: 'Chi phí', color: 'text-red-600' },
    revenue_received: { label: 'Thu (đã TT)', color: 'text-emerald-600' },
    revenue_pending: { label: 'Thu (chờ NT)', color: 'text-amber-600' },
};

const SOURCE_CONFIG: Record<ProjectTxSource, { label: string; icon: string }> = {
    manual: { label: 'Thủ công', icon: '✍️' },
    import: { label: 'Import', icon: '📊' },
    workflow: { label: 'Workflow', icon: '🔄' },
};

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
    return n.toLocaleString('vi-VN');
};
const fmtFull = (n: number) => n.toLocaleString('vi-VN') + ' đ';

const emptyFinance = (siteId: string): ProjectFinance => ({
    id: crypto.randomUUID(),
    constructionSiteId: siteId,
    contractValue: 0,
    budgetMaterials: 0, budgetLabor: 0, budgetSubcontract: 0, budgetMachinery: 0, budgetOverhead: 0,
    actualMaterials: 0, actualLabor: 0, actualSubcontract: 0, actualMachinery: 0, actualOverhead: 0,
    revenueReceived: 0, revenuePending: 0,
    progressPercent: 0, status: 'planning',
    updatedAt: new Date().toISOString(),
});

const ProjectDashboard: React.FC = () => {
    const {
        hrmConstructionSites, projectFinances, addProjectFinance, updateProjectFinance, removeProjectFinance,
        projectTransactions, addProjectTransaction, addProjectTransactions, updateProjectTransaction, removeProjectTransaction, user
    } = useApp();
    useModuleData('da');
    useModuleData('wms');

    const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
    const [activeView, setActiveView] = useState<'list' | 'overview'>('list');
    const [overviewTab, setOverviewTab] = useState<'org' | 'budget' | 'cashflow' | 'contract' | 'gantt' | 'dailylog' | 'subcontract' | 'material' | 'supply' | 'report' | 'documents'>('org');
    const [showBudgetForm, setShowBudgetForm] = useState(false);
    const [showTxForm, setShowTxForm] = useState(false);
    const [budgetData, setBudgetData] = useState<ProjectFinance | null>(null);
    const [txFilter, setTxFilter] = useState<ProjectCostCategory | 'all'>('all');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const txFileInputRef = useRef<HTMLInputElement>(null);

    // TX form state
    const [txType, setTxType] = useState<ProjectTxType>('expense');
    const [txCategory, setTxCategory] = useState<ProjectCostCategory>('materials');
    const [txAmount, setTxAmount] = useState('');
    const [txDesc, setTxDesc] = useState('');
    const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
    const [txFiles, setTxFiles] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [editingTx, setEditingTx] = useState<ProjectTransaction | null>(null);
    const [existingAttachments, setExistingAttachments] = useState<Attachment[]>([]);
    const [taskProgressBySite, setTaskProgressBySite] = useState<Record<string, { progressPercent: number; leafTaskCount: number }>>({});

    const selectedSite = hrmConstructionSites.find(s => s.id === selectedSiteId);
    const selectedFinance = useMemo(() =>
        selectedSiteId ? projectFinances.find(pf => pf.constructionSiteId === selectedSiteId) || null : null,
        [selectedSiteId, projectFinances]
    );

    // === AUTO-AGGREGATE from transactions ===
    const getAggregated = (siteId: string) => {
        const txs = projectTransactions.filter(t => t.constructionSiteId === siteId);
        const sumExpense = (cat: ProjectCostCategory) => txs.filter(t => t.type === 'expense' && t.category === cat).reduce((s, t) => s + t.amount, 0);
        return {
            actualMaterials: sumExpense('materials'),
            actualLabor: sumExpense('labor'),
            actualSubcontract: sumExpense('subcontract'),
            actualMachinery: sumExpense('machinery'),
            actualOverhead: sumExpense('overhead'),
            actualOther: sumExpense('other'),
            revenueReceived: txs.filter(t => t.type === 'revenue_received').reduce((s, t) => s + t.amount, 0),
            revenuePending: txs.filter(t => t.type === 'revenue_pending').reduce((s, t) => s + t.amount, 0),
            totalExpense: txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
            txCount: txs.length,
        };
    };

    const selectedAgg = selectedSiteId ? getAggregated(selectedSiteId) : null;
    const siteTxs = useMemo(() => {
        if (!selectedSiteId) return [];
        let txs = projectTransactions.filter(t => t.constructionSiteId === selectedSiteId);
        if (txFilter !== 'all') txs = txs.filter(t => t.category === txFilter);
        return txs.sort((a, b) => b.date.localeCompare(a.date));
    }, [selectedSiteId, projectTransactions, txFilter]);

    const financeSiteKey = useMemo(() =>
        projectFinances.map(p => `${p.constructionSiteId}:${p.progressPercent}`).sort().join('|'),
        [projectFinances]
    );

    useEffect(() => {
        if (!isSupabaseConfigured) {
            setTaskProgressBySite({});
            return;
        }
        const siteIds = Array.from(new Set(projectFinances.map(p => p.constructionSiteId).filter(Boolean)));
        if (siteIds.length === 0) {
            setTaskProgressBySite({});
            return;
        }

        let cancelled = false;
        taskService.listBySites(siteIds)
            .then(allTasks => {
                if (cancelled) return;
                const next: Record<string, { progressPercent: number; leafTaskCount: number }> = {};
                for (const siteId of siteIds) {
                    const summary = calculateProjectProgress(allTasks.filter(task => task.constructionSiteId === siteId));
                    if (summary.leafTaskCount > 0) {
                        next[siteId] = {
                            progressPercent: summary.progressPercent,
                            leafTaskCount: summary.leafTaskCount,
                        };
                    }
                }
                setTaskProgressBySite(next);
            })
            .catch(console.error);

        return () => { cancelled = true; };
    }, [financeSiteKey, projectFinances]);

    const getDisplayProgress = (finance?: ProjectFinance | null) => {
        if (!finance) return 0;
        return taskProgressBySite[finance.constructionSiteId]?.progressPercent ?? finance.progressPercent;
    };

    // === BUDGET CATEGORIES for chart ===
    const BUDGET_CATS = [
        { key: 'Materials', label: 'Vật tư', icon: '🧱', color: '#f97316', aggKey: 'actualMaterials' as const, filterKey: 'materials' as ProjectCostCategory },
        { key: 'Labor', label: 'Nhân công', icon: '👷', color: '#0ea5e9', aggKey: 'actualLabor' as const, filterKey: 'labor' as ProjectCostCategory },
        { key: 'Subcontract', label: 'Thầu phụ', icon: '🏗️', color: '#8b5cf6', aggKey: 'actualSubcontract' as const, filterKey: 'subcontract' as ProjectCostCategory },
        { key: 'Machinery', label: 'Máy móc', icon: '⚙️', color: '#10b981', aggKey: 'actualMachinery' as const, filterKey: 'machinery' as ProjectCostCategory },
        { key: 'Overhead', label: 'Quản lý chung', icon: '📋', color: '#6366f1', aggKey: 'actualOverhead' as const, filterKey: 'overhead' as ProjectCostCategory },
        { key: 'Other', label: 'Phát sinh', icon: '📦', color: '#ec4899', aggKey: 'actualOther' as const, filterKey: 'other' as ProjectCostCategory },
    ];

    // === ALL-PROJECT AGGREGATE ===
    const allStats = useMemo(() => {
        const totalContract = projectFinances.reduce((s, p) => s + p.contractValue, 0);
        const totalBudget = projectFinances.reduce((s, p) => s + p.budgetMaterials + p.budgetLabor + p.budgetSubcontract + p.budgetMachinery + p.budgetOverhead, 0);
        const totalActual = projectTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const totalRevenue = projectTransactions.filter(t => t.type === 'revenue_received').reduce((s, t) => s + t.amount, 0);
        const avgProgress = projectFinances.length > 0 ? projectFinances.reduce((s, p) => s + getDisplayProgress(p), 0) / projectFinances.length : 0;
        return { totalContract, totalBudget, totalActual, totalRevenue, avgProgress, profit: totalContract - totalActual };
    }, [projectFinances, projectTransactions, taskProgressBySite]);

    // === HANDLERS ===
    const openBudgetForm = (siteId: string) => {
        const existing = projectFinances.find(pf => pf.constructionSiteId === siteId);
        setBudgetData(existing ? { ...existing } : emptyFinance(siteId));
        setShowBudgetForm(true);
    };

    const saveBudget = () => {
        if (!budgetData) return;
        const derivedProgress = taskProgressBySite[budgetData.constructionSiteId]?.progressPercent;
        const nextBudgetData = {
            ...budgetData,
            progressPercent: derivedProgress ?? budgetData.progressPercent,
            updatedAt: new Date().toISOString(),
        };
        const existing = projectFinances.find(pf => pf.id === nextBudgetData.id);
        if (existing) updateProjectFinance(nextBudgetData);
        else addProjectFinance(nextBudgetData);
        setShowBudgetForm(false);
        setSelectedSiteId(nextBudgetData.constructionSiteId);
        setActiveView('overview');
    };

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const uploadFiles = async (files: File[]): Promise<Attachment[]> => {
        if (files.length === 0) return [];
        const results: Attachment[] = [];

        for (const file of files) {
            let uploaded = false;

            // Try Supabase Storage first
            if (isSupabaseConfigured) {
                try {
                    const ext = file.name.split('.').pop();
                    const path = `tx/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
                    console.log('[Attachment] Uploading to storage:', path, 'size:', file.size);
                    const { data, error } = await supabase.storage.from('project-attachments').upload(path, file, {
                        cacheControl: '3600',
                        upsert: false,
                    });
                    if (error) {
                        console.error('[Attachment] Storage upload error:', error.message);
                    } else {
                        const { data: urlData } = supabase.storage.from('project-attachments').getPublicUrl(path);
                        console.log('[Attachment] Upload OK, URL:', urlData.publicUrl);
                        results.push({ name: file.name, url: urlData.publicUrl, fileType: file.type });
                        uploaded = true;
                    }
                } catch (err: any) {
                    console.error('[Attachment] Storage exception:', err.message);
                }
            }

            // Fallback: convert to base64 data URL
            if (!uploaded) {
                try {
                    console.log('[Attachment] Falling back to base64 for:', file.name);
                    const base64 = await fileToBase64(file);
                    results.push({ name: file.name, url: base64, fileType: file.type });
                } catch (err: any) {
                    console.error('[Attachment] Base64 conversion failed:', err.message);
                }
            }
        }

        if (results.length > 0) {
            console.log(`[Attachment] ${results.length}/${files.length} files processed`);
        }
        return results;
    };

    const openEditTx = (tx: ProjectTransaction) => {
        setEditingTx(tx);
        setTxType(tx.type);
        setTxCategory(tx.category);
        setTxAmount(String(tx.amount));
        setTxDesc(tx.description);
        setTxDate(tx.date);
        setTxFiles([]);
        setExistingAttachments(tx.attachments || []);
        setShowTxForm(true);
    };

    const resetTxForm = () => {
        setEditingTx(null);
        setTxType('expense');
        setTxCategory('materials');
        setTxAmount('');
        setTxDesc('');
        setTxDate(new Date().toISOString().slice(0, 10));
        setTxFiles([]);
        setExistingAttachments([]);
        setShowTxForm(false);
    };

    const handleAddTx = async () => {
        if (!selectedSiteId || !txAmount || Number(txAmount) <= 0) return;
        setUploading(true);
        let financeId = selectedFinance?.id;
        if (!financeId) {
            const newFin = emptyFinance(selectedSiteId);
            addProjectFinance(newFin);
            financeId = newFin.id;
        }
        const newAttachments = await uploadFiles(txFiles);
        const allAttachments = [...existingAttachments, ...newAttachments];

        if (editingTx) {
            // UPDATE existing transaction
            const updated: ProjectTransaction = {
                ...editingTx,
                type: txType,
                category: txCategory,
                amount: Number(txAmount),
                description: txDesc,
                date: txDate,
                attachments: allAttachments,
            };
            updateProjectTransaction(updated);
        } else {
            // CREATE new transaction
            const tx: ProjectTransaction = {
                id: crypto.randomUUID(),
                projectFinanceId: financeId,
                constructionSiteId: selectedSiteId,
                type: txType,
                category: txCategory,
                amount: Number(txAmount),
                description: txDesc,
                date: txDate,
                source: 'manual',
                attachments: allAttachments,
                createdBy: user.id,
                createdAt: new Date().toISOString(),
            };
            addProjectTransaction(tx);
        }
        resetTxForm();
        setUploading(false);
    };

    const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!selectedSiteId) { alert('Vui lòng chọn dự án trước khi import'); return; }
        let financeId = selectedFinance?.id;
        if (!financeId) {
            const newFin = emptyFinance(selectedSiteId);
            addProjectFinance(newFin);
            financeId = newFin.id;
        }

        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const XLSX = await loadXlsx();
                const data = new Uint8Array(ev.target?.result as ArrayBuffer);
                const wb = XLSX.read(data, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];

                // ===== SMART HEADER DETECTION =====
                const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                console.log('[DA Import] Sheet:', wb.SheetNames[0], 'Total raw rows:', rawRows.length);

                const headerKeywords = ['thành tiền', 'thanh tien', 'đơn giá', 'don gia', 'số tiền', 'so tien', 'amount', 'số lượng', 'so luong', 'tên hàng', 'ten hang', 'stt', 'hạng mục', 'mô tả', 'nội dung'];
                let headerRowIdx = -1;
                let headerCols: string[] = [];
                for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
                    const row = rawRows[r];
                    if (!row || row.length < 2) continue;
                    const cellTexts = row.map((c: any) => String(c || '').toLowerCase().trim());
                    const matchCount = cellTexts.filter((t: string) => headerKeywords.some(kw => t.includes(kw))).length;
                    if (matchCount >= 2) {
                        headerRowIdx = r;
                        headerCols = row.map((c: any) => String(c || '').trim());
                        console.log(`[DA Import] Found header at row ${r}:`, headerCols);
                        break;
                    }
                }

                let rows: any[];
                if (headerRowIdx >= 0) {
                    rows = [];
                    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
                        const rawRow = rawRows[r];
                        if (!rawRow || rawRow.every((c: any) => !c && c !== 0)) continue;
                        const obj: any = {};
                        headerCols.forEach((col, i) => { if (col) obj[col] = rawRow[i] ?? ''; });
                        rows.push(obj);
                    }
                    console.log('[DA Import] Parsed rows with detected header:', rows.length);
                } else {
                    rows = XLSX.utils.sheet_to_json(ws);
                    console.log('[DA Import] Fallback: standard header, rows:', rows.length);
                }

                if (rows.length > 0) console.log('[DA Import] First data row keys:', Object.keys(rows[0]), 'values:', rows[0]);
                if (rows.length === 0) { alert('File rỗng hoặc không có dữ liệu'); return; }

                // Fuzzy column finder
                const findCol = (row: any, patterns: string[]) => {
                    const keys = Object.keys(row);
                    for (const p of patterns) {
                        const exact = keys.find(k => k.toLowerCase().trim() === p);
                        if (exact) return row[exact];
                    }
                    for (const p of patterns) {
                        const partial = keys.find(k => k.toLowerCase().trim().includes(p) || p.includes(k.toLowerCase().trim()));
                        if (partial) return row[partial];
                    }
                    return undefined;
                };

                const catMap: Record<string, ProjectCostCategory> = {
                    'vật tư': 'materials', 'vat tu': 'materials', 'materials': 'materials', 'vt': 'materials',
                    'nhân công': 'labor', 'nhan cong': 'labor', 'labor': 'labor', 'nc': 'labor',
                    'thầu phụ': 'subcontract', 'thau phu': 'subcontract', 'subcontract': 'subcontract', 'tp': 'subcontract',
                    'máy móc': 'machinery', 'may moc': 'machinery', 'machinery': 'machinery', 'mm': 'machinery', 'máy': 'machinery',
                    'quản lý chung': 'overhead', 'quan ly chung': 'overhead', 'overhead': 'overhead', 'qlc': 'overhead', 'quản lý': 'overhead',
                    'phát sinh': 'other', 'phat sinh': 'other', 'other': 'other', 'khác': 'other', 'khac': 'other', 'ps': 'other',
                };
                const typeMap: Record<string, ProjectTxType> = {
                    'chi phí': 'expense', 'chi phi': 'expense', 'expense': 'expense', 'chi': 'expense',
                    'thu': 'revenue_received', 'doanh thu': 'revenue_received', 'revenue': 'revenue_received',
                    'chờ thu': 'revenue_pending', 'cho thu': 'revenue_pending', 'pending': 'revenue_pending',
                };

                const parseDate = (val: any): string => {
                    if (!val) return new Date().toISOString().slice(0, 10);
                    if (typeof val === 'number') {
                        // XLSX date serial number
                        const d = new Date((val - 25569) * 86400 * 1000);
                        return d.toISOString().slice(0, 10);
                    }
                    const s = String(val).trim();
                    // Try DD/MM/YYYY
                    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
                    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
                    return s || new Date().toISOString().slice(0, 10);
                };

                const parseAmount = (val: any): number => {
                    if (typeof val === 'number') return val;
                    if (!val) return 0;
                    // Remove currency symbols, dots as thousand separators, spaces
                    const cleaned = String(val).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
                    return Number(cleaned) || 0;
                };

                // Detect "total" summary rows vs detail rows
                const totalKeywords = ['tổng số', 'tong so', 'tổng cộng', 'tong cong', 'tổng số tiền', 'tong so tien', 'total', 'tổng', 'tong', 'cộng', 'cong', 'sum', 'grand total', 'subtotal'];

                const isTotalRow = (row: any): boolean => {
                    // Check all string values in the row for total keywords
                    for (const val of Object.values(row)) {
                        if (typeof val === 'string') {
                            const lower = val.toLowerCase().trim();
                            if (totalKeywords.some(kw => lower === kw || lower.startsWith(kw + ' ') || lower.startsWith(kw + ':') || lower.startsWith(kw + '(') || lower.endsWith(' ' + kw) || lower.includes('tổng') || lower.includes('total'))) return true;
                        }
                    }
                    return false;
                };

                const allParsed = rows.map((row, i) => {
                    const rawAmount = findCol(row, ['thành tiền', 'thanh tien', 'số tiền', 'so tien', 'amount', 'tiền', 'tien', 'giá trị', 'gia tri', 'value', 'số tiền (vnđ)', 'money', 'đơn giá', 'don gia']);
                    const rawCat = String(findCol(row, ['hạng mục', 'hang muc', 'category', 'loại chi phí', 'loai chi phi', 'mục', 'muc']) || 'other').toLowerCase().trim();
                    const rawType = String(findCol(row, ['loại', 'loai', 'type', 'loại giao dịch']) || 'expense').toLowerCase().trim();
                    const rawDesc = findCol(row, ['mô tả', 'mo ta', 'description', 'diễn giải', 'dien giai', 'nội dung', 'noi dung', 'ghi chú', 'ghi chu', 'note', 'tên hàng hóa', 'ten hang hoa', 'tên hàng', 'ten hang', 'hàng hóa', 'hang hoa']);
                    const rawDate = findCol(row, ['ngày', 'ngay', 'date', 'ngày giao dịch', 'ngay giao dich']);
                    const amount = parseAmount(rawAmount);
                    const isTotal = isTotalRow(row);
                    console.log(`[DA Import] Row ${i}: amount=${amount}, cat=${rawCat}, type=${rawType}, desc=${rawDesc}, isTotal=${isTotal}`);

                    return {
                        tx: {
                            id: crypto.randomUUID(),
                            projectFinanceId: financeId!,
                            constructionSiteId: selectedSiteId,
                            type: typeMap[rawType] || 'expense',
                            category: catMap[rawCat] || 'other',
                            amount,
                            description: String(rawDesc || ''),
                            date: parseDate(rawDate),
                            source: 'import' as ProjectTxSource,
                            createdBy: user.id,
                            createdAt: new Date().toISOString(),
                        } as ProjectTransaction,
                        isTotal,
                    };
                }).filter(p => p.tx.amount > 0);

                // If there are total rows → use only those (avoid double-counting with details)
                const totalRows = allParsed.filter(p => p.isTotal);
                const detailRows = allParsed.filter(p => !p.isTotal);
                let txs: ProjectTransaction[];
                let importMode: string;

                if (totalRows.length > 0) {
                    // Merge all total rows into ONE transaction
                    const mergedAmount = totalRows.reduce((sum, p) => sum + p.tx.amount, 0);
                    const mergedDesc = totalRows.map(p => p.tx.description).filter(Boolean).join('; ') || 'Tổng import từ Excel';
                    const mergedTx: ProjectTransaction = {
                        ...totalRows[0].tx,
                        amount: mergedAmount,
                        description: mergedDesc,
                    };
                    txs = [mergedTx];
                    importMode = totalRows.length === 1
                        ? `Tìm thấy 1 dòng tổng → import dòng tổng (bỏ ${detailRows.length} dòng chi tiết)`
                        : `Tìm thấy ${totalRows.length} dòng tổng → cộng lại = ${mergedAmount.toLocaleString('vi-VN')}đ (bỏ ${detailRows.length} dòng chi tiết)`;
                } else {
                    txs = detailRows.map(p => p.tx);
                    importMode = `Không có dòng tổng → import ${txs.length} dòng chi tiết`;
                }
                console.log(`[DA Import] Mode: ${importMode}`);

                if (txs.length > 0) {
                    addProjectTransactions(txs);
                    alert(`✅ Import thành công ${txs.length} giao dịch từ file "${file.name}"\n\n${importMode}`);
                } else {
                    const sampleKeys = rows.length > 0 ? Object.keys(rows[0]).join(', ') : 'N/A';
                    alert(`❌ Không tìm thấy giao dịch hợp lệ (số tiền > 0).\n\nCột trong file: ${sampleKeys}\n\nCần ít nhất cột: Số tiền (hoặc Amount)\nTùy chọn: Hạng mục, Mô tả, Ngày, Loại`);
                }
            } catch (err: any) {
                console.error('[DA Import] Error:', err);
                alert(`Lỗi đọc file: ${err.message}`);
            }
        };
        reader.readAsArrayBuffer(file);
        e.target.value = '';
    };

    const handleDeleteTx = (id: string) => {
        if (confirm('Xoá giao dịch này?')) removeProjectTransaction(id);
    };

    // ========== BUDGET FORM MODAL ==========
    const renderBudgetForm = () => {
        if (!showBudgetForm || !budgetData) return null;
        const site = hrmConstructionSites.find(s => s.id === budgetData.constructionSiteId);
        const derivedProgress = taskProgressBySite[budgetData.constructionSiteId]?.progressPercent;
        const progressValue = derivedProgress ?? budgetData.progressPercent;
        const budgetCats = [
            { key: 'Materials', label: 'Vật tư', icon: '🧱' },
            { key: 'Labor', label: 'Nhân công', icon: '👷' },
            { key: 'Subcontract', label: 'Thầu phụ', icon: '🏗️' },
            { key: 'Machinery', label: 'Máy móc', icon: '⚙️' },
            { key: 'Overhead', label: 'Quản lý chung', icon: '📋' },
        ];

        return (
            <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
                    <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-orange-500 to-amber-500 rounded-t-3xl flex items-center justify-between">
                        <div className="text-white">
                            <span className="font-bold text-lg block">Kế hoạch & Ngân sách</span>
                            <span className="text-white/80 text-sm">{site?.name}</span>
                        </div>
                        <button onClick={() => setShowBudgetForm(false)} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                    </div>
                    <div className="p-6 space-y-5">
                        {/* Contract + Status */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Giá trị HĐ (VNĐ)</label>
                                <input type="number" value={budgetData.contractValue || ''} onChange={e => setBudgetData({ ...budgetData, contractValue: Number(e.target.value) })}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày ký HĐ</label>
                                <input type="date" value={budgetData.contractSignDate || ''} onChange={e => setBudgetData({ ...budgetData, contractSignDate: e.target.value })}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Dự kiến hoàn thành</label>
                                <input type="date" value={budgetData.estimatedEndDate || ''} onChange={e => setBudgetData({ ...budgetData, estimatedEndDate: e.target.value })}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Trạng thái</label>
                                <select value={budgetData.status} onChange={e => setBudgetData({ ...budgetData, status: e.target.value as any })}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none">
                                    {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                </select>
                            </div>
                        </div>
                        {/* Budget */}
                        <div>
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Ngân sách dự toán (DT)</h3>
                            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-2">
                                {budgetCats.map(c => (
                                    <div key={c.key} className="flex items-center gap-3">
                                        <span className="text-lg w-8">{c.icon}</span>
                                        <span className="text-sm font-bold text-slate-700 w-32">{c.label}</span>
                                        <input type="number" value={(budgetData as any)[`budget${c.key}`] || ''}
                                            onChange={e => setBudgetData({ ...budgetData, [`budget${c.key}`]: Number(e.target.value) })}
                                            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm text-right font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="0" />
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* Progress */}
                        <div className="flex items-center gap-4">
                            <label className="text-xs font-bold text-slate-500">Tiến độ:</label>
                            <input type="range" min={0} max={100} value={progressValue}
                                disabled={derivedProgress !== undefined}
                                onChange={e => setBudgetData({ ...budgetData, progressPercent: Number(e.target.value) })}
                                className="flex-1 accent-orange-500 disabled:opacity-60" />
                            <span className="text-lg font-black text-orange-600 w-14 text-right">{progressValue}%</span>
                        </div>
                        {/* Notes */}
                        <textarea value={budgetData.notes || ''} onChange={e => setBudgetData({ ...budgetData, notes: e.target.value })}
                            placeholder="Ghi chú..." rows={2} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none resize-none" />
                    </div>
                    <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                        <button onClick={() => setShowBudgetForm(false)} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                        <button onClick={saveBudget} className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg hover:shadow-xl flex items-center gap-2">
                            <Save size={16} /> Lưu
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ========== ADD TX FORM MODAL ==========
    const renderTxForm = () => {
        if (!showTxForm) return null;
        return (
            <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
                    <div className={`px-6 py-4 border-b border-slate-100 rounded-t-3xl flex items-center justify-between ${editingTx ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-blue-500 to-cyan-500'}`}>
                        <span className="font-bold text-lg text-white flex items-center gap-2">{editingTx ? <><Edit2 size={20} /> Chỉnh sửa giao dịch</> : <><Plus size={20} /> Thêm giao dịch</>}</span>
                        <button onClick={resetTxForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                    </div>
                    <div className="p-6 space-y-4 overflow-y-auto flex-1">
                        {/* Type */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Loại giao dịch</label>
                            <div className="flex gap-2">
                                {Object.entries(TX_TYPE_CONFIG).map(([k, v]) => (
                                    <button key={k} onClick={() => setTxType(k as ProjectTxType)}
                                        className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${txType === k ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                        {v.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {/* Category (only for expense) */}
                        {txType === 'expense' && (
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Hạng mục chi phí</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
                                        <button key={k} onClick={() => setTxCategory(k as ProjectCostCategory)}
                                            className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1 ${txCategory === k ? 'bg-orange-50 border-orange-300 text-orange-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                            <span>{v.icon}</span> {v.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {/* Amount + Date */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Số tiền (VNĐ)</label>
                                <input type="number" value={txAmount} onChange={e => setTxAmount(e.target.value)} placeholder="0"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày</label>
                                <input type="date" value={txDate} onChange={e => setTxDate(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                        </div>
                        {/* Description */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Mô tả</label>
                            <input value={txDesc} onChange={e => setTxDesc(e.target.value)} placeholder="VD: Thanh toán nhân công đợt 1..."
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                        {/* Attachments */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tệp đính kèm</label>
                            <label
                                htmlFor="tx-file-input-field"
                                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400', 'bg-blue-50'); }}
                                onDragLeave={e => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50'); }}
                                onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50'); const newFiles = Array.from(e.dataTransfer.files); setTxFiles(prev => [...prev, ...newFiles]); }}
                                className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all block"
                            >
                                <Paperclip size={20} className="mx-auto mb-1 text-slate-300" />
                                <p className="text-xs text-slate-400">Nhấn hoặc kéo thả file vào đây</p>
                                <p className="text-[10px] text-slate-300 mt-0.5">Hình ảnh CK, biên bản nghiệm thu, hoá đơn...</p>
                            </label>
                            <input id="tx-file-input-field" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const files = e.target.files; console.log('[Attachment] onChange fired, files:', files?.length); if (files && files.length > 0) { const arr: File[] = Array.from(files); console.log('[Attachment] Adding files:', arr.map((f: File) => f.name)); setTxFiles(prev => [...prev, ...arr]); } e.target.value = ''; }} />
                            {txFiles.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {txFiles.map((f, i) => (
                                        <div key={i} className="relative group">
                                            {f.type.startsWith('image/') ? (
                                                <img src={URL.createObjectURL(f)} className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                                            ) : (
                                                <div className="w-16 h-16 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center">
                                                    <FileText size={18} className="text-slate-400" />
                                                    <span className="text-[8px] text-slate-400 mt-0.5 truncate w-14 text-center">{f.name.split('.').pop()?.toUpperCase()}</span>
                                                </div>
                                            )}
                                            <button onClick={e => { e.stopPropagation(); setTxFiles(prev => prev.filter((_, idx) => idx !== i)); }}
                                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] shadow opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Existing attachments (edit mode) */}
                    {editingTx && existingAttachments.length > 0 && (
                        <div className="px-6 pb-2">
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tệp đã đính kèm</label>
                            <div className="flex flex-wrap gap-2">
                                {existingAttachments.map((att, i) => (
                                    <div key={i} className="relative group">
                                        {(att.fileType || '').startsWith('image/') ? (
                                            <img src={att.url} className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                                        ) : (
                                            <div className="w-16 h-16 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center">
                                                <FileText size={18} className="text-slate-400" />
                                                <span className="text-[8px] text-slate-400 mt-0.5 truncate w-14 text-center">{att.name.split('.').pop()?.toUpperCase()}</span>
                                            </div>
                                        )}
                                        <button onClick={() => setExistingAttachments(prev => prev.filter((_, idx) => idx !== i))}
                                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] shadow opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                        <button onClick={resetTxForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                        <button onClick={handleAddTx} disabled={!txAmount || Number(txAmount) <= 0 || uploading}
                            className={`px-6 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50 ${editingTx ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-blue-500 to-cyan-500'}`}>
                            {uploading ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Đang tải...</> : editingTx ? <><Save size={16} /> Lưu thay đổi</> : <><Check size={16} /> Thêm giao dịch</>}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ========== OVERVIEW (project detail) ==========
    const renderOverview = () => {
        if (!selectedSite || !selectedFinance || !selectedAgg) return null;
        const totalBudget = selectedFinance.budgetMaterials + selectedFinance.budgetLabor + selectedFinance.budgetSubcontract + selectedFinance.budgetMachinery + selectedFinance.budgetOverhead;
        const estimatedMargin = selectedFinance.contractValue - selectedAgg.totalExpense;
        const estimatedMarginPct = selectedFinance.contractValue > 0 ? (estimatedMargin / selectedFinance.contractValue * 100) : 0;
        const budgetUsed = totalBudget > 0 ? (selectedAgg.totalExpense / totalBudget * 100) : 0;

        // Chart max value
        const maxVal = Math.max(...BUDGET_CATS.map(c =>
            Math.max((selectedFinance as any)[`budget${c.key}`] || 0, (selectedAgg as any)[c.aggKey] || 0)
        ), 1);

        return (
            <div className="space-y-6">
                {/* Back + Actions */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <button onClick={() => { setActiveView('list'); setSelectedSiteId(null); }}
                        className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors">← Danh sách dự án</button>
                    <div className="flex gap-2 flex-wrap">
                        <button onClick={() => { resetTxForm(); setShowTxForm(true); }}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-all">
                            <Plus size={14} /> Thêm giao dịch
                        </button>
                        <button onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-all">
                            <Upload size={14} /> Import Excel
                        </button>
                        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportExcel} />
                        <button onClick={() => openBudgetForm(selectedSiteId!)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-orange-600 bg-orange-50 border border-orange-200 hover:bg-orange-100 transition-all">
                            <Edit2 size={14} /> Ngân sách
                        </button>
                    </div>
                </div>

                {/* Header Banner */}
                <div className="bg-gradient-to-r from-orange-500 to-amber-500 rounded-3xl p-6 text-white shadow-xl">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center"><HardHat size={24} /></div>
                            <div>
                                <h2 className="text-2xl font-black">{selectedSite.name}</h2>
                                <p className="text-white/70 text-sm">{selectedSite.address || selectedSite.description || '—'}</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="inline-block px-3 py-1 rounded-full text-sm font-bold bg-white/20 mb-1">{STATUS_CONFIG[selectedFinance.status]?.label}</div>
                            <div className="text-3xl font-black">{getDisplayProgress(selectedFinance)}%</div>
                        </div>
                    </div>
                    <div className="mt-4 h-3 bg-white/20 rounded-full overflow-hidden">
                        <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${getDisplayProgress(selectedFinance)}%` }} />
                    </div>
                </div>

                {/* Overview Sub-tabs */}
                <div className="flex gap-1 bg-white rounded-2xl p-1.5 border border-slate-100 shadow-sm overflow-x-auto">
                    {[
                        { key: 'org' as const, label: 'Tổ chức', icon: '👥' },
                        { key: 'budget' as const, label: 'Ngân sách', icon: '📊' },
                        { key: 'cashflow' as const, label: 'Dòng tiền', icon: '💰' },
                        { key: 'contract' as const, label: 'Hợp đồng', icon: '📋' },
                        { key: 'gantt' as const, label: 'Tiến độ', icon: '📐' },
                        { key: 'dailylog' as const, label: 'Nhật ký', icon: '📝' },
                        { key: 'subcontract' as const, label: 'Nhà thầu', icon: '🏗️' },
                        { key: 'material' as const, label: 'Vật tư', icon: '📦' },
                        { key: 'supply' as const, label: 'Cung ứng', icon: '🚛' },
                        { key: 'documents' as const, label: 'Tài liệu', icon: '📎' },
                        { key: 'report' as const, label: 'Báo cáo', icon: '📊' },
                    ].map(tab => (
                        <button key={tab.key} onClick={() => setOverviewTab(tab.key)}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                                overviewTab === tab.key ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/25' : 'text-slate-500 hover:bg-slate-50'
                            }`}>
                            <span>{tab.icon}</span> {tab.label}
                        </button>
                    ))}
                </div>

                {overviewTab === 'org' ? (
                    <ProjectOrgTab constructionSiteId={selectedSiteId!} />
                ) : overviewTab === 'cashflow' ? (
                    <CashFlowTab
                        constructionSiteId={selectedSiteId!}
                        transactions={projectTransactions.filter(t => t.constructionSiteId === selectedSiteId)}
                        contractValue={selectedFinance.contractValue}
                    />
                ) : overviewTab === 'contract' ? (
                    <ContractTab constructionSiteId={selectedSiteId!} />
                ) : overviewTab === 'gantt' ? (
                    <GanttTab constructionSiteId={selectedSiteId!} />
                ) : overviewTab === 'dailylog' ? (
                    <DailyLogTab constructionSiteId={selectedSiteId!} />
                ) : overviewTab === 'subcontract' ? (
                    <SubcontractTab constructionSiteId={selectedSiteId!} />
                ) : overviewTab === 'material' ? (
                    <MaterialTab constructionSiteId={selectedSiteId!} />
                ) : overviewTab === 'supply' ? (
                    <SupplyChainTab constructionSiteId={selectedSiteId!} />
                ) : overviewTab === 'report' ? (
                    <ReportTab
                        constructionSiteId={selectedSiteId!}
                        contractValue={selectedFinance?.contractValue || 0}
                        totalSpent={selectedAgg?.totalExpense || 0}
                    />
                ) : overviewTab === 'documents' ? (
                    <DocumentsTab constructionSiteId={selectedSiteId!} uploadedBy={user?.name} />
                ) : (
                <>
                {/* KPI Cards — AUTO-AGGREGATED */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div onClick={() => setOverviewTab('contract')} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer group">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 group-hover:text-indigo-500 transition-colors"><FileText size={12} /> Giá trị HĐ</div>
                        <div className="text-xl font-black text-slate-800">{fmt(selectedFinance.contractValue)}</div>
                        <div className="text-[10px] text-slate-400 mt-1">{fmtFull(selectedFinance.contractValue)}</div>
                    </div>
                    <div onClick={() => setOverviewTab('budget')} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer group">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 group-hover:text-orange-500 transition-colors"><DollarSign size={12} /> Chi phí thực tế</div>
                        <div className="text-xl font-black text-slate-800">{fmt(selectedAgg.totalExpense)}</div>
                        <div className={`text-[10px] mt-1 font-bold flex items-center gap-1 ${budgetUsed > 100 ? 'text-red-500' : 'text-emerald-500'}`}>
                            {budgetUsed > 100 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />} {budgetUsed.toFixed(1)}% ngân sách
                        </div>
                    </div>
                    <div onClick={() => setOverviewTab('cashflow')} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer group">
	                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 group-hover:text-emerald-500 transition-colors"><TrendingUp size={12} /> Biên tạm tính</div>
	                        <div className={`text-xl font-black ${estimatedMargin >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(estimatedMargin)}</div>
	                        <div className={`text-[10px] mt-1 font-bold ${estimatedMarginPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
	                            {estimatedMarginPct >= 0 ? '+' : ''}{estimatedMarginPct.toFixed(1)}%
                        </div>
                    </div>
                    <div onClick={() => setOverviewTab('cashflow')} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer group">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 group-hover:text-cyan-500 transition-colors"><Target size={12} /> Thu / Chờ thu</div>
                        <div className="text-xl font-black text-emerald-600">{fmt(selectedAgg.revenueReceived)}</div>
                        <div className="text-[10px] text-amber-500 font-bold mt-1">Chờ: {fmt(selectedAgg.revenuePending)}</div>
                    </div>
                </div>

                {/* Budget Chart + Cash Flow */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Budget vs Actual */}
                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                        <h3 className="text-sm font-black text-slate-700 mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-orange-500" /> Dự toán vs Thực tế (tự động)</h3>
                        <div className="space-y-4">
                            {BUDGET_CATS.map(cat => {
                                const budget = (selectedFinance as any)[`budget${cat.key}`] || 0;
                                const actual = (selectedAgg as any)[cat.aggKey] || 0;
                                const diff = actual - budget;
                                return (
                                    <div key={cat.key}
                                        onClick={() => { setTxFilter(txFilter === cat.filterKey ? 'all' : cat.filterKey); document.getElementById('tx-list-section')?.scrollIntoView({ behavior: 'smooth' }); }}
                                        className={`cursor-pointer rounded-xl p-2 -mx-2 transition-all hover:bg-slate-50 ${txFilter === cat.filterKey ? 'ring-2 ring-offset-1 bg-slate-50 scale-[1.02]' : ''}`}
                                        style={txFilter === cat.filterKey ? { '--tw-ring-color': cat.color } as any : {}}
                                    >
                                        <div className="flex items-center justify-between mb-1.5">
                                            <div className="flex items-center gap-2"><span className="text-lg">{cat.icon}</span><span className="text-sm font-bold text-slate-700">{cat.label}</span>{txFilter === cat.filterKey && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold text-white" style={{ backgroundColor: cat.color }}>Đang lọc</span>}</div>
                                            <div className="flex items-center gap-3 text-xs">
                                                <span className="text-slate-400">DT: <span className="font-bold text-slate-600">{fmt(budget)}</span></span>
                                                <span className="text-slate-400">TT: <span className={`font-bold ${diff > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{fmt(actual)}</span></span>
                                                {diff !== 0 && <span className={`font-bold px-1.5 py-0.5 rounded ${diff > 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>{diff > 0 ? '+' : ''}{fmt(diff)}</span>}
                                            </div>
                                        </div>
                                        <div className="relative h-5 bg-slate-100 rounded-full overflow-hidden">
                                            <div className="absolute inset-y-0 left-0 rounded-full opacity-30 transition-all duration-700" style={{ width: `${maxVal > 0 ? (budget / maxVal) * 100 : 0}%`, backgroundColor: cat.color }} />
                                            <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700" style={{ width: `${maxVal > 0 ? (actual / maxVal) * 100 : 0}%`, backgroundColor: cat.color }} />
                                        </div>
                                    </div>
                                );
                            })}
                            <div className="flex items-center gap-6 pt-2 border-t border-slate-100 text-xs text-slate-400">
                                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-slate-300 opacity-40" /> Dự toán</div>
                                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-slate-500" /> Thực tế (từ giao dịch)</div>
                            </div>
                        </div>
                    </div>

                    {/* Cash Flow */}
                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                        <h3 className="text-sm font-black text-slate-700 mb-4 flex items-center gap-2"><DollarSign size={16} className="text-emerald-500" /> Dòng tiền</h3>
                        <div className="space-y-2.5">
                            <div className="flex justify-between items-center p-3 bg-blue-50 rounded-xl border border-blue-100">
                                <span className="text-sm font-bold text-blue-700">Giá trị HĐ (A)</span>
                                <span className="text-sm font-black text-blue-700">{fmtFull(selectedFinance.contractValue)}</span>
                            </div>
                            <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                                <span className="text-sm font-bold text-emerald-700">Đã thanh toán</span>
                                <span className="text-sm font-black text-emerald-700">+ {fmtFull(selectedAgg.revenueReceived)}</span>
                            </div>
                            <div className="flex justify-between items-center p-3 bg-amber-50 rounded-xl border border-amber-100">
                                <span className="text-sm font-bold text-amber-700">Chờ nghiệm thu</span>
                                <span className="text-sm font-black text-amber-700">{fmtFull(selectedAgg.revenuePending)}</span>
                            </div>
                            <div className="border-t-2 border-dashed border-slate-200 my-1" />
                            <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-200">
                                <span className="text-sm font-bold text-slate-700">Tổng ngân sách (DT)</span>
                                <span className="text-sm font-black text-slate-700">{fmtFull(totalBudget)}</span>
                            </div>
                            <div className="flex justify-between items-center p-3 bg-orange-50 rounded-xl border border-orange-200">
                                <span className="text-sm font-bold text-orange-700">Tổng chi thực tế ({selectedAgg.txCount} GD)</span>
                                <span className="text-sm font-black text-orange-700">- {fmtFull(selectedAgg.totalExpense)}</span>
                            </div>
	                            <div className={`flex justify-between items-center p-4 rounded-xl border-2 ${estimatedMargin >= 0 ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300'}`}>
	                                <span className={`text-sm font-black uppercase ${estimatedMargin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{estimatedMargin >= 0 ? 'Biên doanh thu - chi' : 'Âm theo chi hiện tại'}</span>
	                                <span className={`text-lg font-black ${estimatedMargin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{estimatedMargin >= 0 ? '+' : ''}{fmtFull(estimatedMargin)}</span>
	                            </div>
                        </div>
                    </div>
                </div>

                {/* Transaction List */}
                <div id="tx-list-section" className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between flex-wrap gap-2">
                        <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-2">
                            <List size={16} /> Danh sách giao dịch ({siteTxs.length})
                        </h3>
                        <div className="flex items-center gap-2">
                            <select value={txFilter} onChange={e => setTxFilter(e.target.value as any)}
                                className="text-xs font-bold text-slate-600 px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-orange-500 outline-none">
                                <option value="all">Tất cả</option>
                                {Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                            </select>
                        </div>
                    </div>

                    {siteTxs.length === 0 ? (
                        <div className="p-12 text-center">
                            <DollarSign size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có giao dịch nào</p>
                            <p className="text-xs text-slate-300 mt-1">Nhấn "Thêm giao dịch" hoặc "Import Excel" để bắt đầu</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {siteTxs.map(tx => {
                                const catCfg = CATEGORY_CONFIG[tx.category];
                                const typeCfg = TX_TYPE_CONFIG[tx.type];
                                const srcCfg = SOURCE_CONFIG[tx.source];
                                const hasAttachments = tx.attachments && tx.attachments.length > 0;
                                return (
                                    <div key={tx.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/50 transition-colors group">
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <span className="text-lg">{catCfg?.icon || '📄'}</span>
                                            <div className="min-w-0">
                                                <div className="text-sm font-bold text-slate-800 truncate flex items-center gap-1.5">
                                                    {tx.description || '—'}
                                                    {hasAttachments && (
                                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-50 text-violet-500 text-[10px] font-bold shrink-0">
                                                            <Paperclip size={9} /> {tx.attachments!.length}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 text-[10px] flex-wrap">
                                                    <span className={`font-bold px-1.5 py-0.5 rounded ${typeCfg?.color}`}>{typeCfg?.label}</span>
                                                    <span className="text-slate-400">{catCfg?.label}</span>
                                                    <span className="text-slate-300">•</span>
                                                    <span className="text-slate-400">{tx.date}</span>
                                                    <span className="text-slate-300">•</span>
                                                    <span className="text-slate-400">{srcCfg?.icon} {srcCfg?.label}</span>
                                                </div>
                                                {hasAttachments && (
                                                    <div className="flex gap-1.5 mt-1.5">
                                                        {tx.attachments!.map((att, ai) => (
                                                            <button key={ai} onClick={() => setPreviewUrl(att.url)} className="group/att relative">
                                                                {(att.fileType || '').startsWith('image/') ? (
                                                                    <img src={att.url} className="w-10 h-10 object-cover rounded-lg border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all" />
                                                                ) : (
                                                                    <div className="w-10 h-10 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center hover:border-blue-400 transition-all">
                                                                        <FileText size={12} className="text-slate-400" />
                                                                        <span className="text-[7px] text-slate-400">{att.name.split('.').pop()?.toUpperCase()}</span>
                                                                    </div>
                                                                )}
                                                                <div className="absolute inset-0 rounded-lg bg-black/0 group-hover/att:bg-black/20 flex items-center justify-center transition-all">
                                                                    <Eye size={12} className="text-white opacity-0 group-hover/att:opacity-100 transition-opacity" />
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-sm font-black ${tx.type === 'expense' ? 'text-red-500' : 'text-emerald-600'}`}>
                                                {tx.type === 'expense' ? '-' : '+'}{fmtFull(tx.amount)}
                                            </span>
                                            <button onClick={() => openEditTx(tx)}
                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-all opacity-0 group-hover:opacity-100">
                                                <Edit2 size={13} />
                                            </button>
                                            <button onClick={() => handleDeleteTx(tx.id)}
                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                </>
                )}
            </div>
        );
    };

    // ========== PROJECT LIST VIEW ==========
    const renderList = () => (
        <div className="space-y-6">
            {/* Aggregate KPIs */}
            {projectFinances.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div onClick={() => setActiveView('overview')} className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-5 text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all cursor-pointer">
                        <div className="text-xs font-bold uppercase tracking-wider opacity-70 mb-1">Tổng giá trị HĐ</div>
                        <div className="text-2xl font-black">{fmt(allStats.totalContract)}</div>
                        <div className="text-xs opacity-60 mt-1">{projectFinances.length} dự án</div>
                    </div>
                    <div onClick={() => setActiveView('overview')} className="bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl p-5 text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all cursor-pointer">
                        <div className="text-xs font-bold uppercase tracking-wider opacity-70 mb-1">Tổng chi thực tế</div>
                        <div className="text-2xl font-black">{fmt(allStats.totalActual)}</div>
                        <div className="text-xs opacity-60 mt-1">NS: {fmt(allStats.totalBudget)}</div>
                    </div>
                    <div onClick={() => setActiveView('overview')} className={`bg-gradient-to-br ${allStats.profit >= 0 ? 'from-emerald-500 to-green-600' : 'from-red-500 to-rose-600'} rounded-2xl p-5 text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all cursor-pointer`}>
                        <div className="text-xs font-bold uppercase tracking-wider opacity-70 mb-1">{allStats.profit >= 0 ? 'Biên tạm tính' : 'Âm theo chi hiện tại'}</div>
                        <div className="text-2xl font-black">{fmt(allStats.profit)}</div>
                    </div>
                    <div onClick={() => setActiveView('overview')} className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl p-5 text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all cursor-pointer">
                        <div className="text-xs font-bold uppercase tracking-wider opacity-70 mb-1">Tiến độ TB</div>
                        <div className="text-2xl font-black">{allStats.avgProgress.toFixed(0)}%</div>
                        <div className="text-xs opacity-60 mt-1">Thu: {fmt(allStats.totalRevenue)}</div>
                    </div>
                </div>
            )}

            {/* Project cards */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider">Danh sách dự án</h3>
                    <span className="text-xs font-bold text-slate-400">{hrmConstructionSites.length} công trường</span>
                </div>
                {hrmConstructionSites.length === 0 ? (
                    <div className="p-12 text-center">
                        <Building2 size={40} className="mx-auto mb-3 text-slate-300" />
                        <p className="text-sm font-bold text-slate-500">Chưa có công trường nào</p>
                        <p className="text-xs text-slate-400 mt-1">Thêm tại Cài đặt → Dữ liệu gốc HRM → Công trường</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {hrmConstructionSites.map(site => {
                            const finance = projectFinances.find(pf => pf.constructionSiteId === site.id);
                            const agg = getAggregated(site.id);
                            const profit = finance ? finance.contractValue - agg.totalExpense : 0;
                            const displayProgress = getDisplayProgress(finance);

                            return (
                                <div key={site.id} className="flex items-center justify-between p-4 hover:bg-slate-50/50 transition-colors group">
                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                        <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center shrink-0"><HardHat size={18} /></div>
                                        <div className="min-w-0">
                                            <div className="text-sm font-bold text-slate-800 truncate">{site.name}</div>
                                            <div className="text-xs text-slate-400 truncate">{site.address || site.description || '—'}</div>
                                        </div>
                                    </div>
                                    {finance ? (
                                        <div className="flex items-center gap-4">
                                            <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_CONFIG[finance.status]?.bg} ${STATUS_CONFIG[finance.status]?.color}`}>
                                                {STATUS_CONFIG[finance.status]?.label}
                                            </div>
                                            <div className="text-right hidden md:block">
                                                <div className="text-xs font-bold text-slate-600">{fmt(finance.contractValue)}</div>
                                                <div className={`text-[10px] font-bold ${profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                    {profit >= 0 ? '+' : ''}{fmt(profit)} ({agg.txCount} GD)
                                                </div>
                                            </div>
                                            <div className="w-20 hidden lg:block">
                                                <div className="text-[10px] font-bold text-slate-500 mb-0.5">{displayProgress}%</div>
                                                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                    <div className="h-full bg-orange-500 rounded-full" style={{ width: `${displayProgress}%` }} />
                                                </div>
                                            </div>
                                            <button onClick={() => { setSelectedSiteId(site.id); setActiveView('overview'); }}
                                                className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-200 hover:bg-orange-100 opacity-0 group-hover:opacity-100 transition-all">
                                                Xem chi tiết
                                            </button>
                                        </div>
                                    ) : (
                                        <button onClick={() => openBudgetForm(site.id)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 opacity-0 group-hover:opacity-100 transition-all">
                                            <Plus size={12} /> Thiết lập dự án
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );

    // ========== MAIN ==========
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/30">
                    <BarChart3 size={24} className="text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white">Tổng quan Dự án</h1>
                    <p className="text-sm text-slate-500">Chi phí tự động cập nhật từ giao dịch • Import • Workflow</p>
                </div>
            </div>

            {activeView === 'list' && renderList()}
            {activeView === 'overview' && renderOverview()}
            {renderBudgetForm()}
            {renderTxForm()}

            {/* Lightbox Preview */}
            {previewUrl && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="relative max-w-4xl max-h-[90vh] mx-4">
                        <button onClick={() => setPreviewUrl(null)} className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center text-slate-600 hover:text-red-500"><X size={16} /></button>
                        {previewUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)/i) ? (
                            <img src={previewUrl} className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain" />
                        ) : (
                            <div className="bg-white rounded-2xl p-8 text-center shadow-2xl">
                                <FileText size={48} className="mx-auto mb-3 text-slate-400" />
                                <p className="text-sm font-bold text-slate-700 mb-3">{previewUrl.split('/').pop()}</p>
                                <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-blue-500 hover:bg-blue-600">
                                    <Download size={14} /> Tải xuống
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProjectDashboard;
