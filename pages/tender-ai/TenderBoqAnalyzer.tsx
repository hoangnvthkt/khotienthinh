import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CheckSquare,
  Download,
  Eye,
  FileSpreadsheet,
  Layers,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import {
  costTemplateService,
  internalNormService,
  internalPriceBookService,
} from '../../lib/costEstimateService';
import {
  externalBoqMappingService,
  externalBoqParserService,
  tenderDocumentService,
  tenderExportService,
  tenderPackageService,
  tenderPermissionService,
  tenderPricingService,
  tenderRiskRfiService,
  TenderBoqColumnKey,
  TenderColumnMapping,
  TenderExternalBoqLine,
  TenderAllocationType,
  TenderInternalMapping,
  TenderInternalMappingLink,
  TenderMappingLinkDraft,
  TenderMappingDraft,
  TenderPackage,
  TenderPackageDetails,
  TenderWorkbookPreview,
} from '../../lib/tenderAiService';
import {
  CostTemplateItem,
  InternalNorm,
  InternalPriceBookItem,
} from '../../types';

const money = (value: unknown) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));
const num = (value: unknown) => Number(value || 0);

const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-fuchsia-600 px-3 py-2 text-xs font-black text-white hover:bg-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SOFT = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800';
const BTN_DANGER = 'inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300';
const CELL = 'px-3 py-2 align-middle text-xs text-slate-600 dark:text-slate-300';
const PAGE_SIZE = 50;

type TemplateItemOption = {
  template: any;
  item: CostTemplateItem;
  label: string;
};

const columnLabels: Record<TenderBoqColumnKey, string> = {
  lineNo: 'STT',
  itemCode: 'Mã',
  name: 'Nội dung',
  description: 'Mô tả',
  unit: 'Đơn vị',
  quantity: 'Khối lượng',
  ownerUnitPrice: 'Đơn giá CĐT',
  ownerAmount: 'Thành tiền CĐT',
  note: 'Ghi chú',
};

const statusLabel: Record<string, string> = {
  uploaded: 'Đã upload',
  parsed: 'Đã parse',
  mapping_review: 'Review mapping',
  priced: 'Đã tính giá',
  risk_review: 'Review rủi ro',
  approved_for_bid: 'Đã duyệt chào',
  exported: 'Đã export',
  submitted: 'Đã gửi thầu',
  won: 'Trúng thầu',
  lost: 'Trượt thầu',
  cancelled: 'Huỷ',
};

const mappingLabel: Record<string, string> = {
  matched: 'Đã map',
  needs_review: 'Cần review',
  unmatched: 'Chưa map',
  ignored: 'Bỏ qua',
};

const riskColor: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const lineTitle = (line?: TenderExternalBoqLine | null) =>
  [line?.itemCode, line?.name || line?.description].filter(Boolean).join(' - ') || 'Dòng BOQ';

const TenderBoqAnalyzer: React.FC = () => {
  const { user } = useApp();
  const toast = useToast();
  const canUse = tenderPermissionService.canUseTenderAi(user);
  const canManagePricing = tenderPermissionService.canManageTenderPricing(user);

  const [packages, setPackages] = useState<TenderPackage[]>([]);
  const [details, setDetails] = useState<TenderPackageDetails | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [prices, setPrices] = useState<InternalPriceBookItem[]>([]);
  const [norms, setNorms] = useState<InternalNorm[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [previewPage, setPreviewPage] = useState(1);
  const [boqPage, setBoqPage] = useState(1);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TenderWorkbookPreview | null>(null);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [headerRow, setHeaderRow] = useState(0);
  const [columnMapping, setColumnMapping] = useState<TenderColumnMapping>({});
  const [packageName, setPackageName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [projectType, setProjectType] = useState('nha_xuong_cong_nghiep');
  const [sourceTemplateId, setSourceTemplateId] = useState('');
  const [aiMode, setAiMode] = useState<'remote' | 'local' | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [mappingDrawerOpen, setMappingDrawerOpen] = useState(false);
  const [mappingTargetLineIds, setMappingTargetLineIds] = useState<string[]>([]);
  const [mappingSearch, setMappingSearch] = useState('');
  const [mappingDraftLinks, setMappingDraftLinks] = useState<TenderMappingLinkDraft[]>([]);

  const load = useCallback(async (selectedId?: string) => {
    setLoading(true);
    try {
      const [packageRows, templateRows, priceRows, normRows] = await Promise.all([
        tenderPackageService.list().catch(() => []),
        costTemplateService.list(true).catch(() => []),
        canManagePricing ? internalPriceBookService.list(true).catch(() => []) : Promise.resolve([]),
        canManagePricing ? internalNormService.list(true).catch(() => []) : Promise.resolve([]),
      ]);
      setPackages(packageRows);
      setTemplates(templateRows);
      setPrices(priceRows);
      setNorms(normRows);
      const id = selectedId || details?.id || packageRows[0]?.id || '';
      if (id) setDetails(await tenderPackageService.get(id, canManagePricing));
      else setDetails(null);
      if (!sourceTemplateId && templateRows[0]?.id) setSourceTemplateId(templateRows[0].id);
    } catch (error) {
      logApiError('tender-ai.load', error);
      toast.error('Không thể tải Tender AI', getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [canManagePricing, details?.id, sourceTemplateId, toast]);

  useEffect(() => { load(); }, []);

  const selectedSheetPreview = useMemo(
    () => preview?.sheets.find(sheet => sheet.name === selectedSheet) || null,
    [preview, selectedSheet],
  );

  const previewLines = useMemo(() => {
    if (!preview || !selectedSheet) return [];
    return externalBoqParserService.buildLineDrafts(preview, selectedSheet, columnMapping, headerRow);
  }, [columnMapping, headerRow, preview, selectedSheet]);

  const previewPageCount = Math.max(1, Math.ceil(previewLines.length / PAGE_SIZE));
  const paginatedPreviewLines = useMemo(
    () => previewLines.slice((previewPage - 1) * PAGE_SIZE, previewPage * PAGE_SIZE),
    [previewLines, previewPage],
  );

  useEffect(() => {
    setPreviewPage(1);
  }, [preview, selectedSheet, headerRow, columnMapping]);

  useEffect(() => {
    setPreviewPage(page => Math.min(page, Math.max(1, Math.ceil(previewLines.length / PAGE_SIZE))));
  }, [previewLines.length]);

  const filteredPackages = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return packages.filter(row => !keyword || [row.code, row.name, row.customerName, row.status].some(value => (value || '').toLowerCase().includes(keyword)));
  }, [packages, query]);

  const mappingByLineId = useMemo(
    () => new Map((details?.mappings || []).map(mapping => [mapping.externalLineId, mapping])),
    [details?.mappings],
  );

  const mappingLinksByLineId = useMemo(() => {
    const map = new Map<string, TenderInternalMappingLink[]>();
    (details?.mappingLinks || []).forEach(link => {
      map.set(link.externalLineId, [...(map.get(link.externalLineId) || []), link]);
    });
    return map;
  }, [details?.mappingLinks]);

  const pricingByLineId = useMemo(() => {
    const map = new Map<string, number>();
    (details?.pricingLines || []).forEach(row => {
      if (!row.externalLineId) return;
      map.set(row.externalLineId, (map.get(row.externalLineId) || 0) + Number(row.quoteAmount || 0));
    });
    return map;
  }, [details?.pricingLines]);

  const templateItemOptions = useMemo<TemplateItemOption[]>(() => {
    return templates.flatMap(template =>
      template.items.map((item: CostTemplateItem) => ({
        template,
        item,
        label: `${template.code} / ${item.code} - ${item.name}`,
      })),
    );
  }, [templates]);

  const optionByItemId = useMemo(
    () => new Map(templateItemOptions.map(option => [option.item.id, option])),
    [templateItemOptions],
  );

  const stats = useMemo(() => {
    const totalLines = details?.lines.length || 0;
    const mapped = details?.mappings.filter(row => row.mappingStatus === 'matched').length || 0;
    const needsReview = details?.mappings.filter(row => row.mappingStatus === 'needs_review').length || 0;
    const missingPricing = details?.pricingLines.filter(row => row.pricingSource === 'missing').length || 0;
    const risks = details?.risks.length || 0;
    const quote = details?.pricingLines.reduce((sum, row) => sum + Number(row.quoteAmount || 0), 0) || details?.totalQuoteAmount || 0;
    const cost = details?.pricingLines.reduce((sum, row) => sum + Number(row.costAmount || 0), 0) || 0;
    return { totalLines, mapped, needsReview, missingPricing, risks, quote, cost };
  }, [details]);

  const boqLines = details?.lines || [];
  const boqPageCount = Math.max(1, Math.ceil(boqLines.length / PAGE_SIZE));
  const paginatedBoqLines = useMemo(
    () => boqLines.slice((boqPage - 1) * PAGE_SIZE, boqPage * PAGE_SIZE),
    [boqLines, boqPage],
  );
  const paginatedBoqLineIds = useMemo(() => paginatedBoqLines.map(line => line.id), [paginatedBoqLines]);
  const isCurrentPageSelected = paginatedBoqLineIds.length > 0 && paginatedBoqLineIds.every(id => selectedLineIds.includes(id));

  useEffect(() => {
    setBoqPage(1);
    setSelectedLineIds([]);
  }, [details?.id]);

  useEffect(() => {
    setBoqPage(page => Math.min(page, Math.max(1, Math.ceil(boqLines.length / PAGE_SIZE))));
  }, [boqLines.length]);

  const getLinkLabel = useCallback((link: Pick<TenderMappingLinkDraft | TenderInternalMappingLink, 'templateItemId' | 'workCode' | 'normGroupCode'>) => {
    const option = link.templateItemId ? optionByItemId.get(link.templateItemId) : null;
    return option?.label || [link.workCode, link.normGroupCode, link.templateItemId].filter(Boolean).join(' / ') || 'Item nội bộ';
  }, [optionByItemId]);

  const toDraftLink = useCallback((link: TenderInternalMappingLink): TenderMappingLinkDraft => ({
    templateId: link.templateId || null,
    templateSectionId: link.templateSectionId || null,
    templateItemId: link.templateItemId || null,
    workCode: link.workCode || null,
    normGroupCode: link.normGroupCode || null,
    allocationType: link.allocationType || 'inherit_quantity',
    allocationValue: link.allocationValue ?? null,
    quantityFormula: link.quantityFormula || null,
    note: link.note || null,
    mappingSource: 'user',
    confidenceScore: link.confidenceScore ?? 1,
    reason: link.reason || null,
    metadata: link.metadata || {},
  }), []);

  const toggleSelectedLine = (lineId: string) => {
    setSelectedLineIds(prev => prev.includes(lineId) ? prev.filter(id => id !== lineId) : [...prev, lineId]);
  };

  const toggleCurrentPageSelection = () => {
    setSelectedLineIds(prev => {
      if (isCurrentPageSelected) return prev.filter(id => !paginatedBoqLineIds.includes(id));
      return Array.from(new Set([...prev, ...paginatedBoqLineIds]));
    });
  };

  const openMappingDrawer = (lineIds: string[]) => {
    const ids = Array.from(new Set(lineIds.filter(Boolean)));
    if (!ids.length) return;
    setMappingTargetLineIds(ids);
    setMappingSearch('');
    setMappingDraftLinks(ids.length === 1 ? (mappingLinksByLineId.get(ids[0]) || []).map(toDraftLink) : []);
    setMappingDrawerOpen(true);
  };

  const toggleMappingOption = (option: TemplateItemOption) => {
    setMappingDraftLinks(prev => {
      const exists = prev.some(link => link.templateItemId === option.item.id);
      if (exists) return prev.filter(link => link.templateItemId !== option.item.id);
      return [...prev, {
        templateId: option.template.id,
        templateSectionId: option.item.sectionId || null,
        templateItemId: option.item.id,
        workCode: option.item.workCode || null,
        normGroupCode: option.item.normGroupCode || null,
        allocationType: 'inherit_quantity',
        allocationValue: null,
        quantityFormula: null,
        note: '',
        mappingSource: 'user',
        confidenceScore: 1,
        reason: `User chọn ${option.item.code} - ${option.item.name}`,
        metadata: { manual: true },
      }];
    });
  };

  const updateDraftLink = (index: number, patch: Partial<TenderMappingLinkDraft>) => {
    setMappingDraftLinks(prev => prev.map((link, idx) => idx === index ? { ...link, ...patch } : link));
  };

  const removeDraftLink = (index: number) => {
    setMappingDraftLinks(prev => prev.filter((_, idx) => idx !== index));
  };

  const parseFile = async (inputFile?: File | null) => {
    if (!inputFile) return;
    setSaving(true);
    try {
      const workbookPreview = await externalBoqParserService.parseWorkbook(inputFile);
      setFile(inputFile);
      setPreview(workbookPreview);
      setSelectedSheet(workbookPreview.suggestedSheetName);
      setHeaderRow(workbookPreview.suggestedHeaderRow);
      setColumnMapping(workbookPreview.suggestedMapping);
      setPackageName(prev => prev || inputFile.name.replace(/\.(xlsx|xls)$/i, ''));
      toast.success('Đã đọc file Excel', `${workbookPreview.sheets.length} sheet, gợi ý sheet ${workbookPreview.suggestedSheetName}`);
    } catch (error) {
      logApiError('tender-ai.parseFile', error);
      toast.error('Không đọc được file Excel', getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const detectColumns = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      let suggestion;
      try {
        suggestion = await tenderDocumentService.suggestColumnsRemote(preview);
        setAiMode('remote');
      } catch (error) {
        logApiError('tender-ai.detectColumns.remote', error);
        suggestion = externalBoqParserService.detectColumnsLocal(preview, selectedSheet);
        setAiMode('local');
        toast.warning('AI remote chưa phản hồi', 'Hệ thống dùng gợi ý offline để tiếp tục.');
      }
      setSelectedSheet(suggestion.sheetName);
      setHeaderRow(suggestion.headerRow);
      setColumnMapping(suggestion.mapping);
      toast.success('Đã gợi ý cột BOQ', `${Math.round(suggestion.confidenceScore * 100)}% confidence`);
    } catch (error) {
      logApiError('tender-ai.detectColumns', error);
      toast.error('Không thể nhận diện cột', getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const createPackage = async () => {
    if (!file || !preview || !packageName.trim()) {
      toast.warning('Thiếu dữ liệu', 'Cần chọn Excel và nhập tên hồ sơ.');
      return;
    }
    setSaving(true);
    try {
      const created = await tenderPackageService.createFromExcel({
        name: packageName,
        customerName,
        projectType,
        sourceTemplateId: sourceTemplateId || undefined,
        file,
        preview,
        selectedSheetName: selectedSheet,
        headerRow,
        columnMapping,
        createdBy: user.id,
      });
      setDetails(created);
      setFile(null);
      setPreview(null);
      await load(created.id);
      toast.success('Đã tạo hồ sơ Tender AI', `${created.lineCount} dòng BOQ CĐT đã được lưu.`);
    } catch (error) {
      logApiError('tender-ai.createPackage', error);
      toast.error('Không thể tạo hồ sơ', getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const runMapping = async () => {
    if (!details) return;
    setSaving(true);
    try {
      let mappings: TenderMappingDraft[] = [];
      try {
        mappings = await externalBoqMappingService.suggestMappingsRemote(details.id, details.lines, templates);
        setAiMode('remote');
      } catch (error) {
        logApiError('tender-ai.mapping.remote', error);
        mappings = externalBoqMappingService.suggestMappingsLocal(details.lines, templates);
        setAiMode('local');
        toast.warning('AI remote chưa phản hồi', 'Hệ thống dùng mapping offline theo độ khớp tên/mã.');
      }
      if (!mappings.length) mappings = externalBoqMappingService.suggestMappingsLocal(details.lines, templates);
      await externalBoqMappingService.saveMappings(details.id, mappings, user.id);
      await load(details.id);
      toast.success('Đã tạo mapping', `${mappings.length} dòng được gợi ý/map.`);
    } catch (error) {
      logApiError('tender-ai.runMapping', error);
      toast.error('Không thể map BOQ', getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const saveMappingDrawer = async () => {
    if (!details || !mappingTargetLineIds.length) return;
    const firstLink = mappingDraftLinks[0];
    const drafts: TenderMappingDraft[] = mappingTargetLineIds.map(lineId => ({
      externalLineId: lineId,
      templateId: firstLink?.templateId || null,
      templateSectionId: firstLink?.templateSectionId || null,
      templateItemId: firstLink?.templateItemId || null,
      workCode: firstLink?.workCode || null,
      normGroupCode: firstLink?.normGroupCode || null,
      mappingStatus: mappingDraftLinks.length ? 'matched' : 'unmatched',
      mappingSource: 'user',
      confidenceScore: mappingDraftLinks.length ? 1 : 0.2,
      reason: mappingDraftLinks.length
        ? `User chọn ${mappingDraftLinks.length} item nội bộ.`
        : 'User xác nhận chưa chọn item nội bộ.',
      metadata: { manual: true, batchLineCount: mappingTargetLineIds.length },
      links: mappingDraftLinks.map(link => ({
        ...link,
        mappingSource: 'user',
        confidenceScore: link.confidenceScore ?? 1,
        reason: link.reason || `User chọn ${getLinkLabel(link)}`,
        metadata: { ...(link.metadata || {}), manual: true },
      })),
    }));
    setSaving(true);
    try {
      await externalBoqMappingService.saveMappings(details.id, drafts, user.id);
      await load(details.id);
      setMappingDrawerOpen(false);
      setMappingTargetLineIds([]);
      setMappingDraftLinks([]);
      setSelectedLineIds([]);
      toast.success('Đã lưu mapping nội bộ', `${drafts.length} dòng CĐT, ${mappingDraftLinks.length} item nội bộ.`);
    } catch (error) {
      logApiError('tender-ai.manualMapping', error);
      toast.error('Không thể lưu mapping', getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const runPricing = async () => {
    if (!details || !canManagePricing) return;
    setSaving(true);
    try {
      const fresh = await tenderPackageService.get(details.id, true);
      if (!fresh) throw new Error('Không tìm thấy hồ sơ.');
      const rows = tenderPricingService.buildPricingPreview({
        packageId: fresh.id,
        lines: fresh.lines,
        mappings: fresh.mappings,
        mappingLinks: fresh.mappingLinks,
        templates,
        prices,
        norms,
        actorId: user.id,
      });
      await tenderPricingService.savePricing(fresh.id, rows, user.id);
      await load(fresh.id);
      toast.success('Đã tính lại giá nội bộ', `${rows.length} dòng cost/pricing được tạo.`);
    } catch (error) {
      logApiError('tender-ai.runPricing', error);
      toast.error('Không thể tính giá', getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const runRisks = async () => {
    if (!details) return;
    setSaving(true);
    try {
      const fresh = await tenderPackageService.get(details.id, canManagePricing);
      if (!fresh) throw new Error('Không tìm thấy hồ sơ.');
      const localRisks = tenderRiskRfiService.buildRisksLocal(fresh);
      let remoteRisks = [];
      try {
        remoteRisks = await tenderRiskRfiService.suggestRisksRemote(fresh);
        setAiMode('remote');
      } catch (error) {
        logApiError('tender-ai.risks.remote', error);
        setAiMode('local');
      }
      await tenderRiskRfiService.saveRisks(fresh.id, [...localRisks, ...remoteRisks], user.id);
      await load(fresh.id);
      toast.success('Đã tạo risk/RFI', `${localRisks.length + remoteRisks.length} cảnh báo được ghi nhận.`);
    } catch (error) {
      logApiError('tender-ai.runRisks', error);
      toast.error('Không thể tạo risk/RFI', getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const exportWorkbook = async (mode: 'external_quote' | 'internal_workbook') => {
    if (!details) return;
    if (mode === 'internal_workbook' && !canManagePricing) {
      toast.error('Không có quyền', 'Internal workbook chỉ dành cho Admin hoặc quản trị Tender AI/HD.');
      return;
    }
    setSaving(true);
    try {
      const fresh = await tenderPackageService.get(details.id, canManagePricing);
      if (!fresh) throw new Error('Không tìm thấy hồ sơ.');
      const blob = mode === 'external_quote'
        ? await tenderExportService.createExternalQuote(fresh)
        : await tenderExportService.createInternalWorkbook(fresh);
      const safeCustomer = (fresh.customerName || 'khach-hang').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
      const fileName = `${fresh.code}-${safeCustomer}-${mode === 'external_quote' ? 'bao-gia-cdt' : 'noi-bo'}.xlsx`;
      downloadBlob(blob, fileName);
      await tenderExportService.recordExport(fresh.id, mode, fileName, user.id, {
        lineCount: fresh.lines.length,
        pricingLineCount: fresh.pricingLines.length,
        riskCount: fresh.risks.length,
      });
      await load(fresh.id);
      toast.success('Đã export Excel', fileName);
    } catch (error) {
      logApiError('tender-ai.export', error);
      toast.error('Không thể export', getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (!canUse) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
        <div>
          <LockKeyhole className="mx-auto mb-3 text-slate-400" size={36} />
          <h2 className="text-lg font-black">Chưa có quyền Tender AI</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">Admin cần cấp module Tender AI hoặc HD cho tài khoản này.</p>
        </div>
      </div>
    );
  }

  if (loading) return <div className="flex min-h-[360px] items-center justify-center"><Loader2 className="animate-spin text-fuchsia-600" size={32} /></div>;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-5">
        {[
          ['Hồ sơ', packages.length],
          ['Dòng BOQ', stats.totalLines],
          ['Đã map', stats.mapped],
          ['Thiếu giá', stats.missingPricing],
          ['Risk/RFI', stats.risks],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-[10px] font-black uppercase text-slate-400">{label}</div>
            <div className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)] w-full min-w-0">
        <div className="space-y-4 min-w-0">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-black"><Upload size={16} /> Upload BOQ CĐT</h2>
              {aiMode && <span className="rounded-lg bg-fuchsia-50 px-2 py-1 text-[10px] font-black text-fuchsia-700 dark:bg-fuchsia-950/30 dark:text-fuchsia-300">AI: {aiMode}</span>}
            </div>
            <div className="space-y-3">
              <input
                value={packageName}
                onChange={event => setPackageName(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-fuchsia-400 dark:border-slate-700 dark:bg-slate-950"
                placeholder="Tên hồ sơ thầu"
              />
              <input
                value={customerName}
                onChange={event => setCustomerName(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-fuchsia-400 dark:border-slate-700 dark:bg-slate-950"
                placeholder="Chủ đầu tư / khách hàng"
              />
              <select
                value={sourceTemplateId}
                onChange={event => setSourceTemplateId(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-fuchsia-400 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">Chưa chọn template baseline</option>
                {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
              <input
                value={projectType}
                onChange={event => setProjectType(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-fuchsia-400 dark:border-slate-700 dark:bg-slate-950"
                placeholder="Loại công trình"
              />
              <label className={BTN_SOFT}>
                <FileSpreadsheet size={14} />
                Chọn Excel BOQ CĐT
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={event => parseFile(event.target.files?.[0])} />
              </label>
              {preview && (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-black">{preview.fileName}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={selectedSheet} onChange={event => {
                      const sheetName = event.target.value;
                      const suggestion = externalBoqParserService.detectColumnsLocal(preview, sheetName);
                      setSelectedSheet(sheetName);
                      setHeaderRow(suggestion.headerRow);
                      setColumnMapping(suggestion.mapping);
                    }} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-900">
                      {preview.sheets.map(sheet => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}
                    </select>
                    <input
                      type="number"
                      value={headerRow + 1}
                      min={1}
                      onChange={event => setHeaderRow(Math.max(0, Number(event.target.value) - 1))}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                      title="Dòng header"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(columnLabels) as TenderBoqColumnKey[]).map(key => (
                      <label key={key} className="text-[10px] font-black text-slate-500">
                        {columnLabels[key]}
                        <input
                          type="number"
                          min={1}
                          value={columnMapping[key] !== undefined ? Number(columnMapping[key]) + 1 : ''}
                          onChange={event => setColumnMapping(prev => ({
                            ...prev,
                            [key]: event.target.value ? Math.max(0, Number(event.target.value) - 1) : undefined,
                          }))}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className={BTN_SOFT} onClick={detectColumns} disabled={saving}><Wand2 size={14} /> AI nhận diện cột</button>
                    <button className={BTN_PRIMARY} onClick={createPackage} disabled={saving}><Save size={14} /> Lưu hồ sơ</button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center gap-2">
              <Search size={15} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                className="w-full bg-transparent text-sm font-bold outline-none"
                placeholder="Tìm hồ sơ Tender AI"
              />
            </div>
            <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {filteredPackages.map(pkg => (
                <button
                  key={pkg.id}
                  onClick={() => load(pkg.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    details?.id === pkg.id
                      ? 'border-fuchsia-300 bg-fuchsia-50 dark:border-fuchsia-900 dark:bg-fuchsia-950/30'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-black text-slate-900 dark:text-white">{pkg.name}</div>
                      <div className="mt-0.5 text-[10px] font-bold text-slate-400">{pkg.code}</div>
                    </div>
                    <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-300">{statusLabel[pkg.status] || pkg.status}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] font-bold text-slate-500">
                    <span>{pkg.lineCount} dòng</span>
                    <span>{money(pkg.totalQuoteAmount || pkg.totalOwnerAmount)}</span>
                  </div>
                </button>
              ))}
              {filteredPackages.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs font-bold text-slate-400 dark:border-slate-800">Chưa có hồ sơ Tender AI.</div>}
            </div>
          </section>
        </div>

        <div className="space-y-4 min-w-0">
          {preview && selectedSheetPreview && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-black"><Eye size={16} /> Preview BOQ</h2>
                <span className="text-xs font-bold text-slate-400">{previewLines.length} dòng BOQ / {selectedSheetPreview.rowCount} dòng sheet</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="min-w-full divide-y divide-slate-200 text-left dark:divide-slate-800">
                  <thead className="bg-slate-50 dark:bg-slate-950">
                    <tr>
                      <th className="w-12 px-3 py-2 text-center text-[10px] font-black uppercase text-slate-400">Row</th>
                      <th className="w-28 px-3 py-2 text-left text-[10px] font-black uppercase text-slate-400">Mã</th>
                      <th className="min-w-[280px] px-3 py-2 text-left text-[10px] font-black uppercase text-slate-400">Nội dung</th>
                      <th className="w-16 px-3 py-2 text-center text-[10px] font-black uppercase text-slate-400">ĐVT</th>
                      <th className="w-24 px-3 py-2 text-right text-[10px] font-black uppercase text-slate-400">KL</th>
                      <th className="w-32 px-3 py-2 text-right text-[10px] font-black uppercase text-slate-400">Thành tiền</th>
                      <th className="w-28 px-3 py-2 text-center text-[10px] font-black uppercase text-slate-400">Loại</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {paginatedPreviewLines.map(line => (
                      <tr key={`${line.sheetName}-${line.rowNumber}`}>
                        <td className="w-12 px-3 py-2 text-center align-middle text-xs text-slate-600 dark:text-slate-300">{line.rowNumber}</td>
                        <td className="w-28 px-3 py-2 text-left align-middle text-xs text-slate-600 dark:text-slate-300">{line.itemCode || line.lineNo || '-'}</td>
                        <td className="min-w-[280px] px-3 py-2 text-left align-middle text-xs font-bold text-slate-800 dark:text-slate-100 break-words whitespace-normal">{line.name || line.description}</td>
                        <td className="w-16 px-3 py-2 text-center align-middle text-xs text-slate-600 dark:text-slate-300">{line.unit || '-'}</td>
                        <td className="w-24 px-3 py-2 text-right align-middle text-xs text-slate-600 dark:text-slate-300 font-medium">{line.quantity || '-'}</td>
                        <td className="w-32 px-3 py-2 text-right align-middle text-xs text-slate-600 dark:text-slate-300 font-bold">{line.ownerAmount ? money(line.ownerAmount) : '-'}</td>
                        <td className="w-28 px-3 py-2 text-center align-middle text-xs text-slate-600 dark:text-slate-300">{line.lineType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                label="Preview BOQ"
                page={previewPage}
                pageCount={previewPageCount}
                total={previewLines.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPreviewPage}
              />
            </section>
          )}

          {details ? (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase text-fuchsia-600 dark:text-fuchsia-300">
                      <Bot size={13} /> {details.code}
                    </div>
                    <h2 className="mt-1 text-xl font-black">{details.name}</h2>
                    <div className="mt-1 text-xs font-bold text-slate-500">{details.customerName || 'Chưa có khách hàng'} · {statusLabel[details.status] || details.status}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className={BTN_SOFT} onClick={() => load(details.id)} disabled={saving}><RefreshCw size={14} /> Tải lại</button>
                    <button className={BTN_PRIMARY} onClick={runMapping} disabled={saving || templates.length === 0}><Wand2 size={14} /> AI map BOQ</button>
                    <button className={canManagePricing ? BTN_DANGER : BTN_SOFT} onClick={runPricing} disabled={saving || !canManagePricing}><ShieldCheck size={14} /> Tính giá nội bộ</button>
                    <button className={BTN_SOFT} onClick={runRisks} disabled={saving}><AlertTriangle size={14} /> Risk/RFI</button>
                    <button className={BTN_SOFT} onClick={() => exportWorkbook('external_quote')} disabled={saving}><Download size={14} /> Báo giá CĐT</button>
                    <button className={BTN_SOFT} onClick={() => exportWorkbook('internal_workbook')} disabled={saving || !canManagePricing}><Download size={14} /> Workbook nội bộ</button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-[10px] font-black uppercase text-slate-400">Giá CĐT</div><div className="mt-1 font-black">{money(details.totalOwnerAmount)}</div></div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-[10px] font-black uppercase text-slate-400">Giá chào</div><div className="mt-1 font-black">{money(stats.quote)}</div></div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-[10px] font-black uppercase text-slate-400">Giá vốn</div><div className="mt-1 font-black">{canManagePricing ? money(stats.cost) : 'Ẩn theo quyền'}</div></div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-[10px] font-black uppercase text-slate-400">Margin tạm tính</div><div className="mt-1 font-black">{canManagePricing && stats.quote > 0 ? `${Math.round(((stats.quote - stats.cost) / stats.quote) * 1000) / 10}%` : 'Ẩn theo quyền'}</div></div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-black"><Layers size={16} /> BOQ CĐT và mapping nội bộ</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={BTN_SOFT}
                      onClick={() => openMappingDrawer(selectedLineIds)}
                      disabled={!selectedLineIds.length || saving}
                    >
                      <CheckSquare size={14} /> Map hàng loạt ({selectedLineIds.length})
                    </button>
                    <span className="text-xs font-bold text-slate-400">{boqLines.length} dòng</span>
                    {saving && <Loader2 className="animate-spin text-fuchsia-600" size={18} />}
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="min-w-full divide-y divide-slate-200 text-left dark:divide-slate-800">
                    <thead className="bg-slate-50 dark:bg-slate-950">
                      <tr>
                        <th className="w-10 px-3 py-2 text-center">
                          <button type="button" onClick={toggleCurrentPageSelection} className="text-slate-400 hover:text-fuchsia-600" title="Chọn/bỏ chọn trang hiện tại">
                            {isCurrentPageSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                          </button>
                        </th>
                        <th className="w-12 px-3 py-2 text-center text-[10px] font-black uppercase text-slate-400">Row</th>
                        <th className="min-w-[320px] px-3 py-2 text-left text-[10px] font-black uppercase text-slate-400">Dòng BOQ CĐT</th>
                        <th className="w-16 px-3 py-2 text-center text-[10px] font-black uppercase text-slate-400">ĐVT</th>
                        <th className="w-24 px-3 py-2 text-right text-[10px] font-black uppercase text-slate-400">KL</th>
                        <th className="w-32 px-3 py-2 text-center text-[10px] font-black uppercase text-slate-400">Mapping</th>
                        <th className="w-36 px-3 py-2 text-right text-[10px] font-black uppercase text-slate-400">Giá chào</th>
                        <th className="min-w-[260px] px-3 py-2 text-left text-[10px] font-black uppercase text-slate-400">Item nội bộ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {paginatedBoqLines.map(line => {
                        const mapping = mappingByLineId.get(line.id);
                        const links = mappingLinksByLineId.get(line.id) || [];
                        const quoteAmount = pricingByLineId.get(line.id) || 0;
                        return (
                          <tr key={line.id}>
                            <td className="w-10 px-3 py-2 text-center align-middle">
                              <button type="button" onClick={() => toggleSelectedLine(line.id)} className="text-slate-400 hover:text-fuchsia-600">
                                {selectedLineIds.includes(line.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                              </button>
                            </td>
                            <td className="w-12 px-3 py-2 text-center align-middle text-xs text-slate-650 dark:text-slate-350">{line.rowNumber}</td>
                            <td className="min-w-[320px] px-3 py-2 text-left align-middle text-xs text-slate-600 dark:text-slate-300 break-words whitespace-normal">
                              <div className="font-black text-slate-800 dark:text-slate-100">{lineTitle(line)}</div>
                              <div className="mt-0.5 text-[10px] font-bold text-slate-400">{line.lineType}</div>
                            </td>
                            <td className="w-16 px-3 py-2 text-center align-middle text-xs text-slate-650 dark:text-slate-350">{line.unit || '-'}</td>
                            <td className="w-24 px-3 py-2 text-right align-middle text-xs text-slate-650 dark:text-slate-350 font-medium">{line.quantity || '-'}</td>
                            <td className="w-32 px-3 py-2 text-center align-middle text-xs text-slate-650 dark:text-slate-350">
                              <MappingBadge mapping={mapping} links={links} />
                            </td>
                            <td className="w-36 px-3 py-2 text-right align-middle text-xs text-slate-600 dark:text-slate-300 font-bold">{quoteAmount ? money(quoteAmount) : '-'}</td>
                            <td className="min-w-[260px] px-3 py-2 text-left align-middle text-xs text-slate-600 dark:text-slate-300">
                              <div className="space-y-2">
                                {links.length > 0 ? (
                                  <div className="space-y-1">
                                    {links.slice(0, 3).map(link => (
                                      <div key={link.id} className="max-w-[240px] truncate rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300" title={getLinkLabel(link)}>
                                        {getLinkLabel(link)}
                                      </div>
                                    ))}
                                    {links.length > 3 && <div className="text-[10px] font-bold text-slate-400">+{links.length - 3} item khác</div>}
                                  </div>
                                ) : (
                                  <div className="text-[10px] font-bold text-slate-400">Chưa chọn item nội bộ</div>
                                )}
                                <button type="button" className={BTN_SOFT} onClick={() => openMappingDrawer([line.id])} disabled={saving}>
                                  <Search size={14} /> Gõ để tìm / chọn
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  label="BOQ CĐT"
                  page={boqPage}
                  pageCount={boqPageCount}
                  total={boqLines.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setBoqPage}
                />
              </section>

              <div className="grid gap-4 xl:grid-cols-2">
                <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-black"><AlertTriangle size={16} /> Risk/RFI</h2>
                  <div className="space-y-2">
                    {details.risks.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs font-bold text-slate-400 dark:border-slate-800">Chưa có risk/RFI.</div>}
                    {details.risks.slice(0, 12).map(risk => {
                      const line = details.lines.find(row => row.id === risk.externalLineId);
                      return (
                        <div key={risk.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-black text-sm">{risk.title}</div>
                            <span className={`rounded-lg px-2 py-1 text-[9px] font-black ${riskColor[risk.severity] || riskColor.medium}`}>{risk.severity}</span>
                          </div>
                          <div className="mt-1 text-xs font-bold text-slate-500">{lineTitle(line)}</div>
                          {risk.description && <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">{risk.description}</div>}
                          {risk.suggestedRfi && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{risk.suggestedRfi}</div>}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-black"><CheckCircle2 size={16} /> Export & audit</h2>
                  <div className="space-y-2">
                    {details.exports.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs font-bold text-slate-400 dark:border-slate-800">Chưa có lịch sử export.</div>}
                    {details.exports.map(row => (
                      <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-black">{row.fileName}</div>
                          <div className="mt-0.5 text-[10px] font-bold text-slate-400">{row.exportType} · {row.createdAt ? new Date(row.createdAt).toLocaleString('vi-VN') : ''}</div>
                        </div>
                        <FileSpreadsheet className="shrink-0 text-slate-400" size={18} />
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          ) : (
            <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
              <FileSpreadsheet className="mx-auto mb-3 text-slate-300" size={44} />
              <h2 className="text-lg font-black">Chưa chọn hồ sơ BOQ CĐT</h2>
              <p className="mt-1 text-sm font-bold text-slate-500">Upload Excel hoặc chọn hồ sơ ở danh sách bên trái.</p>
            </section>
          )}
        </div>
      </div>
      <MappingDrawer
        open={mappingDrawerOpen}
        saving={saving}
        targetLines={mappingTargetLineIds.map(id => details?.lines.find(line => line.id === id)).filter(Boolean) as TenderExternalBoqLine[]}
        options={templateItemOptions}
        search={mappingSearch}
        links={mappingDraftLinks}
        getLinkLabel={getLinkLabel}
        onSearchChange={setMappingSearch}
        onToggleOption={toggleMappingOption}
        onUpdateLink={updateDraftLink}
        onRemoveLink={removeDraftLink}
        onClearLinks={() => setMappingDraftLinks([])}
        onClose={() => setMappingDrawerOpen(false)}
        onSave={saveMappingDrawer}
      />
    </div>
  );
};

const MappingBadge: React.FC<{ mapping?: TenderInternalMapping; links?: TenderInternalMappingLink[] }> = ({ mapping, links = [] }) => {
  if (!mapping) return <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-300">Chưa map</span>;
  const cls = mapping.mappingStatus === 'matched'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    : mapping.mappingStatus === 'needs_review'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return (
    <div>
      <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${cls}`}>{mappingLabel[mapping.mappingStatus] || mapping.mappingStatus}</span>
      <div className="mt-1 text-[10px] font-bold text-slate-400">{links.length} item · {Math.round(num(mapping.confidenceScore) * 100)}% · {mapping.mappingSource}</div>
    </div>
  );
};

const MappingDrawer: React.FC<{
  open: boolean;
  saving: boolean;
  targetLines: TenderExternalBoqLine[];
  options: TemplateItemOption[];
  search: string;
  links: TenderMappingLinkDraft[];
  getLinkLabel: (link: Pick<TenderMappingLinkDraft | TenderInternalMappingLink, 'templateItemId' | 'workCode' | 'normGroupCode'>) => string;
  onSearchChange: (value: string) => void;
  onToggleOption: (option: TemplateItemOption) => void;
  onUpdateLink: (index: number, patch: Partial<TenderMappingLinkDraft>) => void;
  onRemoveLink: (index: number) => void;
  onClearLinks: () => void;
  onClose: () => void;
  onSave: () => void;
}> = ({
  open,
  saving,
  targetLines,
  options,
  search,
  links,
  getLinkLabel,
  onSearchChange,
  onToggleOption,
  onUpdateLink,
  onRemoveLink,
  onClearLinks,
  onClose,
  onSave,
}) => {
  if (!open) return null;
  const keyword = search.trim().toLowerCase();
  const filteredOptions = options
    .filter(option => !keyword || option.label.toLowerCase().includes(keyword))
    .slice(0, 120);
  const selectedItemIds = new Set(links.map(link => link.templateItemId).filter(Boolean));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <div className="h-full w-full max-w-4xl overflow-y-auto bg-white p-4 shadow-2xl dark:bg-slate-950">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">Map item nội bộ</h3>
            <p className="mt-1 text-xs font-bold text-slate-500">
              {targetLines.length} dòng BOQ CĐT được chọn. Có thể để trống item để lưu trạng thái chưa map.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] w-full min-w-0">
          <div className="space-y-3 min-w-0">
            <div className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="mb-2 text-[10px] font-black uppercase text-slate-400">Dòng CĐT đang map</div>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {targetLines.slice(0, 10).map(line => (
                  <div key={line.id} className="truncate rounded-lg bg-slate-50 px-2 py-1 text-xs font-bold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                    Row {line.rowNumber}: {lineTitle(line)}
                  </div>
                ))}
                {targetLines.length > 10 && <div className="text-xs font-bold text-slate-400">+{targetLines.length - 10} dòng khác</div>}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800">
                <Search size={15} className="text-slate-400" />
                <input
                  value={search}
                  onChange={event => onSearchChange(event.target.value)}
                  className="w-full bg-transparent text-sm font-bold outline-none"
                  placeholder="Gõ mã, tên hạng mục, work code để tìm item nội bộ"
                />
              </div>
              <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                {filteredOptions.map(option => {
                  const selected = Boolean(selectedItemIds.has(option.item.id));
                  return (
                    <button
                      key={option.item.id}
                      type="button"
                      onClick={() => onToggleOption(option)}
                      className={`flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-900 ${selected ? 'bg-fuchsia-50 dark:bg-fuchsia-950/20' : ''}`}
                    >
                      <span className="mt-0.5 text-fuchsia-600">{selected ? <CheckSquare size={16} /> : <Square size={16} />}</span>
                      <span className="min-w-0">
                        <span className="block text-xs font-black text-slate-800 dark:text-slate-100">{option.item.code || option.item.workCode || 'NO-CODE'} - {option.item.name}</span>
                        <span className="mt-0.5 block text-[10px] font-bold text-slate-400">{option.template.name} · {option.item.unit || 'chưa có đơn vị'}</span>
                      </span>
                    </button>
                  );
                })}
                {filteredOptions.length === 0 && <div className="p-5 text-center text-xs font-bold text-slate-400">Không tìm thấy item nội bộ phù hợp.</div>}
              </div>
            </div>
          </div>

          <div className="space-y-3 min-w-0">
            <div className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-black uppercase text-slate-400">Item đã chọn</div>
                <button type="button" onClick={onClearLinks} className="text-[10px] font-black text-slate-400 hover:text-red-500">Không chọn mục nào</button>
              </div>
              <div className="mt-3 space-y-3">
                {links.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs font-bold text-slate-400 dark:border-slate-800">Chưa chọn item nội bộ.</div>}
                {links.map((link, index) => (
                  <div key={`${link.templateItemId || link.workCode || index}`} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-black text-slate-800 dark:text-slate-100">{getLinkLabel(link)}</div>
                        <div className="mt-0.5 text-[10px] font-bold text-slate-400">{link.workCode || link.normGroupCode || 'mapping item'}</div>
                      </div>
                      <button type="button" onClick={() => onRemoveLink(index)} className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <select
                        value={link.allocationType || 'inherit_quantity'}
                        onChange={event => onUpdateLink(index, { allocationType: event.target.value as TenderAllocationType })}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="inherit_quantity">Theo KL CĐT</option>
                        <option value="percent">Theo %</option>
                        <option value="fixed_quantity">KL cố định</option>
                        <option value="formula">Công thức</option>
                      </select>
                      <input
                        value={link.allocationValue ?? ''}
                        onChange={event => onUpdateLink(index, { allocationValue: event.target.value === '' ? null : Number(event.target.value) })}
                        disabled={(link.allocationType || 'inherit_quantity') === 'inherit_quantity'}
                        type="number"
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:disabled:bg-slate-950"
                        placeholder="% hoặc KL"
                      />
                    </div>
                    <input
                      value={link.note || ''}
                      onChange={event => onUpdateLink(index, { note: event.target.value })}
                      className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                      placeholder="Ghi chú phân bổ"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button type="button" className={BTN_SOFT} onClick={onClose} disabled={saving}>Huỷ</button>
              <button type="button" className={BTN_PRIMARY} onClick={onSave} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Lưu mapping
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const PaginationControls: React.FC<{
  label: string;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}> = ({ label, page, pageCount, total, pageSize, onPageChange }) => {
  if (total <= pageSize) {
    return (
      <div className="mt-3 text-xs font-bold text-slate-400">
        {label}: hiển thị đủ {total} dòng
      </div>
    );
  }
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs font-bold text-slate-400">
        {label}: dòng {start}-{end} / {total}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className={BTN_SOFT}
        >
          Trước
        </button>
        <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {page}/{pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          className={BTN_SOFT}
        >
          Sau
        </button>
      </div>
    </div>
  );
};

export default TenderBoqAnalyzer;
