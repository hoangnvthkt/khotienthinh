import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  GitCompare,
  Layers,
  Library,
  Loader2,
  LockKeyhole,
  PackageSearch,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import {
  CostTemplateDetails,
  CostImportValidationResult,
  costTemplateService,
  estimateAiSuggestionService,
  CatalogReadinessReport,
  EstimateComparisonResult,
  EstimateConversionAudit,
  EstimateConversionPreview,
  EstimateAiSuggestion,
  estimateParameterLabels,
  estimatePermissionService,
  estimateScenarioService,
  EstimateScenarioDetails,
  EstimateExportMode,
  CostTemplateReadinessReport,
  CostTemplateNormalizationReport,
  CostTemplateNormalizationStatus,
  CostNormWorkbenchLine,
  costNormStandardizationAiService,
  costNormWorkbenchService,
  InternalNormImportPayload,
  InternalPriceBookImportPayload,
  internalNormService,
  internalPriceBookService,
  NormalizedTemplateMaterial,
  ProjectTemplateImportPreview,
  RawTemplateMaterialSnapshot,
} from '../../lib/costEstimateService';
import { customerContractService, subcontractorContractService } from '../../lib/hdService';
import {
  ContractItemType,
  CostTemplateItem,
  CostTemplateParameter,
  CostTemplateSection,
  CustomerContract,
  EstimateItem,
  EstimateScenario,
  InternalNorm,
  InternalPriceBookItem,
  SubcontractorContract,
} from '../../types';

type PageTab = 'builder' | 'templates' | 'prices' | 'norms' | 'estimates';
type BuilderStep = 1 | 2 | 3 | 4;
type StatusFilter = 'all' | 'draft' | 'active' | 'archived' | 'reviewed' | 'finalized' | 'converted' | 'cancelled';
type NormalizationFormState = {
  status: CostTemplateNormalizationStatus;
  standardUnit: string;
  standardBaseQuantity: string;
  standardWorkCode: string;
  note: string;
  normalizedMaterials: NormalizedTemplateMaterial[];
};

const money = (value: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));
const num = (value: unknown) => Number(value || 0);
const today = () => new Date().toISOString().slice(0, 10);

const statusLabel: Record<string, string> = {
  draft: 'Nháp',
  active: 'Hiệu lực',
  archived: 'Lưu trữ',
  reviewed: 'Đã rà soát',
  finalized: 'Đã chốt',
  converted: 'Đã chuyển BOQ',
  cancelled: 'Huỷ',
};

const normalizationLabel: Record<CostTemplateNormalizationStatus, string> = {
  raw: 'Thô',
  reviewing: 'Đang rà soát',
  normalized: 'Đã chuẩn hóa',
  ignored: 'Bỏ qua',
};

const readinessLabel: Record<string, string> = {
  draft: 'Draft',
  needs_data: 'Needs data',
  ready_to_estimate: 'Ready to estimate',
  active: 'Active',
};

const TD = 'px-4 py-3 align-middle text-slate-800 dark:text-slate-200 whitespace-nowrap text-xs font-semibold border-b border-slate-100 dark:border-slate-800';
const BTN_SOFT = 'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50';
const BTN_PRIMARY = 'inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50';
const BTN_MINI = 'inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600';

const tabs: Array<{ key: PageTab; label: string; icon: React.ReactNode }> = [
  { key: 'builder', label: 'Tạo dự toán nhanh', icon: <Calculator size={14} /> },
  { key: 'templates', label: 'Template', icon: <Library size={14} /> },
  { key: 'prices', label: 'Đơn giá nội bộ', icon: <ShieldCheck size={14} /> },
  { key: 'norms', label: 'Định mức', icon: <PackageSearch size={14} /> },
  { key: 'estimates', label: 'Phương án', icon: <FileSpreadsheet size={14} /> },
];

const emptyTemplate = () => ({
  code: `NHAXUONG_${Date.now().toString().slice(-5)}`,
  name: 'Nhà xưởng thép tiền chế',
  projectType: 'nha_xuong',
  description: '',
  status: 'draft' as const,
  versionNo: 1,
  effectiveFrom: today(),
});

const emptySection = (templateId = ''): Partial<CostTemplateSection> & { templateId: string; code: string; name: string } => ({
  templateId,
  code: '',
  name: '',
  unit: '',
  calculationMethod: '',
  sortOrder: 0,
});

const emptyItem = (templateId = ''): Partial<CostTemplateItem> & { templateId: string; code: string; name: string } => ({
  templateId,
  code: '',
  name: '',
  itemType: 'work',
  unit: '',
  quantityFormula: '',
  baseQuantity: 0,
  defaultWastePercent: 0,
  laborRate: 0,
  machineRate: 0,
  overheadPercent: 0,
  profitPercent: 0,
  riskBufferPercent: 0,
  sortOrder: 0,
});

const emptyParameter = (templateId = ''): Partial<CostTemplateParameter> & { templateId: string; code: string; label: string } => ({
  templateId,
  code: '',
  label: '',
  dataType: 'number',
  unit: '',
  isRequired: true,
  options: [],
  sortOrder: 0,
});

const emptyPrice = (): Partial<InternalPriceBookItem> & { itemCode: string; itemName: string; unit: string; unitPrice: number } => ({
  itemCode: '',
  itemName: '',
  itemType: 'material',
  category: '',
  spec: '',
  unit: '',
  region: 'all',
  unitPrice: 0,
  versionNo: 1,
  effectiveFrom: today(),
  status: 'draft',
  sensitivityLevel: 'internal',
});

const emptyNorm = (): Partial<InternalNorm> & { normCode: string; resourceName: string; unit: string; normQuantity: number } => ({
  normCode: '',
  templateItemId: '',
  workCode: '',
  resourceCode: '',
  resourceName: '',
  resourceType: 'material',
  unit: '',
  normQuantity: 0,
  wastePercent: 0,
  formula: '',
  region: 'all',
  versionNo: 1,
  effectiveFrom: today(),
  status: 'draft',
  confidenceScore: 0.7,
});

const getItemMetadata = (item: CostTemplateItem): Record<string, unknown> => item.metadata || {};
const getRawMaterials = (item: CostTemplateItem): RawTemplateMaterialSnapshot[] => {
  const value = getItemMetadata(item).rawMaterials;
  return Array.isArray(value) ? value as RawTemplateMaterialSnapshot[] : [];
};
const getNormalizedMaterials = (item: CostTemplateItem): NormalizedTemplateMaterial[] => {
  const value = getItemMetadata(item).normalizedMaterials;
  return Array.isArray(value) ? value as NormalizedTemplateMaterial[] : [];
};
const getNormalizationStatus = (item: CostTemplateItem): CostTemplateNormalizationStatus => {
  const value = getItemMetadata(item).normalizationStatus;
  if (value === 'reviewing' || value === 'normalized' || value === 'ignored') return value;
  return getRawMaterials(item).length > 0 || getItemMetadata(item).needsNormalization ? 'raw' : 'normalized';
};
const normalizePackageCode = (value: unknown, fallback = 'GOI_DINH_MUC') => {
  const normalized = String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
};
const isNormPackageItem = (item: CostTemplateItem, norms: InternalNorm[] = []) => {
  const metadata = getItemMetadata(item);
  return metadata.sourceKind === 'internal_norm_package'
    || item.costCategory === 'norm_package'
    || Boolean(item.normGroupCode)
    || norms.some(norm => norm.templateItemId === item.id);
};
const defaultNormPackageForm = (referenceItem?: CostTemplateItem | null) => ({
  code: referenceItem ? normalizePackageCode(getItemMetadata(referenceItem).standardWorkCode || referenceItem.workCode || referenceItem.code || referenceItem.name) : '',
  name: referenceItem?.name || '',
  unit: String(referenceItem ? getItemMetadata(referenceItem).standardUnit || referenceItem.unit || '' : ''),
  baseQuantity: '1',
});
const rawToNormalizedMaterial = (material: RawTemplateMaterialSnapshot, index: number): NormalizedTemplateMaterial => ({
  sourceMaterialBudgetItemId: material.sourceMaterialBudgetItemId,
  materialCode: material.materialCode || '',
  itemName: material.itemName || '',
  category: material.category || '',
  unit: material.unit || '',
  quantity: Number(material.budgetQty || 0),
  conversionFactor: 1,
  wastePercent: Number(material.wastePercent || 0),
  note: material.notes || '',
  sortOrder: material.sortOrder ?? index,
});

const factorySections = [
  { code: 'A', name: 'Móng', unit: 'gói', calculationMethod: 'Theo loại móng và diện tích', sortOrder: 10 },
  { code: 'B', name: 'Nền bê tông', unit: 'm2', calculationMethod: 'Diện tích nền x chiều dày', sortOrder: 20 },
  { code: 'C', name: 'Khung thép', unit: 'kg', calculationMethod: 'Diện tích sàn x kg thép/m2', sortOrder: 30 },
  { code: 'D', name: 'Mái', unit: 'm2', calculationMethod: 'Diện tích sàn x hệ số mái', sortOrder: 40 },
  { code: 'E', name: 'Vách bao che', unit: 'm2', calculationMethod: 'Chu vi giả định x chiều cao', sortOrder: 50 },
  { code: 'F', name: 'MEP', unit: 'gói', calculationMethod: 'Theo diện tích và mức hoàn thiện', sortOrder: 60 },
  { code: 'G', name: 'PCCC', unit: 'gói', calculationMethod: 'Theo diện tích và yêu cầu công năng', sortOrder: 70 },
];

const CostLibrary: React.FC = () => {
  const { user } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const canManage = estimatePermissionService.canManageCostLibrary(user);
  const canCreateEstimate = estimatePermissionService.canCreateEstimate(user);
  const canSeeInternalCost = estimatePermissionService.canSeeInternalCost(user);

  const [activeTab, setActiveTab] = useState<PageTab>('builder');
  const [templates, setTemplates] = useState<CostTemplateDetails[]>([]);
  const [prices, setPrices] = useState<InternalPriceBookItem[]>([]);
  const [norms, setNorms] = useState<InternalNorm[]>([]);
  const [estimates, setEstimates] = useState<EstimateScenario[]>([]);
  const [customerContracts, setCustomerContracts] = useState<CustomerContract[]>([]);
  const [subcontractorContracts, setSubcontractorContracts] = useState<SubcontractorContract[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedEstimateId, setSelectedEstimateId] = useState('');
  const [estimateDetail, setEstimateDetail] = useState<EstimateScenarioDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [versionFilter, setVersionFilter] = useState('all');
  const [builderStep, setBuilderStep] = useState<BuilderStep>(1);

  const [templateForm, setTemplateForm] = useState(emptyTemplate());
  const [sectionForm, setSectionForm] = useState(emptySection());
  const [itemForm, setItemForm] = useState(emptyItem());
  const [parameterForm, setParameterForm] = useState(emptyParameter());
  const [priceForm, setPriceForm] = useState(emptyPrice());
  const [normForm, setNormForm] = useState(emptyNorm());
  const [normWorkbenchTemplateId, setNormWorkbenchTemplateId] = useState('');
  const [normWorkbenchItemId, setNormWorkbenchItemId] = useState('');
  const [normWorkbenchQuery, setNormWorkbenchQuery] = useState('');
  const [normWorkbenchStatusFilter, setNormWorkbenchStatusFilter] = useState<CostTemplateNormalizationStatus | 'all'>('all');
  const [normWorkbenchLines, setNormWorkbenchLines] = useState<CostNormWorkbenchLine[]>([]);
  const [normWorkbenchAiWarnings, setNormWorkbenchAiWarnings] = useState<string[]>([]);
  const [loadingNormAi, setLoadingNormAi] = useState(false);
  const [normPackageTemplateId, setNormPackageTemplateId] = useState('');
  const [normPackageItemId, setNormPackageItemId] = useState('');
  const [normPackageForm, setNormPackageForm] = useState(defaultNormPackageForm());
  const [leftWidth, setLeftWidth] = useState(30); // Default layout: left pane takes 30%
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let percentage = ((e.clientX - rect.left) / rect.width) * 100;
      if (percentage < 15) percentage = 15;
      if (percentage > 50) percentage = 50;
      setLeftWidth(percentage);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging]);

  const [draftInput, setDraftInput] = useState<Record<string, unknown>>({});
  const [draftName, setDraftName] = useState('Phương án tiêu chuẩn');
  const [draftCustomer, setDraftCustomer] = useState('');
  const [draftMargin, setDraftMargin] = useState(0);
  const [lineEdits, setLineEdits] = useState<Record<string, { quantity: number; unitPrice: number; quoteUnitPrice: number; overrideReason: string }>>({});
  const [convertType, setConvertType] = useState<ContractItemType>('customer');
  const [convertContractId, setConvertContractId] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState<EstimateAiSuggestion | null>(null);
  const [aiSuggestionSource, setAiSuggestionSource] = useState<'remote' | 'local' | null>(null);
  const [loadingAiSuggestion, setLoadingAiSuggestion] = useState(false);
  const [finalizeOverrideReason, setFinalizeOverrideReason] = useState('');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<EstimateComparisonResult | null>(null);
  const [conversionPreview, setConversionPreview] = useState<EstimateConversionPreview | null>(null);
  const [conversionAudit, setConversionAudit] = useState<EstimateConversionAudit | null>(null);
  const [smbImportPreview, setSmbImportPreview] = useState<ProjectTemplateImportPreview | null>(null);
  const [loadingSmbPreview, setLoadingSmbPreview] = useState(false);
  const [normalizingTemplateId, setNormalizingTemplateId] = useState('');
  const [normalizationReport, setNormalizationReport] = useState<CostTemplateNormalizationReport | null>(null);
  const [selectedTemplateReadiness, setSelectedTemplateReadiness] = useState<CostTemplateReadinessReport | null>(null);
  const [priceReadiness, setPriceReadiness] = useState<CatalogReadinessReport | null>(null);
  const [normReadiness, setNormReadiness] = useState<CatalogReadinessReport | null>(null);
  const [normalizationItem, setNormalizationItem] = useState<CostTemplateItem | null>(null);
  const [normalizationForm, setNormalizationForm] = useState<NormalizationFormState>({
    status: 'raw',
    standardUnit: '',
    standardBaseQuantity: '',
    standardWorkCode: '',
    note: '',
    normalizedMaterials: [],
  });
  const [importPreview, setImportPreview] = useState<{
    kind: 'prices' | 'norms';
    file: File;
    result: CostImportValidationResult<InternalPriceBookImportPayload | InternalNormImportPayload>;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [templateRows, priceRows, normRows, estimateRows, customerRows, subcontractorRows] = await Promise.all([
        costTemplateService.list(true).catch(() => []),
        internalPriceBookService.list(true).catch(() => []),
        internalNormService.list(true).catch(() => []),
        estimateScenarioService.list().catch(() => []),
        customerContractService.list().catch(() => []),
        subcontractorContractService.list().catch(() => []),
      ]);
      setTemplates(templateRows);
      setPrices(priceRows);
      setNorms(normRows);
      setEstimates(estimateRows);
      setCustomerContracts(customerRows);
      setSubcontractorContracts(subcontractorRows);
      setPriceReadiness(await internalPriceBookService.getReadinessReport(priceRows));
      setNormReadiness(await internalNormService.getReadinessReport(normRows));
      const firstTemplate = selectedTemplateId || templateRows[0]?.id || '';
      setSelectedTemplateId(firstTemplate);
      setSectionForm(emptySection(firstTemplate));
      setItemForm(emptyItem(firstTemplate));
      setParameterForm(emptyParameter(firstTemplate));
      if (firstTemplate) {
        setSelectedTemplateReadiness(await costTemplateService.getReadinessReport(firstTemplate).catch(() => null));
      }
    } catch (error) {
      logApiError('cost-library.load', error);
      toast.error('Không thể tải dữ liệu dự toán', getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [selectedTemplateId, toast]);

  useEffect(() => { load(); }, [load]);

  const selectedTemplate = useMemo(
    () => templates.find(template => template.id === selectedTemplateId) || templates[0] || null,
    [selectedTemplateId, templates],
  );

  const normSourceTemplates = useMemo(
    () => templates.filter(template =>
      template.metadata?.sourceKind === 'project_wbs_material_raw_template'
      || template.code === costTemplateService.smbFactoryTemplateCode
      || template.items.some(item => getRawMaterials(item).length > 0 || getNormalizedMaterials(item).length > 0),
    ),
    [templates],
  );
  const selectedNormTemplate = useMemo(
    () => templates.find(template => template.id === normWorkbenchTemplateId)
      || normSourceTemplates[0]
      || selectedTemplate
      || null,
    [normSourceTemplates, normWorkbenchTemplateId, selectedTemplate, templates],
  );
  const normWorkbenchItems = useMemo(() => {
    const keyword = normWorkbenchQuery.trim().toLowerCase();
    return (selectedNormTemplate?.items || []).filter(item => {
      const status = getNormalizationStatus(item);
      const matchesStatus = normWorkbenchStatusFilter === 'all' || status === normWorkbenchStatusFilter;
      const matchesKeyword = !keyword || [
        item.code,
        item.name,
        item.workCode,
        String(getItemMetadata(item).sourceWbsCode || ''),
      ].some(value => (value || '').toLowerCase().includes(keyword));
      return matchesStatus && matchesKeyword;
    });
  }, [normWorkbenchQuery, normWorkbenchStatusFilter, selectedNormTemplate]);
  const selectedNormItem = useMemo(
    () => selectedNormTemplate?.items.find(item => item.id === normWorkbenchItemId)
      || normWorkbenchItems[0]
      || selectedNormTemplate?.items[0]
      || null,
    [normWorkbenchItemId, normWorkbenchItems, selectedNormTemplate],
  );
  const normPackageTemplates = useMemo(
    () => templates.filter(template => template.status !== 'archived' && template.metadata?.sourceKind !== 'project_wbs_material_raw_template'),
    [templates],
  );
  const selectedNormPackageTemplate = useMemo(
    () => templates.find(template => template.id === normPackageTemplateId)
      || normPackageTemplates[0]
      || selectedTemplate
      || null,
    [normPackageTemplateId, normPackageTemplates, selectedTemplate, templates],
  );
  const normPackageItems = useMemo(
    () => (selectedNormPackageTemplate?.items || [])
      .filter(item => isNormPackageItem(item, norms))
      .sort((a, b) => a.code.localeCompare(b.code, 'vi')),
    [norms, selectedNormPackageTemplate],
  );
  const selectedNormPackageItem = useMemo(
    () => selectedNormPackageTemplate?.items.find(item => item.id === normPackageItemId) || null,
    [normPackageItemId, selectedNormPackageTemplate],
  );
  const selectedNormPackageDrafts = useMemo(
    () => selectedNormPackageItem ? norms.filter(norm => norm.templateItemId === selectedNormPackageItem.id && norm.status === 'draft') : [],
    [norms, selectedNormPackageItem],
  );

  useEffect(() => {
    if (!normWorkbenchTemplateId && normSourceTemplates[0]) {
      setNormWorkbenchTemplateId(normSourceTemplates[0].id);
    }
  }, [normSourceTemplates, normWorkbenchTemplateId]);

  useEffect(() => {
    if (!selectedNormTemplate) return;
    if (!normWorkbenchItemId || !selectedNormTemplate.items.some(item => item.id === normWorkbenchItemId)) {
      setNormWorkbenchItemId(normWorkbenchItems[0]?.id || selectedNormTemplate.items[0]?.id || '');
    }
  }, [normWorkbenchItemId, normWorkbenchItems, selectedNormTemplate]);

  useEffect(() => {
    if (!selectedNormItem) {
      setNormWorkbenchLines([]);
      return;
    }
    if (!selectedNormPackageItem) {
      setNormWorkbenchLines([]);
      setNormWorkbenchAiWarnings([]);
      return;
    }
    setNormWorkbenchLines(costNormWorkbenchService.buildLinesForPackage(selectedNormItem, selectedNormPackageItem, norms, { includeReferenceFallback: false }));
    setNormWorkbenchAiWarnings([]);
  }, [norms, selectedNormItem, selectedNormPackageItem]);

  useEffect(() => {
    if (!normPackageTemplateId && (normPackageTemplates[0] || selectedTemplate)) {
      setNormPackageTemplateId((normPackageTemplates[0] || selectedTemplate)?.id || '');
    }
  }, [normPackageTemplateId, normPackageTemplates, selectedTemplate]);

  useEffect(() => {
    if (!selectedNormPackageTemplate) return;
    if (normPackageItemId && !selectedNormPackageTemplate.items.some(item => item.id === normPackageItemId)) {
      setNormPackageItemId('');
    }
  }, [normPackageItemId, selectedNormPackageTemplate]);

  useEffect(() => {
    if (selectedNormPackageItem) {
      setNormPackageForm({
        code: selectedNormPackageItem.code,
        name: selectedNormPackageItem.name,
        unit: selectedNormPackageItem.unit || '',
        baseQuantity: String(selectedNormPackageItem.baseQuantity || 1),
      });
      return;
    }
    setNormPackageForm(defaultNormPackageForm(selectedNormItem));
  }, [selectedNormItem, selectedNormPackageItem]);

  useEffect(() => {
    if (!selectedTemplate?.id) {
      setSelectedTemplateReadiness(null);
      return;
    }
    costTemplateService.getReadinessReport(selectedTemplate.id)
      .then(setSelectedTemplateReadiness)
      .catch(error => {
        logApiError('cost-library.selectedTemplateReadiness', error);
        setSelectedTemplateReadiness(null);
      });
  }, [selectedTemplate?.id]);

  const templateTypes = useMemo(() => Array.from(new Set(templates.map(row => row.projectType || '').filter(Boolean))).sort(), [templates]);
  const priceRegions = useMemo(() => Array.from(new Set([...prices.map(row => row.region), ...norms.map(row => row.region)].filter(Boolean))).sort(), [prices, norms]);

  const filteredTemplates = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return templates.filter(row => {
      const matchesKeyword = !keyword || [row.code, row.name, row.projectType, row.description].some(value => (value || '').toLowerCase().includes(keyword));
      const matchesStatus = statusFilter === 'all' || row.status === statusFilter;
      const matchesType = typeFilter === 'all' || row.projectType === typeFilter;
      const matchesVersion = versionFilter === 'all' || String(row.versionNo) === versionFilter;
      return matchesKeyword && matchesStatus && matchesType && matchesVersion;
    });
  }, [query, statusFilter, templates, typeFilter, versionFilter]);

  const filteredPrices = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return prices.filter(row => {
      const matchesKeyword = !keyword || [row.itemCode, row.itemName, row.category, row.spec, row.region].some(value => (value || '').toLowerCase().includes(keyword));
      const matchesStatus = statusFilter === 'all' || row.status === statusFilter;
      const matchesType = typeFilter === 'all' || row.itemType === typeFilter;
      const matchesRegion = regionFilter === 'all' || row.region === regionFilter;
      const matchesVersion = versionFilter === 'all' || String(row.versionNo) === versionFilter;
      return matchesKeyword && matchesStatus && matchesType && matchesRegion && matchesVersion;
    });
  }, [prices, query, regionFilter, statusFilter, typeFilter, versionFilter]);

  const filteredNorms = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return norms.filter(row => {
      const matchesKeyword = !keyword || [row.normCode, row.workCode, row.resourceCode, row.resourceName, row.region].some(value => (value || '').toLowerCase().includes(keyword));
      const matchesStatus = statusFilter === 'all' || row.status === statusFilter;
      const matchesType = typeFilter === 'all' || row.resourceType === typeFilter;
      const matchesRegion = regionFilter === 'all' || row.region === regionFilter;
      const matchesVersion = versionFilter === 'all' || String(row.versionNo) === versionFilter;
      return matchesKeyword && matchesStatus && matchesType && matchesRegion && matchesVersion;
    });
  }, [norms, query, regionFilter, statusFilter, typeFilter, versionFilter]);

  const filteredEstimates = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return estimates.filter(row => {
      const matchesKeyword = !keyword || [row.code, row.name, row.customerName, row.projectType].some(value => (value || '').toLowerCase().includes(keyword));
      const matchesStatus = statusFilter === 'all' || row.status === statusFilter;
      const matchesType = typeFilter === 'all' || row.projectType === typeFilter;
      return matchesKeyword && matchesStatus && matchesType;
    });
  }, [estimates, query, statusFilter, typeFilter]);

  const activeTemplates = useMemo(() => templates.filter(template => template.status === 'active'), [templates]);
  const convertContracts = convertType === 'customer' ? customerContracts : subcontractorContracts;
  const selectedConvertContract = convertContracts.find(contract => contract.id === convertContractId);

  const loadEstimateDetail = useCallback(async (id: string) => {
    setSelectedEstimateId(id);
    setConversionPreview(null);
    const detail = await estimateScenarioService.get(id);
    setEstimateDetail(detail);
    setConversionAudit(detail ? await estimateScenarioService.getConversionAudit(detail.id) : null);
    if (detail) {
      setLineEdits(Object.fromEntries(detail.items.map(item => [item.id, {
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        quoteUnitPrice: item.quoteUnitPrice ?? item.unitPrice,
        overrideReason: item.overrideReason || '',
      }])));
    }
  }, []);

  const runSave = async (title: string, action: () => Promise<void>) => {
    setSaving(true);
    try {
      await action();
      toast.success(title);
      await load();
    } catch (error) {
      logApiError('cost-library.save', error);
      toast.error('Không thể lưu dữ liệu', getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadPriceTemplate = async () => {
    const blob = await internalPriceBookService.createImportTemplate();
    downloadBlob(blob, 'mau-import-don-gia-noi-bo.xlsx');
  };

  const downloadNormTemplate = async () => {
    const blob = await internalNormService.createImportTemplate();
    downloadBlob(blob, 'mau-import-dinh-muc-noi-bo.xlsx');
  };

  const createFactoryTemplate = async () => {
    if (!canManage) return;
    await runSave('Đã tạo template nhà xưởng', async () => {
      const template = await costTemplateService.upsertTemplate({
        ...emptyTemplate(),
        code: `NHAXUONG_THEP_TIEN_CHE_${Date.now().toString().slice(-4)}`,
        status: 'active',
        createdBy: user.id,
        updatedBy: user.id,
      });
      const parameterRows = costTemplateService.defaultParameters.map(parameter => costTemplateService.upsertParameter({
        templateId: template.id,
        code: parameter.code,
        label: parameter.label,
        dataType: parameter.dataType,
        unit: parameter.unit,
        isRequired: parameter.isRequired,
        options: parameter.options || [],
        sortOrder: parameter.sortOrder,
      }));
      const sectionRows = await Promise.all(factorySections.map(section => costTemplateService.upsertSection({ templateId: template.id, ...section })));
      await Promise.all(parameterRows);
      const sectionByCode = new Map(sectionRows.map(section => [section.code, section]));
      await Promise.all([
        costTemplateService.upsertItem({
          templateId: template.id,
          sectionId: sectionByCode.get('A')?.id,
          code: 'A.01',
          name: 'Móng nhà xưởng',
          itemType: 'work',
          unit: 'm2',
          quantityFormula: 'floor_area',
          overheadPercent: 8,
          profitPercent: 10,
          riskBufferPercent: 5,
          workCode: 'FOUNDATION',
          sortOrder: 10,
        }),
        costTemplateService.upsertItem({
          templateId: template.id,
          sectionId: sectionByCode.get('C')?.id,
          code: 'C.01',
          name: 'Khung thép tiền chế',
          itemType: 'material',
          unit: 'kg',
          quantityFormula: 'floor_area * 35',
          defaultWastePercent: 3,
          overheadPercent: 8,
          profitPercent: 10,
          riskBufferPercent: 5,
          materialSku: 'STEEL_STRUCTURE',
          workCode: 'STEEL_FRAME',
          sortOrder: 30,
        }),
        costTemplateService.upsertItem({
          templateId: template.id,
          sectionId: sectionByCode.get('B')?.id,
          code: 'B.01',
          name: 'Nền bê tông nhà xưởng',
          itemType: 'work',
          unit: 'm2',
          quantityFormula: 'floor_area',
          overheadPercent: 8,
          profitPercent: 10,
          riskBufferPercent: 4,
          workCode: 'CONCRETE_FLOOR',
          sortOrder: 20,
        }),
        costTemplateService.upsertItem({
          templateId: template.id,
          sectionId: sectionByCode.get('D')?.id,
          code: 'D.01',
          name: 'Mái tôn',
          itemType: 'material',
          unit: 'm2',
          quantityFormula: 'floor_area * 1.16',
          defaultWastePercent: 2,
          overheadPercent: 8,
          profitPercent: 10,
          riskBufferPercent: 3,
          materialSku: 'ROOF_SHEET',
          workCode: 'ROOF',
          sortOrder: 40,
        }),
        costTemplateService.upsertItem({
          templateId: template.id,
          sectionId: sectionByCode.get('E')?.id,
          code: 'E.01',
          name: 'Vách bao che',
          itemType: 'material',
          unit: 'm2',
          quantityFormula: 'floor_area * 0.75',
          defaultWastePercent: 2,
          overheadPercent: 8,
          profitPercent: 10,
          riskBufferPercent: 3,
          materialSku: 'WALL_SHEET',
          workCode: 'WALL',
          sortOrder: 50,
        }),
        costTemplateService.upsertItem({
          templateId: template.id,
          sectionId: sectionByCode.get('F')?.id,
          code: 'F.01',
          name: 'MEP cơ bản',
          itemType: 'subcontract',
          unit: 'm2',
          quantityFormula: 'floor_area',
          overheadPercent: 8,
          profitPercent: 10,
          riskBufferPercent: 5,
          workCode: 'MEP',
          sortOrder: 60,
        }),
        costTemplateService.upsertItem({
          templateId: template.id,
          sectionId: sectionByCode.get('G')?.id,
          code: 'G.01',
          name: 'PCCC sơ bộ',
          itemType: 'subcontract',
          unit: 'm2',
          quantityFormula: 'floor_area',
          overheadPercent: 8,
          profitPercent: 10,
          riskBufferPercent: 6,
          workCode: 'FIRE_PROTECTION',
          sortOrder: 70,
        }),
      ]);
      setSelectedTemplateId(template.id);
    });
  };

  const previewSmbFactoryTemplate = async () => {
    if (!canManage) return;
    setLoadingSmbPreview(true);
    try {
      const preview = await costTemplateService.previewSmbFactoryTemplateImport();
      setSmbImportPreview(preview);
    } catch (error) {
      logApiError('cost-library.previewSmbFactoryTemplate', error);
      toast.error('Không thể preview dữ liệu Sơn Miền Bắc', getApiErrorMessage(error));
    } finally {
      setLoadingSmbPreview(false);
    }
  };

  const createSmbFactoryTemplate = async () => {
    if (!canManage || !smbImportPreview) return;
    const ok = await confirm({
      title: 'Tạo template nháp từ Sơn Miền Bắc?',
      targetName: `${smbImportPreview.templateCode} v${smbImportPreview.nextVersionNo}`,
      subtitle: 'Hệ thống chỉ tạo đầu mục và lưu vật tư thô trong metadata. Không tạo đơn giá nội bộ và không tự chuẩn hóa định mức.',
      actionLabel: 'Tạo template',
      intent: 'warning',
    });
    if (!ok) return;
    await runSave('Đã tạo template từ Sơn Miền Bắc', async () => {
      const template = await costTemplateService.createSmbFactoryTemplate(user.id);
      setSelectedTemplateId(template.id);
      setSmbImportPreview(null);
    });
  };

  const loadNormalizationReport = useCallback(async (templateId: string) => {
    if (!templateId) return;
    try {
      const report = await costTemplateService.getNormalizationReport(templateId);
      setNormalizationReport(report);
    } catch (error) {
      logApiError('cost-library.normalizationReport', error);
      toast.error('Không thể tải báo cáo chuẩn hóa', getApiErrorMessage(error));
    }
  }, [toast]);

  const openTemplateNormalization = async (template: CostTemplateDetails) => {
    setNormalizingTemplateId(template.id);
    await loadNormalizationReport(template.id);
  };

  const openItemNormalization = (item: CostTemplateItem) => {
    const metadata = getItemMetadata(item);
    const rawMaterials = getRawMaterials(item);
    const normalizedMaterials = getNormalizedMaterials(item);
    setNormalizationItem(item);
    setNormalizationForm({
      status: getNormalizationStatus(item),
      standardUnit: String(metadata.standardUnit || item.unit || ''),
      standardBaseQuantity: String(metadata.standardBaseQuantity ?? item.baseQuantity ?? ''),
      standardWorkCode: String(metadata.standardWorkCode || item.workCode || item.code || ''),
      note: String(metadata.normalizationNote || ''),
      normalizedMaterials: normalizedMaterials.length > 0 ? normalizedMaterials : rawMaterials.map(rawToNormalizedMaterial),
    });
  };

  const saveItemNormalization = async () => {
    if (!canManage || !normalizationItem) return;
    await runSave('Đã lưu chuẩn hóa hạng mục', async () => {
      await costTemplateService.updateItemNormalization(normalizationItem.id, {
        status: normalizationForm.status,
        standardUnit: normalizationForm.standardUnit.trim(),
        standardBaseQuantity: normalizationForm.standardBaseQuantity === '' ? null : Number(normalizationForm.standardBaseQuantity),
        standardWorkCode: normalizationForm.standardWorkCode.trim(),
        note: normalizationForm.note.trim(),
        actorId: user.id,
      });
      await costTemplateService.updateItemRawMaterials(normalizationItem.id, normalizationForm.normalizedMaterials, user.id);
      setNormalizationItem(null);
    });
    if (normalizingTemplateId) await loadNormalizationReport(normalizingTemplateId);
  };

  const createDraftNormsFromTemplate = async (template: CostTemplateDetails) => {
    if (!canManage) return;
    const ok = await confirm({
      title: 'Tạo định mức nháp từ template?',
      targetName: template.name,
      subtitle: 'Chỉ sinh draft từ các hạng mục đã chuẩn hóa và vật tư chuẩn. Không tạo đơn giá nội bộ, không kích hoạt định mức.',
      actionLabel: 'Tạo định mức nháp',
      intent: 'warning',
    });
    if (!ok) return;
    await runSave('Đã tạo định mức nháp', async () => {
      const result = await costTemplateService.createDraftNormsFromTemplate(template.id, user.id);
      toast.info('Kết quả tạo định mức', `Tạo mới ${result.created} dòng, bỏ qua ${result.skipped} dòng.`);
    });
  };

  const saveTemplate = async () => {
    if (!canManage) return;
    await runSave('Đã lưu template', async () => {
      const saved = await costTemplateService.upsertTemplate({ ...templateForm, createdBy: user.id, updatedBy: user.id });
      setSelectedTemplateId(saved.id);
      setTemplateForm(emptyTemplate());
    });
  };

  const saveSection = async () => {
    if (!canManage || !selectedTemplate) return;
    await runSave('Đã lưu nhóm hạng mục', async () => {
      await costTemplateService.upsertSection({ ...sectionForm, templateId: selectedTemplate.id });
      setSectionForm(emptySection(selectedTemplate.id));
    });
  };

  const saveParameter = async () => {
    if (!canManage || !selectedTemplate) return;
    await runSave('Đã lưu tham số', async () => {
      await costTemplateService.upsertParameter({ ...parameterForm, templateId: selectedTemplate.id });
      setParameterForm(emptyParameter(selectedTemplate.id));
    });
  };

  const saveItem = async () => {
    if (!canManage || !selectedTemplate) return;
    await runSave('Đã lưu hạng mục template', async () => {
      await costTemplateService.upsertItem({ ...itemForm, templateId: selectedTemplate.id });
      setItemForm(emptyItem(selectedTemplate.id));
    });
  };

  const savePrice = async () => {
    if (!canManage) return;
    await runSave('Đã lưu đơn giá', async () => {
      await internalPriceBookService.upsert({ ...priceForm, createdBy: user.id, updatedBy: user.id });
      setPriceForm(emptyPrice());
    });
  };

  const saveNorm = async () => {
    if (!canManage) return;
    await runSave('Đã lưu định mức', async () => {
      await internalNormService.upsert({ ...normForm, createdBy: user.id, updatedBy: user.id });
      setNormForm(emptyNorm());
    });
  };

  const createTemplateVersion = async (template: CostTemplateDetails) => {
    if (!canManage) return;
    await runSave('Đã tạo version template mới', async () => {
      const next = await costTemplateService.createVersion(template, user.id);
      setSelectedTemplateId(next.id);
    });
  };

  const changeTemplateStatus = async (template: CostTemplateDetails, action: 'activate' | 'archive') => {
    if (!canManage) return;
    await runSave(action === 'activate' ? 'Đã kích hoạt template' : 'Đã lưu trữ template', async () => {
      if (action === 'activate') await costTemplateService.activate(template, user.id);
      else await costTemplateService.archive(template, user.id);
    });
  };

  const changePriceStatus = async (row: InternalPriceBookItem, action: 'version' | 'activate' | 'archive') => {
    if (!canManage) return;
    await runSave(action === 'version' ? 'Đã tạo version đơn giá' : action === 'activate' ? 'Đã kích hoạt đơn giá' : 'Đã lưu trữ đơn giá', async () => {
      if (action === 'version') await internalPriceBookService.createVersion(row, user.id);
      if (action === 'activate') await internalPriceBookService.activate(row, user.id);
      if (action === 'archive') await internalPriceBookService.archive(row, user.id);
    });
  };

  const changeNormStatus = async (row: InternalNorm, action: 'version' | 'activate' | 'archive') => {
    if (!canManage) return;
    await runSave(action === 'version' ? 'Đã tạo version định mức' : action === 'activate' ? 'Đã kích hoạt định mức' : 'Đã lưu trữ định mức', async () => {
      if (action === 'version') await internalNormService.createVersion(row, user.id);
      if (action === 'activate') await internalNormService.activate(row, user.id);
      if (action === 'archive') await internalNormService.archive(row, user.id);
    });
  };

  const bulkActivatePrices = async () => {
    if (!canManage) return;
    const rows = filteredPrices.filter(row => row.status !== 'active');
    if (rows.length === 0) {
      toast.info('Không có đơn giá cần kích hoạt');
      return;
    }
    await runSave('Đã xử lý kích hoạt đơn giá', async () => {
      const result = await internalPriceBookService.bulkActivate(rows, user.id);
      toast.info('Kết quả kích hoạt đơn giá', `Active ${result.activated} dòng, skip ${result.skipped} dòng.`);
      if (result.blockers.length > 0) toast.warning('Một số dòng bị skip', result.blockers.slice(0, 3).join(' • '));
    });
  };

  const bulkActivateNorms = async () => {
    if (!canManage) return;
    const rows = filteredNorms.filter(row => row.status !== 'active');
    if (rows.length === 0) {
      toast.info('Không có định mức cần kích hoạt');
      return;
    }
    await runSave('Đã xử lý kích hoạt định mức', async () => {
      const result = await internalNormService.bulkActivate(rows, user.id);
      toast.info('Kết quả kích hoạt định mức', `Active ${result.activated} dòng, skip ${result.skipped} dòng.`);
      if (result.blockers.length > 0) toast.warning('Một số dòng bị skip', result.blockers.slice(0, 3).join(' • '));
    });
  };

  const setNormWorkbenchLine = (id: string, patch: Partial<CostNormWorkbenchLine>) => {
    setNormWorkbenchLines(prev => prev.map(line => line.id === id ? { ...line, ...patch } : line));
  };

  const saveNormPackageItem = async () => {
    if (!canManage || !selectedNormItem || !selectedNormPackageTemplate) return;
    const code = normalizePackageCode(normPackageForm.code || normPackageForm.name);
    const name = normPackageForm.name.trim();
    if (!code || !name) {
      toast.warning('Thiếu mã hoặc tên gói định mức', 'Ví dụ mã LAT_SAN, tên LÁT SÀN.');
      return;
    }
    const unit = normPackageForm.unit.trim() || String(getItemMetadata(selectedNormItem).standardUnit || selectedNormItem.unit || '');
    const baseQuantity = num(normPackageForm.baseQuantity) > 0 ? num(normPackageForm.baseQuantity) : 1;
    await runSave(selectedNormPackageItem ? 'Đã cập nhật gói định mức' : 'Đã tạo gói định mức', async () => {
      const metadata = selectedNormPackageItem ? getItemMetadata(selectedNormPackageItem) : {};
      const referenceMetadata = getItemMetadata(selectedNormItem);
      const saved = await costTemplateService.upsertItem({
        id: selectedNormPackageItem?.id,
        templateId: selectedNormPackageTemplate.id,
        sectionId: selectedNormPackageItem?.sectionId || null,
        code,
        name,
        itemType: 'work',
        unit,
        quantityFormula: selectedNormPackageItem?.quantityFormula || '',
        baseQuantity,
        defaultWastePercent: selectedNormPackageItem?.defaultWastePercent ?? 0,
        laborRate: selectedNormPackageItem?.laborRate ?? 0,
        machineRate: selectedNormPackageItem?.machineRate ?? 0,
        overheadPercent: selectedNormPackageItem?.overheadPercent ?? 0,
        profitPercent: selectedNormPackageItem?.profitPercent ?? 0,
        riskBufferPercent: selectedNormPackageItem?.riskBufferPercent ?? 0,
        costCategory: 'norm_package',
        workCode: code,
        materialSku: selectedNormPackageItem?.materialSku || '',
        normGroupCode: code,
        sortOrder: selectedNormPackageItem?.sortOrder ?? (selectedNormPackageTemplate.items.length + 1) * 10,
        assumptions: selectedNormPackageItem?.assumptions || ['Gói định mức chuẩn được tạo từ workbench định mức.'],
        metadata: {
          ...metadata,
          sourceKind: 'internal_norm_package',
          referenceSourceTemplateId: selectedNormItem.templateId,
          referenceSourceItemId: selectedNormItem.id,
          referenceSourceWbsCode: String(referenceMetadata.sourceWbsCode || selectedNormItem.code || ''),
          referenceSourceName: selectedNormItem.name,
          createdFrom: metadata.createdFrom || 'cost_norm_workbench',
          updatedFrom: 'cost_norm_workbench',
        },
      });
      setNormPackageTemplateId(saved.templateId);
      setNormPackageItemId(saved.id);
      setNormPackageForm({ code: saved.code, name: saved.name, unit: saved.unit || '', baseQuantity: String(saved.baseQuantity || 1) });
      await load();
    });
  };

  const addNormWorkbenchLine = () => {
    if (!selectedNormPackageItem) {
      toast.warning('Chưa có gói định mức đích', 'Hãy tạo hoặc chọn gói như LÁT SÀN trước.');
      return;
    }
    setNormWorkbenchLines(prev => [...prev, costNormWorkbenchService.buildEmptyLine(selectedNormPackageItem, prev.length)]);
  };

  const removeNormWorkbenchLine = (id: string) => {
    setNormWorkbenchLines(prev => prev.filter(line => line.id !== id));
  };

  const isReferenceMaterialSelected = (material: RawTemplateMaterialSnapshot, index: number) => {
    if (!selectedNormItem) return false;
    const fallbackId = `${selectedNormItem.id}-raw-${index}`;
    return normWorkbenchLines.some(line =>
      (material.sourceMaterialBudgetItemId && line.sourceMaterialBudgetItemId === material.sourceMaterialBudgetItemId)
      || line.id === fallbackId
      || (!material.sourceMaterialBudgetItemId && line.resourceName === material.itemName && line.rawQuantity === num(material.budgetQty)),
    );
  };

  const toggleReferenceMaterial = (material: RawTemplateMaterialSnapshot, index: number, checked: boolean) => {
    if (!selectedNormItem || !selectedNormPackageItem) {
      toast.warning('Chưa có gói định mức đích', 'Hãy tạo hoặc chọn gói trước khi tích vật tư tham chiếu.');
      return;
    }
    const fallbackId = `${selectedNormItem.id}-raw-${index}`;
    setNormWorkbenchLines(prev => {
      const exists = prev.some(line =>
        (material.sourceMaterialBudgetItemId && line.sourceMaterialBudgetItemId === material.sourceMaterialBudgetItemId)
        || line.id === fallbackId
        || (!material.sourceMaterialBudgetItemId && line.resourceName === material.itemName && line.rawQuantity === num(material.budgetQty)),
      );
      if (checked) {
        if (exists) return prev;
        return [...prev, costNormWorkbenchService.buildLineFromRawMaterial(selectedNormItem, selectedNormPackageItem, material, prev.length)];
      }
      return prev.filter(line =>
        !(
          (material.sourceMaterialBudgetItemId && line.sourceMaterialBudgetItemId === material.sourceMaterialBudgetItemId)
          || line.id === fallbackId
          || (!material.sourceMaterialBudgetItemId && line.resourceName === material.itemName && line.rawQuantity === num(material.budgetQty))
        ),
      );
    });
  };

  const runNormAiSuggestion = async () => {
    if (!selectedNormItem || !selectedNormPackageItem) {
      toast.warning('Chưa có gói định mức đích', 'AI sẽ gợi ý vào gói như LÁT SÀN, không lưu vào hạng mục tham chiếu.');
      return;
    }
    setLoadingNormAi(true);
    try {
      const result = await costNormStandardizationAiService.suggestRemote({
        referenceItem: selectedNormItem,
        targetItem: selectedNormPackageItem,
        currentLines: normWorkbenchLines,
        priceBookSamples: prices,
      });
      setNormWorkbenchLines(result.suggestions);
      setNormWorkbenchAiWarnings(result.warnings);
      toast.success('AI đã gợi ý định mức draft', `Confidence ${Math.round(result.confidenceScore * 100)}%.`);
    } catch (error) {
      logApiError('cost-library.normAiSuggestion', error);
      const fallback = costNormStandardizationAiService.suggestLocal({
        referenceItem: selectedNormItem,
        targetItem: selectedNormPackageItem,
        currentLines: normWorkbenchLines,
        priceBookSamples: prices,
      });
      setNormWorkbenchLines(fallback.suggestions);
      setNormWorkbenchAiWarnings(fallback.warnings);
      toast.warning('Đang dùng gợi ý local', getApiErrorMessage(error));
    } finally {
      setLoadingNormAi(false);
    }
  };

  const saveNormWorkbenchDraft = async (markNormalized = false) => {
    if (!canManage || !selectedNormItem || !selectedNormPackageItem) {
      toast.warning('Chưa có gói định mức đích', 'Hãy tạo hoặc chọn gói như LÁT SÀN trước khi lưu draft.');
      return;
    }
    const validRows = normWorkbenchLines.filter(line => line.resourceName.trim() && line.unit.trim() && num(line.normQuantity) > 0);
    if (validRows.length === 0) {
      toast.warning('Chưa có dòng định mức hợp lệ', 'Cần tên nguồn lực, đơn vị và định mức lớn hơn 0.');
      return;
    }
    await runSave(markNormalized ? 'Đã lưu và đánh dấu chuẩn hóa' : 'Đã lưu định mức draft', async () => {
      const result = await costNormWorkbenchService.saveDraft({
        targetItemId: selectedNormPackageItem.id,
        referenceItemId: selectedNormItem.id,
        lines: normWorkbenchLines,
        markNormalized,
        actorId: user.id,
      });
      toast.info('Kết quả workbench', `Lưu ${result.savedNorms.length} dòng draft, archive ${result.archivedDrafts} draft bị xoá.`);
      if (normalizingTemplateId) await loadNormalizationReport(normalizingTemplateId);
    });
  };

  const activateSelectedNormDrafts = async () => {
    if (!canManage || !selectedNormPackageItem) return;
    if (selectedNormPackageDrafts.length === 0) {
      toast.info('Chưa có draft để kích hoạt', 'Hãy lưu draft trước khi activate.');
      return;
    }
    const ok = await confirm({
      title: 'Kích hoạt định mức draft của gói?',
      targetName: selectedNormPackageItem.name,
      subtitle: 'Các active norm cũ cùng mã/khu vực sẽ được archive theo logic version hiện có.',
      actionLabel: 'Kích hoạt',
      intent: 'warning',
    });
    if (!ok) return;
    await runSave('Đã kích hoạt định mức của gói', async () => {
      const result = await internalNormService.bulkActivate(selectedNormPackageDrafts, user.id);
      toast.info('Kết quả kích hoạt', `Active ${result.activated} dòng, skip ${result.skipped} dòng.`);
      if (result.blockers.length > 0) toast.warning('Một số dòng bị skip', result.blockers.slice(0, 3).join(' • '));
    });
  };

  const importPrices = async (file?: File | null) => {
    if (!canManage || !file) return;
    try {
      const result = await internalPriceBookService.validateImport(file, user.id);
      setImportPreview({ kind: 'prices', file, result });
      if (result.hasErrors) {
        toast.warning('File đơn giá còn lỗi', `${result.invalidRows} dòng cần sửa trước khi import.`);
      } else {
        toast.info('Preview đơn giá', `${result.validRows} dòng hợp lệ, ${result.issues.filter(issue => issue.level === 'warning').length} cảnh báo.`);
      }
    } catch (error) {
      toast.error('Không thể đọc file đơn giá', getApiErrorMessage(error));
    }
  };

  const importNorms = async (file?: File | null) => {
    if (!canManage || !file) return;
    try {
      const result = await internalNormService.validateImport(file, user.id);
      setImportPreview({ kind: 'norms', file, result });
      if (result.hasErrors) {
        toast.warning('File định mức còn lỗi', `${result.invalidRows} dòng cần sửa trước khi import.`);
      } else {
        toast.info('Preview định mức', `${result.validRows} dòng hợp lệ, ${result.issues.filter(issue => issue.level === 'warning').length} cảnh báo.`);
      }
    } catch (error) {
      toast.error('Không thể đọc file định mức', getApiErrorMessage(error));
    }
  };

  const confirmImportPreview = async () => {
    if (!importPreview || importPreview.result.hasErrors) return;
    const { kind, file } = importPreview;
    await runSave(kind === 'prices' ? 'Đã import đơn giá từ Excel' : 'Đã import định mức từ Excel', async () => {
      const count = kind === 'prices'
        ? await internalPriceBookService.importFromExcel(file, user.id)
        : await internalNormService.importFromExcel(file, user.id);
      toast.info(kind === 'prices' ? 'Import đơn giá' : 'Import định mức', `Đã ghi ${count} dòng hợp lệ.`);
      setImportPreview(null);
    });
  };

  const runAiSuggestion = async () => {
    if (!aiPrompt.trim()) {
      toast.warning('Thiếu mô tả', 'Nhập mô tả công trình để AI gợi ý tham số.');
      return;
    }
    setLoadingAiSuggestion(true);
    try {
      const suggestion = await estimateAiSuggestionService.suggestInputsRemote({
        prompt: aiPrompt,
        templates,
        currentInput: draftInput,
        selectedTemplateId,
        canSeeInternalCost,
      });
      setAiSuggestion(suggestion);
      setAiSuggestionSource('remote');
      if (suggestion.templateId) setSelectedTemplateId(suggestion.templateId);
      toast.success('AI remote đã gợi ý form', `Confidence ${Math.round(suggestion.confidenceScore * 100)}%.`);
    } catch (error) {
      logApiError('cost-library.aiSuggestionRemote', error);
      const suggestion = estimateAiSuggestionService.suggestInputs({
        prompt: aiPrompt,
        templates,
        currentInput: draftInput,
        selectedTemplateId,
        canSeeInternalCost,
      });
      setAiSuggestion(suggestion);
      setAiSuggestionSource('local');
      if (suggestion.templateId) setSelectedTemplateId(suggestion.templateId);
      toast.warning('Đang dùng gợi ý offline', getApiErrorMessage(error));
    } finally {
      setLoadingAiSuggestion(false);
    }
  };

  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    setDraftInput(aiSuggestion.suggestedInputs);
    if (aiSuggestion.templateId) setSelectedTemplateId(aiSuggestion.templateId);
    toast.success('Đã áp dụng gợi ý vào form');
  };

  const createDraft = async () => {
    const templateId = selectedTemplate?.id || '';
    if (!templateId || !canCreateEstimate) return;
    await runSave('Đã tạo dự toán nháp', async () => {
      const draft = await estimateScenarioService.createDraft({
        templateId,
        name: draftName,
        customerName: draftCustomer,
        inputParameters: draftInput,
        marginPercent: draftMargin,
        createdBy: user.id,
      });
      await loadEstimateDetail(draft.id);
      setActiveTab('estimates');
    });
  };

  const saveLineOverride = async (item: EstimateItem) => {
    const draft = lineEdits[item.id];
    if (!draft?.overrideReason.trim()) {
      toast.warning('Thiếu lý do chỉnh tay', 'Vui lòng nhập lý do để lưu thay đổi dòng dự toán.');
      return;
    }
    await runSave('Đã cập nhật dòng dự toán', async () => {
      await estimateScenarioService.updateItemOverride(item, { ...draft, actorId: user.id, actorName: user.name || user.username });
      await loadEstimateDetail(item.estimateId);
    });
  };

  const updateEstimateStatus = async (status: EstimateScenario['status']) => {
    if (!estimateDetail) return;
    await runSave(`Đã cập nhật trạng thái ${statusLabel[status] || status}`, async () => {
      await estimateScenarioService.updateStatus(
        estimateDetail,
        status,
        user.id,
        undefined,
        {
          actorCanOverride: canManage,
          allowMissingPriceOverride: Boolean(finalizeOverrideReason.trim()),
          missingPriceOverrideReason: finalizeOverrideReason,
        },
      );
      setFinalizeOverrideReason('');
      await loadEstimateDetail(estimateDetail.id);
    });
  };

  const exportQuote = async (mode: EstimateExportMode) => {
    if (!estimateDetail) return;
    const blob = await estimateScenarioService.exportExcel(estimateDetail, mode, canSeeInternalCost);
    const customer = (estimateDetail.customerName || 'khach-hang').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    downloadBlob(blob, `${estimateDetail.code || estimateDetail.id}-${customer}-${mode === 'internal' ? 'noi-bo' : 'bao-gia'}.xlsx`);
  };

  const runCompare = async () => {
    if (compareIds.length < 2) {
      toast.warning('Chọn ít nhất 2 phương án', 'Có thể so sánh tối đa 3 phương án.');
      return;
    }
    const result = await estimateScenarioService.compare(compareIds);
    setCompareResult(result);
  };

  const previewConvert = () => {
    if (!estimateDetail || !selectedConvertContract) return;
    try {
      setConversionPreview(estimateScenarioService.previewConversion({
        estimate: estimateDetail,
        contractId: selectedConvertContract.id,
        contractType: convertType,
        projectId: selectedConvertContract.projectId || null,
        constructionSiteId: selectedConvertContract.constructionSiteId || null,
        actorId: user.id,
      }));
    } catch (error) {
      toast.error('Không thể preview chuyển đổi', getApiErrorMessage(error));
    }
  };

  const convertEstimate = async () => {
    if (!estimateDetail || !selectedConvertContract) return;
    const ok = await confirm({
      title: 'Tạo bản nháp vận hành từ estimate?',
      targetName: estimateDetail.name,
      subtitle: 'Hệ thống sẽ tạo BOQ hợp đồng, Work BOQ và Material Plan từ preview đã kiểm tra.',
      actionLabel: 'Tạo nháp',
      intent: 'warning',
    });
    if (!ok) return;
    await runSave('Đã chuyển dự toán sang dữ liệu dự án', async () => {
      await estimateScenarioService.convertToProjectDraft({
        estimate: estimateDetail,
        contractId: selectedConvertContract.id,
        contractType: convertType,
        projectId: selectedConvertContract.projectId || null,
        constructionSiteId: selectedConvertContract.constructionSiteId || null,
        actorId: user.id,
      });
      await loadEstimateDetail(estimateDetail.id);
    });
  };

  const rollbackConversion = async () => {
    if (!estimateDetail) return;
    const ok = await confirm({
      title: 'Rollback dữ liệu đã chuyển đổi?',
      targetName: estimateDetail.name,
      subtitle: 'Chỉ rollback được khi BOQ/Material Plan chưa phát sinh nhật ký, nghiệm thu, thanh toán, đề xuất vật tư hoặc xuất kho.',
      actionLabel: 'Rollback',
      intent: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    try {
      const result = await estimateScenarioService.rollbackConversionBatch(estimateDetail, user.id);
      if (result.blockedReasons.length > 0) {
        toast.warning('Rollback bị chặn', result.blockedReasons.slice(0, 3).join(' • '));
        return;
      }
      toast.success('Đã rollback conversion', `Đã xoá ${result.deletedTargets} dòng nháp từ batch ${result.batchId}.`);
      await loadEstimateDetail(estimateDetail.id);
      await load();
    } catch (error) {
      logApiError('cost-library.rollbackConversion', error);
      toast.error('Không thể rollback chuyển đổi', getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const deleteChild = async (table: 'sections' | 'items' | 'parameters', id: string, name: string) => {
    if (!canManage) return;
    const ok = await confirm({ title: 'Xoá dữ liệu?', targetName: name, actionLabel: 'Xoá', intent: 'danger' });
    if (!ok) return;
    await runSave('Đã xoá dữ liệu', async () => costTemplateService.removeChild(table, id));
  };

  const deletePrice = async (row: InternalPriceBookItem) => {
    if (!canManage) return;
    const ok = await confirm({ title: 'Xoá đơn giá?', targetName: row.itemName, actionLabel: 'Xoá', intent: 'danger' });
    if (!ok) return;
    await runSave('Đã xoá đơn giá', async () => internalPriceBookService.remove(row.id));
  };

  const deleteNorm = async (row: InternalNorm) => {
    if (!canManage) return;
    const ok = await confirm({ title: 'Xoá định mức?', targetName: row.resourceName, actionLabel: 'Xoá', intent: 'danger' });
    if (!ok) return;
    await runSave('Đã xoá định mức', async () => internalNormService.remove(row.id));
  };

  const renderSearch = () => (
    <div className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-200 bg-white p-2 dark:bg-slate-900 dark:border-slate-800 md:grid-cols-[minmax(0,1fr)_130px_150px_130px_110px]">
      <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
        <Search size={15} className="text-slate-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Tìm kiếm..."
          className="w-full bg-transparent outline-none text-sm text-slate-700 dark:text-slate-200"
        />
      </div>
      <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold">
        <option value="all">Mọi trạng thái</option>
        {['draft', 'active', 'archived', 'reviewed', 'finalized', 'converted', 'cancelled'].map(status => <option key={status} value={status}>{statusLabel[status]}</option>)}
      </select>
      <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold">
        <option value="all">Mọi loại</option>
        {[...templateTypes, 'material', 'labor', 'machine', 'subcontract', 'overhead', 'other'].filter((value, index, arr) => value && arr.indexOf(value) === index).map(type => <option key={type} value={type}>{type}</option>)}
      </select>
      <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold">
        <option value="all">Mọi khu vực</option>
        {priceRegions.map(region => <option key={region} value={region}>{region}</option>)}
      </select>
      <input value={versionFilter} onChange={e => setVersionFilter(e.target.value || 'all')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold" placeholder="version" />
    </div>
  );

  const renderImportPreview = () => {
    if (!importPreview) return null;
    const { result, kind, file } = importPreview;
    const warnings = result.issues.filter(issue => issue.level === 'warning').length;
    const title = kind === 'prices' ? 'Preview import đơn giá' : 'Preview import định mức';
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-800 dark:text-white">{title}</h2>
              <p className="text-xs font-bold text-slate-400">{file.name}</p>
            </div>
            <button onClick={() => setImportPreview(null)} className={BTN_MINI}><X size={14} /></button>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
            <Metric label="Tổng dòng" value={result.totalRows} />
            <Metric label="Hợp lệ" value={result.validRows} />
            <Metric label="Tạo mới" value={result.createRows} />
            <Metric label="Cập nhật" value={result.updateRows} />
            <Metric label="Dòng lỗi" value={result.invalidRows} />
            <Metric label="Trùng file" value={result.duplicateRows} />
            <Metric label="Quá cũ" value={result.staleRows} />
            <Metric label="Cảnh báo" value={warnings} />
          </div>
          <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-indigo-50/80 border-b border-indigo-100/80 dark:bg-slate-800 dark:border-slate-700 text-xs font-black text-indigo-950 dark:text-slate-200 uppercase whitespace-nowrap">
                <tr>
                  {['Dòng', 'Mức', 'Trường', 'Nội dung'].map(header => <th key={header} className="px-4 py-3 text-left font-black tracking-wider whitespace-nowrap">{header}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.issues.slice(0, 80).map((issue, index) => (
                  <tr key={`${issue.rowNumber}-${issue.field}-${index}`}>
                    <td className={TD}>{issue.rowNumber}</td>
                    <td className={`${TD} font-black ${issue.level === 'error' ? 'text-red-600' : 'text-amber-600'}`}>{issue.level === 'error' ? 'Lỗi' : 'Cảnh báo'}</td>
                    <td className={`${TD} font-mono`}>{issue.field}</td>
                    <td className={TD}>{issue.message}</td>
                  </tr>
                ))}
                {result.issues.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-xs font-bold text-emerald-600">Không có lỗi hoặc cảnh báo.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setImportPreview(null)} className={BTN_SOFT}>Đóng</button>
            <button onClick={confirmImportPreview} disabled={saving || result.hasErrors} className={BTN_PRIMARY}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Ghi {result.createRows} mới / {result.updateRows} cập nhật
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSmbImportPreview = () => {
    if (!smbImportPreview) return null;
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-5xl rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-800 dark:text-white">Preview template Sơn Miền Bắc</h2>
              <p className="text-xs font-bold text-slate-400">
                {smbImportPreview.templateCode} v{smbImportPreview.nextVersionNo} • source {smbImportPreview.sourceProjectId}
              </p>
            </div>
            <button onClick={() => setSmbImportPreview(null)} className={BTN_MINI}><X size={14} /></button>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
            <Metric label="WBS cha" value={smbImportPreview.sectionCount} />
            <Metric label="Item tạo" value={smbImportPreview.itemCount} />
            <Metric label="Task source" value={smbImportPreview.sourceTaskCount} />
            <Metric label="Work BOQ" value={`${smbImportPreview.linkedWorkBoqCount}/${smbImportPreview.workBoqCount}`} />
            <Metric label="Vật tư raw" value={smbImportPreview.rawMaterialCount} />
            <Metric label="Nhóm VT" value={smbImportPreview.materialCategoryCount} />
            <Metric label="Thiếu đơn vị" value={smbImportPreview.missingTaskUnitCount} />
            <Metric label="Thiếu KL" value={smbImportPreview.missingWorkBoqQuantityCount} />
            <Metric label="Root placeholder" value={smbImportPreview.rootPlaceholderItemCount} />
            <Metric label="Version cũ" value={smbImportPreview.existingVersionCount} />
          </div>

          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">
            <AlertTriangle size={14} className="inline mr-1" />
            Dữ liệu này chỉ tạo template nháp. Giá, công thức, định mức và các dòng thiếu đơn vị/khối lượng cần được chuẩn hóa thủ công sau.
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-indigo-50/80 border-b border-indigo-100/80 dark:bg-slate-800 dark:border-slate-700 text-xs font-black text-indigo-950 dark:text-slate-200 uppercase whitespace-nowrap">
                  <tr>
                    {['WBS cha', 'Tên nhóm', 'Task', 'VT raw'].map(header => <th key={header} className="px-4 py-3 text-left font-black tracking-wider whitespace-nowrap">{header}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {smbImportPreview.sampleSections.map(section => (
                    <tr key={section.code}>
                      <td className={`${TD} font-mono`}>{section.code}</td>
                      <td className={`${TD} font-bold`}>{section.name}</td>
                      <td className={TD}>{section.taskCount}</td>
                      <td className={TD}>{section.materialCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-indigo-50/80 border-b border-indigo-100/80 dark:bg-slate-800 dark:border-slate-700 text-xs font-black text-indigo-950 dark:text-slate-200 uppercase whitespace-nowrap">
                  <tr>
                    {['WBS con', 'Hạng mục', 'ĐVT', 'KL', 'VT raw'].map(header => <th key={header} className="px-4 py-3 text-left font-black tracking-wider whitespace-nowrap">{header}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {smbImportPreview.sampleItems.map(item => (
                    <tr key={item.code}>
                      <td className={`${TD} font-mono`}>{item.code}</td>
                      <td className={`${TD} font-bold`}>{item.name}</td>
                      <td className={TD}>{item.unit || '-'}</td>
                      <td className={TD}>{item.baseQuantity ?? '-'}</td>
                      <td className={TD}>{item.rawMaterialCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setSmbImportPreview(null)} className={BTN_SOFT}>Đóng</button>
            <button onClick={createSmbFactoryTemplate} disabled={saving} className={BTN_PRIMARY}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Tạo template nháp
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderPermissionNotice = () => !canManage && (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
      <LockKeyhole size={15} className="mt-0.5 shrink-0" />
      <span>Đơn giá nội bộ và định mức chỉ cho phép Admin hoặc quản trị module HD chỉnh sửa.</span>
    </div>
  );

  const renderReadinessPanel = () => {
    const blockers = [
      ...(selectedTemplateReadiness?.blockers || []),
      ...(priceReadiness?.blockers || []),
      ...(normReadiness?.blockers || []),
    ];
    const warnings = [
      ...(selectedTemplateReadiness?.warnings || []),
      ...(priceReadiness?.warnings || []),
      ...(normReadiness?.warnings || []),
    ];
    if (!selectedTemplateReadiness && !priceReadiness && !normReadiness) return null;
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-black text-slate-800 dark:text-white">Dữ liệu còn thiếu để dùng thật</h2>
            <p className="text-xs font-bold text-slate-400">Gate production cho template, định mức, đơn giá và estimate builder.</p>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-[10px] font-black ${selectedTemplateReadiness?.canEstimate ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}>
            {readinessLabel[selectedTemplateReadiness?.status || 'needs_data']}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Active prices" value={priceReadiness?.activeRows || 0} />
          <Metric label="Active norms" value={normReadiness?.activeRows || 0} />
          <Metric label="Missing price match" value={selectedTemplateReadiness?.metrics.itemsMissingPrice || 0} />
          <Metric label="Old price/norm" value={(priceReadiness?.staleRows || 0) + (normReadiness?.staleRows || 0)} />
        </div>
        {(blockers.length > 0 || warnings.length > 0) && (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {blockers.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
                <AlertTriangle size={14} className="mr-1 inline" />
                {blockers.slice(0, 6).join(' • ')}
              </div>
            )}
            {warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">
                <AlertTriangle size={14} className="mr-1 inline" />
                {warnings.slice(0, 6).join(' • ')}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderBuilder = () => (
    <div
      ref={containerRef}
      className="flex flex-col xl:flex-row gap-4 relative w-full"
      style={{ '--left-pane-width': `${leftWidth}%` } as React.CSSProperties}
    >
      <div className="w-full resizable-left-pane rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-800 dark:text-white">Tạo dự toán nhanh</h2>
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black text-indigo-600">Bước {builderStep}/4</span>
        </div>
        <div className="mb-4 grid grid-cols-4 gap-1">
          {[
            [1, 'Template'],
            [2, 'Tham số'],
            [3, 'Kết quả'],
            [4, 'Review'],
          ].map(([step, label]) => (
            <button
              key={String(step)}
              onClick={() => setBuilderStep(step as BuilderStep)}
              className={`rounded-xl px-2 py-2 text-[10px] font-black ${builderStep === step ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {builderStep === 1 && (
            <>
              <label className="block text-xs font-bold text-slate-500">Template</label>
              <select value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
                {(activeTemplates.length ? activeTemplates : templates).map(template => (
                  <option key={template.id} value={template.id}>{template.code} - {template.name}</option>
                ))}
              </select>
              {selectedTemplateReadiness && (
                <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${selectedTemplateReadiness.canEstimate ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}>
                  {readinessLabel[selectedTemplateReadiness.status]} • {selectedTemplateReadiness.canEstimate ? 'Đủ điều kiện sinh dự toán' : selectedTemplateReadiness.blockers.slice(0, 2).join(' • ')}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input value={draftName} onChange={e => setDraftName(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Tên phương án" />
                <input value={draftCustomer} onChange={e => setDraftCustomer(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Khách hàng" />
              </div>
              {canSeeInternalCost && <input type="number" value={draftMargin} onChange={e => setDraftMargin(num(e.target.value))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Biên lợi nhuận bổ sung (%)" />}
            </>
          )}

          {builderStep === 2 && (
            <>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-black text-indigo-700"><Wand2 size={14} /> AI gợi ý điền form</div>
                <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} className="min-h-[84px] w-full rounded-xl border border-indigo-100 px-3 py-2 text-sm" placeholder="Ví dụ: Nhà xưởng 5.000m2, cao 9m, móng cọc, mái tôn cách nhiệt, miền Bắc..." />
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={runAiSuggestion} disabled={loadingAiSuggestion} className={BTN_SOFT}>
                    {loadingAiSuggestion ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    Gợi ý
                  </button>
                  <button type="button" onClick={applyAiSuggestion} disabled={!aiSuggestion} className={BTN_PRIMARY}>Áp dụng vào form</button>
                </div>
                {aiSuggestion && (
                  <div className="mt-2 text-xs font-bold text-indigo-700">
                    {aiSuggestion.templateName && <div>Template: {aiSuggestion.templateName}</div>}
                    <div>Confidence: {Math.round(aiSuggestion.confidenceScore * 100)}% • {aiSuggestionSource === 'remote' ? 'AI remote' : 'Gợi ý offline'}</div>
                    {aiSuggestion.missingParameters.length > 0 && <div>Còn thiếu: {aiSuggestion.missingParameters.join(', ')}</div>}
                    {aiSuggestion.dataGaps && aiSuggestion.dataGaps.length > 0 && <div>Data gaps: {aiSuggestion.dataGaps.slice(0, 3).join(' • ')}</div>}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(selectedTemplate?.parameters || costTemplateService.defaultParameters).map(param => (
                  <div key={param.code}>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">{param.label || estimateParameterLabels[param.code]}</label>
                    {param.dataType === 'select' && Array.isArray(param.options) && param.options.length > 0 ? (
                      <select
                        value={String(draftInput[param.code] ?? param.defaultValue ?? '')}
                        onChange={e => setDraftInput(prev => ({ ...prev, [param.code]: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      >
                        <option value="">-</option>
                        {param.options.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
                      </select>
                    ) : (
                      <input
                        type={param.dataType === 'number' ? 'number' : 'text'}
                        value={String(draftInput[param.code] ?? param.defaultValue ?? '')}
                        onChange={e => setDraftInput(prev => ({ ...prev, [param.code]: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        placeholder={param.unit || ''}
                      />
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {builderStep === 3 && (
            <div className="space-y-2 text-xs">
              <Metric label="Template" value={selectedTemplate?.name || 'Chưa chọn'} />
              <Metric label="Tham số đã nhập" value={Object.values(draftInput).filter(value => value !== '' && value !== undefined).length} />
              <Metric label="Hạng mục template" value={selectedTemplate?.items.length || 0} />
              <Metric label="Đơn giá active" value={prices.filter(price => price.status === 'active').length} />
            </div>
          )}

          {builderStep === 4 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-600">
              Dự toán sinh ra sẽ ở trạng thái nháp. Người dùng phải rà soát/chốt trước khi export báo giá hoặc chuyển BOQ.
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setBuilderStep(Math.max(1, builderStep - 1) as BuilderStep)} className={BTN_SOFT}>Lùi</button>
            <button type="button" onClick={() => setBuilderStep(Math.min(4, builderStep + 1) as BuilderStep)} className={BTN_SOFT}>Tiếp</button>
          </div>
          <button disabled={!canCreateEstimate || saving || !selectedTemplate || !selectedTemplateReadiness?.canEstimate} onClick={createDraft} className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
            {saving ? <Loader2 size={15} className="inline animate-spin" /> : 'Sinh dự toán nháp'}
          </button>
        </div>
      </div>

      <div
        onMouseDown={handleMouseDown}
        className={`hidden xl:flex select-none w-1.5 hover:w-2 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-300 dark:hover:bg-indigo-700 active:bg-indigo-500 cursor-col-resize transition-all duration-150 relative shrink-0 items-center justify-center rounded-full self-stretch ${isDragging ? 'bg-indigo-400 w-2' : ''}`}
        title="Kéo để thay đổi kích thước các cột"
      >
        <div className="absolute top-1/2 -translate-y-1/2 w-4 h-8 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm rounded-md flex flex-col gap-0.5 items-center justify-center cursor-col-resize hover:border-indigo-400 z-10">
          <div className="w-0.5 h-3 bg-slate-300 dark:bg-slate-500 rounded-full" />
          <div className="w-0.5 h-3 bg-slate-300 dark:bg-slate-500 rounded-full" />
        </div>
      </div>

      <div className="w-full resizable-right-pane">
        <EstimateDetail
          estimate={estimateDetail}
          canManage={canManage}
          canSeeInternalCost={canSeeInternalCost}
          lineEdits={lineEdits}
          setLineEdits={setLineEdits}
          onSaveLine={saveLineOverride}
          onReview={() => updateEstimateStatus('reviewed')}
          onFinalize={() => updateEstimateStatus('finalized')}
          onExport={exportQuote}
          convertType={convertType}
          setConvertType={setConvertType}
          convertContractId={convertContractId}
          setConvertContractId={setConvertContractId}
          convertContracts={convertContracts}
          onPreviewConvert={previewConvert}
          conversionPreview={conversionPreview}
          conversionAudit={conversionAudit}
          onConvert={convertEstimate}
          onRollbackConvert={rollbackConversion}
          finalizeOverrideReason={finalizeOverrideReason}
          setFinalizeOverrideReason={setFinalizeOverrideReason}
          saving={saving}
        />
      </div>
    </div>
  );

  const renderTemplates = () => (
    <div
      ref={containerRef}
      className="flex flex-col xl:flex-row gap-4 relative w-full"
      style={{ '--left-pane-width': `${leftWidth}%` } as React.CSSProperties}
    >
      <div className="w-full resizable-left-pane space-y-3">
        {renderSearch()}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-black text-slate-800 dark:text-white">Template</h2>
            {canManage && (
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={previewSmbFactoryTemplate} disabled={loadingSmbPreview} className="text-xs font-bold text-emerald-600 disabled:opacity-50">
                  {loadingSmbPreview ? 'Đang đọc...' : 'Tạo từ Sơn Miền Bắc'}
                </button>
                <button onClick={createFactoryTemplate} className="text-xs font-bold text-indigo-600">Tạo mẫu nhà xưởng</button>
              </div>
            )}
          </div>
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {filteredTemplates.map(template => (
              <button
                key={template.id}
                onClick={() => {
                  setSelectedTemplateId(template.id);
                  setSectionForm(emptySection(template.id));
                  setItemForm(emptyItem(template.id));
                  setParameterForm(emptyParameter(template.id));
                }}
                className={`w-full text-left rounded-xl border px-3 py-2 ${template.id === selectedTemplateId ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-black text-indigo-600">{template.code}</span>
                  <span className="text-[10px] font-bold text-slate-400">
                    {template.id === selectedTemplateId && selectedTemplateReadiness
                      ? readinessLabel[selectedTemplateReadiness.status]
                      : statusLabel[template.status]}
                  </span>
                </div>
                <div className="text-sm font-black text-slate-800">{template.name}</div>
                <div className="text-[11px] text-slate-400">v{template.versionNo} • {template.items.length} hạng mục</div>
              </button>
            ))}
          </div>
        </div>
        {canManage && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
            <h3 className="text-xs font-black text-slate-700 mb-2">Thêm template</h3>
            <div className="space-y-2">
              <input value={templateForm.code} onChange={e => setTemplateForm(prev => ({ ...prev, code: e.target.value }))} className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Mã template" />
              <input value={templateForm.name} onChange={e => setTemplateForm(prev => ({ ...prev, name: e.target.value }))} className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Tên template" />
              <div className="grid grid-cols-2 gap-2">
                <input value={templateForm.projectType} onChange={e => setTemplateForm(prev => ({ ...prev, projectType: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Loại công trình" />
                <select value={templateForm.status} onChange={e => setTemplateForm(prev => ({ ...prev, status: e.target.value as any }))} className="rounded-xl border px-3 py-2 text-sm">
                  <option value="draft">Nháp</option>
                  <option value="active">Hiệu lực</option>
                  <option value="archived">Lưu trữ</option>
                </select>
              </div>
              <button onClick={saveTemplate} disabled={saving} className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white">Lưu template</button>
            </div>
          </div>
        )}
      </div>

      <div
        onMouseDown={handleMouseDown}
        className={`hidden xl:flex select-none w-1.5 hover:w-2 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-300 dark:hover:bg-indigo-700 active:bg-indigo-500 cursor-col-resize transition-all duration-150 relative shrink-0 items-center justify-center rounded-full self-stretch ${isDragging ? 'bg-indigo-400 w-2' : ''}`}
        title="Kéo để thay đổi kích thước các cột"
      >
        <div className="absolute top-1/2 -translate-y-1/2 w-4 h-8 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm rounded-md flex flex-col gap-0.5 items-center justify-center cursor-col-resize hover:border-indigo-400 z-10">
          <div className="w-0.5 h-3 bg-slate-300 dark:bg-slate-500 rounded-full" />
          <div className="w-0.5 h-3 bg-slate-300 dark:bg-slate-500 rounded-full" />
        </div>
      </div>

      <div className="w-full resizable-right-pane space-y-4">
        {selectedTemplate ? (
          <>
            <TemplateChildren
              template={selectedTemplate}
              canManage={canManage}
              sectionForm={sectionForm}
              setSectionForm={setSectionForm}
              parameterForm={parameterForm}
              setParameterForm={setParameterForm}
              itemForm={itemForm}
              setItemForm={setItemForm}
              onSaveSection={saveSection}
              onSaveParameter={saveParameter}
              onSaveItem={saveItem}
              onDeleteChild={deleteChild}
              onCreateVersion={createTemplateVersion}
              onChangeStatus={changeTemplateStatus}
              onNormalize={openTemplateNormalization}
              saving={saving}
            />
            {normalizingTemplateId === selectedTemplate.id && (
              <TemplateNormalizationPanel
                template={selectedTemplate}
                report={normalizationReport}
                canManage={canManage}
                saving={saving}
                onOpenItem={openItemNormalization}
                onCreateDraftNorms={createDraftNormsFromTemplate}
                onRefresh={() => loadNormalizationReport(selectedTemplate.id)}
              />
            )}
            {normalizationItem && (
              <NormalizationItemModal
                item={normalizationItem}
                form={normalizationForm}
                setForm={setNormalizationForm}
                saving={saving}
                onSave={saveItemNormalization}
                onClose={() => setNormalizationItem(null)}
              />
            )}
          </>
        ) : (
          <EmptyState title="Chưa có template" />
        )}
      </div>
    </div>
  );

  const renderPrices = () => (
    <div className="space-y-4 w-full">
      {renderPermissionNotice()}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={downloadPriceTemplate} className={BTN_SOFT}>
            <Download size={14} /> Tải file mẫu
          </button>
          <label className={BTN_SOFT}>
            <Upload size={14} /> Preview import đơn giá
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => importPrices(e.target.files?.[0])} />
          </label>
          <button onClick={bulkActivatePrices} disabled={saving} className={BTN_PRIMARY}>
            <CheckCircle2 size={14} /> Kích hoạt dòng đang lọc
          </button>
        </div>
      )}
      {canManage ? (
        <div
          ref={containerRef}
          className="flex flex-col xl:flex-row gap-4 relative w-full"
          style={{ '--left-pane-width': `${leftWidth}%` } as React.CSSProperties}
        >
          <div className="w-full resizable-left-pane">
            <CatalogForm title="Đơn giá nội bộ" onSave={savePrice} saving={saving}>
              <input value={priceForm.itemCode} onChange={e => setPriceForm(prev => ({ ...prev, itemCode: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Mã" />
              <input value={priceForm.itemName} onChange={e => setPriceForm(prev => ({ ...prev, itemName: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Tên vật tư/nguồn lực" />
              <div className="grid grid-cols-2 gap-2">
                <select value={priceForm.itemType} onChange={e => setPriceForm(prev => ({ ...prev, itemType: e.target.value as any }))} className="rounded-xl border px-3 py-2 text-sm">
                  {['material', 'labor', 'machine', 'subcontract', 'overhead', 'other'].map(type => <option key={type} value={type}>{type}</option>)}
                </select>
                <input value={priceForm.unit} onChange={e => setPriceForm(prev => ({ ...prev, unit: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="ĐVT" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={priceForm.region} onChange={e => setPriceForm(prev => ({ ...prev, region: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Khu vực" />
                <input type="number" value={priceForm.unitPrice} onChange={e => setPriceForm(prev => ({ ...prev, unitPrice: num(e.target.value) }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Đơn giá" />
              </div>
              <select value={priceForm.status} onChange={e => setPriceForm(prev => ({ ...prev, status: e.target.value as any }))} className="rounded-xl border px-3 py-2 text-sm">
                <option value="draft">Nháp</option>
                <option value="active">Hiệu lực</option>
                <option value="archived">Lưu trữ</option>
              </select>
            </CatalogForm>
          </div>

          <div
            onMouseDown={handleMouseDown}
            className={`hidden xl:flex select-none w-1.5 hover:w-2 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-300 dark:hover:bg-indigo-700 active:bg-indigo-500 cursor-col-resize transition-all duration-150 relative shrink-0 items-center justify-center rounded-full self-stretch ${isDragging ? 'bg-indigo-400 w-2' : ''}`}
            title="Kéo để thay đổi kích thước các cột"
          >
            <div className="absolute top-1/2 -translate-y-1/2 w-4 h-8 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm rounded-md flex flex-col gap-0.5 items-center justify-center cursor-col-resize hover:border-indigo-400 z-10">
              <div className="w-0.5 h-3 bg-slate-300 dark:bg-slate-500 rounded-full" />
              <div className="w-0.5 h-3 bg-slate-300 dark:bg-slate-500 rounded-full" />
            </div>
          </div>

          <div className="w-full resizable-right-pane space-y-3">
            {renderSearch()}
            <DataTable headers={['Mã', 'Tên', 'Loại', 'Khu vực', 'ĐVT', 'Version', 'Đơn giá', 'Trạng thái', '']}>
              {filteredPrices.map(row => (
                <tr key={row.id}>
                  <td className={`${TD} font-mono`}>{row.itemCode}</td>
                  <td className={`${TD} font-bold`}>{row.itemName}</td>
                  <td className={TD}>{row.itemType}</td>
                  <td className={TD}>{row.region}</td>
                  <td className={TD}>{row.unit}</td>
                  <td className={TD}>v{row.versionNo}</td>
                  <td className={`${TD} font-black`}>{canSeeInternalCost ? money(row.unitPrice) : 'Ẩn'}</td>
                  <td className={TD}>{statusLabel[row.status]}</td>
                  <td className={`${TD} text-right`}>
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => changePriceStatus(row, 'version')} className={BTN_MINI} title="Tạo version mới">v+</button>
                        {row.status !== 'active' && <button onClick={() => changePriceStatus(row, 'activate')} className={BTN_MINI} title="Kích hoạt"><CheckCircle2 size={13} /></button>}
                        {row.status !== 'archived' && <button onClick={() => changePriceStatus(row, 'archive')} className={BTN_MINI} title="Lưu trữ"><X size={13} /></button>}
                        <IconButton onClick={() => deletePrice(row)} icon={<Trash2 size={13} />} title="Xoá" />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {renderSearch()}
          <DataTable headers={['Mã', 'Tên', 'Loại', 'Khu vực', 'ĐVT', 'Version', 'Đơn giá', 'Trạng thái', '']}>
            {filteredPrices.map(row => (
              <tr key={row.id}>
                <td className={`${TD} font-mono`}>{row.itemCode}</td>
                <td className={`${TD} font-bold`}>{row.itemName}</td>
                <td className={TD}>{row.itemType}</td>
                <td className={TD}>{row.region}</td>
                <td className={TD}>{row.unit}</td>
                <td className={TD}>v{row.versionNo}</td>
                <td className={`${TD} font-black`}>{canSeeInternalCost ? money(row.unitPrice) : 'Ẩn'}</td>
                <td className={TD}>{statusLabel[row.status]}</td>
                <td className={`${TD} text-right`}>
                  {canManage && (
                    <div className="flex justify-end gap-1">
                      <button onClick={() => changePriceStatus(row, 'version')} className={BTN_MINI} title="Tạo version mới">v+</button>
                      {row.status !== 'active' && <button onClick={() => changePriceStatus(row, 'activate')} className={BTN_MINI} title="Kích hoạt"><CheckCircle2 size={13} /></button>}
                      {row.status !== 'archived' && <button onClick={() => changePriceStatus(row, 'archive')} className={BTN_MINI} title="Lưu trữ"><X size={13} /></button>}
                      <IconButton onClick={() => deletePrice(row)} icon={<Trash2 size={13} />} title="Xoá" />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );

  const renderNorms = () => {
    const rawMaterials = selectedNormItem ? getRawMaterials(selectedNormItem) : [];
    const baseQuantity = selectedNormItem ? costNormWorkbenchService.getBaseQuantity(selectedNormItem) : null;
    const selectedStatus = selectedNormItem ? getNormalizationStatus(selectedNormItem) : 'raw';
    const packageStatusValue = selectedNormPackageItem ? getItemMetadata(selectedNormPackageItem).normalizationStatus : null;
    const packageStatus = packageStatusValue === 'reviewing' || packageStatusValue === 'normalized' || packageStatusValue === 'ignored'
      ? packageStatusValue
      : selectedNormPackageDrafts.length > 0 ? 'reviewing' : null;
    return (
      <div className="space-y-4">
        {renderPermissionNotice()}

        <div
          ref={containerRef}
          className="flex flex-col xl:flex-row gap-4 relative w-full"
          style={{ '--left-pane-width': `${leftWidth}%` } as React.CSSProperties}
        >
          <div className="w-full resizable-left-pane space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
              <div className="mb-3">
                <div className="text-[10px] font-black uppercase text-indigo-500">Workbench định mức</div>
                <h2 className="text-sm font-black text-slate-800 dark:text-white">Chọn hạng mục tham chiếu</h2>
              </div>
              <div className="space-y-2">
                <select
                  value={selectedNormTemplate?.id || ''}
                  onChange={e => {
                    setNormWorkbenchTemplateId(e.target.value);
                    setNormWorkbenchItemId('');
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  {(normSourceTemplates.length ? normSourceTemplates : templates).map(template => (
                    <option key={template.id} value={template.id}>{template.code} - {template.name}</option>
                  ))}
                </select>
                <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
                  <Search size={15} className="text-slate-400" />
                  <input
                    value={normWorkbenchQuery}
                    onChange={e => setNormWorkbenchQuery(e.target.value)}
                    placeholder="Tìm WBS/hạng mục..."
                    className="w-full bg-transparent text-sm text-slate-700 outline-none dark:text-slate-200"
                  />
                </div>
                <select value={normWorkbenchStatusFilter} onChange={e => setNormWorkbenchStatusFilter(e.target.value as any)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold">
                  <option value="all">Mọi trạng thái chuẩn hóa</option>
                  {(['raw', 'reviewing', 'normalized', 'ignored'] as CostTemplateNormalizationStatus[]).map(status => (
                    <option key={status} value={status}>{normalizationLabel[status]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="max-h-[620px] space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 dark:bg-slate-900 dark:border-slate-800">
              {normWorkbenchItems.map(item => {
                const status = getNormalizationStatus(item);
                const metadata = getItemMetadata(item);
                const rawCount = getRawMaterials(item).length;
                const draftCount = norms.filter(norm => norm.templateItemId === item.id && norm.status === 'draft').length;
                return (
                  <button
                    key={item.id}
                    onClick={() => setNormWorkbenchItemId(item.id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left ${selectedNormItem?.id === item.id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-black text-indigo-600">{String(metadata.sourceWbsCode || item.code)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${status === 'normalized' ? 'bg-emerald-100 text-emerald-700' :
                        status === 'ignored' ? 'bg-slate-100 text-slate-500' :
                          status === 'reviewing' ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                        }`}>
                        {normalizationLabel[status]}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-black text-slate-800">{item.name}</div>
                    <div className="mt-1 text-[11px] font-bold text-slate-400">
                      Raw {rawCount} • Draft {draftCount} • KL {String(metadata.standardBaseQuantity ?? item.baseQuantity ?? metadata.sourcePlannedQty ?? '-')} {String(metadata.standardUnit || item.unit || '')}
                    </div>
                  </button>
                );
              })}
              {normWorkbenchItems.length === 0 && <EmptyState title="Không có hạng mục phù hợp" />}
            </div>
          </div>

          <div
            onMouseDown={handleMouseDown}
            className={`hidden xl:flex select-none w-1.5 hover:w-2 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-300 dark:hover:bg-indigo-700 active:bg-indigo-500 cursor-col-resize transition-all duration-150 relative shrink-0 items-center justify-center rounded-full self-stretch ${isDragging ? 'bg-indigo-400 w-2' : ''}`}
            title="Kéo để thay đổi kích thước các cột"
          >
            <div className="absolute top-1/2 -translate-y-1/2 w-4 h-8 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm rounded-md flex flex-col gap-0.5 items-center justify-center cursor-col-resize hover:border-indigo-400 z-10">
              <div className="w-0.5 h-3 bg-slate-300 dark:bg-slate-500 rounded-full" />
              <div className="w-0.5 h-3 bg-slate-300 dark:bg-slate-500 rounded-full" />
            </div>
          </div>

          <div className="w-full resizable-right-pane space-y-4">
            {selectedNormItem ? (
              <>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
                  <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-[10px] font-black uppercase text-emerald-600">Gói định mức đích</div>
                      <h2 className="text-sm font-black text-slate-800 dark:text-white">Tạo hoặc chọn hạng mục thư viện để lưu định mức</h2>
                      <div className="mt-1 text-xs font-bold text-slate-400">
                        Tham chiếu: {String(getItemMetadata(selectedNormItem).sourceWbsCode || selectedNormItem.code)} - {selectedNormItem.name}
                      </div>
                    </div>
                    {selectedNormPackageItem && (
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black text-emerald-700">
                          {selectedNormPackageItem.code}
                        </span>
                        {packageStatus && (
                          <span className={`rounded-full px-3 py-1 text-[10px] font-black ${packageStatus === 'normalized' ? 'bg-emerald-100 text-emerald-700' :
                            packageStatus === 'reviewing' ? 'bg-amber-100 text-amber-700' :
                              packageStatus === 'ignored' ? 'bg-slate-100 text-slate-500' :
                                'bg-red-100 text-red-700'
                          }`}>
                            {normalizationLabel[packageStatus]}
                          </span>
                        )}
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-500">
                          Draft {selectedNormPackageDrafts.length}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_120px_120px_auto]">
                    <select
                      value={selectedNormPackageTemplate?.id || ''}
                      onChange={e => {
                        setNormPackageTemplateId(e.target.value);
                        setNormPackageItemId('');
                      }}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    >
                      {(normPackageTemplates.length ? normPackageTemplates : templates).map(template => (
                        <option key={template.id} value={template.id}>{template.code} - {template.name}</option>
                      ))}
                    </select>
                    <select
                      value={selectedNormPackageItem?.id || ''}
                      onChange={e => setNormPackageItemId(e.target.value)}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    >
                      <option value="">Tạo gói mới từ tham chiếu</option>
                      {normPackageItems.map(item => (
                        <option key={item.id} value={item.id}>{item.code} - {item.name}</option>
                      ))}
                    </select>
                    <input
                      value={normPackageForm.code}
                      onChange={e => setNormPackageForm(prev => ({ ...prev, code: normalizePackageCode(e.target.value) }))}
                      placeholder="Mã gói"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono font-bold"
                    />
                    <input
                      value={normPackageForm.unit}
                      onChange={e => setNormPackageForm(prev => ({ ...prev, unit: e.target.value }))}
                      placeholder="ĐVT gói"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                    {canManage && (
                      <button onClick={saveNormPackageItem} disabled={saving || !selectedNormPackageTemplate} className={BTN_PRIMARY}>
                        <Save size={14} /> {selectedNormPackageItem ? 'Cập nhật gói' : 'Tạo gói'}
                      </button>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_160px]">
                    <input
                      value={normPackageForm.name}
                      onChange={e => setNormPackageForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Tên gói/hạng mục định mức, ví dụ LÁT SÀN"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
                    />
                    <input
                      type="number"
                      value={normPackageForm.baseQuantity}
                      onChange={e => setNormPackageForm(prev => ({ ...prev, baseQuantity: e.target.value }))}
                      placeholder="KL gói"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  {!selectedNormPackageItem && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">
                      <AlertTriangle size={14} className="mr-1 inline" />
                      Chưa có gói đích. Hãy tạo gói như LÁT SÀN trước, rồi tích vật tư tham chiếu hoặc bấm AI gợi ý.
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="font-mono text-xs font-black text-indigo-600">{String(getItemMetadata(selectedNormItem).sourceWbsCode || selectedNormItem.code)}</div>
                      <h2 className="text-lg font-black text-slate-800 dark:text-white">{selectedNormPackageItem?.name || 'Chưa chọn gói định mức'}</h2>
                      <div className="mt-1 text-xs font-bold text-slate-400">
                        Nguồn tham chiếu {selectedNormItem.name} • ĐVT tham chiếu {String(getItemMetadata(selectedNormItem).standardUnit || selectedNormItem.unit || '-')} • KL tham chiếu {baseQuantity ?? '-'} • Raw {rawMaterials.length} dòng
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full px-3 py-1 text-[10px] font-black ${selectedStatus === 'normalized' ? 'bg-emerald-100 text-emerald-700' :
                        selectedStatus === 'reviewing' ? 'bg-amber-100 text-amber-700' :
                          selectedStatus === 'ignored' ? 'bg-slate-100 text-slate-500' :
                            'bg-red-100 text-red-700'
                        }`}>
                        {normalizationLabel[selectedStatus]}
                      </span>
                      {canManage && <button onClick={runNormAiSuggestion} disabled={loadingNormAi || !selectedNormPackageItem} className={BTN_SOFT}>{loadingNormAi ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} AI gợi ý</button>}
                      {canManage && <button onClick={() => saveNormWorkbenchDraft(false)} disabled={saving || !selectedNormPackageItem} className={BTN_SOFT}><Save size={14} /> Lưu draft</button>}
                      {canManage && <button onClick={() => saveNormWorkbenchDraft(true)} disabled={saving || !selectedNormPackageItem} className={BTN_PRIMARY}><ShieldCheck size={14} /> Lưu & đã chuẩn hóa</button>}
                      {canManage && <button onClick={activateSelectedNormDrafts} disabled={saving || !selectedNormPackageItem || selectedNormPackageDrafts.length === 0} className={BTN_SOFT}><CheckCircle2 size={14} /> Kích hoạt draft</button>}
                    </div>
                  </div>
                  {(!baseQuantity || baseQuantity <= 0) && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">
                      <AlertTriangle size={14} className="mr-1 inline" />
                      Hạng mục chưa có KL chuẩn, hệ thống không tự tính định mức từ KL vật tư raw.
                    </div>
                  )}
                  {normWorkbenchAiWarnings.length > 0 && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">
                      <AlertTriangle size={14} className="mr-1 inline" />
                      {normWorkbenchAiWarnings.slice(0, 4).join(' • ')}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[360px_minmax(0,1fr)]">
                  <Panel title="Vật tư raw Sơn Miền Bắc" icon={<PackageSearch size={14} />}>
                    <div className="max-h-[460px] overflow-y-auto">
                      {rawMaterials.length === 0 && <div className="text-xs font-bold text-slate-400">Hạng mục này chưa có vật tư raw.</div>}
                      {rawMaterials.map((material, index) => {
                        const checked = isReferenceMaterialSelected(material, index);
                        return (
                          <label key={`${material.sourceMaterialBudgetItemId || material.itemName}-${index}`} className={`mb-2 flex cursor-pointer gap-2 rounded-xl border p-2 text-xs ${checked ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100'}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canManage || !selectedNormPackageItem}
                              onChange={e => toggleReferenceMaterial(material, index, e.target.checked)}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-black text-slate-700">{material.itemName}</span>
                              <span className="block text-slate-400">{material.materialCode || '-'} • {material.category || '-'} • {String(material.budgetQty ?? '-')} {material.unit || ''}</span>
                              {baseQuantity && material.budgetQty !== null && material.budgetQty !== undefined && (
                                <span className="mt-1 block font-bold text-emerald-600">Gợi ý: {Math.round((Number(material.budgetQty || 0) / baseQuantity) * 1_000_000) / 1_000_000} / {selectedNormItem.unit || 'đơn vị'}</span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </Panel>

                  <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800">
                    <table className="w-full min-w-[1180px] text-sm">
                      <thead className="bg-indigo-50/80 border-b border-indigo-100/80 dark:bg-slate-800 dark:border-slate-700 text-xs font-black text-indigo-950 dark:text-slate-200 uppercase whitespace-nowrap">
                        <tr>
                          {['Mã Định Mức', 'Nguồn lực chuẩn', 'Loại', 'Mã Vật Tư', 'ĐVT', 'Raw KL', 'Định mức', 'Hao hụt %', 'Review', 'Ghi chú', ''].map(header => (
                            <th key={header} className="px-4 py-3 text-left font-black tracking-wider whitespace-nowrap">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {normWorkbenchLines.map(line => (
                          <tr key={line.id}>
                            <td className={TD}><input value={line.normCode} onChange={e => setNormWorkbenchLine(line.id, { normCode: e.target.value })} className="w-36 rounded-lg border px-2 py-1 font-mono text-xs" /></td>
                            <td className={TD}><input value={line.resourceName} onChange={e => setNormWorkbenchLine(line.id, { resourceName: e.target.value })} className="w-56 rounded-lg border px-2 py-1 text-xs font-bold" /></td>
                            <td className={TD}>
                              <select value={line.resourceType} onChange={e => setNormWorkbenchLine(line.id, { resourceType: e.target.value as InternalNorm['resourceType'] })} className="w-32 rounded-lg border px-2 py-1 text-xs">
                                {['material', 'labor', 'machine', 'subcontract', 'overhead', 'other'].map(type => <option key={type} value={type}>{type}</option>)}
                              </select>
                            </td>
                            <td className={TD}><input value={line.resourceCode || ''} onChange={e => setNormWorkbenchLine(line.id, { resourceCode: e.target.value })} className="w-32 rounded-lg border px-2 py-1 text-xs" /></td>
                            <td className={TD}><input value={line.unit} onChange={e => setNormWorkbenchLine(line.id, { unit: e.target.value })} className="w-20 rounded-lg border px-2 py-1 text-xs" /></td>
                            <td className={TD}>{line.rawQuantity ?? '-'}</td>
                            <td className={TD}><input type="number" value={line.normQuantity} onChange={e => setNormWorkbenchLine(line.id, { normQuantity: num(e.target.value), needsReview: true })} className="w-28 rounded-lg border px-2 py-1 text-xs" /></td>
                            <td className={TD}><input type="number" value={line.wastePercent} onChange={e => setNormWorkbenchLine(line.id, { wastePercent: num(e.target.value) })} className="w-24 rounded-lg border px-2 py-1 text-xs" /></td>
                            <td className={TD}><input type="checkbox" checked={Boolean(line.needsReview)} onChange={e => setNormWorkbenchLine(line.id, { needsReview: e.target.checked })} /></td>
                            <td className={TD}><input value={line.note || line.reason || ''} onChange={e => setNormWorkbenchLine(line.id, { note: e.target.value })} className="w-56 rounded-lg border px-2 py-1 text-xs" /></td>
                            <td className={`${TD} text-right`}>
                              {canManage && <button onClick={() => removeNormWorkbenchLine(line.id)} className={BTN_MINI}><Trash2 size={13} /></button>}
                            </td>
                          </tr>
                        ))}
                        {normWorkbenchLines.length === 0 && (
                          <tr>
                            <td colSpan={11} className="px-3 py-8 text-center text-xs font-bold text-slate-400">Chưa có dòng định mức draft cho gói này.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {canManage && (
                      <div className="border-t border-slate-100 p-3">
                        <button onClick={addNormWorkbenchLine} disabled={!selectedNormPackageItem} className={BTN_SOFT}><Plus size={14} /> Thêm vật tư / nhân công / máy / thầu phụ</button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <EmptyState title="Chọn hạng mục để chuẩn hóa định mức" />
            )}
          </div>
        </div>

        {canManage && (
          <details className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
            <summary className="cursor-pointer text-sm font-black text-slate-800 dark:text-white">Thêm thủ công một dòng định mức</summary>
            <div className="mt-3 max-w-xl">
              <CatalogForm title="Định mức nội bộ" onSave={saveNorm} saving={saving}>
                <input value={normForm.normCode} onChange={e => setNormForm(prev => ({ ...prev, normCode: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Mã định mức" />
                <input value={normForm.resourceName} onChange={e => setNormForm(prev => ({ ...prev, resourceName: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Nguồn lực/vật tư" />
                <select value={normForm.templateItemId || ''} onChange={e => setNormForm(prev => ({ ...prev, templateItemId: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm">
                  <option value="">Không gắn item</option>
                  {templates.flatMap(template => template.items).map(item => <option key={item.id} value={item.id}>{item.code} - {item.name}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input value={normForm.resourceCode || ''} onChange={e => setNormForm(prev => ({ ...prev, resourceCode: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Mã đơn giá" />
                  <select value={normForm.resourceType} onChange={e => setNormForm(prev => ({ ...prev, resourceType: e.target.value as any }))} className="rounded-xl border px-3 py-2 text-sm">
                    {['material', 'labor', 'machine', 'subcontract', 'overhead', 'other'].map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input value={normForm.unit} onChange={e => setNormForm(prev => ({ ...prev, unit: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="ĐVT" />
                  <input type="number" value={normForm.normQuantity} onChange={e => setNormForm(prev => ({ ...prev, normQuantity: num(e.target.value) }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Định mức" />
                  <input type="number" value={normForm.wastePercent || 0} onChange={e => setNormForm(prev => ({ ...prev, wastePercent: num(e.target.value) }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Hao hụt %" />
                </div>
                <select value={normForm.status} onChange={e => setNormForm(prev => ({ ...prev, status: e.target.value as any }))} className="rounded-xl border px-3 py-2 text-sm">
                  <option value="draft">Nháp</option>
                  <option value="active">Hiệu lực</option>
                  <option value="archived">Lưu trữ</option>
                </select>
              </CatalogForm>
            </div>
          </details>
        )}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {canManage && (
              <>
                <button onClick={downloadNormTemplate} className={BTN_SOFT}><Download size={14} /> Tải file mẫu</button>
                <label className={BTN_SOFT}>
                  <Upload size={14} /> Preview import định mức
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => importNorms(e.target.files?.[0])} />
                </label>
                <button onClick={bulkActivateNorms} disabled={saving} className={BTN_PRIMARY}><CheckCircle2 size={14} /> Kích hoạt dòng đang lọc</button>
              </>
            )}
          </div>
          {renderSearch()}
          <DataTable headers={['Mã', 'Nguồn lực', 'Loại', 'ĐVT', 'Định mức', 'Hao hụt', 'Version', 'Trạng thái', '']}>
            {filteredNorms.map(row => (
              <tr key={row.id}>
                <td className={`${TD} font-mono`}>{row.normCode}</td>
                <td className={`${TD} font-bold`}>{row.resourceName}</td>
                <td className={TD}>{row.resourceType}</td>
                <td className={TD}>{row.unit}</td>
                <td className={TD}>{row.normQuantity}</td>
                <td className={TD}>{row.wastePercent}%</td>
                <td className={TD}>v{row.versionNo}</td>
                <td className={TD}>{statusLabel[row.status]}</td>
                <td className={`${TD} text-right`}>
                  {canManage && (
                    <div className="flex justify-end gap-1">
                      <button onClick={() => changeNormStatus(row, 'version')} className={BTN_MINI} title="Tạo version mới">v+</button>
                      {row.status !== 'active' && <button onClick={() => changeNormStatus(row, 'activate')} className={BTN_MINI} title="Kích hoạt"><CheckCircle2 size={13} /></button>}
                      {row.status !== 'archived' && <button onClick={() => changeNormStatus(row, 'archive')} className={BTN_MINI} title="Lưu trữ"><X size={13} /></button>}
                      <IconButton onClick={() => deleteNorm(row)} icon={<Trash2 size={13} />} title="Xoá" />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </div>
    );
  };

  const renderEstimates = () => (
    <div className="space-y-4 w-full">
      <div
        ref={containerRef}
        className="flex flex-col xl:flex-row gap-4 relative w-full"
        style={{ '--left-pane-width': `${leftWidth}%` } as React.CSSProperties}
      >
        <div className="w-full resizable-left-pane rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
          <h2 className="text-sm font-black text-slate-800 dark:text-white mb-3">Phương án dự toán</h2>
          <div className="space-y-2 max-h-[620px] overflow-y-auto">
            {renderSearch()}
            <div className="flex items-center gap-2">
              <button onClick={runCompare} className={BTN_SOFT}><GitCompare size={14} /> So sánh</button>
              <span className="text-[10px] font-bold text-slate-400">Chọn 2-3 phương án</span>
            </div>
            {filteredEstimates.map(estimate => (
              <div key={estimate.id} className={`rounded-xl border px-3 py-2 ${estimate.id === selectedEstimateId ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={compareIds.includes(estimate.id)}
                    onChange={e => setCompareIds(prev => e.target.checked ? [...prev, estimate.id].slice(-3) : prev.filter(id => id !== estimate.id))}
                    className="mt-1"
                  />
                  <button onClick={() => loadEstimateDetail(estimate.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-black text-indigo-600">{estimate.code}</span>
                      <span className="text-[10px] font-bold text-slate-400">{statusLabel[estimate.status]}</span>
                    </div>
                    <div className="text-sm font-black text-slate-800">{estimate.name}</div>
                    <div className="text-[11px] text-slate-400">{money(estimate.quoteAmount || estimate.totalAmount)}</div>
                  </button>
                </div>
              </div>
            ))}
            {filteredEstimates.length === 0 && <EmptyState title="Chưa có phương án" />}
          </div>
        </div>

        <div
          onMouseDown={handleMouseDown}
          className={`hidden xl:flex select-none w-1.5 hover:w-2 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-300 dark:hover:bg-indigo-700 active:bg-indigo-500 cursor-col-resize transition-all duration-150 relative shrink-0 items-center justify-center rounded-full self-stretch ${isDragging ? 'bg-indigo-400 w-2' : ''}`}
          title="Kéo để thay đổi kích thước các cột"
        >
          <div className="absolute top-1/2 -translate-y-1/2 w-4 h-8 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm rounded-md flex flex-col gap-0.5 items-center justify-center cursor-col-resize hover:border-indigo-400 z-10">
            <div className="w-0.5 h-3 bg-slate-300 dark:bg-slate-500 rounded-full" />
            <div className="w-0.5 h-3 bg-slate-300 dark:bg-slate-500 rounded-full" />
          </div>
        </div>

        <div className="w-full resizable-right-pane">
          <EstimateDetail
            estimate={estimateDetail}
            canManage={canManage}
            canSeeInternalCost={canSeeInternalCost}
            lineEdits={lineEdits}
            setLineEdits={setLineEdits}
            onSaveLine={saveLineOverride}
            onReview={() => updateEstimateStatus('reviewed')}
            onFinalize={() => updateEstimateStatus('finalized')}
            onExport={exportQuote}
            convertType={convertType}
            setConvertType={setConvertType}
            convertContractId={convertContractId}
            setConvertContractId={setConvertContractId}
            convertContracts={convertContracts}
            onPreviewConvert={previewConvert}
            conversionPreview={conversionPreview}
            conversionAudit={conversionAudit}
            onConvert={convertEstimate}
            onRollbackConvert={rollbackConversion}
            finalizeOverrideReason={finalizeOverrideReason}
            setFinalizeOverrideReason={setFinalizeOverrideReason}
            saving={saving}
          />
        </div>
      </div>

      {compareResult && (
        <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-800 dark:text-white">So sánh phương án</h2>
            <button onClick={() => setCompareResult(null)} className={BTN_MINI}><X size={14} /></button>
          </div>
          <DataTable headers={['Mã', 'Hạng mục', ...compareResult.estimates.map(row => row.code || row.name), 'Chênh lệch']}>
            {compareResult.rows.slice(0, 30).map(row => (
              <tr key={row.code}>
                <td className={`${TD} font-mono`}>{row.code}</td>
                <td className={`${TD} font-bold`}>{row.name}</td>
                {compareResult.estimates.map(estimate => <td key={estimate.id} className={TD}>{money(row.values[estimate.id]?.quoteAmount || 0)}</td>)}
                <td className={`${TD} font-black text-amber-600`}>{money(row.spreadAmount)}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 size={24} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!canCreateEstimate) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm font-bold text-amber-700">
        <LockKeyhole size={18} className="mb-2" />
        Tài khoản hiện tại chưa được cấp quyền module HD để tạo/xem dự toán nhanh.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <style dangerouslySetInnerHTML={{
        __html: `
        @media (min-width: 1280px) {
          .resizable-left-pane {
            width: calc(var(--left-pane-width) - 8px) !important;
            flex-shrink: 0 !important;
          }
          .resizable-right-pane {
            width: calc(100% - var(--left-pane-width) - 8px) !important;
            flex-shrink: 0 !important;
          }
        }
        tbody tr {
          transition: background-color 0.15s ease-in-out;
        }
        tbody tr:hover {
          background-color: rgba(99, 102, 241, 0.05) !important;
        }
        .dark tbody tr:hover {
          background-color: rgba(99, 102, 241, 0.1) !important;
        }
        /* Custom scrollbar styling */
        .overflow-auto::-webkit-scrollbar, 
        .overflow-x-auto::-webkit-scrollbar,
        .overflow-y-auto::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .overflow-auto::-webkit-scrollbar-track, 
        .overflow-x-auto::-webkit-scrollbar-track,
        .overflow-y-auto::-webkit-scrollbar-track {
          background: transparent;
        }
        .overflow-auto::-webkit-scrollbar-thumb, 
        .overflow-x-auto::-webkit-scrollbar-thumb,
        .overflow-y-auto::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 3px;
        }
        .dark .overflow-auto::-webkit-scrollbar-thumb, 
        .dark .overflow-x-auto::-webkit-scrollbar-thumb,
        .dark .overflow-y-auto::-webkit-scrollbar-thumb {
          background: #475569;
        }
        .overflow-auto::-webkit-scrollbar-thumb:hover, 
        .overflow-x-auto::-webkit-scrollbar-thumb:hover,
        .overflow-y-auto::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
        .dark .overflow-auto::-webkit-scrollbar-thumb:hover, 
        .dark .overflow-x-auto::-webkit-scrollbar-thumb:hover,
        .dark .overflow-y-auto::-webkit-scrollbar-thumb:hover {
          background: #64748b;
        }
      `}} />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white">Đơn giá nội bộ & Dự toán nhanh</h1>
          <p className="text-xs text-slate-500">Cost Library, định mức, price book và phương án chào thầu</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
          <RefreshCw size={14} /> Tải lại
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Template active" value={templates.filter(t => t.status === 'active').length} />
        <Kpi label="Đơn giá active" value={prices.filter(p => p.status === 'active').length} />
        <Kpi label="Định mức active" value={norms.filter(n => n.status === 'active').length} />
        <Kpi label="Estimate đã chốt" value={estimates.filter(e => e.status === 'finalized' || e.status === 'converted').length} />
        <Kpi label="Giá quá cũ" value={priceReadiness?.staleRows || 0} />
        <Kpi label="Dữ liệu lỗi" value={(priceReadiness?.invalidRows || 0) + (normReadiness?.invalidRows || 0)} />
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 dark:bg-slate-900 dark:border-slate-800">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex min-w-max items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition ${activeTab === tab.key ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {renderImportPreview()}
      {renderSmbImportPreview()}
      {renderReadinessPanel()}
      {activeTab === 'builder' && renderBuilder()}
      {activeTab === 'templates' && renderTemplates()}
      {activeTab === 'prices' && renderPrices()}
      {activeTab === 'norms' && renderNorms()}
      {activeTab === 'estimates' && renderEstimates()}
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:bg-slate-900 dark:border-slate-800">
    <div className="text-[10px] font-bold uppercase text-slate-400">{label}</div>
    <div className="text-xl font-black text-slate-800 dark:text-white">{value.toLocaleString('vi-VN')}</div>
  </div>
);

const EmptyState: React.FC<{ title: string }> = ({ title }) => (
  <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm font-bold text-slate-400 dark:bg-slate-900 dark:border-slate-800">
    {title}
  </div>
);

const IconButton: React.FC<{ icon: React.ReactNode; title: string; onClick: () => void }> = ({ icon, title, onClick }) => (
  <button onClick={onClick} title={title} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
    {icon}
  </button>
);

const DataTable: React.FC<{ headers: string[]; children: React.ReactNode }> = ({ headers, children }) => (
  <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800">
    <table className="w-full min-w-[780px] text-sm">
      <thead className="bg-indigo-50/80 border-b border-indigo-100/80 dark:bg-slate-800 dark:border-slate-700 text-xs font-black text-indigo-950 dark:text-slate-200 uppercase whitespace-nowrap">
        <tr>{headers.map(header => <th key={header} className="px-4 py-3 text-left font-black tracking-wider whitespace-nowrap">{header}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-slate-100">{children}</tbody>
    </table>
  </div>
);

const CatalogForm: React.FC<{ title: string; children: React.ReactNode; onSave: () => void; saving: boolean }> = ({ title, children, onSave, saving }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
    <h2 className="mb-3 text-sm font-black text-slate-800 dark:text-white">{title}</h2>
    <div className="space-y-2">{children}</div>
    <button onClick={onSave} disabled={saving} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
      <Save size={14} /> Lưu
    </button>
  </div>
);

const TemplateChildren: React.FC<{
  template: CostTemplateDetails;
  canManage: boolean;
  sectionForm: Partial<CostTemplateSection> & { templateId: string; code: string; name: string };
  setSectionForm: React.Dispatch<React.SetStateAction<Partial<CostTemplateSection> & { templateId: string; code: string; name: string }>>;
  parameterForm: Partial<CostTemplateParameter> & { templateId: string; code: string; label: string };
  setParameterForm: React.Dispatch<React.SetStateAction<Partial<CostTemplateParameter> & { templateId: string; code: string; label: string }>>;
  itemForm: Partial<CostTemplateItem> & { templateId: string; code: string; name: string };
  setItemForm: React.Dispatch<React.SetStateAction<Partial<CostTemplateItem> & { templateId: string; code: string; name: string }>>;
  onSaveSection: () => void;
  onSaveParameter: () => void;
  onSaveItem: () => void;
  onDeleteChild: (table: 'sections' | 'items' | 'parameters', id: string, name: string) => void;
  onCreateVersion: (template: CostTemplateDetails) => void;
  onChangeStatus: (template: CostTemplateDetails, action: 'activate' | 'archive') => void;
  onNormalize: (template: CostTemplateDetails) => void;
  saving: boolean;
}> = ({
  template,
  canManage,
  sectionForm,
  setSectionForm,
  parameterForm,
  setParameterForm,
  itemForm,
  setItemForm,
  onSaveSection,
  onSaveParameter,
  onSaveItem,
  onDeleteChild,
  onCreateVersion,
  onChangeStatus,
  onNormalize,
  saving,
}) => {
    const canNormalize = template.metadata?.sourceKind === 'project_wbs_material_raw_template' || template.items.some(item => getRawMaterials(item).length > 0 || getItemMetadata(item).needsNormalization);
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="font-mono text-xs font-black text-indigo-600">{template.code}</div>
              <h2 className="text-lg font-black text-slate-800 dark:text-white">{template.name}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-500">v{template.versionNo} • {statusLabel[template.status]}</span>
              {canManage && canNormalize && <button onClick={() => onNormalize(template)} className={BTN_SOFT}><ShieldCheck size={14} /> Chuẩn hóa</button>}
              {canManage && <button onClick={() => onCreateVersion(template)} className={BTN_SOFT}>Tạo version mới</button>}
              {canManage && template.status !== 'active' && <button onClick={() => onChangeStatus(template, 'activate')} className={BTN_SOFT}>Kích hoạt</button>}
              {canManage && template.status !== 'archived' && <button onClick={() => onChangeStatus(template, 'archive')} className={BTN_SOFT}>Lưu trữ</button>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Metric label="Nhóm" value={template.sections.length} />
            <Metric label="Tham số" value={template.parameters.length} />
            <Metric label="Hạng mục" value={template.items.length} />
          </div>
        </div>

        <div className="grid grid-cols-1 2xl:grid-cols-3 gap-4">
          <Panel title="Nhóm hạng mục" icon={<Layers size={14} />}>
            <div className="space-y-2">
              {template.sections.map(section => (
                <Row key={section.id} title={`${section.code} - ${section.name}`} subtitle={section.calculationMethod || section.unit || ''} onDelete={canManage ? () => onDeleteChild('sections', section.id, section.name) : undefined} />
              ))}
              {canManage && (
                <div className="grid gap-2 pt-2">
                  <input value={sectionForm.code} onChange={e => setSectionForm(prev => ({ ...prev, code: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Mã nhóm" />
                  <input value={sectionForm.name} onChange={e => setSectionForm(prev => ({ ...prev, name: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Tên nhóm" />
                  <input value={sectionForm.calculationMethod || ''} onChange={e => setSectionForm(prev => ({ ...prev, calculationMethod: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Phương pháp tính" />
                  <button onClick={onSaveSection} disabled={saving} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white"><Plus size={13} className="inline" /> Thêm nhóm</button>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Tham số" icon={<Calculator size={14} />}>
            <div className="space-y-2">
              {template.parameters.map(param => (
                <Row key={param.id} title={`${param.code} - ${param.label}`} subtitle={`${param.dataType}${param.unit ? ` • ${param.unit}` : ''}`} onDelete={canManage ? () => onDeleteChild('parameters', param.id, param.label) : undefined} />
              ))}
              {canManage && (
                <div className="grid gap-2 pt-2">
                  <input value={parameterForm.code} onChange={e => setParameterForm(prev => ({ ...prev, code: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Mã tham số" />
                  <input value={parameterForm.label} onChange={e => setParameterForm(prev => ({ ...prev, label: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Tên tham số" />
                  <div className="grid grid-cols-2 gap-2">
                    <select value={parameterForm.dataType} onChange={e => setParameterForm(prev => ({ ...prev, dataType: e.target.value as any }))} className="rounded-xl border px-3 py-2 text-sm">
                      {['number', 'text', 'select', 'boolean', 'date'].map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                    <input value={parameterForm.unit || ''} onChange={e => setParameterForm(prev => ({ ...prev, unit: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="ĐVT" />
                  </div>
                  <button onClick={onSaveParameter} disabled={saving} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white"><Plus size={13} className="inline" /> Thêm tham số</button>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Hạng mục" icon={<PackageSearch size={14} />}>
            <div className="space-y-2">
              {template.items.map(item => (
                <Row key={item.id} title={`${item.code} - ${item.name}`} subtitle={`${item.itemType} • ${item.quantityFormula || item.baseQuantity || 'chưa có công thức'}`} onDelete={canManage ? () => onDeleteChild('items', item.id, item.name) : undefined} />
              ))}
              {canManage && (
                <div className="grid gap-2 pt-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input value={itemForm.code} onChange={e => setItemForm(prev => ({ ...prev, code: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Mã" />
                    <select value={itemForm.sectionId || ''} onChange={e => setItemForm(prev => ({ ...prev, sectionId: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm">
                      <option value="">Không nhóm</option>
                      {template.sections.map(section => <option key={section.id} value={section.id}>{section.code} - {section.name}</option>)}
                    </select>
                  </div>
                  <input value={itemForm.name} onChange={e => setItemForm(prev => ({ ...prev, name: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Tên hạng mục" />
                  <div className="grid grid-cols-2 gap-2">
                    <select value={itemForm.itemType} onChange={e => setItemForm(prev => ({ ...prev, itemType: e.target.value as any }))} className="rounded-xl border px-3 py-2 text-sm">
                      {['work', 'material', 'labor', 'machine', 'subcontract', 'overhead', 'other'].map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                    <input value={itemForm.unit || ''} onChange={e => setItemForm(prev => ({ ...prev, unit: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="ĐVT" />
                  </div>
                  <input value={itemForm.quantityFormula || ''} onChange={e => setItemForm(prev => ({ ...prev, quantityFormula: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Công thức, ví dụ floor_area * 35" />
                  <div className="grid grid-cols-3 gap-2">
                    <input type="number" value={itemForm.overheadPercent || 0} onChange={e => setItemForm(prev => ({ ...prev, overheadPercent: num(e.target.value) }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="CP chung %" />
                    <input type="number" value={itemForm.profitPercent || 0} onChange={e => setItemForm(prev => ({ ...prev, profitPercent: num(e.target.value) }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="LN %" />
                    <input type="number" value={itemForm.riskBufferPercent || 0} onChange={e => setItemForm(prev => ({ ...prev, riskBufferPercent: num(e.target.value) }))} className="rounded-xl border px-3 py-2 text-sm" placeholder="Risk %" />
                  </div>
                  <button onClick={onSaveItem} disabled={saving} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white"><Plus size={13} className="inline" /> Thêm hạng mục</button>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    );
  };

const TemplateNormalizationPanel: React.FC<{
  template: CostTemplateDetails;
  report: CostTemplateNormalizationReport | null;
  canManage: boolean;
  saving: boolean;
  onOpenItem: (item: CostTemplateItem) => void;
  onCreateDraftNorms: (template: CostTemplateDetails) => void;
  onRefresh: () => void;
}> = ({ template, report, canManage, saving, onOpenItem, onCreateDraftNorms, onRefresh }) => {
  const sectionById = new Map(template.sections.map(section => [section.id, section]));
  return (
    <div className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[10px] font-black uppercase text-emerald-600">Chuẩn hóa template thô</div>
          <h2 className="text-base font-black text-slate-800 dark:text-white">{template.name}</h2>
          <p className="text-xs font-bold text-slate-500">Chuẩn hóa đơn vị, khối lượng mẫu, mã công việc và vật tư trước khi kích hoạt/sinh định mức.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onRefresh} className={BTN_SOFT}><RefreshCw size={14} /> Cập nhật KPI</button>
          {canManage && <button onClick={() => onCreateDraftNorms(template)} disabled={saving} className={BTN_PRIMARY}><PackageSearch size={14} /> Tạo định mức nháp</button>}
        </div>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Metric label="Tổng item" value={report.totalItems} />
            <Metric label="Thô" value={report.rawItems} />
            <Metric label="Đang rà" value={report.reviewingItems} />
            <Metric label="Đã chuẩn" value={report.normalizedItems} />
            <Metric label="Bỏ qua" value={report.ignoredItems} />
            <Metric label="Thiếu ĐVT" value={report.missingUnitItems} />
            <Metric label="Thiếu KL" value={report.missingQuantityItems} />
            <Metric label="VT chuẩn" value={`${report.normalizedMaterialRows}/${report.rawMaterialRows}`} />
          </div>
          {!report.canActivate && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">
              <AlertTriangle size={14} className="mr-1 inline" />
              Chưa đủ điều kiện kích hoạt: {report.blockers.join(' • ')}
            </div>
          )}
          {report.canActivate && (
            <div className="rounded-xl border border-emerald-200 bg-white p-3 text-xs font-bold text-emerald-700">
              <CheckCircle2 size={14} className="mr-1 inline" />
              Template đã qua gate chuẩn hóa, có thể kích hoạt nếu nghiệp vụ đã duyệt.
            </div>
          )}
        </>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800">
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="bg-indigo-50/80 border-b border-indigo-100/80 dark:bg-slate-800 dark:border-slate-700 text-xs font-black text-indigo-950 dark:text-slate-200 uppercase whitespace-nowrap">
            <tr>
              {['WBS', 'Hạng mục', 'Nhóm', 'ĐVT chuẩn', 'KL mẫu', 'VT thô', 'VT chuẩn', 'Trạng thái', ''].map(header => (
                <th key={header} className="px-4 py-3 text-left font-black tracking-wider whitespace-nowrap">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {template.items.map(item => {
              const metadata = getItemMetadata(item);
              const rawMaterials = getRawMaterials(item);
              const normalizedMaterials = getNormalizedMaterials(item);
              const status = getNormalizationStatus(item);
              const section = item.sectionId ? sectionById.get(item.sectionId) : null;
              return (
                <tr key={item.id}>
                  <td className={`${TD} font-mono`}>{metadata.sourceWbsCode ? String(metadata.sourceWbsCode) : item.code}</td>
                  <td className={`${TD} font-bold`}>{item.name}</td>
                  <td className={TD}>{section ? `${section.code} - ${section.name}` : '-'}</td>
                  <td className={TD}>{String(metadata.standardUnit || item.unit || '-')}</td>
                  <td className={TD}>{String(metadata.standardBaseQuantity ?? item.baseQuantity ?? '-')}</td>
                  <td className={TD}>{rawMaterials.length}</td>
                  <td className={TD}>{normalizedMaterials.length}</td>
                  <td className={TD}>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-black ${status === 'normalized' ? 'bg-emerald-100 text-emerald-700' :
                      status === 'ignored' ? 'bg-slate-100 text-slate-500' :
                        status === 'reviewing' ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                      }`}>
                      {normalizationLabel[status]}
                    </span>
                  </td>
                  <td className={`${TD} text-right`}>
                    <button onClick={() => onOpenItem(item)} className={BTN_SOFT}>Chi tiết</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const NormalizationItemModal: React.FC<{
  item: CostTemplateItem;
  form: NormalizationFormState;
  setForm: React.Dispatch<React.SetStateAction<NormalizationFormState>>;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}> = ({ item, form, setForm, saving, onSave, onClose }) => {
  const rawMaterials = getRawMaterials(item);
  const setMaterial = (index: number, patch: Partial<NormalizedTemplateMaterial>) =>
    setForm(prev => ({
      ...prev,
      normalizedMaterials: prev.normalizedMaterials.map((material, idx) => idx === index ? { ...material, ...patch } : material),
    }));
  const addMaterial = () => setForm(prev => ({
    ...prev,
    normalizedMaterials: [...prev.normalizedMaterials, { itemName: '', category: '', unit: '', quantity: 0, conversionFactor: 1, note: '', sortOrder: prev.normalizedMaterials.length }],
  }));
  const removeMaterial = (index: number) => setForm(prev => ({
    ...prev,
    normalizedMaterials: prev.normalizedMaterials.filter((_, idx) => idx !== index),
  }));

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-xs font-black text-indigo-600">{item.code}</div>
            <h2 className="text-lg font-black text-slate-800 dark:text-white">{item.name}</h2>
            <p className="text-xs font-bold text-slate-400">Chuẩn hóa dữ liệu thô thành đầu mục và vật tư có thể sinh định mức draft.</p>
          </div>
          <button onClick={onClose} className={BTN_MINI}><X size={14} /></button>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <label className="text-xs font-bold text-slate-500">
            Trạng thái
            <select value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value as CostTemplateNormalizationStatus }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              {(['raw', 'reviewing', 'normalized', 'ignored'] as CostTemplateNormalizationStatus[]).map(status => (
                <option key={status} value={status}>{normalizationLabel[status]}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-500">
            ĐVT chuẩn
            <input value={form.standardUnit} onChange={e => setForm(prev => ({ ...prev, standardUnit: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" placeholder="m2, kg, bộ..." />
          </label>
          <label className="text-xs font-bold text-slate-500">
            Khối lượng mẫu
            <input type="number" value={form.standardBaseQuantity} onChange={e => setForm(prev => ({ ...prev, standardBaseQuantity: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-bold text-slate-500">
            Mã công việc chuẩn
            <input value={form.standardWorkCode} onChange={e => setForm(prev => ({ ...prev, standardWorkCode: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
        </div>
        <textarea value={form.note} onChange={e => setForm(prev => ({ ...prev, note: e.target.value }))} className="mt-3 min-h-[72px] w-full rounded-xl border px-3 py-2 text-sm" placeholder="Ghi chú chuẩn hóa, lý do bỏ qua, hoặc điểm cần bổ sung..." />

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel title="Vật tư thô từ Sơn Miền Bắc" icon={<PackageSearch size={14} />}>
            <div className="max-h-72 overflow-y-auto">
              {rawMaterials.length === 0 && <div className="text-xs font-bold text-slate-400">Hạng mục này chưa có vật tư thô.</div>}
              {rawMaterials.map((material, index) => (
                <div key={`${material.sourceMaterialBudgetItemId || material.itemName}-${index}`} className="mb-2 rounded-xl border border-slate-100 p-2 text-xs">
                  <div className="font-black text-slate-700">{material.itemName}</div>
                  <div className="text-slate-400">{material.materialCode || '-'} • {material.category || '-'} • {String(material.budgetQty ?? '-')} {material.unit || ''}</div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Vật tư chuẩn để sinh định mức" icon={<ShieldCheck size={14} />}>
            <div className="space-y-2">
              {form.normalizedMaterials.map((material, index) => (
                <div key={index} className="rounded-xl border border-slate-100 p-2">
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_120px_90px_100px_36px]">
                    <input value={material.itemName} onChange={e => setMaterial(index, { itemName: e.target.value })} className="rounded-lg border px-2 py-1 text-xs" placeholder="Tên vật tư chuẩn" />
                    <input value={material.materialCode || ''} onChange={e => setMaterial(index, { materialCode: e.target.value })} className="rounded-lg border px-2 py-1 text-xs" placeholder="Mã" />
                    <input value={material.unit} onChange={e => setMaterial(index, { unit: e.target.value })} className="rounded-lg border px-2 py-1 text-xs" placeholder="ĐVT" />
                    <input type="number" value={material.quantity} onChange={e => setMaterial(index, { quantity: num(e.target.value) })} className="rounded-lg border px-2 py-1 text-xs" placeholder="Định mức/KL" />
                    <button onClick={() => removeMaterial(index)} className={BTN_MINI}><Trash2 size={13} /></button>
                  </div>
                  <input value={material.note || ''} onChange={e => setMaterial(index, { note: e.target.value })} className="mt-2 w-full rounded-lg border px-2 py-1 text-xs" placeholder="Ghi chú vật tư" />
                </div>
              ))}
              <button onClick={addMaterial} className={BTN_SOFT}><Plus size={14} /> Thêm vật tư chuẩn</button>
            </div>
          </Panel>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className={BTN_SOFT}>Đóng</button>
          <button onClick={onSave} disabled={saving} className={BTN_PRIMARY}><Save size={14} /> Lưu chuẩn hóa</button>
        </div>
      </div>
    </div>
  );
};

const EstimateDetail: React.FC<{
  estimate: EstimateScenarioDetails | null;
  canManage: boolean;
  canSeeInternalCost: boolean;
  lineEdits: Record<string, { quantity: number; unitPrice: number; quoteUnitPrice: number; overrideReason: string }>;
  setLineEdits: React.Dispatch<React.SetStateAction<Record<string, { quantity: number; unitPrice: number; quoteUnitPrice: number; overrideReason: string }>>>;
  onSaveLine: (item: EstimateItem) => void;
  onReview: () => void;
  onFinalize: () => void;
  onExport: (mode: EstimateExportMode) => void;
  convertType: ContractItemType;
  setConvertType: React.Dispatch<React.SetStateAction<ContractItemType>>;
  convertContractId: string;
  setConvertContractId: React.Dispatch<React.SetStateAction<string>>;
  convertContracts: Array<CustomerContract | SubcontractorContract>;
  onPreviewConvert: () => void;
  conversionPreview: EstimateConversionPreview | null;
  conversionAudit: EstimateConversionAudit | null;
  onConvert: () => void;
  onRollbackConvert: () => void;
  finalizeOverrideReason: string;
  setFinalizeOverrideReason: React.Dispatch<React.SetStateAction<string>>;
  saving: boolean;
}> = ({
  estimate,
  canManage,
  canSeeInternalCost,
  lineEdits,
  setLineEdits,
  onSaveLine,
  onReview,
  onFinalize,
  onExport,
  convertType,
  setConvertType,
  convertContractId,
  setConvertContractId,
  convertContracts,
  onPreviewConvert,
  conversionPreview,
  conversionAudit,
  onConvert,
  onRollbackConvert,
  finalizeOverrideReason,
  setFinalizeOverrideReason,
  saving,
}) => {
    if (!estimate) return <EmptyState title="Chọn hoặc tạo một phương án dự toán" />;
    const setLine = (id: string, patch: Partial<{ quantity: number; unitPrice: number; quoteUnitPrice: number; overrideReason: string }>) =>
      setLineEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    const floorArea = num(estimate.inputParameters?.floor_area);
    const quoteAmount = estimate.quoteAmount || estimate.totalAmount;
    const missingPriceWarnings = (estimate.riskWarnings || []).filter(value => String(value).toLowerCase().includes('chưa có đơn giá'));
    const formulaWarnings = (estimate.riskWarnings || []).filter(value => {
      const text = String(value).toLowerCase();
      return text.includes('thiếu tham số') || text.includes('chưa tính được khối lượng');
    });
    const materialItems = estimate.items.filter(item => item.itemType === 'material');
    const grouped = estimate.items.reduce<Record<string, { count: number; quoteAmount: number }>>((acc, item) => {
      const key = item.itemType;
      acc[key] ||= { count: 0, quoteAmount: 0 };
      acc[key].count += 1;
      acc[key].quoteAmount += num(item.quoteAmount ?? item.amount);
      return acc;
    }, {});
    const conversionBatch = conversionAudit?.batch || null;
    const conversionItems = conversionAudit?.items || [];
    const activeConversionBatch = conversionBatch && conversionBatch.status !== 'cancelled';

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="font-mono text-xs font-black text-indigo-600">{estimate.code}</div>
              <h2 className="text-lg font-black text-slate-800 dark:text-white">{estimate.name}</h2>
              <div className="text-xs font-bold text-slate-400">{statusLabel[estimate.status]} • confidence {Math.round(num(estimate.confidenceScore) * 100)}%</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {estimate.status === 'draft' && <button onClick={onReview} disabled={saving} className={BTN_SOFT}><CheckCircle2 size={14} /> Rà soát</button>}
              {estimate.status !== 'finalized' && estimate.status !== 'converted' && <button onClick={onFinalize} disabled={saving || formulaWarnings.length > 0} className={BTN_PRIMARY}><ShieldCheck size={14} /> Chốt</button>}
              <button onClick={() => onExport('external')} disabled={!['reviewed', 'finalized'].includes(estimate.status)} className={BTN_SOFT}><Download size={14} /> Excel gửi khách</button>
              {canSeeInternalCost && <button onClick={() => onExport('internal')} className={BTN_SOFT}><FileSpreadsheet size={14} /> Excel nội bộ</button>}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Giá vốn nội bộ" value={canSeeInternalCost ? money(estimate.totalAmount) : 'Ẩn'} />
            <Metric label="Giá chào" value={money(quoteAmount)} />
            <Metric label="Lợi nhuận dự kiến" value={canSeeInternalCost ? money(estimate.profitAmount || 0) : 'Ẩn'} />
            <Metric label="Số dòng" value={estimate.items.length} />
            <Metric label="Đơn giá/m2" value={floorArea > 0 ? money(Math.round(quoteAmount / floorArea)) : '-'} />
            <Metric label="Dòng vật tư" value={materialItems.length} />
            <Metric label="Manual override" value={estimate.items.filter(item => item.manualOverride).length} />
            <Metric label="Thiếu đơn giá" value={missingPriceWarnings.length} />
            <Metric label="Lỗi công thức" value={formulaWarnings.length} />
          </div>
          {formulaWarnings.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
              <AlertTriangle size={14} className="inline mr-1" />
              {formulaWarnings.slice(0, 4).join(' • ')}
            </div>
          )}
          {missingPriceWarnings.length > 0 && canSeeInternalCost && estimate.status !== 'finalized' && estimate.status !== 'converted' && (
            <div className="mt-3">
              <input
                value={finalizeOverrideReason}
                onChange={e => setFinalizeOverrideReason(e.target.value)}
                className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700"
                placeholder="HD admin nhập lý do ngoại lệ nếu vẫn muốn chốt khi thiếu đơn giá active"
              />
            </div>
          )}
          {estimate.riskWarnings.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">
              <AlertTriangle size={14} className="inline mr-1" />
              {estimate.riskWarnings.slice(0, 4).join(' • ')}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Khái toán nhanh" icon={<Calculator size={14} />}>
            <div className="space-y-2">
              <Metric label="Tổng giá chào" value={money(quoteAmount)} />
              <Metric label="Đơn giá bình quân/m2" value={floorArea > 0 ? money(Math.round(quoteAmount / floorArea)) : '-'} />
              <Metric label="Sai số dự kiến" value={missingPriceWarnings.length > 0 ? 'Cao' : 'Trung bình'} />
            </div>
          </Panel>
          <Panel title="Theo hạng mục" icon={<Layers size={14} />}>
            <div className="space-y-2">
              {Object.entries(grouped).map(([type, value]) => <Metric key={type} label={`${type} • ${value.count} dòng`} value={money(value.quoteAmount)} />)}
            </div>
          </Panel>
          <Panel title="BOQ vật tư sơ bộ" icon={<PackageSearch size={14} />}>
            <div className="space-y-2">
              {materialItems.slice(0, 5).map(item => <Row key={item.id} title={`${item.code || ''} ${item.name}`} subtitle={`${item.quantity} ${item.unit || ''}`} />)}
              {materialItems.length === 0 && <div className="text-xs font-bold text-slate-400">Chưa có dòng vật tư</div>}
            </div>
          </Panel>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-indigo-50/80 border-b border-indigo-100/80 dark:bg-slate-800 dark:border-slate-700 text-xs font-black text-indigo-950 dark:text-slate-200 uppercase whitespace-nowrap">
              <tr>
                {['Mã', 'Hạng mục', 'Loại', 'KL', 'Đơn giá vốn', 'Thành tiền vốn', 'Đơn giá chào', 'Thành tiền chào', 'Lý do chỉnh', ''].map(header => <th key={header} className="px-4 py-3 text-left font-black tracking-wider whitespace-nowrap">{header}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {estimate.items.map(item => {
                const edit = lineEdits[item.id] || { quantity: item.quantity, unitPrice: item.unitPrice, quoteUnitPrice: item.quoteUnitPrice ?? item.unitPrice, overrideReason: item.overrideReason || '' };
                return (
                  <tr key={item.id}>
                    <td className={`${TD} font-mono`}>{item.code}</td>
                    <td className={`${TD} font-bold`}>{item.name}</td>
                    <td className={TD}>{item.itemType}</td>
                    <td className={TD}><input type="number" value={edit.quantity} onChange={e => setLine(item.id, { quantity: num(e.target.value) })} className="w-24 rounded-lg border px-2 py-1 text-xs" /></td>
                    <td className={TD}>{canSeeInternalCost ? <input type="number" value={edit.unitPrice} onChange={e => setLine(item.id, { unitPrice: num(e.target.value) })} className="w-28 rounded-lg border px-2 py-1 text-xs" /> : 'Ẩn'}</td>
                    <td className={`${TD} font-bold`}>{canSeeInternalCost ? money(item.amount) : 'Ẩn'}</td>
                    <td className={TD}><input type="number" value={edit.quoteUnitPrice} onChange={e => setLine(item.id, { quoteUnitPrice: num(e.target.value) })} className="w-28 rounded-lg border px-2 py-1 text-xs" /></td>
                    <td className={`${TD} font-black`}>{money(item.quoteAmount ?? item.amount)}</td>
                    <td className={TD}><input value={edit.overrideReason} onChange={e => setLine(item.id, { overrideReason: e.target.value })} className="w-44 rounded-lg border px-2 py-1 text-xs" placeholder="Bắt buộc nếu chỉnh" /></td>
                    <td className={`${TD} text-right`}><button onClick={() => onSaveLine(item)} className={BTN_MINI}><Save size={13} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
          <h3 className="mb-3 text-sm font-black text-slate-800 dark:text-white">Tạo bản nháp BOQ dự án</h3>
          {!canManage && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
              Chỉ ADMIN hoặc HD admin được chuyển estimate sang BOQ/Material Plan.
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[180px_minmax(0,1fr)_120px_120px]">
            <select value={convertType} onChange={e => setConvertType(e.target.value as ContractItemType)} disabled={!canManage} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50">
              <option value="customer">HĐ nhận thầu</option>
              <option value="subcontractor">HĐ thầu phụ</option>
            </select>
            <select value={convertContractId} onChange={e => setConvertContractId(e.target.value)} disabled={!canManage} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50">
              <option value="">Chọn hợp đồng</option>
              {convertContracts.map(contract => <option key={contract.id} value={contract.id}>{contract.code} - {contract.name}</option>)}
            </select>
            <button onClick={onPreviewConvert} disabled={!canManage || saving || estimate.status !== 'finalized' || !convertContractId} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-600 disabled:opacity-50">
              <Eye size={14} className="inline" /> Preview
            </button>
            <button onClick={onConvert} disabled={!canManage || saving || estimate.status !== 'finalized' || !convertContractId || !conversionPreview} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-black text-white disabled:opacity-50">
              Tạo nháp
            </button>
          </div>
          {conversionPreview && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Contract BOQ" value={conversionPreview.contractItems.length} />
                <Metric label="Work BOQ" value={conversionPreview.workBoqItems.length} />
                <Metric label="Material Plan" value={conversionPreview.materialBudgetItems.length} />
              </div>
              <div className="max-h-48 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-indigo-50/80 border-b border-indigo-100/80 dark:bg-slate-800 dark:border-slate-700 text-xs font-black text-indigo-950 dark:text-slate-200 uppercase whitespace-nowrap">
                    <tr>
                      {['Target', 'Mã', 'Tên', 'KL/GT'].map(header => <th key={header} className="px-4 py-3 text-left font-black tracking-wider whitespace-nowrap">{header}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[
                      ...conversionPreview.contractItems.map(item => ({ target: 'Contract BOQ', code: item.code, name: item.name, value: `${item.quantity} ${item.unit} • ${money(item.totalPrice)}` })),
                      ...conversionPreview.workBoqItems.map(item => ({ target: 'Work BOQ', code: item.wbsCode || '', name: item.name, value: `${item.plannedQty} ${item.unit}` })),
                      ...conversionPreview.materialBudgetItems.map(item => ({ target: 'Material Plan', code: item.materialCode || '', name: item.itemName, value: `${item.budgetQty} ${item.unit}` })),
                    ].slice(0, 12).map((row, index) => (
                      <tr key={`${row.target}-${row.code}-${index}`}>
                        <td className={TD}>{row.target}</td>
                        <td className={`${TD} font-mono`}>{row.code}</td>
                        <td className={`${TD} font-bold`}>{row.name}</td>
                        <td className={TD}>{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {conversionBatch && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xs font-black text-slate-700">Conversion batch: {conversionBatch.status}</div>
                  <div className="text-[10px] font-bold text-slate-400">{conversionBatch.id}</div>
                </div>
                {canManage && activeConversionBatch && estimate.status === 'converted' && (
                  <button onClick={onRollbackConvert} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
                    <Trash2 size={14} /> Rollback
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Contract BOQ" value={conversionItems.filter(item => item.targetTable === 'contract_items').length} />
                <Metric label="Work BOQ" value={conversionItems.filter(item => item.targetTable === 'project_work_boq_items').length} />
                <Metric label="Material Plan" value={conversionItems.filter(item => item.targetTable === 'material_budget_items').length} />
              </div>
              {conversionItems.length > 0 && (
                <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-xs">
                    <thead className="bg-indigo-50/80 border-b border-indigo-100/80 dark:bg-slate-800 dark:border-slate-700 text-xs font-black text-indigo-950 dark:text-slate-200 uppercase whitespace-nowrap">
                      <tr>
                        {['Bảng đích', 'Mã', 'Tên', 'Target ID'].map(header => <th key={header} className="px-4 py-3 text-left font-black tracking-wider whitespace-nowrap">{header}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {conversionItems.slice(0, 12).map(item => (
                        <tr key={item.id}>
                          <td className={TD}>{item.targetTable}</td>
                          <td className={`${TD} font-mono`}>{item.targetCode || '-'}</td>
                          <td className={`${TD} font-bold`}>{item.targetName || '-'}</td>
                          <td className={`${TD} font-mono text-[10px]`}>{item.targetId}</td>
                        </tr>
                      ))}
                      {conversionItems.length > 12 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-2 text-center text-xs font-bold text-slate-400">Còn {conversionItems.length - 12} dòng mapping khác</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

const Panel: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
    <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800 dark:text-white">{icon} {title}</h3>
    {children}
  </div>
);

const Row: React.FC<{ title: string; subtitle?: string; onDelete?: () => void }> = ({ title, subtitle, onDelete }) => (
  <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
    <div className="min-w-0">
      <div className="truncate text-xs font-black text-slate-700">{title}</div>
      {subtitle && <div className="truncate text-[10px] font-bold text-slate-400">{subtitle}</div>}
    </div>
    {onDelete && <IconButton icon={<Trash2 size={13} />} title="Xoá" onClick={onDelete} />}
  </div>
);

const Metric: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-xl bg-slate-50 px-3 py-2">
    <div className="text-[10px] font-bold uppercase text-slate-400">{label}</div>
    <div className="text-sm font-black text-slate-800">{value}</div>
  </div>
);

export default CostLibrary;
