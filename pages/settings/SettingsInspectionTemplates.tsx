import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Edit2, Trash2, Archive, X, Save, Layers, ClipboardCheck, PlusCircle,
  Check, ArrowRight, Settings, Sparkles, HelpCircle, CheckSquare,
  FileText, Activity, Compass, ArrowUp, ArrowDown, FolderPlus,
  BookOpen, Eye, FolderKanban, ShieldCheck, AlertCircle, FilePlus
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { qualityChecklistService } from '../../lib/qualityChecklistService';
import {
  InspectionCategory,
  InspectionWorkType,
  InspectionTemplate,
  InspectionTemplateSection,
  InspectionTemplateItem,
  InspectionItemType
} from '../../types';

const CATEGORY_ICONS: Record<string, string> = {
  'CAT-MONG': '🏗️',
  'CAT-THEP': '⚙️',
};

const emptyTemplate = (workTypeId: string): Partial<InspectionTemplate> => ({
  workTypeId,
  code: '',
  name: '',
  version: 1,
  isActive: true,
  description: '',
  standardReference: '',
  inspectionPurpose: '',
  riskLevel: 'medium',
  discipline: 'civil',
});

const emptyItem = (sectionId: string): Partial<InspectionTemplateItem> => ({
  sectionId,
  itemName: '',
  dataType: 'checkbox',
  required: true,
  sortOrder: 1,
  acceptanceCriteria: '',
  inspectionMethod: '',
  unit: '',
  minValue: undefined,
  maxValue: undefined,
});

const SettingsInspectionTemplates: React.FC = () => {
  const toast = useToast();
  
  // Dynamic Categories & Work Types States
  const [categories, setCategories] = useState<InspectionCategory[]>([]);
  const [workTypes, setWorkTypes] = useState<InspectionWorkType[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<string>('');
  const [selectedWtId, setSelectedWtId] = useState<string>('');
  
  // Templates States
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<(InspectionTemplate & { sections: (InspectionTemplateSection & { items: InspectionTemplateItem[] })[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);

  // Modals / Forms States
  const [isTplModalOpen, setIsTplModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<InspectionTemplate | null>(null);
  const [tplForm, setTplForm] = useState<Partial<InspectionTemplate>>({});
  const [savingTpl, setSavingTpl] = useState(false);

  // Dynamic Section States
  const [isSecModalOpen, setIsSecModalOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<InspectionTemplateSection | null>(null);
  const [secNameForm, setSecNameForm] = useState('');
  const [secOrderForm, setSecOrderForm] = useState(1);
  const [savingSec, setSavingSec] = useState(false);

  // Item Form states
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState<Partial<InspectionTemplateItem>>({});
  const [newItemSectionId, setNewItemSectionId] = useState<string | null>(null);
  const [newItemForm, setNewItemForm] = useState<Partial<InspectionTemplateItem>>({});
  const [savingItem, setSavingItem] = useState(false);

  // ===================== CATEGORY CRUD STATES & HANDLERS =====================
  const [isCatModalOpen, setIsCatModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<InspectionCategory | null>(null);
  const [catForm, setCatForm] = useState<Partial<InspectionCategory>>({ code: '', name: '' });
  const [savingCat, setSavingCat] = useState(false);

  const handleOpenCreateCat = () => {
    setEditingCategory(null);
    setCatForm({ code: '', name: '' });
    setIsCatModalOpen(true);
  };

  const handleOpenEditCat = (cat: InspectionCategory, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCategory(cat);
    setCatForm({ ...cat });
    setIsCatModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catForm.name?.trim() || !catForm.code?.trim()) {
      toast.warning('Thiếu thông tin', 'Vui lòng nhập Tên và Mã hạng mục chuẩn.');
      return;
    }
    setSavingCat(true);
    try {
      if (editingCategory) {
        await qualityChecklistService.updateCategory(editingCategory.id, catForm);
        toast.success('Đã cập nhật Hạng mục chuẩn');
      } else {
        const created = await qualityChecklistService.createCategory(catForm);
        toast.success('Đã thêm Hạng mục chuẩn mới');
        setSelectedCatId(created.id);
      }
      setIsCatModalOpen(false);
      
      // Reload entire list of categories
      const cats = await qualityChecklistService.listCategories();
      setCategories(cats);
      
      if (editingCategory) {
        if (selectedCatId === editingCategory.id) {
          handleCategoryChange(editingCategory.id);
        }
      } else {
        const catsNew = await qualityChecklistService.listCategories();
        if (catsNew.length > 0) {
          const newCat = catsNew.find(c => c.code === catForm.code);
          if (newCat) {
            handleCategoryChange(newCat.id);
          }
        }
      }
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.saveCategory', error);
      toast.error('Lỗi khi lưu Hạng mục chuẩn', getApiErrorMessage(error));
    } finally {
      setSavingCat(false);
    }
  };

  const handleDeleteCategory = async (cat: InspectionCategory, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Xác nhận Xóa Hạng mục chuẩn "${cat.name}" (${cat.code})?\n\nCẢNH BÁO NGUY HIỂM: Do cấu trúc cascade, việc này sẽ xóa TOÀN BỘ Loại công tác, Mẫu nghiệm thu, Sections và Tiêu chí kiểm tra thuộc Hạng mục này khỏi hệ thống!`)) return;
    try {
      await qualityChecklistService.removeCategory(cat.id);
      toast.success('Đã xóa Hạng mục chuẩn thành công');
      
      const cats = await qualityChecklistService.listCategories();
      setCategories(cats);
      
      if (selectedCatId === cat.id) {
        if (cats.length > 0) {
          handleCategoryChange(cats[0].id);
        } else {
          setSelectedCatId('');
          setWorkTypes([]);
          setSelectedWtId('');
          setTemplates([]);
          setSelectedTemplate(null);
        }
      }
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.deleteCategory', error);
      toast.error('Lỗi xóa Hạng mục chuẩn', getApiErrorMessage(error));
    }
  };

  // ===================== WORK TYPE CRUD STATES & HANDLERS =====================
  const [isWtModalOpen, setIsWtModalOpen] = useState(false);
  const [editingWorkType, setEditingWorkType] = useState<InspectionWorkType | null>(null);
  const [wtForm, setWtForm] = useState<Partial<InspectionWorkType>>({ categoryId: '', code: '', name: '' });
  const [savingWt, setSavingWt] = useState(false);

  const handleOpenCreateWt = () => {
    if (!selectedCatId) {
      toast.warning('Chú ý', 'Vui lòng chọn hoặc thêm một Hạng mục chuẩn trước.');
      return;
    }
    setEditingWorkType(null);
    setWtForm({ categoryId: selectedCatId, code: '', name: '' });
    setIsWtModalOpen(true);
  };

  const handleOpenEditWt = (wt: InspectionWorkType, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingWorkType(wt);
    setWtForm({ ...wt });
    setIsWtModalOpen(true);
  };

  const handleSaveWorkType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wtForm.name?.trim() || !wtForm.code?.trim() || !wtForm.categoryId) {
      toast.warning('Thiếu thông tin', 'Vui lòng điền đầy đủ Tên, Mã công tác và Hạng mục liên kết.');
      return;
    }
    setSavingWt(true);
    try {
      if (editingWorkType) {
        await qualityChecklistService.updateWorkType(editingWorkType.id, wtForm);
        toast.success('Đã cập nhật Loại công tác');
      } else {
        const created = await qualityChecklistService.createWorkType(wtForm);
        toast.success('Đã thêm Loại công tác mới');
      }
      setIsWtModalOpen(false);
      
      const wts = await qualityChecklistService.listWorkTypes(selectedCatId);
      setWorkTypes(wts);
      
      if (editingWorkType) {
        if (selectedWtId === editingWorkType.id) {
          setSelectedWtId(editingWorkType.id);
          loadTemplates();
        }
      } else {
        const wtsNew = await qualityChecklistService.listWorkTypes(selectedCatId);
        const newWt = wtsNew.find(w => w.code === wtForm.code);
        if (newWt) {
          setSelectedWtId(newWt.id);
          setSelectedTemplate(null);
          loadTemplates();
        }
      }
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.saveWorkType', error);
      toast.error('Lỗi khi lưu Loại công tác', getApiErrorMessage(error));
    } finally {
      setSavingWt(false);
    }
  };

  const handleDeleteWorkType = async (wt: InspectionWorkType, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Xác nhận Xóa Loại công tác "${wt.name}" (${wt.code})?\n\nCẢNH BÁO: Việc này sẽ xóa toàn bộ Mẫu nghiệm thu, Sections và Tiêu chí thuộc công tác này!`)) return;
    try {
      await qualityChecklistService.removeWorkType(wt.id);
      toast.success('Đã xóa Loại công tác thành công');
      
      const wts = await qualityChecklistService.listWorkTypes(selectedCatId);
      setWorkTypes(wts);
      
      if (selectedWtId === wt.id) {
        if (wts.length > 0) {
          setSelectedWtId(wts[0].id);
          setSelectedTemplate(null);
          loadTemplates();
        } else {
          setSelectedWtId('');
          setTemplates([]);
          setSelectedTemplate(null);
        }
      }
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.deleteWorkType', error);
      toast.error('Lỗi xóa Loại công tác', getApiErrorMessage(error));
    }
  };


  // Load basic Metadata (Categories and Work Types)
  const loadMetadata = useCallback(async () => {
    setLoading(true);
    try {
      const cats = await qualityChecklistService.listCategories();
      setCategories(cats);
      
      if (cats.length > 0) {
        const defaultCatId = cats[0].id;
        setSelectedCatId(defaultCatId);
        
        const wts = await qualityChecklistService.listWorkTypes(defaultCatId);
        setWorkTypes(wts);
        
        if (wts.length > 0) {
          setSelectedWtId(wts[0].id);
        }
      }
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.loadMetadata', error);
      toast.error('Không tải được danh mục gốc', getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  // Load work types when category changes
  const handleCategoryChange = async (catId: string) => {
    setSelectedCatId(catId);
    setSelectedTemplate(null);
    try {
      const wts = await qualityChecklistService.listWorkTypes(catId);
      setWorkTypes(wts);
      if (wts.length > 0) {
        setSelectedWtId(wts[0].id);
      } else {
        setSelectedWtId('');
        setTemplates([]);
      }
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.handleCategoryChange', error);
      toast.error('Lỗi khi tải loại công tác', getApiErrorMessage(error));
    }
  };

  // Load templates when work type changes
  const loadTemplates = useCallback(async () => {
    if (!selectedWtId) {
      setTemplates([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await qualityChecklistService.listAllTemplates(selectedWtId);
      setTemplates(rows);
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.loadTemplates', error);
      toast.error('Không tải được mẫu nghiệm thu', getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [selectedWtId, toast]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Load detailed template sections and items
  const loadTemplateDetails = useCallback(async (templateId: string) => {
    setItemsLoading(true);
    try {
      const data = await qualityChecklistService.getTemplateWithItems(templateId);
      setSelectedTemplate(data);
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.loadTemplateDetails', error);
      toast.error('Không tải được cấu trúc tiêu chí', getApiErrorMessage(error));
    } finally {
      setItemsLoading(false);
    }
  }, [toast]);

  // Template Handlers
  const handleOpenCreateTpl = () => {
    if (!selectedWtId) {
      toast.warning('Chú ý', 'Vui lòng chọn hoặc cấu hình ít nhất một Loại công tác.');
      return;
    }
    setEditingTemplate(null);
    setTplForm(emptyTemplate(selectedWtId));
    setIsTplModalOpen(true);
  };

  const handleOpenEditTpl = (tpl: InspectionTemplate) => {
    setEditingTemplate(tpl);
    setTplForm({ ...tpl });
    setIsTplModalOpen(true);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tplForm.name?.trim() || !tplForm.code?.trim()) {
      toast.warning('Thiếu thông tin', 'Vui lòng nhập Tên và Mã mẫu.');
      return;
    }
    setSavingTpl(true);
    try {
      if (editingTemplate) {
        await qualityChecklistService.updateTemplate(editingTemplate.id, tplForm);
        toast.success('Đã cập nhật mẫu nghiệm thu');
        if (selectedTemplate?.id === editingTemplate.id) {
          loadTemplateDetails(editingTemplate.id);
        }
      } else {
        const created = await qualityChecklistService.createTemplate(tplForm);
        toast.success('Đã thêm mẫu nghiệm thu mới');
        
        // Auto-seed initial standard sections for a brand new template to save time
        const prepSec = await qualityChecklistService.createSection({
          templateId: created.id,
          name: 'Công tác chuẩn bị',
          sortOrder: 1
        });
        await qualityChecklistService.createSection({
          templateId: created.id,
          name: 'Tiêu chuẩn kỹ thuật',
          sortOrder: 2
        });

        loadTemplateDetails(created.id);
      }
      setIsTplModalOpen(false);
      await loadTemplates();
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.saveTemplate', error);
      toast.error('Lỗi khi lưu mẫu', getApiErrorMessage(error));
    } finally {
      setSavingTpl(false);
    }
  };

  const handleDeleteTemplate = async (tpl: InspectionTemplate) => {
    if (!confirm(`Xóa mẫu nghiệm thu "${tpl.name}" (${tpl.code})? Hành động này sẽ xóa toàn bộ sections và tiêu chí con.`)) return;
    try {
      await qualityChecklistService.removeTemplate(tpl.id);
      if (selectedTemplate?.id === tpl.id) {
        setSelectedTemplate(null);
      }
      await loadTemplates();
      toast.success('Đã xóa mẫu thành công');
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.deleteTemplate', error);
      toast.error('Lỗi xóa mẫu', getApiErrorMessage(error));
    }
  };

  const handleToggleActiveTemplate = async (tpl: InspectionTemplate) => {
    const nextActive = !tpl.isActive;
    try {
      await qualityChecklistService.updateTemplate(tpl.id, { isActive: nextActive });
      await loadTemplates();
      toast.success(nextActive ? 'Đã kích hoạt mẫu' : 'Đã ẩn mẫu sử dụng');
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.toggleActive', error);
      toast.error('Lỗi cập nhật trạng thái', getApiErrorMessage(error));
    }
  };

  // Section Handlers
  const handleOpenCreateSec = () => {
    if (!selectedTemplate) return;
    setEditingSection(null);
    setSecNameForm('');
    setSecOrderForm((selectedTemplate.sections?.length || 0) + 1);
    setIsSecModalOpen(true);
  };

  const handleOpenEditSec = (sec: InspectionTemplateSection) => {
    setEditingSection(sec);
    setSecNameForm(sec.name);
    setSecOrderForm(sec.sortOrder);
    setIsSecModalOpen(true);
  };

  const handleSaveSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate || !secNameForm.trim()) return;
    setSavingSec(true);
    try {
      if (editingSection) {
        await qualityChecklistService.updateSection(editingSection.id, {
          name: secNameForm.trim(),
          sortOrder: secOrderForm
        });
        toast.success('Đã cập nhật Section');
      } else {
        await qualityChecklistService.createSection({
          templateId: selectedTemplate.id,
          name: secNameForm.trim(),
          sortOrder: secOrderForm
        });
        toast.success('Đã thêm Section mới');
      }
      setIsSecModalOpen(false);
      await loadTemplateDetails(selectedTemplate.id);
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.saveSection', error);
      toast.error('Lỗi khi lưu Section', getApiErrorMessage(error));
    } finally {
      setSavingSec(false);
    }
  };

  const handleDeleteSection = async (secId: string) => {
    if (!confirm('Xóa Section này sẽ xóa toàn bộ các tiêu chí con nằm bên trong. Xác nhận xóa?')) return;
    try {
      await qualityChecklistService.removeSection(secId);
      toast.success('Đã xóa Section');
      if (selectedTemplate) {
        await loadTemplateDetails(selectedTemplate.id);
      }
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.deleteSection', error);
      toast.error('Lỗi xóa Section', getApiErrorMessage(error));
    }
  };

  // Item Handlers
  const handleStartAddItem = (secId: string) => {
    const secItems = selectedTemplate?.sections?.find(s => s.id === secId)?.items || [];
    const maxOrder = secItems.reduce((max, item) => item.sortOrder > max ? item.sortOrder : max, 0);

    setNewItemSectionId(secId);
    setNewItemForm({
      ...emptyItem(secId),
      sortOrder: maxOrder + 1
    });
  };

  const handleCancelAddItem = () => {
    setNewItemSectionId(null);
    setNewItemForm({});
  };

  const handleSaveNewItem = async (secId: string) => {
    if (!newItemForm.itemName?.trim()) {
      toast.warning('Thiếu thông tin', 'Vui lòng nhập tên tiêu chí.');
      return;
    }
    setSavingItem(true);
    try {
      await qualityChecklistService.createTemplateItem({
        ...newItemForm,
        sectionId: secId
      });
      toast.success('Đã thêm tiêu chí mới');
      handleCancelAddItem();
      if (selectedTemplate) {
        await loadTemplateDetails(selectedTemplate.id);
      }
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.saveNewItem', error);
      toast.error('Lỗi lưu tiêu chí', getApiErrorMessage(error));
    } finally {
      setSavingItem(false);
    }
  };

  const handleStartEditItem = (item: InspectionTemplateItem) => {
    setEditingItemId(item.id);
    setItemForm({ ...item });
  };

  const handleCancelEditItem = () => {
    setEditingItemId(null);
    setItemForm({});
  };

  const handleSaveEditItem = async (itemId: string) => {
    if (!itemForm.itemName?.trim()) {
      toast.warning('Thiếu thông tin', 'Vui lòng nhập tên tiêu chí.');
      return;
    }
    setSavingItem(true);
    try {
      await qualityChecklistService.updateTemplateItem(itemId, itemForm);
      toast.success('Đã cập nhật tiêu chí');
      setEditingItemId(null);
      setItemForm({});
      if (selectedTemplate) {
        await loadTemplateDetails(selectedTemplate.id);
      }
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.saveEditItem', error);
      toast.error('Lỗi khi cập nhật tiêu chí', getApiErrorMessage(error));
    } finally {
      setSavingItem(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Xóa tiêu chí này khỏi mẫu?')) return;
    try {
      await qualityChecklistService.removeTemplateItem(itemId);
      toast.success('Đã xóa tiêu chí');
      if (selectedTemplate) {
        await loadTemplateDetails(selectedTemplate.id);
      }
    } catch (error: any) {
      logApiError('SettingsInspectionTemplates.deleteItem', error);
      toast.error('Lỗi xóa tiêu chí', getApiErrorMessage(error));
    }
  };

  return (
    <div className="animate-in slide-in-from-right-4 duration-300 space-y-6">
      {/* 3-Tier Multi-Navigation System */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Tier 1 & 2 Left Sidebar: Categories & Work Types */}
        <div className="bg-card rounded-3xl p-5 border border-border shadow-sm space-y-5 h-fit">
          {/* Hạng mục chuẩn (Categories) Selector */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                <Layers size={13} className="text-muted-foreground" />
                1. Hạng mục chuẩn
              </h3>
              <button
                onClick={handleOpenCreateCat}
                className="p-1 rounded-lg text-indigo-600 hover:bg-indigo-50 transition"
                title="Thêm Hạng mục chuẩn"
              >
                <PlusCircle size={15} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {categories.map(cat => {
                const isSelected = selectedCatId === cat.id;
                const icon = CATEGORY_ICONS[cat.code] || '📋';
                return (
                  <div key={cat.id} className="relative group">
                    <button
                      onClick={() => handleCategoryChange(cat.id)}
                      className={`w-full px-3 py-3 rounded-2xl border text-xs font-black transition-all text-center flex flex-col items-center justify-center gap-1.5 min-h-[75px] ${
                        isSelected
                          ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 shadow-sm'
                          : 'bg-card border-border text-muted-foreground hover:border-border/80'
                      }`}
                    >
                      <span className="text-xl">{icon}</span>
                      <span className="truncate w-full px-1">{cat.name}</span>
                    </button>
                    {/* Hover actions */}
                    <div className="absolute top-1.5 right-1.5 hidden group-hover:flex gap-1 bg-card/95 backdrop-blur-sm p-1 rounded-lg shadow-sm border border-border">
                      <button
                        onClick={(e) => handleOpenEditCat(cat, e)}
                        className="p-1 rounded text-muted-foreground hover:text-indigo-600 hover:bg-muted transition"
                        title="Sửa"
                      >
                        <Edit2 size={10} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteCategory(cat, e)}
                        className="p-1 rounded text-muted-foreground hover:text-red-600 hover:bg-muted transition"
                        title="Xóa"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Loại công tác (Work Types) Menu */}
          {selectedCatId && (
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                  <Compass size={13} className="text-muted-foreground" />
                  2. Loại công tác
                </h3>
                <button
                  onClick={handleOpenCreateWt}
                  className="p-1 rounded-lg text-indigo-600 hover:bg-indigo-50 transition"
                  title="Thêm Loại công tác"
                >
                  <PlusCircle size={15} />
                </button>
              </div>
              {workTypes.length === 0 ? (
                <p className="text-xs text-muted-foreground italic font-bold p-3">Chưa có công tác nào.</p>
              ) : (
                <div className="space-y-1.5">
                  {workTypes.map(wt => {
                    const isSelected = selectedWtId === wt.id;
                    return (
                      <div
                        key={wt.id}
                        className="relative group w-full"
                      >
                        <button
                          onClick={() => {
                            setSelectedWtId(wt.id);
                            setSelectedTemplate(null);
                          }}
                          className={`w-full flex items-center justify-between pl-4 pr-16 py-3 rounded-xl text-xs font-black transition-all ${
                            isSelected
                              ? 'bg-indigo-600 text-white shadow-md'
                              : 'text-foreground hover:bg-muted/50 border border-transparent'
                          }`}
                        >
                          <span className="truncate">{wt.name}</span>
                          <ArrowRight size={12} className={isSelected ? 'opacity-100' : 'opacity-20'} />
                        </button>
                        {/* Hover Actions inside row */}
                        <div className="absolute right-2 top-1.5 hidden group-hover:flex gap-1 p-0.5 rounded-lg">
                          <button
                            onClick={(e) => handleOpenEditWt(wt, e)}
                            className={`p-1.5 rounded transition ${
                              isSelected
                                ? 'text-white/80 hover:text-white hover:bg-white/10'
                                : 'text-muted-foreground hover:text-indigo-400 hover:bg-muted'
                            }`}
                            title="Sửa"
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            onClick={(e) => handleDeleteWorkType(wt, e)}
                            className={`p-1.5 rounded transition ${
                              isSelected
                                ? 'text-white/80 hover:text-white hover:bg-white/10'
                                : 'text-muted-foreground hover:text-red-400 hover:bg-muted'
                            }`}
                            title="Xóa"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tier 3: Templates and Items dynamic workspace */}
        <div className="space-y-6">
          {/* Templates Grid */}
          {selectedWtId && (
            <div className="bg-card rounded-3xl shadow-sm border border-border overflow-hidden min-h-[250px]">
              <div className="p-6 border-b border-border bg-muted/30 flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-sm font-black text-foreground flex items-center gap-2">
                    <ClipboardCheck size={20} className="text-indigo-600" />
                    Mẫu nghiệm thu chuẩn
                  </h2>
                  <p className="text-xs text-muted-foreground font-semibold mt-0.5">
                    Chọn một mẫu để thiết lập các Section động và tiêu chí con QA/QC tương ứng.
                  </p>
                </div>
                <button
                  onClick={handleOpenCreateTpl}
                  className="px-4 py-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-xs font-black text-white flex items-center gap-1.5 shadow-md shadow-indigo-600/10 transition"
                >
                  <Plus size={15} /> Thêm mẫu mới
                </button>
              </div>

              <div className="p-6">
                {loading ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full" />
                  </div>
                ) : templates.length === 0 ? (
                  <div className="py-12 text-center border border-dashed border-border rounded-2xl">
                    <Sparkles size={32} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-xs font-black text-muted-foreground">Chưa có mẫu nào cho công tác này</p>
                    <button
                      onClick={handleOpenCreateTpl}
                      className="mt-2 text-xs text-indigo-600 font-black hover:underline"
                    >
                      Bấm vào đây để tạo mẫu đầu tiên
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {templates.map(tpl => {
                      const isSelected = selectedTemplate?.id === tpl.id;
                      return (
                        <div
                          key={tpl.id}
                          onClick={() => loadTemplateDetails(tpl.id)}
                          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                            isSelected
                              ? 'bg-indigo-500/5 border-indigo-500/30 shadow-sm ring-1 ring-indigo-500/20'
                              : 'bg-card border-border hover:border-border/80 hover:shadow-sm'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono font-bold bg-slate-100 text-muted-foreground px-2 py-0.5 rounded">
                                {tpl.code} (v{tpl.version})
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[8px] font-black ${
                                tpl.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-200 text-muted-foreground'
                              }`}>
                                {tpl.isActive ? 'ĐANG DÙNG' : 'ĐÃ ẨN'}
                              </span>
                            </div>
                            <h4 className="mt-2.5 text-xs font-black text-foreground truncate">{tpl.name}</h4>
                            <p className="text-[11px] font-semibold text-muted-foreground mt-1 line-clamp-2">
                              {tpl.description || 'Chưa có mô tả hướng dẫn.'}
                            </p>
                            {/* AI Metadata Tags Display */}
                            <div className="flex flex-wrap gap-1.5 mt-2.5">
                              <span className="text-[9px] font-black bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20 uppercase">
                                Tag: {tpl.discipline === 'civil' ? 'Xây dựng' : tpl.discipline === 'steel' ? 'Cơ cấu thép' : tpl.discipline}
                              </span>
                              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase ${
                                tpl.riskLevel === 'high' ? 'bg-destructive/10 text-destructive border-destructive/20' : tpl.riskLevel === 'medium' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20'
                              }`}>
                                Rủi ro: {tpl.riskLevel === 'high' ? 'Cao' : tpl.riskLevel === 'medium' ? 'T.Bình' : 'Thấp'}
                              </span>
                            </div>
                          </div>

                          <div className="mt-4 pt-2 border-t border-border/50 flex items-center justify-between">
                            <span className="text-[10px] text-indigo-600 font-bold flex items-center gap-0.5">
                              Xem tiêu chí <ArrowRight size={10} />
                            </span>
                            <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                              <button onClick={() => handleOpenEditTpl(tpl)} className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-muted transition"><Edit2 size={12} /></button>
                              <button onClick={() => handleToggleActiveTemplate(tpl)} className="p-1.5 rounded text-slate-400 hover:text-amber-600 hover:bg-muted transition"><Archive size={12} /></button>
                              <button onClick={() => handleDeleteTemplate(tpl)} className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-muted transition"><Trash2 size={12} /></button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Dynamic Template Sections & Items Manager */}
          {selectedTemplate && (
            <div className="bg-card rounded-3xl shadow-sm border border-border overflow-hidden">
              <div className="p-6 border-b border-border bg-muted/30 flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h3 className="text-sm font-black text-slate-800">
                    Cơ cấu hồ sơ: <span className="text-indigo-600">{selectedTemplate.name}</span>
                  </h3>
                  <p className="text-xs text-muted-foreground font-semibold mt-0.5">
                    Quản lý các phân mục và tiêu chí nghiệm thu chi tiết (dung sai, kỹ thuật kiểm tra).
                  </p>
                </div>
                <button
                  onClick={handleOpenCreateSec}
                  className="px-4 py-2 rounded-2xl border border-indigo-500/20 text-xs font-black text-indigo-400 hover:bg-indigo-500/10 flex items-center gap-1.5 transition"
                >
                  <FolderPlus size={14} /> Thêm Section mới
                </button>
              </div>

              <div className="p-6 space-y-8">
                {itemsLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full" />
                  </div>
                ) : (selectedTemplate.sections || []).length === 0 ? (
                  <div className="py-12 text-center border border-dashed border-border rounded-2xl">
                    <BookOpen size={32} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-xs font-black text-muted-foreground">Chưa có Section nào trong mẫu này</p>
                    <button onClick={handleOpenCreateSec} className="mt-2 text-xs text-indigo-600 font-black hover:underline">Tạo Section đầu tiên</button>
                  </div>
                ) : (
                  (selectedTemplate.sections || []).map((sec, secIdx) => {
                    const isAddingToThisSec = newItemSectionId === sec.id;
                    const secItems = sec.items || [];
                    
                    return (
                      <div key={sec.id} className="p-5 rounded-3xl border border-border space-y-4">
                        {/* Section Header */}
                        <div className="flex items-center justify-between border-b border-border pb-2">
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center text-xs font-black">
                              {secIdx + 1}
                            </span>
                            <span className="text-xs font-black text-foreground">{sec.name}</span>
                            <span className="text-[10px] text-muted-foreground">({secItems.length} tiêu chí)</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleStartAddItem(sec.id)}
                              className="px-2.5 py-1 rounded-xl bg-muted hover:bg-muted/80 text-[10px] font-black text-foreground flex items-center gap-1 transition"
                            >
                              <Plus size={11} /> Thêm tiêu chí
                            </button>
                            <button onClick={() => handleOpenEditSec(sec)} className="p-1 rounded text-slate-400 hover:text-blue-500 hover:bg-muted transition"><Edit2 size={12} /></button>
                            <button onClick={() => handleDeleteSection(sec.id)} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-muted transition"><Trash2 size={12} /></button>
                          </div>
                        </div>

                        {/* Inline Adding Form */}
                        {isAddingToThisSec && (
                          <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 space-y-3">
                            <h5 className="text-[10px] font-black text-indigo-600 uppercase tracking-wider">Tiêu chí mới</h5>
                            
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                              <div className="md:col-span-5">
                                <label className="text-[9px] font-black text-muted-foreground block mb-1">Tên tiêu chí *</label>
                                <input
                                  value={newItemForm.itemName || ''}
                                  onChange={e => setNewItemForm(p => ({ ...p, itemName: e.target.value }))}
                                  placeholder="Tên tiêu chí cần kiểm tra..."
                                  className="w-full bg-card border border-border text-foreground rounded-xl px-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                                />
                              </div>
                              <div className="md:col-span-2">
                                <label className="text-[9px] font-black text-muted-foreground block mb-1">Kiểu dữ liệu</label>
                                <select
                                  value={newItemForm.dataType || 'checkbox'}
                                  onChange={e => setNewItemForm(p => ({ ...p, dataType: e.target.value as any }))}
                                  className="w-full bg-card border border-border text-foreground rounded-xl px-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                                >
                                  <option value="checkbox">Nút Check</option>
                                  <option value="number">Đo số liệu</option>
                                  <option value="text">Chữ tự do</option>
                                  <option value="photo">Chụp ảnh</option>
                                </select>
                              </div>
                              <div className="md:col-span-3">
                                <label className="text-[9px] font-black text-muted-foreground block mb-1">Mức chấp nhận (Criteria)</label>
                                <input
                                  value={newItemForm.acceptanceCriteria || ''}
                                  onChange={e => setNewItemForm(p => ({ ...p, acceptanceCriteria: e.target.value }))}
                                  placeholder="Ví dụ: ≤ L/500..."
                                  className="w-full bg-card border border-border text-foreground rounded-xl px-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                                />
                              </div>
                              <div className="md:col-span-2">
                                <label className="text-[9px] font-black text-muted-foreground block mb-1">Phương pháp đo</label>
                                <input
                                  value={newItemForm.inspectionMethod || ''}
                                  onChange={e => setNewItemForm(p => ({ ...p, inspectionMethod: e.target.value }))}
                                  placeholder="Ví dụ: Thước, máy đo..."
                                  className="w-full bg-card border border-border text-foreground rounded-xl px-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                                />
                              </div>
                            </div>

                            {/* Tolerance Fields (Only for number type) */}
                            {newItemForm.dataType === 'number' && (
                              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-muted/50 p-3 rounded-xl border border-border">
                                <div>
                                  <label className="text-[9px] font-black text-muted-foreground block mb-1">Sai số nhỏ nhất (Min)</label>
                                  <input
                                    type="number"
                                    value={newItemForm.minValue ?? ''}
                                    onChange={e => setNewItemForm(p => ({ ...p, minValue: e.target.value ? Number(e.target.value) : undefined }))}
                                    placeholder="Không giới hạn"
                                    className="w-full border border-border bg-card text-foreground rounded-lg px-2.5 py-1 text-xs font-bold outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] font-black text-muted-foreground block mb-1">Sai số lớn nhất (Max)</label>
                                  <input
                                    type="number"
                                    value={newItemForm.maxValue ?? ''}
                                    onChange={e => setNewItemForm(p => ({ ...p, maxValue: e.target.value ? Number(e.target.value) : undefined }))}
                                    placeholder="Không giới hạn"
                                    className="w-full border border-border bg-card text-foreground rounded-lg px-2.5 py-1 text-xs font-bold outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] font-black text-muted-foreground block mb-1">Đơn vị đo (Unit)</label>
                                  <input
                                    value={newItemForm.unit || ''}
                                    onChange={e => setNewItemForm(p => ({ ...p, unit: e.target.value }))}
                                    placeholder="mm, cm, kg/cm²..."
                                    className="w-full border border-border bg-card text-foreground rounded-lg px-2.5 py-1 text-xs font-bold outline-none"
                                  />
                                </div>
                              </div>
                            )}

                            <div className="flex gap-4 justify-between items-center flex-wrap pt-1">
                              <div className="flex gap-4">
                                <label className="flex items-center gap-1.5 text-xs font-bold text-foreground cursor-pointer bg-card border border-border rounded-xl px-3 py-1.5">
                                  <input
                                    type="checkbox"
                                    checked={newItemForm.required}
                                    onChange={e => setNewItemForm(p => ({ ...p, required: e.target.checked }))}
                                    className="rounded border-border"
                                  />
                                  Bắt buộc đạt
                                </label>
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] text-muted-foreground font-black">Thứ tự:</span>
                                  <input
                                    type="number"
                                    value={newItemForm.sortOrder || 1}
                                    onChange={e => setNewItemForm(p => ({ ...p, sortOrder: Number(e.target.value) || 1 }))}
                                    className="w-12 border border-border bg-card text-foreground rounded-lg px-2 py-1 text-xs font-bold text-center outline-none"
                                  />
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={handleCancelAddItem} className="px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-black text-muted-foreground bg-white hover:bg-muted transition">Hủy</button>
                                <button onClick={() => handleSaveNewItem(sec.id)} disabled={savingItem} className="px-4 py-1.5 rounded-xl bg-indigo-600 text-white text-[10px] font-black hover:bg-indigo-700 transition">Thêm tiêu chí</button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* List Items */}
                        {secItems.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic pl-5 font-bold">Chưa có tiêu chí nào trong phần này.</p>
                        ) : (
                          <div className="space-y-2">
                            {secItems.map(item => {
                              const isEditing = editingItemId === item.id;
                              return isEditing ? (
                                <div key={item.id} className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-3">
                                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                                    <div className="md:col-span-5">
                                      <label className="text-[9px] font-black text-muted-foreground block mb-1">Tên tiêu chí</label>
                                      <input
                                        value={itemForm.itemName || ''}
                                        onChange={e => setItemForm(p => ({ ...p, itemName: e.target.value }))}
                                        className="w-full bg-card border border-border text-foreground rounded-xl px-3 py-1.5 text-xs font-bold outline-none"
                                      />
                                    </div>
                                    <div className="md:col-span-2">
                                      <label className="text-[9px] font-black text-muted-foreground block mb-1">Kiểu</label>
                                      <select
                                        value={itemForm.dataType || 'checkbox'}
                                        onChange={e => setItemForm(p => ({ ...p, dataType: e.target.value as any }))}
                                        className="w-full bg-card border border-border text-foreground rounded-xl px-3 py-1.5 text-xs font-bold outline-none"
                                      >
                                        <option value="checkbox">Nút Check</option>
                                        <option value="number">Đo số liệu</option>
                                        <option value="text">Chữ tự do</option>
                                        <option value="photo">Chụp ảnh</option>
                                      </select>
                                    </div>
                                    <div className="md:col-span-3">
                                      <label className="text-[9px] font-black text-muted-foreground block mb-1">Mức chấp nhận</label>
                                      <input
                                        value={itemForm.acceptanceCriteria || ''}
                                        onChange={e => setItemForm(p => ({ ...p, acceptanceCriteria: e.target.value }))}
                                        className="w-full bg-card border border-border text-foreground rounded-xl px-3 py-1.5 text-xs font-bold outline-none"
                                      />
                                    </div>
                                    <div className="md:col-span-2">
                                      <label className="text-[9px] font-black text-muted-foreground block mb-1">Phương pháp</label>
                                      <input
                                        value={itemForm.inspectionMethod || ''}
                                        onChange={e => setItemForm(p => ({ ...p, inspectionMethod: e.target.value }))}
                                        className="w-full bg-card border border-border text-foreground rounded-xl px-3 py-1.5 text-xs font-bold outline-none"
                                      />
                                    </div>
                                  </div>

                                  {itemForm.dataType === 'number' && (
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-muted/50 p-3 rounded-xl border border-border">
                                      <div>
                                        <label className="text-[9px] font-black text-muted-foreground block mb-1">Sai số nhỏ nhất (Min)</label>
                                        <input
                                          type="number"
                                          value={itemForm.minValue ?? ''}
                                          onChange={e => setItemForm(p => ({ ...p, minValue: e.target.value ? Number(e.target.value) : undefined }))}
                                          className="w-full border border-border bg-card text-foreground rounded-lg px-2.5 py-1 text-xs font-bold outline-none"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[9px] font-black text-muted-foreground block mb-1">Sai số lớn nhất (Max)</label>
                                        <input
                                          type="number"
                                          value={itemForm.maxValue ?? ''}
                                          onChange={e => setItemForm(p => ({ ...p, maxValue: e.target.value ? Number(e.target.value) : undefined }))}
                                          className="w-full border border-border bg-card text-foreground rounded-lg px-2.5 py-1 text-xs font-bold outline-none"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[9px] font-black text-muted-foreground block mb-1">Đơn vị đo (Unit)</label>
                                        <input
                                          value={itemForm.unit || ''}
                                          onChange={e => setItemForm(p => ({ ...p, unit: e.target.value }))}
                                          className="w-full border border-border bg-card text-foreground rounded-lg px-2.5 py-1 text-xs font-bold outline-none"
                                        />
                                      </div>
                                    </div>
                                  )}

                                  <div className="flex gap-4 justify-between items-center flex-wrap pt-1">
                                    <div className="flex gap-4">
                                      <label className="flex items-center gap-1.5 text-xs font-bold text-foreground cursor-pointer bg-card border border-border rounded-xl px-3 py-1.5">
                                        <input
                                          type="checkbox"
                                          checked={itemForm.required}
                                          onChange={e => setItemForm(p => ({ ...p, required: e.target.checked }))}
                                          className="rounded border-border"
                                        />
                                        Bắt buộc đạt
                                      </label>
                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-muted-foreground font-black">Thứ tự:</span>
                                        <input
                                          type="number"
                                          value={itemForm.sortOrder || 1}
                                          onChange={e => setItemForm(p => ({ ...p, sortOrder: Number(e.target.value) || 1 }))}
                                          className="w-12 border border-border bg-card text-foreground rounded-lg px-2 py-1 text-xs font-bold text-center outline-none"
                                        />
                                      </div>
                                    </div>
                                    <div className="flex gap-2">
                                      <button onClick={handleCancelEditItem} className="px-3 py-1 text-[10px] font-black text-muted-foreground hover:underline">Hủy</button>
                                      <button onClick={() => handleSaveEditItem(item.id)} disabled={savingItem} className="px-4 py-1.5 rounded-xl bg-amber-500 text-white text-[10px] font-black hover:bg-amber-600 flex items-center gap-1">Lưu thay đổi</button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div key={item.id} className="grid grid-cols-12 gap-3 items-center p-3 rounded-2xl border border-border hover:bg-muted/30 group text-xs font-bold text-foreground">
                                  <div className="col-span-1 text-[10px] font-black text-muted-foreground bg-muted w-5 h-5 rounded-lg flex items-center justify-center shrink-0">
                                    {item.sortOrder}
                                  </div>
                                  <div className="col-span-4 flex items-center gap-2">
                                    <span>{item.itemName}</span>
                                    {item.required && (
                                      <span className="text-[8px] font-black bg-destructive/10 text-destructive border border-destructive/20 px-1.5 py-0.5 rounded shrink-0">BẮT BUỘC</span>
                                    )}
                                  </div>
                                  <div className="col-span-2 text-[10px] text-muted-foreground">
                                    {item.dataType === 'checkbox' ? '☑️ Nút Check' : item.dataType === 'number' ? '🔢 Đo số liệu' : item.dataType === 'photo' ? '📷 Chụp ảnh' : '✏️ Nhập tự do'}
                                  </div>
                                  <div className="col-span-2 text-[10px] text-muted-foreground italic truncate" title={item.acceptanceCriteria}>
                                    {item.acceptanceCriteria || '—'}
                                  </div>
                                  <div className="col-span-2 text-[10px] font-mono text-muted-foreground">
                                    {item.inspectionMethod || '—'}
                                  </div>
                                  <div className="col-span-1 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => handleStartEditItem(item)} className="p-1 rounded text-muted-foreground hover:text-amber-500 hover:bg-muted"><Edit2 size={12} /></button>
                                    <button onClick={() => handleDeleteItem(item.id)} className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-muted"><Trash2 size={12} /></button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CREATE / EDIT TEMPLATE MODAL */}
      {isTplModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in-50 duration-200">
          <div className="bg-card border border-border rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-border bg-gradient-to-r from-indigo-500/5 to-violet-500/5">
              <div>
                <h3 className="text-sm font-black text-foreground">
                  {editingTemplate ? 'Cập nhật mẫu nghiệm thu' : 'Thêm mẫu nghiệm thu mới'}
                </h3>
                <p className="text-xs text-muted-foreground font-semibold mt-0.5">
                  Cấu hình công tác: {workTypes.find(w => w.id === selectedWtId)?.name || ''}
                </p>
              </div>
              <button onClick={() => setIsTplModalOpen(false)} className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-slate-800 transition">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveTemplate} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Tên mẫu nghiệm thu *</label>
                <input
                  value={tplForm.name || ''}
                  onChange={e => setTplForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ví dụ: Nghiệm thu đổ bê tông móng M1..."
                  className="w-full bg-muted/30 border border-border text-foreground rounded-2xl px-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Mã mẫu *</label>
                  <input
                    value={tplForm.code || ''}
                    onChange={e => setTplForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                    placeholder="Ví dụ: TPL-MONG-BT-01"
                    className="w-full bg-muted/30 border border-border text-foreground rounded-2xl px-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                    required
                    disabled={!!editingTemplate}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Phiên bản</label>
                  <input
                    type="number"
                    value={tplForm.version || 1}
                    onChange={e => setTplForm(prev => ({ ...prev, version: Number(e.target.value) || 1 }))}
                    className="w-full bg-muted/30 border border-border text-foreground rounded-2xl px-4 py-2.5 text-xs font-bold outline-none"
                    min={1}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-muted/50 p-4 rounded-2xl border border-border">
                <div>
                  <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Bộ môn (Discipline)</label>
                  <select
                    value={tplForm.discipline || 'civil'}
                    onChange={e => setTplForm(prev => ({ ...prev, discipline: e.target.value }))}
                    className="w-full bg-card border border-border text-foreground rounded-xl px-3 py-2 text-xs font-bold outline-none"
                  >
                    <option value="civil">Xây dựng (Civil)</option>
                    <option value="steel">Kết cấu thép (Steel)</option>
                    <option value="mep">Cơ điện nước (MEP)</option>
                    <option value="finishing">Hoàn thiện (Finishing)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Mức độ rủi ro</label>
                  <select
                    value={tplForm.riskLevel || 'medium'}
                    onChange={e => setTplForm(prev => ({ ...prev, riskLevel: e.target.value as any }))}
                    className="w-full bg-card border border-border text-foreground rounded-xl px-3 py-2 text-xs font-bold outline-none"
                  >
                    <option value="low">Thấp (Low)</option>
                    <option value="medium">Trung bình (Medium)</option>
                    <option value="high">Cao (High - Nghiêm ngặt)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Quy chuẩn / Tiêu chuẩn tham chiếu</label>
                <input
                  value={tplForm.standardReference || ''}
                  onChange={e => setTplForm(prev => ({ ...prev, standardReference: e.target.value }))}
                  placeholder="Ví dụ: TCVN 4453:1995, TCVN 170:2007..."
                  className="w-full bg-muted/30 border border-border text-foreground rounded-2xl px-4 py-2.5 text-xs font-bold outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Mục đích nghiệm thu (AI Context)</label>
                <textarea
                  value={tplForm.inspectionPurpose || ''}
                  onChange={e => setTplForm(prev => ({ ...prev, inspectionPurpose: e.target.value }))}
                  placeholder="Mô tả cụ thể mục đích nghiệm thu để làm giàu ngữ cảnh hỗ trợ AI Assistant sau này..."
                  rows={2}
                  className="w-full bg-muted/30 border border-border text-foreground rounded-2xl px-4 py-2 text-xs font-medium resize-none outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Mô tả chi tiết</label>
                <textarea
                  value={tplForm.description || ''}
                  onChange={e => setTplForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Mô tả tóm tắt quy trình nghiệm thu..."
                  rows={2}
                  className="w-full bg-muted/30 border border-border text-foreground rounded-2xl px-4 py-2 text-xs font-medium resize-none outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-bold text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={tplForm.isActive}
                  onChange={e => setTplForm(prev => ({ ...prev, isActive: e.target.checked }))}
                  className="rounded border-border text-indigo-600 focus:ring-indigo-500"
                />
                Cho phép công trường sử dụng mẫu này
              </label>

              <div className="flex gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsTplModalOpen(false)}
                  className="w-1/3 px-5 py-2.5 rounded-2xl border border-slate-200 text-xs font-black text-muted-foreground bg-white hover:bg-muted transition"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={savingTpl}
                  className="flex-1 px-5 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-xs font-black text-white disabled:opacity-50 transition"
                >
                  {savingTpl ? 'Đang lưu...' : editingTemplate ? 'Cập nhật' : 'Thêm mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE / EDIT SECTION MODAL */}
      {isSecModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in-50 duration-200">
          <div className="bg-card border border-border rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-border bg-gradient-to-r from-indigo-500/5 to-violet-500/5">
              <h3 className="text-xs font-black text-foreground">
                {editingSection ? 'Sửa Section' : 'Thêm Section mới'}
              </h3>
              <button onClick={() => setIsSecModalOpen(false)} className="p-1 hover:bg-white rounded-lg text-slate-400 hover:text-slate-800 transition">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveSection} className="p-5 space-y-4">
              <div>
                <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Tên Section *</label>
                <input
                  value={secNameForm}
                  onChange={e => setSecNameForm(e.target.value)}
                  placeholder="Ví dụ: Kiểm tra kích thước hình học..."
                  className="w-full bg-card border border-border text-foreground rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Thứ tự hiển thị</label>
                <input
                  type="number"
                  value={secOrderForm}
                  onChange={e => setSecOrderForm(Number(e.target.value) || 1)}
                  className="w-full bg-card border border-border text-foreground rounded-xl px-3 py-2 text-xs font-bold outline-none"
                  min={1}
                  required
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSecModalOpen(false)}
                  className="w-1/3 px-3 py-2 rounded-xl border border-slate-200 text-xs font-black text-muted-foreground bg-white hover:bg-muted transition"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingSec}
                  className="flex-1 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-black text-white disabled:opacity-50 transition"
                >
                  {savingSec ? 'Đang lưu...' : 'Lưu Section'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================== CATEGORY CRUD MODAL ===================== */}
      {isCatModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in-50 duration-200">
          <div className="bg-card border border-border rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-border bg-gradient-to-r from-indigo-500/5 to-violet-500/5">
              <h3 className="text-sm font-black text-foreground">
                {editingCategory ? 'Chỉnh sửa Hạng mục chuẩn' : 'Thêm Hạng mục chuẩn mới'}
              </h3>
              <button onClick={() => setIsCatModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-800 transition">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Mã hạng mục *</label>
                <input
                  value={catForm.code || ''}
                  onChange={e => setCatForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                  placeholder="Ví dụ: CAT-MONG, CAT-THEP..."
                  className="w-full bg-muted/30 border border-border text-foreground rounded-2xl px-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                  required
                  disabled={!!editingCategory}
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Tên Hạng mục chuẩn *</label>
                <input
                  value={catForm.name || ''}
                  onChange={e => setCatForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ví dụ: Móng, Kết cấu thép, Dầm..."
                  className="w-full bg-muted/30 border border-border text-foreground rounded-2xl px-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                  required
                />
              </div>

              <div className="flex gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsCatModalOpen(false)}
                  className="w-1/3 px-5 py-2.5 rounded-2xl border border-slate-200 text-xs font-black text-muted-foreground bg-white hover:bg-muted transition"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={savingCat}
                  className="flex-1 px-5 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-xs font-black text-white disabled:opacity-50 transition"
                >
                  {savingCat ? 'Đang lưu...' : editingCategory ? 'Cập nhật' : 'Thêm mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================== WORK TYPE CRUD MODAL ===================== */}
      {isWtModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in-50 duration-200">
          <div className="bg-card border border-border rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-border bg-gradient-to-r from-indigo-500/5 to-violet-500/5">
              <h3 className="text-sm font-black text-foreground">
                {editingWorkType ? 'Chỉnh sửa Loại công tác' : 'Thêm Loại công tác mới'}
              </h3>
              <button onClick={() => setIsWtModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-800 transition">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveWorkType} className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Mã loại công tác *</label>
                <input
                  value={wtForm.code || ''}
                  onChange={e => setWtForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                  placeholder="Ví dụ: WT-MONG-TONG..."
                  className="w-full bg-muted/30 border border-border text-foreground rounded-2xl px-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                  required
                  disabled={!!editingWorkType}
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Tên loại công tác *</label>
                <input
                  value={wtForm.name || ''}
                  onChange={e => setWtForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ví dụ: Bê tông móng, Thép cột..."
                  className="w-full bg-muted/30 border border-border text-foreground rounded-2xl px-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-muted-foreground uppercase block mb-1">Thuộc Hạng mục chuẩn</label>
                <select
                  value={wtForm.categoryId || ''}
                  onChange={e => setWtForm(prev => ({ ...prev, categoryId: e.target.value }))}
                  className="w-full bg-muted/30 border border-border text-foreground rounded-2xl px-4 py-2.5 text-xs font-bold outline-none"
                  required
                  disabled={!!editingWorkType}
                >
                  <option value="" disabled>-- Chọn Hạng mục --</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsWtModalOpen(false)}
                  className="w-1/3 px-5 py-2.5 rounded-2xl border border-slate-200 text-xs font-black text-muted-foreground bg-white hover:bg-muted transition"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={savingWt}
                  className="flex-1 px-5 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-xs font-black text-white disabled:opacity-50 transition"
                >
                  {savingWt ? 'Đang lưu...' : editingWorkType ? 'Cập nhật' : 'Thêm mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsInspectionTemplates;
