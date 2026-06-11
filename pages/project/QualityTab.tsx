import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus, Search, ChevronDown, ChevronRight, Save, X,
  CheckCircle2, AlertTriangle, XCircle, Clock, FileText, Camera,
  ClipboardCheck, Wrench, MapPin, User, Calendar, Upload,
  Trash2, Edit2, Send, RotateCcw, Eye, Layers, Compass, Sparkles,
  ListFilter, ShieldCheck, CheckSquare, PlusCircle, AlertCircle,
  Printer
} from 'lucide-react';
import { qualityChecklistService } from '../../lib/qualityChecklistService';
import { projectStaffService } from '../../lib/projectStaffService';
import { supabase } from '../../lib/supabase';
import {
  QualityChecklist,
  QualityChecklistStatus,
  QualityConclusionResult,
  QualityChecklistClonedSection,
  QualityChecklistClonedItem,
  InspectionCategory,
  InspectionWorkType,
  InspectionTemplate,
  QualityInspectionAttempt,
  InspectionResult,
  Role,
  ProjectStaff,
  ProjectSubmissionTarget,
  DrawingMarker,
  SignerData
} from '../../types';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import ProjectSubmissionDialog from '../../components/project/ProjectSubmissionDialog';

interface QualityTabProps {
  constructionSiteId?: string;
  projectId: string;
  canManageTab?: boolean;
}

const STATUS_CONFIG: Record<QualityChecklistStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  draft: { label: 'Nháp', color: 'text-slate-500', bg: 'bg-slate-50 border-slate-200', icon: <Clock size={12} /> },
  submitted: { label: 'Chờ duyệt', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: <Send size={12} /> },
  approved: { label: 'Đã duyệt', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={12} /> },
  returned: { label: 'Trả lại', color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: <RotateCcw size={12} /> },
  cancelled: { label: 'Đã huỷ', color: 'text-slate-400', bg: 'bg-slate-50 border-slate-200', icon: <XCircle size={12} /> },
};

const RESULT_BADGE: Record<InspectionResult, { label: string; color: string; bg: string }> = {
  PASSED: { label: '✅ ĐẠT', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  FAILED: { label: '❌ KHÔNG ĐẠT', color: 'text-red-700', bg: 'bg-red-100' },
};

const CATEGORY_ICONS: Record<string, string> = {
  'CAT-MONG': '🏗️',
  'CAT-THEP': '⚙️',
};

// ==================== HIERARCHICAL TEMPLATE SELECTOR ====================

interface TemplateSelectorProps {
  onSelect: (template: InspectionTemplate) => void;
  onClose: () => void;
}

const TemplateSelector: React.FC<TemplateSelectorProps> = ({ onSelect, onClose }) => {
  const [categories, setCategories] = useState<InspectionCategory[]>([]);
  const [workTypes, setWorkTypes] = useState<InspectionWorkType[]>([]);
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeCatId, setActiveCatId] = useState<string>('');
  const [activeWtId, setActiveWtId] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const cats = await qualityChecklistService.listCategories();
      setCategories(cats);
      if (cats.length > 0) {
        setActiveCatId(cats[0].id);
        const wts = await qualityChecklistService.listWorkTypes(cats[0].id);
        setWorkTypes(wts);
        if (wts.length > 0) {
          setActiveWtId(wts[0].id);
          const tpls = await qualityChecklistService.listTemplates(wts[0].id);
          setTemplates(tpls);
        }
      }
    } catch (err) {
      console.error('Failed to load selector categories:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCatSelect = async (catId: string) => {
    setActiveCatId(catId);
    setActiveWtId('');
    setTemplates([]);
    try {
      const wts = await qualityChecklistService.listWorkTypes(catId);
      setWorkTypes(wts);
      if (wts.length > 0) {
        setActiveWtId(wts[0].id);
        const tpls = await qualityChecklistService.listTemplates(wts[0].id);
        setTemplates(tpls);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleWtSelect = async (wtId: string) => {
    setActiveWtId(wtId);
    try {
      const tpls = await qualityChecklistService.listTemplates(wtId);
      setTemplates(tpls);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-gradient-to-r from-indigo-50/50 to-violet-50/50">
          <div>
            <h3 className="text-sm font-black text-slate-900">Chọn mẫu hồ sơ nghiệm thu</h3>
            <p className="text-[10px] text-slate-400 mt-0.5 font-bold">Lựa chọn Hạng mục → Công tác → Mẫu nghiệm thu chuẩn để tự động sinh form</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
          </div>
        ) : (
          /* Multi-tiered Split Panes */
          <div className="flex-1 grid grid-cols-1 md:grid-cols-[220px_220px_1fr] overflow-hidden">
            {/* Tier 1: Categories */}
            <div className="border-r border-slate-100 bg-slate-50/30 p-3 space-y-1 overflow-y-auto">
              <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-2 mb-2">1. Hạng mục chính</h4>
              {categories.map(cat => {
                const isSelected = activeCatId === cat.id;
                const icon = CATEGORY_ICONS[cat.code] || '📋';
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCatSelect(cat.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-xs font-bold transition ${isSelected ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                  >
                    <span>{icon}</span>
                    <span className="truncate">{cat.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Tier 2: Work Types */}
            <div className="border-r border-slate-100 bg-slate-50/10 p-3 space-y-1 overflow-y-auto">
              <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-2 mb-2">2. Loại công tác</h4>
              {workTypes.length === 0 ? (
                <p className="text-[10px] text-slate-400 italic px-2 font-bold">Chưa có công tác nào.</p>
              ) : (
                workTypes.map(wt => {
                  const isSelected = activeWtId === wt.id;
                  return (
                    <button
                      key={wt.id}
                      onClick={() => handleWtSelect(wt.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs font-bold transition ${isSelected ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                      <span className="truncate">{wt.name}</span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Tier 3: Templates */}
            <div className="p-5 overflow-y-auto space-y-3">
              <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">3. Mẫu biên bản nghiệm thu</h4>
              {templates.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  <Sparkles size={28} className="mx-auto text-slate-200 mb-2" />
                  <p className="text-xs font-bold">Không tìm thấy template nào phù hợp.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {templates.map(tpl => (
                    <button
                      key={tpl.id}
                      onClick={() => onSelect(tpl)}
                      className="w-full text-left p-4 rounded-2xl border border-slate-100 hover:border-indigo-300 hover:bg-indigo-50/50 transition duration-300 flex flex-col justify-between group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="text-[9px] font-mono font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                            {tpl.code} (v{tpl.version})
                          </span>
                          <h5 className="text-xs font-black text-slate-800 mt-1.5 group-hover:text-indigo-700">{tpl.name}</h5>
                          {tpl.description && <p className="text-[10px] text-slate-400 mt-1">{tpl.description}</p>}
                        </div>
                      </div>
                      <div className="mt-3 pt-2 border-t border-slate-100/50 flex gap-2">
                        <span className="text-[9px] font-black bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100">
                          RISK: {tpl.riskLevel === 'high' ? 'CAO' : tpl.riskLevel === 'medium' ? 'T.BÌNH' : 'THẤP'}
                        </span>
                        {tpl.standardReference && (
                          <span className="text-[9px] font-mono font-bold text-slate-400 flex items-center">
                            Tiêu chuẩn: {tpl.standardReference}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== MAIN QUALITY TAB COMPONENT ====================

const QualityTab: React.FC<QualityTabProps> = ({ constructionSiteId, projectId, canManageTab = true }) => {
  const { user } = useApp();
  const toast = useToast();

  // Data States
  const [checklists, setChecklists] = useState<QualityChecklist[]>([]);
  const [projectStaff, setProjectStaff] = useState<ProjectStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QualityChecklistStatus | ''>('');

  // Submission target state
  const [submittingChecklist, setSubmittingChecklist] = useState<QualityChecklist | null>(null);

  // Attempts States
  const [attempts, setAttempts] = useState<QualityInspectionAttempt[]>([]);
  const [activeAttemptTab, setActiveAttemptTab] = useState<'current' | string>('current');

  // Modals / Forms States
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingChecklist, setEditingChecklist] = useState<QualityChecklist | null>(null);
  const [form, setForm] = useState<Partial<QualityChecklist>>({});
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Detail view
  const [viewingId, setViewingId] = useState<string | null>(null);

  const [projectName, setProjectName] = useState<string>('');

  useEffect(() => {
    if (!projectId) return;
    const fetchProjectName = async () => {
      try {
        const { data } = await supabase
          .from('projects')
          .select('name')
          .eq('id', projectId)
          .maybeSingle();
        if (data?.name) {
          setProjectName(data.name);
        }
      } catch (err) {
        console.error('Failed to fetch project name:', err);
      }
    };
    fetchProjectName();
  }, [projectId]);

  const siteId = constructionSiteId || '';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [list, staff] = await Promise.all([
        qualityChecklistService.list(projectId, siteId),
        projectStaffService.listByProject(projectId, siteId || undefined),
      ]);
      setChecklists(list);
      setProjectStaff(staff);
    } catch (err) {
      console.error('Failed to load quality checklists & staff:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, siteId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load attempts when viewing a checklist
  const loadChecklistAttempts = useCallback(async (checklistId: string) => {
    try {
      const history = await qualityChecklistService.listAttempts(checklistId);
      setAttempts(history);
    } catch (err) {
      console.error('Failed to load attempts history:', err);
    }
  }, []);

  useEffect(() => {
    if (viewingId) {
      loadChecklistAttempts(viewingId);
      setActiveAttemptTab('current');
    }
  }, [viewingId, loadChecklistAttempts]);

  // Split-pane resizing states
  const [leftWidth, setLeftWidth] = useState(60); // Default layout: Drawing takes 60%
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // PDF Layout & Drawing States
  const [uploadingDrawing, setUploadingDrawing] = useState(false);
  const [newMarkerCoords, setNewMarkerCoords] = useState<{ x: number; y: number } | null>(null);
  const [newMarkerLabel, setNewMarkerLabel] = useState('');
  const [newMarkerNote, setNewMarkerNote] = useState('');
  const [newMarkerStatus, setNewMarkerStatus] = useState<'pass' | 'fail' | 'pending'>('pending');
  const [showMarkerModal, setShowMarkerModal] = useState(false);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  const [markerFilter, setMarkerFilter] = useState<'all' | 'pass' | 'fail' | 'pending'>('all');

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
      if (percentage < 20) percentage = 20;
      if (percentage > 80) percentage = 80;
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

  const handleDrawingUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingDrawing(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `drawing-${Date.now()}.${fileExt}`;
      const path = `quality/${editingChecklist?.id || viewingId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('project-attachments')
        .upload(path, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('project-attachments')
        .getPublicUrl(path);

      if (showForm) {
        setForm(prev => ({ ...prev, drawingUrl: data.publicUrl }));
      } else if (viewingId) {
        await qualityChecklistService.update(viewingId, {
          drawingUrl: data.publicUrl,
        });
        await loadData();
      }
      toast.success('Đã tải lên bản vẽ thành công!');
    } catch (err: any) {
      console.error('Failed to upload drawing:', err);
      toast.error(`Lỗi tải bản vẽ: ${err.message || err}`);
    } finally {
      setUploadingDrawing(false);
    }
  };

  const handleDrawingClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const checklist = showForm ? editingChecklist : viewingChecklist;
    if (!checklist) return;
    const readonly = checklist.status !== 'draft' && checklist.status !== 'returned';
    if (readonly) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setNewMarkerCoords({ x, y });
    setNewMarkerLabel(`Điểm ${((showForm ? form.drawingMarkers : viewingChecklist?.drawingMarkers) || []).length + 1}`);
    setNewMarkerNote('');
    setNewMarkerStatus('pending');
    setEditingMarkerId(null);
    setShowMarkerModal(true);
  };

  const handleEditMarker = (marker: DrawingMarker, e: React.MouseEvent) => {
    e.stopPropagation();
    setNewMarkerCoords({ x: marker.x, y: marker.y });
    setNewMarkerLabel(marker.label);
    setNewMarkerNote(marker.note || '');
    setNewMarkerStatus(marker.status);
    setEditingMarkerId(marker.id);
    setShowMarkerModal(true);
  };

  const handleSaveMarker = async () => {
    if (!newMarkerLabel.trim()) {
      toast.error('Vui lòng nhập tên điểm đánh dấu!');
      return;
    }

    const currentMarkers = showForm
      ? (form.drawingMarkers || [])
      : (viewingChecklist?.drawingMarkers || []);

    let updatedMarkers: DrawingMarker[];

    if (editingMarkerId) {
      updatedMarkers = currentMarkers.map(m =>
        m.id === editingMarkerId
          ? { ...m, label: newMarkerLabel, note: newMarkerNote, status: newMarkerStatus }
          : m
      );
    } else {
      const newMarker: DrawingMarker = {
        id: `marker-${Date.now()}`,
        x: newMarkerCoords?.x || 0,
        y: newMarkerCoords?.y || 0,
        label: newMarkerLabel,
        status: newMarkerStatus,
        note: newMarkerNote || undefined,
      };
      updatedMarkers = [...currentMarkers, newMarker];
    }

    if (showForm) {
      setForm(prev => ({ ...prev, drawingMarkers: updatedMarkers }));
    } else if (viewingId) {
      await qualityChecklistService.update(viewingId, {
        drawingMarkers: updatedMarkers,
      });
      await loadData();
    }

    setShowMarkerModal(false);
    setEditingMarkerId(null);
    toast.success('Đã lưu điểm đánh dấu!');
  };

  const handleDeleteMarker = async (markerId: string) => {
    if (!confirm('Bạn có chắc chắn muốn xoá điểm đánh dấu này?')) return;

    const currentMarkers = showForm
      ? (form.drawingMarkers || [])
      : (viewingChecklist?.drawingMarkers || []);

    const updatedMarkers = currentMarkers.filter(m => m.id !== markerId);

    if (showForm) {
      setForm(prev => ({ ...prev, drawingMarkers: updatedMarkers }));
    } else if (viewingId) {
      await qualityChecklistService.update(viewingId, {
        drawingMarkers: updatedMarkers,
      });
      await loadData();
    }

    setShowMarkerModal(false);
    setEditingMarkerId(null);
    toast.success('Đã xoá điểm đánh dấu!');
  };

  const handleSign = async (roleCode: 'inspector' | 'contractor' | 'supervisor' | 'completion', roleName: string) => {
    if (!confirm(`Xác nhận ký tên với tư cách là ${roleName}?`)) return;

    const currentSigners = showForm
      ? (form.signersData || [])
      : (viewingChecklist?.signersData || []);

    const newSigner: SignerData = {
      roleCode,
      roleName,
      userName: user?.name || user?.email || 'Người dùng',
      signatureUrl: user?.signatureUrl || '',
      signedAt: new Date().toISOString(),
    };

    const updatedSigners = [
      ...currentSigners.filter(s => s.roleCode !== roleCode),
      newSigner,
    ];

    if (showForm) {
      setForm(prev => ({ ...prev, signersData: updatedSigners }));
    } else if (viewingId) {
      await qualityChecklistService.update(viewingId, {
        signersData: updatedSigners,
      });
      await loadData();
    }
    toast.success(`Đã ký xác nhận thành công làm ${roleName}!`);
  };

  const handleClearSignature = async (roleCode: 'inspector' | 'contractor' | 'supervisor' | 'completion', roleName: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xoá chữ ký ${roleName}?`)) return;

    const currentSigners = showForm
      ? (form.signersData || [])
      : (viewingChecklist?.signersData || []);

    const updatedSigners = currentSigners.filter(s => s.roleCode !== roleCode);

    if (showForm) {
      setForm(prev => ({ ...prev, signersData: updatedSigners }));
    } else if (viewingId) {
      await qualityChecklistService.update(viewingId, {
        signersData: updatedSigners,
      });
      await loadData();
    }
    toast.success(`Đã xoá chữ ký ${roleName}!`);
  };

  const updateDynamicItemResult = (secId: string, itemId: string, result: 'pass' | 'fail' | undefined) => {
    setForm(prev => {
      const data = prev.checklistData || [];
      const updated = data.map(sec => {
        if (sec.sectionId !== secId) return sec;
        return {
          ...sec,
          items: sec.items.map(item => {
            if (item.id !== itemId) return item;
            return { ...item, result };
          })
        };
      });
      return { ...prev, checklistData: updated };
    });
  };

  const toggleSection = (secId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(secId)) next.delete(secId); else next.add(secId);
      return next;
    });
  };

  // === Create checklist from template ===
  const handleSelectTemplate = async (template: InspectionTemplate) => {
    setShowTemplateSelector(false);
    setSaving(true);
    try {
      const created = await qualityChecklistService.createFromTemplate({
        templateId: template.id,
        projectId,
        constructionSiteId: siteId,
        createdBy: user?.name,
      });
      await loadData();

      // Auto open edit form
      setEditingChecklist(created);
      setForm({ ...created });

      // Expand all sections by default
      const secIds = (created.checklistData || []).map(s => s.sectionId);
      setExpandedSections(new Set(secIds));

      setShowForm(true);
    } catch (err: any) {
      alert(err.message || 'Lỗi tạo hồ sơ chất lượng');
    } finally {
      setSaving(false);
    }
  };

  // === Edit ===
  const openEdit = (checklist: QualityChecklist) => {
    setEditingChecklist(checklist);
    setForm({ ...checklist });

    const secIds = (checklist.checklistData || []).map(s => s.sectionId);
    setExpandedSections(new Set(secIds));

    setShowForm(true);
  };

  // === Save ===
  const handleSave = async () => {
    if (!editingChecklist) return;
    setSaving(true);
    try {
      await qualityChecklistService.update(editingChecklist.id, form);
      setShowForm(false);
      setEditingChecklist(null);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Lỗi lưu hồ sơ chất lượng');
    } finally {
      setSaving(false);
    }
  };

  // === Attempt Multi-audit trigger ===
  const handleCreateNewAttempt = async () => {
    if (!viewingId) return;
    const vc = checklists.find(c => c.id === viewingId);
    if (!vc) return;

    const inspector = prompt(`Nhập tên Kỹ sư QA/QC thực hiện kiểm tra lại Lần ${vc.currentAttempt + 1}:`, user?.name || '');
    if (inspector === null) return; // cancelled

    setSaving(true);
    try {
      // 1. Create historical attempt snapshot
      await qualityChecklistService.createAttempt({
        checklistId: vc.id,
        attemptNumber: vc.currentAttempt,
        inspectorName: vc.workSupervisor || inspector,
        itemsData: vc.checklistData,
        result: vc.inspectionResult === 'PASSED' ? 'PASSED' : 'FAILED',
        conclusion: vc.conclusion,
        createdBy: user?.name
      });

      // 2. Reset values for all items in the checklist for a fresh retry
      const resetChecklistData = vc.checklistData.map(sec => ({
        ...sec,
        items: sec.items.map(item => ({
          ...item,
          actualValue: item.dataType === 'checkbox' ? 'false' : '',
          result: undefined
        }))
      }));

      await qualityChecklistService.update(vc.id, {
        checklistData: resetChecklistData,
        workSupervisor: inspector
      });

      await loadData();
      loadChecklistAttempts(vc.id);
      setActiveAttemptTab('current');
      toast.success(`Khởi tạo thành công Lần nghiệm thu ${vc.currentAttempt + 1}!`);
    } catch (err: any) {
      alert(err.message || 'Lỗi tạo lần nghiệm thu mới.');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (id: string, status: QualityChecklistStatus) => {
    let reason = '';
    if (status === 'returned' || status === 'cancelled') {
      reason = prompt(`Lý do ${status === 'returned' ? 'trả lại' : 'huỷ'}:`) || '';
      if (!reason.trim()) return;
    }
    try {
      await qualityChecklistService.setStatus(id, status, user?.id, reason);
      await loadData();
      setViewingId(null);
    } catch (err: any) { alert(err.message); }
  };

  const handleConfirmSubmit = async (target: ProjectSubmissionTarget) => {
    if (!submittingChecklist) return;
    try {
      await qualityChecklistService.setStatus(
        submittingChecklist.id,
        'submitted',
        user?.id,
        target.note,
        target
      );
      toast.success('Gửi duyệt hồ sơ chất lượng thành công!');
      setSubmittingChecklist(null);
      await loadData();
      setViewingId(null);
    } catch (err: any) {
      alert(err.message || 'Lỗi gửi duyệt hồ sơ chất lượng');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Xóa hồ sơ chất lượng này?')) return;
    try {
      await qualityChecklistService.remove(id);
      await loadData();
    } catch (err: any) { alert(err.message); }
  };

  // === Dynamic Items Input Handler ===
  const updateDynamicItemValue = (secId: string, itemId: string, value: string) => {
    setForm(prev => {
      const data = prev.checklistData || [];
      const updated = data.map(sec => {
        if (sec.sectionId !== secId) return sec;
        return {
          ...sec,
          items: sec.items.map(item => {
            if (item.id !== itemId) return item;

            // Check numeric tolerance in real time (for data sync)
            let itemResult: 'pass' | 'fail' | undefined = undefined;
            if (item.dataType === 'number' && value) {
              const num = parseFloat(value);
              if (!isNaN(num)) {
                const passesMin = item.minValue === undefined || item.minValue === null || num >= item.minValue;
                const passesMax = item.maxValue === undefined || item.maxValue === null || num <= item.maxValue;
                itemResult = (passesMin && passesMax) ? 'pass' : 'fail';
              }
            } else if (item.dataType === 'checkbox') {
              itemResult = value === 'true' ? 'pass' : 'fail';
            }

            return { ...item, actualValue: value, result: itemResult };
          })
        };
      });
      return { ...prev, checklistData: updated };
    });
  };

  // Custom Items
  const addCustomItemToSection = (secId: string) => {
    const itemName = prompt('Nhập tên tiêu chí phát sinh tại hiện trường:');
    if (!itemName?.trim()) return;

    setForm(prev => {
      const data = prev.checklistData || [];
      const updated = data.map(sec => {
        if (sec.sectionId !== secId) return sec;

        const maxOrder = sec.items.reduce((max, i) => i.sortOrder > max ? i.sortOrder : max, 0);
        const newItem: QualityChecklistClonedItem = {
          id: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          itemName: itemName.trim(),
          required: false,
          dataType: 'text',
          sortOrder: maxOrder + 1,
          isCustom: true,
          actualValue: '',
          result: 'pass'
        };

        return {
          ...sec,
          items: [...sec.items, newItem]
        };
      });
      return { ...prev, checklistData: updated };
    });
  };

  const removeCustomItemFromSection = (secId: string, itemId: string) => {
    setForm(prev => {
      const data = prev.checklistData || [];
      const updated = data.map(sec => {
        if (sec.sectionId !== secId) return sec;
        return {
          ...sec,
          items: sec.items.filter(i => i.id !== itemId || !i.isCustom)
        };
      });
      return { ...prev, checklistData: updated };
    });
  };

  // === Tolerance Checker helper for UI border highlights ===
  const isValueOutOfTolerance = (item: QualityChecklistClonedItem): boolean => {
    if (item.dataType !== 'number' || !item.actualValue) return false;
    const num = parseFloat(item.actualValue);
    if (isNaN(num)) return true;
    if (item.minValue !== undefined && item.minValue !== null && num < item.minValue) return true;
    if (item.maxValue !== undefined && item.maxValue !== null && num > item.maxValue) return true;
    return false;
  };

  // === Filtering ===
  const filtered = checklists.filter(c => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (search) {
      return matchesSearchQueryMultiple([c.code, c.title, c.templateName, c.workLocation], search);
    }
    return true;
  });

  // === Stats ===
  const stats = {
    total: checklists.length,
    draft: checklists.filter(c => c.status === 'draft').length,
    submitted: checklists.filter(c => c.status === 'submitted').length,
    approved: checklists.filter(c => c.status === 'approved').length,
    returned: checklists.filter(c => c.status === 'returned').length,
  };

  const viewingChecklist = viewingId ? checklists.find(c => c.id === viewingId) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
        <span className="ml-3 text-sm text-slate-500 font-semibold">Đang tải hồ sơ chất lượng...</span>
      </div>
    );
  }

  // ==================== DETAIL VIEW ====================
  if (viewingChecklist) {
    const vc = viewingChecklist;
    const statusCfg = STATUS_CONFIG[vc.status];
    const resultBadge = vc.inspectionResult ? RESULT_BADGE[vc.inspectionResult] : null;

    const getItemValueForAttempt = (secId: string, itemId: string, attemptNum: number) => {
      if (vc.currentAttempt === attemptNum) {
        const sec = vc.checklistData?.find(s => s.sectionId === secId);
        const item = sec?.items?.find(i => i.id === itemId);
        return item ? { actualValue: item.actualValue, result: item.result } : null;
      } else {
        const attempt = attempts.find(a => a.attemptNumber === attemptNum);
        if (!attempt) return null;
        const sec = attempt.itemsData?.find(s => s.sectionId === secId);
        const item = sec?.items?.find(i => i.id === itemId);
        return item ? { actualValue: item.actualValue, result: item.result } : null;
      }
    };

    const isReadonly = vc.status !== 'draft' && vc.status !== 'returned';

    return (
      <div className="space-y-6 animate-in fade-in-50 duration-200 print:p-0">
        <style dangerouslySetInnerHTML={{
          __html: `
          @media print {
            body {
              background: white !important;
              color: black !important;
            }
            .no-print {
              display: none !important;
            }
            .print-full-width {
              width: 100% !important;
              max-width: 100% !important;
              flex: none !important;
              display: block !important;
            }
            #printable-quality-sheet {
              display: block !important;
              background: white !important;
              padding: 0 !important;
              margin: 0 !important;
            }
            .print-table {
              border-collapse: collapse !important;
              width: 100% !important;
            }
            .print-table th, .print-table td {
              border: 1px solid #000 !important;
              padding: 6px !important;
              color: black !important;
              font-size: 11px !important;
            }
            .print-signatures {
              display: grid !important;
              grid-template-cols: repeat(4, 1fr) !important;
              gap: 15px !important;
              margin-top: 30px !important;
              page-break-inside: avoid;
            }
            .print-drawing-container {
              page-break-inside: avoid;
              text-align: center !important;
              margin: 20px 0 !important;
            }
            .print-drawing-img {
              max-width: 100% !important;
              max-height: 400px !important;
              object-fit: contain !important;
              border: 1px solid #ddd !important;
            }
          }
          @media (min-width: 1024px) {
            .resizable-left-pane {
              width: calc(var(--left-pane-width) - 12px) !important;
              flex-shrink: 0 !important;
            }
            .resizable-right-pane {
              width: calc(100% - var(--left-pane-width) - 12px) !important;
              flex-shrink: 0 !important;
            }
          }
        `}} />

        <div className="flex items-center justify-between gap-3 flex-wrap no-print">
          <button onClick={() => setViewingId(null)} className="text-xs font-black text-slate-500 hover:text-slate-700 flex items-center gap-1">← Quay lại danh sách</button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 text-[10px] font-black bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 flex items-center gap-1 transition shadow-sm"
            >
              <Printer size={12} /> In biên bản
            </button>

            {vc.inspectionResult === 'FAILED' && vc.status === 'draft' && canManageTab && (
              <button
                onClick={handleCreateNewAttempt}
                disabled={saving}
                className="px-3.5 py-1.5 text-[10px] font-black bg-amber-500 hover:bg-amber-600 text-white rounded-lg flex items-center gap-1 shadow-sm transition"
              >
                <PlusCircle size={11} /> Khởi tạo Lần nghiệm thu {vc.currentAttempt + 1}
              </button>
            )}

            {(() => {
              const isCreator = vc.createdBy ? (user?.name === vc.createdBy || user?.id === vc.createdBy) : true;
              const isAdminUser = user?.role === Role.ADMIN;
              const canEdit = (vc.status === 'draft' || vc.status === 'returned') && (isCreator || isAdminUser);
              const isHandler = user?.id === vc.submittedToUserId || isAdminUser;

              return (
                <>
                  {canEdit && canManageTab && (
                    <>
                      <button onClick={() => { openEdit(vc); setViewingId(null); }} className="px-3 py-1.5 text-[10px] font-bold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 flex items-center gap-1"><Edit2 size={10} /> Sửa</button>
                      <button onClick={() => setSubmittingChecklist(vc)} className="px-3 py-1.5 text-[10px] font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1"><Send size={10} /> Gửi duyệt</button>
                    </>
                  )}
                  {vc.status === 'submitted' && isHandler && canManageTab && (
                    <>
                      <button onClick={() => handleStatusChange(vc.id, 'returned')} className="px-3 py-1.5 text-[10px] font-bold bg-red-50 text-red-600 rounded-lg hover:bg-red-100 flex items-center gap-1"><RotateCcw size={10} /> Trả lại</button>
                      <button onClick={() => handleStatusChange(vc.id, 'approved')} className="px-3 py-1.5 text-[10px] font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1"><CheckCircle2 size={10} /> Phê duyệt</button>
                    </>
                  )}
                  {vc.status === 'approved' && isAdminUser && (
                    <button
                      onClick={() => {
                        if (confirm('Bạn có chắc chắn muốn huỷ duyệt hồ sơ này? Trạng thái sẽ quay về Nháp (Draft).')) {
                          handleStatusChange(vc.id, 'draft');
                        }
                      }}
                      className="px-3 py-1.5 text-[10px] font-bold bg-red-100 text-red-700 rounded-lg hover:bg-red-200 flex items-center gap-1"
                    >
                      <X size={10} /> Huỷ duyệt (Admin)
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        <div
          ref={containerRef}
          id="printable-quality-sheet"
          className="flex flex-col lg:flex-row gap-6 print:block relative"
          style={{ '--left-pane-width': `${leftWidth}%` } as React.CSSProperties}
        >
          <div className="w-full resizable-left-pane space-y-4 print-full-width">
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-50 pb-3">
                <div>
                  <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <Compass size={14} className="text-indigo-600" /> Bản vẽ chi tiết & Điểm nghiệm thu
                  </h4>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">Click vào bản vẽ để đánh dấu điểm kiểm soát</p>
                </div>
                {!isReadonly && (
                  <div className="no-print">
                    <input type="file" accept="image/*" onChange={handleDrawingUpload} className="hidden" id="drawing-upload-detail" />
                    <label htmlFor="drawing-upload-detail" className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 text-slate-700 text-[10px] font-black cursor-pointer transition">
                      <Upload size={10} /> {uploadingDrawing ? 'Tải...' : 'Đổi bản vẽ'}
                    </label>
                  </div>
                )}
              </div>

              <div className="relative border border-slate-100 rounded-2xl overflow-hidden bg-slate-900/5 flex items-center justify-center print-drawing-container w-full min-h-[400px] lg:min-h-[70vh] p-2">
                {vc.drawingUrl ? (
                  <div
                    className="relative cursor-crosshair group inline-block"
                    onClick={handleDrawingClick}
                  >
                    <img
                      src={vc.drawingUrl}
                      alt="Drawing Template"
                      className="max-w-full max-h-[68vh] object-contain select-none print-drawing-img block rounded-xl shadow-sm"
                    />
                    {(vc.drawingMarkers || [])
                      .filter(m => markerFilter === 'all' || m.status === markerFilter)
                      .map(marker => {
                        const statusColor = marker.status === 'pass' ? 'bg-emerald-500 ring-emerald-300' : marker.status === 'fail' ? 'bg-red-500 ring-red-300' : 'bg-slate-400 ring-slate-300';
                        return (
                          <div
                            key={marker.id}
                            style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                            onClick={(e) => handleEditMarker(marker, e)}
                            title={`${marker.label}${marker.note ? ` (${marker.note})` : ''}`}
                            className={`absolute w-6 h-6 -ml-3 -mt-3 rounded-full ${statusColor} ring-4 ring-offset-0 text-[9px] text-white font-black flex items-center justify-center cursor-pointer shadow hover:scale-110 active:scale-95 transition-all select-none z-10`}
                          >
                            {marker.label.replace(/^\D+/g, '') || '•'}
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <div className="text-center py-10 flex flex-col items-center justify-center">
                    <Compass size={36} className="text-slate-300 mb-2" />
                    <p className="text-xs font-black text-slate-500">Chưa có bản vẽ được tải lên</p>
                    <p className="text-[9px] text-slate-400 mt-1 max-w-[200px]">Hãy nhấn "Sửa" hoặc upload bản vẽ riêng biệt cho biên bản này.</p>

                    {!isReadonly && (
                      <div className="mt-4 no-print">
                        <input type="file" accept="image/*" onChange={handleDrawingUpload} className="hidden" id="drawing-upload-empty-detail" />
                        <label htmlFor="drawing-upload-empty-detail" className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black rounded-lg cursor-pointer transition shadow-md shadow-indigo-600/10">
                          {uploadingDrawing ? 'Đang tải...' : 'Tải lên bản vẽ'}
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>

               <div className="space-y-2.5">
                <div className="flex items-center gap-3 text-[9px] font-bold text-slate-500 bg-slate-50 p-2 rounded-xl border border-slate-100 flex-wrap no-print">
                  <span className="text-slate-400 font-extrabold mr-1">Lọc trạng thái:</span>
                  {[
                    { val: 'pass', label: 'Đạt', bg: 'bg-emerald-500', activeBg: 'bg-emerald-500 text-white border-emerald-500 shadow-sm shadow-emerald-500/10' },
                    { val: 'fail', label: 'Không đạt', bg: 'bg-red-500', activeBg: 'bg-red-500 text-white border-red-500 shadow-sm shadow-red-500/10' },
                    { val: 'pending', label: 'Chờ kiểm', bg: 'bg-slate-400', activeBg: 'bg-slate-500 text-white border-slate-500 shadow-sm shadow-slate-500/10' }
                  ].map(opt => (
                    <button
                      key={opt.val}
                      onClick={() => setMarkerFilter(prev => prev === opt.val ? 'all' : (opt.val as any))}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border transition duration-150 ${
                        markerFilter === opt.val 
                          ? opt.activeBg 
                          : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full ${markerFilter === opt.val ? 'bg-white' : opt.bg} block`} />
                      {opt.label}
                    </button>
                  ))}
                  {markerFilter !== 'all' && (
                    <button
                      onClick={() => setMarkerFilter('all')}
                      className="text-[8px] font-black text-indigo-600 hover:text-indigo-800 ml-auto uppercase tracking-wider transition"
                    >
                      Hiện tất cả
                    </button>
                  )}
                </div>

                <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                  <h5 className="text-[10px] font-black text-slate-600 tracking-wide">
                    Danh sách các điểm kiểm tra {markerFilter !== 'all' && `(${markerFilter === 'pass' ? 'Đạt' : markerFilter === 'fail' ? 'Không đạt' : 'Chờ kiểm'}):`}
                  </h5>
                  {((vc.drawingMarkers || []).filter(m => markerFilter === 'all' || m.status === markerFilter)).length === 0 ? (
                    <p className="text-[9px] text-slate-400 italic">Không có điểm nào phù hợp.</p>
                  ) : (
                    (vc.drawingMarkers || [])
                      .filter(m => markerFilter === 'all' || m.status === markerFilter)
                      .map(m => (
                        <div key={m.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg text-[10px] font-bold text-slate-700 border border-slate-100/50">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${m.status === 'pass' ? 'bg-emerald-500' : m.status === 'fail' ? 'bg-red-500' : 'bg-slate-400'}`} />
                            <span className="font-black text-indigo-700">{m.label}</span>
                            {m.note && <span className="text-slate-400 font-medium">({m.note})</span>}
                          </div>
                          {!isReadonly && (
                            <button
                              onClick={(e) => handleEditMarker(m, e)}
                              className="text-[9px] text-slate-400 hover:text-indigo-600 no-print"
                            >
                              Sửa
                            </button>
                          )}
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <div
            onMouseDown={handleMouseDown}
            className={`hidden lg:flex select-none w-1.5 hover:w-2 bg-slate-100 hover:bg-indigo-300 active:bg-indigo-500 cursor-col-resize transition-all duration-150 relative shrink-0 items-center justify-center rounded-full self-stretch ${isDragging ? 'bg-indigo-400 w-2' : ''
              } no-print`}
            title="Kéo để thay đổi kích thước bản vẽ"
          >
            <div className="absolute top-1/2 -translate-y-1/2 w-4 h-8 bg-white border border-slate-200 shadow-sm rounded-md flex flex-col gap-0.5 items-center justify-center cursor-col-resize hover:border-indigo-400 z-10">
              <div className="w-0.5 h-3 bg-slate-300 rounded-full" />
              <div className="w-0.5 h-3 bg-slate-300 rounded-full" />
            </div>
          </div>

          <div className="w-full resizable-right-pane space-y-5 print-full-width">
            <div className="bg-white border-2 border-slate-900 rounded-3xl overflow-hidden shadow-sm">
              <table className="w-full text-xs text-left border-collapse print-table">
                <tbody>
                  <tr className="border-b border-slate-900">
                    <td className="p-3 font-black bg-slate-50/50 border-r border-slate-900 w-[150px] text-center">
                      <div className="text-[9px] tracking-wide text-slate-400 font-bold uppercase">Nhà thầu chính</div>
                      <div className="text-sm tracking-wider font-extrabold text-slate-800">TIẾN THỊNH</div>
                    </td>
                    <td className="p-3 text-center border-r border-slate-900 bg-slate-50/10">
                      <h2 className="text-xs font-black uppercase tracking-wider text-slate-900">Biên bản nghiệm thu nội bộ</h2>
                      <div className="text-[9px] text-slate-400 font-bold mt-0.5">Hạng mục: <span className="text-indigo-700 font-black">{vc.templateName}</span></div>
                      {projectName && <div className="text-[9px] text-indigo-900 font-bold mt-0.5">Dự án: <span className="font-extrabold">{projectName}</span></div>}
                    </td>
                    <td className="p-3 w-[150px] text-slate-800 font-bold bg-slate-50/50 text-[10px]">
                      <div>Mã: <b className="font-mono">{vc.code}</b></div>
                      <div>Lần NT: <b>{vc.currentAttempt}</b></div>
                      <div>Trạng thái: <b className="uppercase">{vc.status}</b></div>
                    </td>
                  </tr>
                  <tr>
                    <td className="p-2 border-r border-slate-900 font-black bg-slate-50/20 text-[9px] uppercase text-slate-500 text-center">Mô tả công tác</td>
                    <td colSpan={2} className="p-2 text-slate-900 font-bold">{vc.workDescription || '—'}</td>
                  </tr>
                  <tr className="border-t border-slate-900">
                    <td className="p-2 border-r border-slate-900 font-black bg-slate-50/20 text-[9px] uppercase text-slate-500 text-center">Vị trí trục cột</td>
                    <td className="p-2 border-r border-slate-900 text-slate-900 font-bold">{vc.workLocation || '—'}</td>
                    <td className="p-2 text-slate-850 font-bold bg-slate-50/10">
                      <div className="text-[9px] font-black text-slate-400 uppercase">Ngày nghiệm thu:</div>
                      <div>{vc.workDate || '—'}</div>
                    </td>
                  </tr>
                  <tr className="border-t border-slate-900">
                    <td className="p-2 border-r border-slate-900 font-black bg-slate-50/20 text-[9px] uppercase text-slate-500 text-center">Kỹ sư giám sát</td>
                    <td className="p-2 border-r border-slate-900 text-slate-900 font-bold">{vc.workSupervisor || '—'}</td>
                    <td className="p-2 text-slate-850 font-bold bg-slate-50/10">
                      <div className="text-[9px] font-black text-slate-400 uppercase">Hạn hoàn thành khắc phục:</div>
                      <div className="text-red-600 font-extrabold">{vc.targetCompletionDate || '—'}</div>
                    </td>
                  </tr>
                  <tr className="border-t border-slate-900">
                    <td className="p-2 border-r border-slate-900 font-black bg-slate-50/20 text-[9px] uppercase text-slate-500 text-center">Tiêu chuẩn kỹ thuật</td>
                    <td colSpan={2} className="p-2 text-slate-900 font-bold">{vc.standardReference || 'TCVN/Tiêu chuẩn dự án thiết kế.'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 space-y-4">
              <h4 className="text-xs font-black text-indigo-700 flex items-center gap-1.5"><CheckSquare size={14} /> Nội dung danh mục kiểm tra</h4>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse print-table">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-black text-[10px]">
                      <th className="py-2 pr-3 w-10">Stt</th>
                      <th className="py-2 pr-3">Nội dung kiểm tra</th>
                      <th className="py-2 pr-3">Yêu cầu chấp nhận / Phương pháp</th>
                      <th className="py-2 text-center w-[100px]">Lần 1</th>
                      <th className="py-2 text-center w-[100px]">Lần 2</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(vc.checklistData || []).flatMap((sec, secIdx) => {
                      const secItems = sec.items || [];
                      return [
                        <tr key={sec.sectionId} className="bg-slate-50/50 font-bold border-b border-slate-100">
                          <td colSpan={5} className="py-2 px-2 text-slate-800 font-extrabold uppercase tracking-wide text-[10px]">
                            {secIdx + 1}. {sec.sectionName}
                          </td>
                        </tr>,
                        ...secItems.map((item, itemIdx) => {
                          const val1 = getItemValueForAttempt(sec.sectionId, item.id, 1);
                          const val2 = getItemValueForAttempt(sec.sectionId, item.id, 2);

                          const renderAttemptCell = (valObj: typeof val1, attemptNum: number) => {
                            if (!valObj) {
                              return <span className="text-slate-300 font-medium">—</span>;
                            }
                            const isPass = valObj.result === 'pass';
                            const badgeColor = isPass ? 'text-emerald-600 bg-emerald-50' : 'text-red-500 bg-red-50';

                            return (
                              <div className="flex flex-col items-center justify-center gap-0.5">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${badgeColor}`}>
                                  {isPass ? 'ĐẠT' : 'K.ĐẠT'}
                                </span>
                                {valObj.actualValue && valObj.actualValue !== 'true' && valObj.actualValue !== 'false' && (
                                  <span className="text-[9px] text-slate-500 font-semibold block truncate max-w-[90px]" title={valObj.actualValue}>
                                    {valObj.actualValue}
                                  </span>
                                )}
                              </div>
                            );
                          };

                          return (
                            <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                              <td className="py-2.5 px-2 text-slate-400 font-mono text-[10px]">{secIdx + 1}.{itemIdx + 1}</td>
                              <td className="py-2.5 pr-3 text-slate-800 font-black">
                                {item.itemName}
                                {item.isCustom && <span className="text-[8px] ml-1 bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-black">PHÁT SINH</span>}
                                {item.note && <p className="text-[9px] text-slate-400 font-bold mt-0.5">Ghi chú: {item.note}</p>}
                              </td>
                              <td className="py-2.5 pr-3 text-slate-400 font-medium leading-relaxed">
                                <div>Mức: {item.acceptanceCriteria || '—'}</div>
                                <div className="text-[9px] font-mono text-slate-400 mt-0.5">Phương pháp: {item.inspectionMethod || '—'}</div>
                              </td>
                              <td className="py-2.5 text-center border-l border-slate-100">{renderAttemptCell(val1, 1)}</td>
                              <td className="py-2.5 text-center border-l border-slate-100">{renderAttemptCell(val2, 2)}</td>
                            </tr>
                          );
                        })
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 space-y-3">
              <h4 className="text-xs font-black text-indigo-700 flex items-center gap-1.5"><CheckCircle2 size={14} /> Kết luận nghiệm thu chung</h4>
              <div className="text-xs space-y-2 font-bold text-slate-700">
                <div><span className="text-slate-400">Đánh giá chung:</span> <span className="text-slate-900">{vc.conclusion || 'Chưa có kết luận.'}</span></div>
                {vc.conclusionResult && (
                  <div>
                    <span className="text-slate-400">Quyết định:</span>
                    <span className={`ml-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${vc.conclusionResult === 'accepted' ? 'bg-emerald-50 text-emerald-600' : vc.conclusionResult === 'conditional' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'
                      }`}>
                      {vc.conclusionResult === 'accepted' ? 'ĐỒNG Ý CHẤP NHẬN' : vc.conclusionResult === 'conditional' ? 'CHẤP NHẬN CÓ ĐIỀU KIỆN' : 'TỪ CHỐI NGHIỆM THU'}
                    </span>
                  </div>
                )}
                {vc.conditions && <div><span className="text-slate-400 text-amber-600">Điều kiện sửa đổi khắc phục:</span> <span className="text-slate-900 font-extrabold">{vc.conditions}</span></div>}
              </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-3xl p-5 shadow-sm space-y-4">
              <h4 className="text-xs font-black text-indigo-700 border-b border-slate-50 pb-2 flex items-center gap-1.5"><ShieldCheck size={14} /> Chữ ký & Phê duyệt điện tử</h4>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 print-signatures">
                {[
                  { code: 'inspector', name: 'Kỹ sư kiểm tra' },
                  { code: 'contractor', name: 'Đại diện nhà thầu' },
                  { code: 'supervisor', name: 'Kỹ sư giám sát' },
                  { code: 'completion', name: 'Nghiệm thu hoàn thành' }
                ].map(role => {
                  const signature = (vc.signersData || []).find(s => s.roleCode === role.code);
                  return (
                    <div key={role.code} className="border border-slate-100 rounded-2xl p-4 flex flex-col justify-between items-center text-center bg-slate-50/30 min-h-[140px] hover:border-slate-200 transition">
                      <div>
                        <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{role.name}</h5>
                        <p className="text-[9px] text-slate-500 mt-0.5 font-bold">Quy trình nghiệm thu</p>
                      </div>

                      {signature ? (
                        <div className="space-y-1 my-2">
                          {signature.signatureUrl ? (
                            <img src={signature.signatureUrl} alt="Signature" className="h-10 object-contain mx-auto mix-blend-multiply select-none" />
                          ) : (
                            <span className="text-indigo-600 font-serif italic font-black text-sm tracking-wide block py-2">{signature.userName}</span>
                          )}
                          <span className="text-[9px] text-slate-700 block font-extrabold">{signature.userName}</span>
                          <span className="text-[8px] text-slate-400 block font-mono">{new Date(signature.signedAt || '').toLocaleDateString('vi-VN')}</span>
                        </div>
                      ) : (
                        <div className="text-[9px] text-slate-300 italic my-3 font-semibold">Chưa ký nhận</div>
                      )}

                      <div className="w-full pt-2 border-t border-slate-100/50 no-print flex gap-1 justify-center">
                        {signature ? (
                          (user?.role === Role.ADMIN || user?.name === signature.userName) && (
                            <button onClick={() => handleClearSignature(role.code as any, role.name)} className="text-[8px] font-black text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition uppercase">Xoá ký</button>
                          )
                        ) : (
                          <button onClick={() => handleSign(role.code as any, role.name)} className="text-[8px] font-black text-indigo-600 hover:text-indigo-800 px-2.5 py-1 rounded bg-indigo-50 hover:bg-indigo-100 transition uppercase shadow-sm">Ký duyệt</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>

        {submittingChecklist && (
          <ProjectSubmissionDialog
            title="Gửi duyệt hồ sơ chất lượng"
            documentLabel="HỒ SƠ CHẤT LƯỢNG"
            documentName={submittingChecklist.title}
            documentSubtitle={`Mã: ${submittingChecklist.code} · Quy trình: ${submittingChecklist.templateName}`}
            projectId={projectId}
            constructionSiteId={siteId || null}
            recipientPermissionCodes={['approve']}
            onCancel={() => setSubmittingChecklist(null)}
            onConfirm={handleConfirmSubmit}
          />
        )}
      </div>
    );
  }

  // ==================== FORM VIEW (edit flow) ====================
  if (showForm && editingChecklist) {
    const isReadonly = editingChecklist.status !== 'draft' && editingChecklist.status !== 'returned';
    return (
      <div className="space-y-4 animate-in fade-in-50 duration-200">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-black text-slate-900">{editingChecklist.code} — Chỉnh sửa hồ sơ chất lượng</h3>
            <p className="text-[10px] text-slate-400 mt-0.5 font-bold">Mẫu: <b className="text-indigo-600">{form.templateName}</b> (v{form.templateVersion})</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowForm(false); setEditingChecklist(null); }} className="px-3 py-1.5 text-[10px] font-bold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 flex items-center gap-1"><X size={10} /> Đóng</button>
            {!isReadonly && (
              <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-[10px] font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1">
                <Save size={10} /> {saving ? 'Đang lưu...' : 'Lưu hồ sơ'}
              </button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden divide-y divide-slate-50">
          {/* Section 1: General Info */}
          <div>
            <button onClick={() => toggleSection('general')} className="w-full flex items-center gap-3 px-5 py-4 bg-slate-50 hover:bg-slate-100/50 text-left transition">
              <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-black">1</div>
              <Wrench size={14} className="text-slate-500" />
              <span className="text-xs font-black text-slate-800 flex-1">Thông tin công tác thi công</span>
              {expandedSections.has('general') ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
            </button>

            {expandedSections.has('general') && (
              <div className="px-6 py-4 space-y-4 animate-in fade-in-50 duration-150">
                <div>
                  <label className="text-[10px] font-black text-slate-500 block mb-1">Tiêu đề biên bản nghiệm thu *</label>
                  <input type="text" value={form.title || ''} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} placeholder="Tiêu đề..." className="w-full text-xs font-bold text-slate-900 border border-slate-200 rounded-xl px-3.5 py-2.5 outline-none focus:ring-1 focus:ring-indigo-300" readOnly={isReadonly} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 block mb-1">Mô tả công việc</label>
                  <textarea value={form.workDescription || ''} onChange={e => setForm(prev => ({ ...prev, workDescription: e.target.value }))} placeholder="Mô tả công tác..." rows={2} className="w-full text-xs border border-slate-200 rounded-xl px-3.5 py-2.5 outline-none resize-none font-medium text-slate-700" readOnly={isReadonly} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 mb-1 block"><MapPin size={10} className="inline mr-0.5" />Vị trí trục / cao độ</label>
                    <input type="text" value={form.workLocation || ''} onChange={e => setForm(prev => ({ ...prev, workLocation: e.target.value }))} className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none font-bold" readOnly={isReadonly} />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 mb-1 block"><Calendar size={10} className="inline mr-0.5" />Ngày thực hiện</label>
                    <input type="date" value={form.workDate || ''} onChange={e => setForm(prev => ({ ...prev, workDate: e.target.value }))} className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none font-bold" readOnly={isReadonly} />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 mb-1 block">
                      <User size={10} className="inline mr-0.5" />Kỹ sư giám sát
                    </label>
                    {isReadonly ? (
                      <input
                        type="text"
                        value={form.workSupervisor || ''}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none font-bold bg-slate-50"
                        readOnly
                      />
                    ) : projectStaff.length > 0 ? (
                      <select
                        value={form.workSupervisor || ''}
                        onChange={e => setForm(prev => ({ ...prev, workSupervisor: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none font-bold bg-white"
                      >
                        <option value="">— Chọn giám sát —</option>
                        {projectStaff.map(staff => (
                          <option key={staff.id} value={staff.userName || staff.userId || ''}>
                            {staff.userName || staff.userId} ({staff.positionName || 'Nhân sự'})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={form.workSupervisor || ''}
                        onChange={e => setForm(prev => ({ ...prev, workSupervisor: e.target.value }))}
                        placeholder="Nhập tên giám sát..."
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none font-bold bg-white"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Render Dynamic Cloned Sections */}
          {(form.checklistData || []).map((sec, secIdx) => {
            const isExpanded = expandedSections.has(sec.sectionId);
            const secItems = sec.items || [];

            return (
              <div key={sec.sectionId}>
                <button onClick={() => toggleSection(sec.sectionId)} className="w-full flex items-center gap-3 px-5 py-4 bg-slate-50 hover:bg-slate-100/50 text-left transition">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-black">{secIdx + 2}</div>
                  <CheckSquare size={14} className="text-slate-500" />
                  <span className="text-xs font-black text-slate-800 flex-1">{sec.sectionName}</span>
                  <span className="text-[10px] text-slate-400 font-bold mr-2">
                    {secItems.filter(i => i.result === 'pass').length}/{secItems.length} đạt
                  </span>
                  {isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                </button>

                {isExpanded && (
                  <div className="px-6 py-4 space-y-4 animate-in fade-in-50 duration-150">
                    {secItems.map((item, itemIdx) => {
                      const outOfTolerance = isValueOutOfTolerance(item);

                      return (
                        <div key={item.id} className={`p-4 rounded-2xl border transition-all ${item.isCustom
                          ? 'bg-amber-50/20 border-amber-200'
                          : 'bg-white border-slate-100 hover:border-slate-200/60'
                          }`}>
                          <div className="flex flex-col md:flex-row justify-between gap-3 items-start md:items-center">
                            {/* Left part: Title & Type labels */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-black text-slate-800">{item.itemName}</span>
                                {item.required && (
                                  <span className="text-[8px] font-black bg-red-50 text-red-500 border border-red-100 px-1 py-0.5 rounded">BẮT BUỘC</span>
                                )}
                                {item.isCustom && (
                                  <span className="text-[8px] font-black bg-amber-100 text-amber-700 px-1 py-0.5 rounded">PHÁT SINH</span>
                                )}
                              </div>
                              <div className="flex gap-3 text-[10px] text-slate-400 mt-1.5 font-bold">
                                {item.acceptanceCriteria && <span>Yêu cầu: <b className="text-slate-500">{item.acceptanceCriteria}</b></span>}
                                {item.inspectionMethod && <span>Phương pháp: <b className="text-slate-500">{item.inspectionMethod}</b></span>}
                              </div>
                            </div>

                            {/* Right part: Input value based on DataType */}
                            <div className="shrink-0 flex items-center gap-3 w-full md:w-auto">
                              {item.dataType === 'checkbox' ? (
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-200">
                                  <input
                                    type="checkbox"
                                    checked={item.actualValue === 'true'}
                                    onChange={e => updateDynamicItemValue(sec.sectionId, item.id, e.target.checked ? 'true' : 'false')}
                                    disabled={isReadonly}
                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                                  />
                                  Đạt yêu cầu
                                </label>
                              ) : item.dataType === 'number' ? (
                                <div className="space-y-1 w-full md:w-48 relative">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={item.actualValue || ''}
                                      onChange={e => updateDynamicItemValue(sec.sectionId, item.id, e.target.value)}
                                      disabled={isReadonly}
                                      placeholder="Nhập số thực..."
                                      className={`w-full bg-slate-50 border rounded-xl px-3 py-2.5 text-xs font-black text-right outline-none focus:ring-1 ${outOfTolerance
                                        ? 'border-red-400 focus:ring-red-400 bg-red-50 text-red-700'
                                        : 'border-slate-200 focus:ring-indigo-300'
                                        }`}
                                    />
                                    {item.unit && <span className="text-xs font-bold text-slate-400 shrink-0">{item.unit}</span>}
                                  </div>
                                  {outOfTolerance && (
                                    <div className="text-[9px] text-red-500 font-bold flex items-center gap-0.5 absolute -bottom-4 right-0">
                                      <AlertCircle size={10} /> Ngoài khoảng cho phép!
                                    </div>
                                  )}
                                </div>
                              ) : item.dataType === 'photo' ? (
                                <div className="flex items-center gap-2 w-full md:w-64">
                                  <input
                                    type="text"
                                    value={item.actualValue || ''}
                                    onChange={e => updateDynamicItemValue(sec.sectionId, item.id, e.target.value)}
                                    disabled={isReadonly}
                                    placeholder="Link ảnh bằng chứng..."
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs outline-none"
                                  />
                                </div>
                              ) : (
                                <input
                                  type="text"
                                  value={item.actualValue || ''}
                                  onChange={e => updateDynamicItemValue(sec.sectionId, item.id, e.target.value)}
                                  disabled={isReadonly}
                                  placeholder="Nhập ghi nhận..."
                                  className="w-full md:w-56 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs outline-none"
                                />
                              )}

                              <input
                                type="text"
                                value={item.note || ''}
                                onChange={e => {
                                  setForm(prev => {
                                    const updated = (prev.checklistData || []).map(s => {
                                      if (s.sectionId !== sec.sectionId) return s;
                                      return {
                                        ...s,
                                        items: s.items.map(i => i.id === item.id ? { ...i, note: e.target.value } : i)
                                      };
                                    });
                                    return { ...prev, checklistData: updated };
                                  });
                                }}
                                disabled={isReadonly}
                                placeholder="Ghi chú thêm"
                                className="w-24 bg-slate-50 border border-slate-200 rounded-xl px-2 py-2.5 text-[10px] outline-none"
                              />

                              {item.isCustom && !isReadonly && (
                                <button
                                  onClick={() => removeCustomItemFromSection(sec.sectionId, item.id)}
                                  className="p-2 text-red-400 hover:text-red-600 rounded-xl hover:bg-slate-50 shrink-0"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {!isReadonly && (
                      <button
                        onClick={() => addCustomItemToSection(sec.sectionId)}
                        className="text-[10px] font-black text-amber-600 hover:text-amber-800 flex items-center gap-1 mt-2.5"
                      >
                        <Plus size={12} /> Thêm tiêu chí phát sinh tại hiện trường
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Section 6: Acceptance Conclusion */}
          <div>
            <button onClick={() => toggleSection('conclusion')} className="w-full flex items-center gap-3 px-5 py-4 bg-slate-50 hover:bg-slate-100/50 text-left transition">
              <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-black">
                {(form.checklistData || []).length + 2}
              </div>
              <CheckCircle2 size={14} className="text-slate-500" />
              <span className="text-xs font-black text-slate-800 flex-1">Kết luận nghiệm thu chung</span>
              {expandedSections.has('conclusion') ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
            </button>

            {expandedSections.has('conclusion') && (
              <div className="px-6 py-4 space-y-4 animate-in fade-in-50 duration-150">
                <textarea value={form.conclusion || ''} onChange={e => setForm(prev => ({ ...prev, conclusion: e.target.value }))} placeholder="Nhập ghi chép đánh giá kết luận nghiệm thu chung..." rows={3} className="w-full text-xs border border-slate-200 rounded-xl px-3.5 py-2.5 outline-none resize-none font-medium text-slate-700" readOnly={isReadonly} />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 mb-1 block">Quyết định nghiệm thu</label>
                    <select value={form.conclusionResult || ''} onChange={e => setForm(prev => ({ ...prev, conclusionResult: (e.target.value || undefined) as QualityConclusionResult | undefined }))} disabled={isReadonly} className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none font-bold">
                      <option value="">— Chưa kết luận —</option>
                      <option value="accepted">✅ Đồng ý Chấp nhận</option>
                      <option value="conditional">⚠️ Chấp nhận có điều kiện</option>
                      <option value="rejected">❌ Từ chối nghiệm thu</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 mb-1 block">Người lập kiểm tra</label>
                    <input type="text" value={form.inspectorName || ''} onChange={e => setForm(prev => ({ ...prev, inspectorName: e.target.value }))} className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none font-bold" readOnly={isReadonly} />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 mb-1 block">Người phê duyệt ban ngành</label>
                    <input type="text" value={form.approverName || ''} onChange={e => setForm(prev => ({ ...prev, approverName: e.target.value }))} className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none font-bold" readOnly={isReadonly} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==================== LIST VIEW (Default tab view) ====================
  return (
    <div className="space-y-5">
      {/* Dynamic Template Selector Modal */}
      {showTemplateSelector && (
        <TemplateSelector onSelect={handleSelectTemplate} onClose={() => setShowTemplateSelector(false)} />
      )}

      {/* Overview Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Tổng biên bản', value: stats.total, color: 'text-slate-700', bg: 'bg-slate-50' },
          { label: 'Nháp', value: stats.draft, color: 'text-slate-500', bg: 'bg-slate-50' },
          { label: 'Chờ duyệt', value: stats.submitted, color: 'text-amber-600', bg: 'bg-amber-50/50' },
          { label: 'Đã duyệt', value: stats.approved, color: 'text-emerald-600', bg: 'bg-emerald-50/50' },
          { label: 'Trả lại', value: stats.returned, color: 'text-red-600', bg: 'bg-red-50/50' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-2xl p-4 text-center border border-slate-100`}>
            <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* List Toolbar Actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 max-w-lg">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm mã biên bản, tiêu đề, tên mẫu..." className="w-full text-xs pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-1 focus:ring-indigo-300 font-bold" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="text-xs border border-slate-200 rounded-xl px-3 py-2.5 outline-none font-bold bg-white">
            <option value="">Tất cả trạng thái</option>
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
        </div>
        {canManageTab && (
          <button onClick={() => setShowTemplateSelector(true)} disabled={saving} className="px-5 py-2.5 text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl flex items-center gap-1.5 shadow-lg shadow-indigo-600/10 transition">
            <Layers size={14} /> Chọn mẫu nghiệm thu
          </button>
        )}
      </div>

      {/* Main Inspection Checklists List */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-slate-100">
          <ClipboardCheck size={40} className="text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-black text-slate-500">Chưa có hồ sơ kiểm soát chất lượng nào</p>
          <p className="text-xs text-slate-400 mt-1">Bấm nút "Chọn mẫu nghiệm thu" ở trên để sinh biên bản đầu tiên.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const statusCfg = STATUS_CONFIG[c.status];
            const resultBadge = c.inspectionResult ? RESULT_BADGE[c.inspectionResult] : null;
            return (
              <div key={c.id} onClick={() => setViewingId(c.id)} className="bg-white rounded-2xl border border-slate-100 hover:border-indigo-200 hover:shadow-md transition-all cursor-pointer p-5 flex items-center gap-4 group">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-xl shrink-0">
                  {c.templateCode?.includes('THEP') ? '⚙️' : '🏗️'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono font-bold text-indigo-500">
                      {c.code}
                    </span>
                    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold border ${statusCfg.bg} ${statusCfg.color}`}>{statusCfg.icon} {statusCfg.label}</span>
                    {resultBadge && <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${resultBadge.color} ${resultBadge.bg}`}>{resultBadge.label}</span>}
                    <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Lần {c.currentAttempt}</span>
                  </div>
                  <h4 className="text-xs font-black text-slate-800 mt-1 truncate group-hover:text-indigo-700 transition-colors">{c.title}</h4>
                  <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400 font-bold flex-wrap">
                    <span className="text-indigo-500">{c.templateName}</span>
                    {c.workLocation && <span className="flex items-center gap-0.5"><MapPin size={10} /> {c.workLocation}</span>}
                    {c.workDate && <span>{c.workDate}</span>}
                    {c.totalCriteria !== undefined && c.totalCriteria > 0 && (
                      <span className="text-slate-500">Đạt: <b>{c.passedCriteria}/{c.totalCriteria}</b></span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={e => e.stopPropagation()}>
                  {(() => {
                    const isCreator = c.createdBy ? (user?.name === c.createdBy || user?.id === c.createdBy) : true;
                    const isAdminUser = user?.role === Role.ADMIN;
                    const canEdit = (c.status === 'draft' || c.status === 'returned') && (isCreator || isAdminUser);
                    return canEdit && canManageTab && (
                      <>
                        <button onClick={() => openEdit(c)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-800"><Edit2 size={13} /></button>
                        <button onClick={() => handleDelete(c.id)} className="p-2 rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={13} /></button>
                      </>
                    );
                  })()}
                  <Eye size={14} className="text-slate-300 ml-1" />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {submittingChecklist && (
        <ProjectSubmissionDialog
          title="Gửi duyệt hồ sơ chất lượng"
          documentLabel="HỒ SƠ CHẤT LƯỢNG"
          documentName={submittingChecklist.title}
          documentSubtitle={`Mã: ${submittingChecklist.code} · Quy trình: ${submittingChecklist.templateName}`}
          projectId={projectId}
          constructionSiteId={siteId || null}
          recipientPermissionCodes={['approve']}
          onCancel={() => setSubmittingChecklist(null)}
          onConfirm={handleConfirmSubmit}
        />
      )}

      {showMarkerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200 no-print">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-gradient-to-r from-indigo-50/50 to-violet-50/50">
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  {editingMarkerId ? 'Chỉnh sửa điểm kiểm soát' : 'Thêm điểm kiểm soát mới'}
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5 font-bold">
                  Định vị: X={newMarkerCoords?.x.toFixed(1)}%, Y={newMarkerCoords?.y.toFixed(1)}%
                </p>
              </div>
              <button 
                onClick={() => { setShowMarkerModal(false); setEditingMarkerId(null); }} 
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form Content */}
            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 block mb-1">Tên điểm đánh dấu *</label>
                <input 
                  type="text" 
                  value={newMarkerLabel} 
                  onChange={e => setNewMarkerLabel(e.target.value)} 
                  placeholder="Ví dụ: Điểm A1, Cột B2..." 
                  className="w-full text-xs font-bold text-slate-900 border border-slate-200 rounded-xl px-3.5 py-2.5 outline-none focus:ring-1 focus:ring-indigo-300"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 block mb-1">Trạng thái kiểm tra</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { val: 'pass', label: 'Đạt' },
                    { val: 'fail', label: 'Không Đạt' },
                    { val: 'pending', label: 'Chờ kiểm' }
                  ].map(opt => (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => setNewMarkerStatus(opt.val as any)}
                      className={`py-2 px-3 border rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                        newMarkerStatus === opt.val 
                          ? opt.val === 'pass' 
                            ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm shadow-emerald-500/20' 
                            : opt.val === 'fail'
                              ? 'bg-red-500 text-white border-red-500 shadow-sm shadow-red-500/20'
                              : 'bg-slate-500 text-white border-slate-500 shadow-sm shadow-slate-500/20'
                          : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${
                        newMarkerStatus === opt.val 
                          ? 'bg-white' 
                          : opt.val === 'pass' 
                            ? 'bg-emerald-500' 
                            : opt.val === 'fail' 
                              ? 'bg-red-500' 
                              : 'bg-slate-400'
                      }`} />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 block mb-1">Ghi chú (nếu có)</label>
                <textarea 
                  value={newMarkerNote} 
                  onChange={e => setNewMarkerNote(e.target.value)} 
                  placeholder="Ghi chú thêm về lỗi hoặc mô tả điểm..." 
                  rows={3} 
                  className="w-full text-xs border border-slate-200 rounded-xl px-3.5 py-2.5 outline-none resize-none font-medium text-slate-700 focus:ring-1 focus:ring-indigo-300"
                />
              </div>
            </div>

            {/* Footer actions */}
            <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex justify-between gap-3">
              <div>
                {editingMarkerId && (
                  <button
                    type="button"
                    onClick={() => handleDeleteMarker(editingMarkerId)}
                    className="px-4 py-2 text-xs font-bold bg-red-50 hover:bg-red-100 text-red-600 rounded-xl flex items-center gap-1 transition animate-in fade-in duration-150"
                  >
                    <Trash2 size={12} /> Xoá điểm
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowMarkerModal(false); setEditingMarkerId(null); }}
                  className="px-4 py-2 text-xs font-bold bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition"
                >
                  Huỷ
                </button>
                <button
                  type="button"
                  onClick={handleSaveMarker}
                  className="px-5 py-2 text-xs font-black bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition shadow-md shadow-indigo-600/10"
                >
                  Lưu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QualityTab;
