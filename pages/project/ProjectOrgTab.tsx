import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, Trash2, Edit2, Save, X, Shield, UserPlus,
  XCircle, Calendar
} from 'lucide-react';
import { ProjectStaff, ProjectPermissionType, HrmPosition, UserPermissionGrant } from '../../types';
import { projectStaffService, projectPermissionTypeService, type ProjectOrgCapability } from '../../lib/projectStaffService';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { supabase } from '../../lib/supabase';
import { fromDb } from '../../lib/dbMapping';
import PremiumMemberSelect, { MemberOption } from '../../components/common/PremiumMemberSelect';
import PermissionDiffPreview from '../../components/permissions/PermissionDiffPreview';
import PermissionMatrix from '../../components/permissions/PermissionMatrix';
import { listUserPermissionGrants } from '../../lib/permissions/permissionAdminService';
import {
  getLegacyProjectCodesDerivedFromPermissionCodes,
  legacyProjectCodeToPermissionCodes,
  type LegacyProjectPermissionCode,
} from '../../lib/permissions/projectPermissionService';
import {
  getProjectPermissionTemplateCodes,
  PROJECT_PERMISSION_TEMPLATES,
  type ProjectPermissionTemplateKey,
} from '../../lib/permissions/projectPermissionTemplates';
import { PermissionScope } from '../../lib/permissions/permissionTypes';
import type { EffectivePermissionSource } from '../../lib/permissions/authorizationGovernanceTypes';
import { getPermissionActionByCode } from '../../lib/permissions/permissionRegistry';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  canManageTab?: boolean;
}

const LEVEL_COLORS: Record<number, string> = {
  1: 'from-amber-500 to-orange-600',
  2: 'from-violet-500 to-purple-600',
  3: 'from-blue-500 to-indigo-600',
  4: 'from-emerald-500 to-teal-600',
  5: 'from-slate-400 to-slate-600',
  6: 'from-slate-300 to-slate-500',
};

const LEVEL_BG: Record<number, string> = {
  1: 'bg-amber-50 border-amber-200',
  2: 'bg-violet-50 border-violet-200',
  3: 'bg-blue-50 border-blue-200',
  4: 'bg-emerald-50 border-emerald-200',
  5: 'bg-slate-50 border-slate-200',
  6: 'bg-slate-50 border-slate-100',
};

const LEGACY_PROJECT_PERMISSION_CODES = new Set(['view', 'edit', 'delete', 'submit', 'verify', 'confirm', 'approve', 'view_available_stock']);

const grantMatchesScope = (grant: UserPermissionGrant, scope: PermissionScope) =>
  grant.permissionCode.startsWith('project.') &&
  grant.scopeType === (scope.scopeType || 'project') &&
  grant.scopeId === (scope.scopeId || '*');

const buildScopedProjectGrants = (
  userId: string,
  permissionCodes: readonly string[],
  scope: PermissionScope,
): UserPermissionGrant[] =>
  [...new Set(permissionCodes)]
    .filter(permissionCode => permissionCode.startsWith('project.'))
    .map(permissionCode => ({
      id: `local-${userId}-${permissionCode}-${scope.scopeType || 'project'}-${scope.scopeId || '*'}`,
      userId,
      permissionCode,
      scopeType: scope.scopeType || 'project',
      scopeId: scope.scopeId || '*',
      isActive: true,
    }));

const EMPTY_PROJECT_ORG_CAPABILITY: ProjectOrgCapability = {
  canView: false,
  canAssignStaff: false,
  canGrantPermissions: false,
};

const ProjectOrgTab: React.FC<Props> = ({ projectId, constructionSiteId, canManageTab = true }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const { users, hrmPositions } = useApp();
  const { user: currentUser } = useApp();

  const [staff, setStaff] = useState<ProjectStaff[]>([]);
  const [permTypes, setPermTypes] = useState<ProjectPermissionType[]>([]);
  const [positions, setPositions] = useState<HrmPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<ProjectStaff | null>(null);

  // Form
  const [fUserId, setFUserId] = useState('');
  const [fPositionId, setFPositionId] = useState('');
  const [fStartDate, setFStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [fNote, setFNote] = useState('');
  const [fPermIds, setFPermIds] = useState<Set<string>>(new Set());
  const [initialProjectGrants, setInitialProjectGrants] = useState<UserPermissionGrant[]>([]);
  const [fProjectGrants, setFProjectGrants] = useState<UserPermissionGrant[]>([]);
  const [capabilities, setCapabilities] = useState<ProjectOrgCapability>(EMPTY_PROJECT_ORG_CAPABILITY);
  const [grantLoading, setGrantLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const projectGrantScope = useMemo<PermissionScope>(
    () => ({
      scopeType: constructionSiteId ? 'construction_site' : 'project',
      scopeId: constructionSiteId || projectId,
    }),
    [constructionSiteId, projectId],
  );

  const activeScopedProjectGrantCodes = useMemo(() => (
    fProjectGrants
      .filter(grant => grant.isActive !== false && grantMatchesScope(grant, projectGrantScope))
      .map(grant => grant.permissionCode)
  ), [fProjectGrants, projectGrantScope]);

  const derivedLegacyProjectCodes = useMemo(
    () => new Set(getLegacyProjectCodesDerivedFromPermissionCodes(activeScopedProjectGrantCodes)),
    [activeScopedProjectGrantCodes],
  );

  const visibleLegacyPermissionTypes = useMemo(() => (
    [...fPermIds]
      .map(permissionTypeId => permTypes.find(permissionType => permissionType.id === permissionTypeId))
      .filter((permissionType): permissionType is ProjectPermissionType =>
        Boolean(permissionType) &&
        LEGACY_PROJECT_PERMISSION_CODES.has(permissionType.code) &&
        !derivedLegacyProjectCodes.has(permissionType.code as LegacyProjectPermissionCode)
      )
  ), [derivedLegacyProjectCodes, fPermIds, permTypes]);

  const inheritedProjectPermissionCodes = useMemo(() => {
    const legacyCodes = visibleLegacyPermissionTypes.map(permissionType => permissionType.code);
    return [...new Set(legacyCodes.flatMap(code => legacyProjectCodeToPermissionCodes(code as LegacyProjectPermissionCode)))];
  }, [visibleLegacyPermissionTypes]);

  const inheritedProjectEffectiveSources = useMemo<EffectivePermissionSource[]>(() => (
    inheritedProjectPermissionCodes.map(permissionCode => {
      const action = getPermissionActionByCode(permissionCode);
      return {
        permissionCode,
        sourceType: 'LEGACY',
        sourceId: `project-staff-${permissionCode}`,
        sourceCode: 'PROJECT_STAFF',
        sourceLabel: 'Legacy project staff',
        scopeType: projectGrantScope.scopeType || 'project',
        scopeId: projectGrantScope.scopeId || '*',
        riskLevel: action?.riskLevel || 'normal',
        isBusinessApproval: action?.isBusinessApproval || false,
        metadata: {},
      };
    })
  ), [inheritedProjectPermissionCodes, projectGrantScope]);

  const canAssignStaff = canManageTab || capabilities.canAssignStaff;
  const canGrantPermissions = canManageTab || capabilities.canGrantPermissions;
  const canEditMember = canAssignStaff || canGrantPermissions;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [staffData, permData, orgCapabilities] = await Promise.all([
        projectStaffService.listByProject(projectId, constructionSiteId || undefined),
        projectPermissionTypeService.list(),
        currentUser?.id
          ? projectStaffService.getProjectOrgCapabilities({
            userId: currentUser.id,
            projectId,
            constructionSiteId: constructionSiteId || null,
          })
          : Promise.resolve(EMPTY_PROJECT_ORG_CAPABILITY),
      ]);
      setStaff(staffData);
      setPermTypes(permData.filter(p => p.isActive));
      setCapabilities(orgCapabilities);
      const { data: positionRows, error: positionError } = await supabase
        .from('hrm_positions')
        .select('*')
        .order('level', { ascending: true })
        .order('name', { ascending: true });
      if (positionError) throw positionError;
      setPositions((positionRows || []).map(row => fromDb(row) as HrmPosition));
    } catch (e: any) {
      toast.error('Lỗi tải dữ liệu', e?.message);
      setPositions(prev => prev.length > 0 ? prev : hrmPositions);
    } finally {
      setLoading(false);
    }
  }, [projectId, constructionSiteId, currentUser?.id, hrmPositions, toast]);

  useEffect(() => { load(); }, [load]);

  // Group staff by position level for visual hierarchy
  const groupedStaff = useMemo(() => {
    const groups = new Map<number, ProjectStaff[]>();
    for (const s of staff) {
      const level = s.positionLevel ?? 99;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level)!.push(s);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [staff]);

  // Sorted positions for dropdown
  const sortedPositions = useMemo(() =>
    [...(positions.length > 0 ? positions : hrmPositions)].sort((a, b) =>
      (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name, 'vi')),
  [hrmPositions, positions]);

  // Filter active users who are not yet added to the project staff
  const memberOptions: MemberOption[] = useMemo(() => {
    const existingIds = new Set(staff.map(s => s.userId));
    return users
      .filter(u => !existingIds.has(u.id) && u.isActive !== false)
      .map(u => ({
        id: u.id,
        name: u.name || u.username || u.email || 'Nhân sự',
        avatarUrl: u.avatar || null,
        roleLabel: u.role || null,
        subtitle: u.email || null
      }));
  }, [users, staff]);

  const resetForm = () => {
    setEditingStaff(null);
    setFUserId('');
    setFPositionId('');
    setFStartDate(new Date().toISOString().slice(0, 10));
    setFNote('');
    setFPermIds(new Set());
    setInitialProjectGrants([]);
    setFProjectGrants([]);
    setGrantLoading(false);
    setSearchQuery('');
    setShowModal(false);
  };

  const ensureCapability = (allowed: boolean, permissionCode: string, action: string) => {
    if (allowed) return true;
    toast.warning('Không có quyền Tổ chức Dự Án', `Bạn cần quyền "${permissionCode}" để ${action}.`);
    return false;
  };

  const openAdd = () => {
    if (!ensureCapability(canAssignStaff, 'project.org.assign_staff', 'thêm thành viên dự án')) return;
    resetForm();
    setShowModal(true);
  };

  const openEdit = (s: ProjectStaff) => {
    if (!ensureCapability(canEditMember, 'project.org.assign_staff / project.org.grant_permissions', 'sửa thành viên dự án')) return;
    setEditingStaff(s);
    setFUserId(s.userId);
    setFPositionId(s.positionId);
    setFStartDate(s.startDate || new Date().toISOString().slice(0, 10));
    setFNote(s.note || '');
    setFPermIds(new Set(
      (s.permissions || []).filter(p => p.isActive).map(p => p.permissionTypeId)
    ));
    setShowModal(true);
    setGrantLoading(true);
    listUserPermissionGrants(s.userId)
      .then(grants => {
        const scopedProjectGrants = grants.filter(grant => grantMatchesScope(grant, projectGrantScope));
        setInitialProjectGrants(scopedProjectGrants);
        setFProjectGrants(scopedProjectGrants);
      })
      .catch(error => {
        console.warn('Failed to load project PBAC v2 grants', error);
        toast.warning('Không tải được grant mới', 'Ma trận vẫn hiển thị quyền legacy/inherited hiện có.');
        setInitialProjectGrants([]);
        setFProjectGrants([]);
      })
      .finally(() => setGrantLoading(false));
  };

  const normalizeProjectGrantsForTarget = useCallback((targetUserId: string, grants: readonly UserPermissionGrant[]) =>
    grants
      .filter(grant => grant.permissionCode.startsWith('project.'))
      .map(grant => ({
        ...grant,
        userId: targetUserId,
        scopeType: projectGrantScope.scopeType || 'project',
        scopeId: projectGrantScope.scopeId || '*',
        isActive: grant.isActive ?? true,
      })),
    [projectGrantScope],
  );

  const applyTemplate = (templateKey: ProjectPermissionTemplateKey) => {
    if (!ensureCapability(canGrantPermissions, 'project.org.grant_permissions', 'áp dụng template quyền')) return;
    const targetUserId = fUserId || editingStaff?.userId;
    if (!targetUserId) {
      toast.warning('Chưa chọn nhân viên', 'Chọn nhân viên trước khi áp dụng template quyền.');
      return;
    }
    setFProjectGrants(buildScopedProjectGrants(targetUserId, getProjectPermissionTemplateCodes(templateKey), projectGrantScope));
  };

  const handleSave = async () => {
    if (!ensureCapability(canEditMember, 'project.org.assign_staff / project.org.grant_permissions', 'lưu tổ chức dự án')) return;
    if (!fUserId) { toast.warning('Thiếu', 'Vui lòng chọn nhân viên'); return; }
    if (canAssignStaff && !fPositionId) { toast.warning('Thiếu', 'Vui lòng chọn vị trí'); return; }

    try {
      if (editingStaff) {
        if (canAssignStaff) {
          await projectStaffService.update(editingStaff.id, {
            positionId: fPositionId,
            startDate: fStartDate,
            note: fNote,
          }, currentUser?.id, currentUser?.name);
        }
        if (canGrantPermissions) {
          await projectStaffService.replaceProjectStaffPermissionGrants(
            editingStaff.id,
            normalizeProjectGrantsForTarget(editingStaff.userId, fProjectGrants),
            currentUser?.id,
            currentUser?.name,
          );
        }
        toast.success('Đã cập nhật thành viên');
      } else {
        if (!ensureCapability(canAssignStaff, 'project.org.assign_staff', 'thêm thành viên dự án')) return;
        const staffId = await projectStaffService.add({
          projectId,
          constructionSiteId: constructionSiteId || null,
          userId: fUserId,
          positionId: fPositionId,
          permissionTypeIds: [],
          startDate: fStartDate,
          note: fNote,
          grantedBy: currentUser?.id,
          operatorName: currentUser?.name,
        });
        if (canGrantPermissions) {
          await projectStaffService.replaceProjectStaffPermissionGrants(
            staffId,
            normalizeProjectGrantsForTarget(fUserId, fProjectGrants),
            currentUser?.id,
            currentUser?.name,
          );
        }
        toast.success('Đã thêm thành viên mới');
      }
      await load();
      resetForm();
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
    }
  };

  const handleDelete = async (s: ProjectStaff) => {
    if (!ensureCapability(canAssignStaff, 'project.org.assign_staff', 'xoá thành viên dự án')) return;
    const ok = await confirm({
      title: 'Xoá thành viên',
      targetName: `${s.userName} — ${s.positionName}`,
      warningText: 'Sẽ xoá tất cả quyền nghiệp vụ đã gán cho thành viên này tại dự án.',
    });
    if (!ok) return;
    try {
      await projectStaffService.remove(s.id, currentUser?.id, currentUser?.name);
      await load();
      toast.success('Đã xoá thành viên');
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
    }
  };

  const handleEndDate = async (s: ProjectStaff) => {
    if (!ensureCapability(canAssignStaff, 'project.org.assign_staff', 'kết thúc phân công')) return;
    const ok = await confirm({
      title: 'Kết thúc phân công',
      targetName: `${s.userName} — ${s.positionName}`,
      warningText: 'Đánh dấu thành viên này ngừng hoạt động tại vị trí hiện tại. Dữ liệu lịch sử vẫn được giữ.',
    });
    if (!ok) return;
    try {
      await projectStaffService.update(s.id, { endDate: new Date().toISOString().slice(0, 10) }, currentUser?.id, currentUser?.name);
      await load();
      toast.success('Đã cập nhật');
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Users size={18} className="text-white" />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-800 dark:text-white">Tổ chức Dự Án</h3>
            <p className="text-xs text-slate-400">{staff.length} thành viên • {groupedStaff.length} cấp bậc</p>
          </div>
        </div>
        {canAssignStaff && (
          <button onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black text-white bg-gradient-to-r from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:scale-[1.02] transition-all">
            <UserPlus size={14} /> Thêm thành viên
          </button>
        )}
      </div>

      {/* Staff Grid by Level */}
      {loading ? (
        <div className="p-12 text-center text-sm text-slate-400 font-bold">Đang tải...</div>
      ) : staff.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 p-12 text-center">
          <Users size={40} className="mx-auto mb-3 text-slate-200" />
          <p className="text-sm font-bold text-slate-400">Chưa phân bổ nhân sự</p>
          <p className="text-xs text-slate-300 mt-1">Bấm "Thêm thành viên" để bắt đầu xây dựng tổ chức dự án</p>
        </div>
      ) : (
        groupedStaff.map(([level, members]) => (
          <div key={level}>
            <div className="flex items-center gap-2 mb-3">
              <div className={`h-0.5 w-6 rounded-full bg-gradient-to-r ${LEVEL_COLORS[level] || LEVEL_COLORS[5]}`} />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Cấp {level} — {members[0]?.positionName?.split(' ').slice(-1)[0] || 'Khác'}
              </span>
              <div className={`h-0.5 flex-1 rounded-full bg-gradient-to-r ${LEVEL_COLORS[level] || LEVEL_COLORS[5]} opacity-10`} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {members.map(s => {
                const isEnded = !!s.endDate;
                return (
                  <div key={s.id}
                    className={`relative bg-white dark:bg-slate-800 rounded-2xl border shadow-sm overflow-hidden transition-all hover:shadow-lg group ${
                      isEnded ? 'opacity-50 border-slate-200' : `border-slate-100 dark:border-slate-700 ${LEVEL_BG[level] || ''}`
                    }`}>
                    {/* Header gradient bar */}
                    <div className={`h-1.5 bg-gradient-to-r ${LEVEL_COLORS[level] || LEVEL_COLORS[5]}`} />

                    <div className="p-4">
                      {/* User info */}
                      <div className="flex items-start gap-3">
                        <div className="relative flex-shrink-0">
                          {s.userAvatar ? (
                            <img src={s.userAvatar} alt={s.userName} className="w-12 h-12 rounded-2xl object-cover border-2 border-white shadow-sm" />
                          ) : (
                            <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${LEVEL_COLORS[level] || LEVEL_COLORS[5]} flex items-center justify-center text-white font-black text-sm shadow-sm`}>
                              {(s.userName || '?')[0]?.toUpperCase()}
                            </div>
                          )}
                          {!isEnded && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-black text-slate-800 dark:text-white truncate">{s.userName || 'Unknown'}</div>
                          <div className="text-[10px] font-bold text-slate-500 truncate">{s.positionName}</div>
                          {s.startDate && (
                            <div className="text-[9px] text-slate-400 flex items-center gap-1 mt-0.5">
                              <Calendar size={8} /> {new Date(s.startDate).toLocaleDateString('vi-VN')}
                              {isEnded && <span className="text-red-400"> → {new Date(s.endDate!).toLocaleDateString('vi-VN')}</span>}
                            </div>
                          )}
                        </div>
                        {/* Actions */}
                        {canEditMember && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(s)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors" title="Sửa">
                              <Edit2 size={12} />
                            </button>
                            {canAssignStaff && !isEnded && (
                              <button onClick={() => handleEndDate(s)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Kết thúc">
                                <XCircle size={12} />
                              </button>
                            )}
                            {canAssignStaff && (
                              <button onClick={() => handleDelete(s)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors" title="Xoá">
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Permission summary */}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className="rounded-lg border border-blue-100 bg-blue-50 px-2 py-1 text-[9px] font-black text-blue-700">
                          PBAC v2: mở ma trận để xem/sửa
                        </span>
                      </div>

                      {s.note && (
                        <div className="mt-2 text-[9px] text-slate-400 italic truncate">📝 {s.note}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Modal — Add/Edit Staff */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => resetForm()}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-5xl mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                  <UserPlus size={14} className="text-white" />
                </div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">
                  {editingStaff ? 'Sửa thành viên' : 'Thêm thành viên'}
                </h3>
              </div>
              <button onClick={resetForm} className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* User selection */}
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1.5">Nhân viên *</label>
                {editingStaff ? (
                  <div className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-600">
                    {editingStaff.userName} (không đổi được — xoá rồi thêm mới nếu cần)
                  </div>
                ) : (
                  <div className="border border-slate-100 dark:border-slate-700 rounded-2xl overflow-hidden p-1 bg-slate-50/50 dark:bg-slate-900/30">
                    <PremiumMemberSelect
                      options={memberOptions}
                      selectedIds={fUserId ? [fUserId] : []}
                      onChange={ids => {
                        if (ids.length > 0) {
                          setFUserId(ids[0]);
                        } else {
                          setFUserId('');
                        }
                      }}
                      isMulti={false}
                      placeholder="Tìm nhân viên để thêm..."
                      className="!shadow-none !border-none bg-transparent"
                    />
                  </div>
                )}
              </div>

              {/* Position */}
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1.5">Vị trí công việc *</label>
                <select value={fPositionId} onChange={e => setFPositionId(e.target.value)}
                  disabled={!canAssignStaff}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-700 dark:border-slate-600">
                  <option value="">— Chọn vị trí —</option>
                  {sortedPositions.map(p => (
                    <option key={p.id} value={p.id}>
                      {'·'.repeat(p.level || 0)} {p.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] font-medium text-slate-400">Lấy từ Dữ liệu gốc HRM &gt; Vị trí công việc.</p>
              </div>

              {/* Start Date + Note */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1.5">Ngày bắt đầu</label>
                  <input type="date" value={fStartDate} onChange={e => setFStartDate(e.target.value)}
                    disabled={!canAssignStaff}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-700 dark:border-slate-600" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1.5">Ghi chú</label>
                  <input value={fNote} onChange={e => setFNote(e.target.value)} placeholder="VD: Kiêm nhiệm"
                    disabled={!canAssignStaff}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-700 dark:border-slate-600" />
                </div>
              </div>

              {/* Project PBAC v2 matrix */}
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                  <Shield size={10} className="inline mr-1" />Ma trận quyền Project PBAC v2
                </label>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {PROJECT_PERMISSION_TEMPLATES.map(template => (
                    <button
                      key={template.key}
                      type="button"
                      onClick={() => applyTemplate(template.key)}
                      disabled={!canGrantPermissions}
                      className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-black ${
                        canGrantPermissions
                          ? 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700'
                          : 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300'
                      }`}
                    >
                      {template.label}
                    </button>
                  ))}
                </div>
                {visibleLegacyPermissionTypes.length > 0 && (
                  <div className="mb-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
                    <div className="mb-1 text-[10px] font-black uppercase text-amber-700">Legacy còn sót</div>
                    <div className="flex flex-wrap gap-1.5">
                      {visibleLegacyPermissionTypes.map(permissionType => (
                        <span key={permissionType.id} className="rounded bg-white px-2 py-1 text-[10px] font-bold text-amber-700 ring-1 ring-amber-100">
                          {permissionType.code}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {grantLoading ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-8 text-center text-xs font-bold text-slate-500">
                    Đang tải grant mới...
                  </div>
                ) : (
                  <PermissionMatrix
                    applicationCodes={['project']}
                    grants={fProjectGrants}
                    effectiveSources={inheritedProjectEffectiveSources}
                    targetUserId={fUserId || editingStaff?.userId || ''}
                    scope={projectGrantScope}
                    disabled={!canGrantPermissions}
                    onChange={setFProjectGrants}
                  />
                )}
                <div className="mt-3">
                  <PermissionDiffPreview before={initialProjectGrants} after={fProjectGrants} effectiveSources={inheritedProjectEffectiveSources} />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-2">
              <button onClick={resetForm}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 border border-slate-200">
                Huỷ
              </button>
              <button onClick={handleSave}
                className="px-5 py-2.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20 hover:shadow-xl transition-all">
                <Save size={12} className="inline mr-1" />{editingStaff ? 'Cập nhật' : 'Thêm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectOrgTab;
