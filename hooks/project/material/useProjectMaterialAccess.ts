import { useEffect, useMemo, useState } from 'react';
import { Role, type User } from '../../../types';
import {
    PROJECT_MATERIAL_TAB_PERMISSIONS,
    type ProjectMaterialTabKey,
    type ProjectMaterialTabPermissionMap,
} from '../../../lib/projectTabPermissions';
import { canPerformProjectAction } from '../../../lib/permissions/projectPermissionService';
import { projectStaffService } from '../../../lib/projectStaffService';

export interface ProjectMaterialAccessState {
    materialAccess: ProjectMaterialTabPermissionMap;
    visibleMaterialTabs: Array<(typeof PROJECT_MATERIAL_TAB_PERMISSIONS)[number]>;
    canManageBoq: boolean;
    canManagePlanning: boolean;
    canManageRequest: boolean;
    canManagePo: boolean;
    boqPbacLoaded: boolean;
    canEditProjectBoq: boolean;
    canDeleteProjectBoq: boolean;
    canEditBoq: boolean;
    canDeleteBoq: boolean;
    canSubmitProjectRequest: boolean;
    canApproveProjectRequest: boolean;
    canViewAvailableStock: boolean;
    canCreateMaterialRequest: boolean;
}

type UseProjectMaterialAccessOptions = {
    materialPermissions?: ProjectMaterialTabPermissionMap;
    canManageTab: boolean;
    projectId?: string;
    constructionSiteId?: string;
    user: User;
};

export const useProjectMaterialAccess = ({
    materialPermissions,
    canManageTab,
    projectId,
    constructionSiteId,
    user,
}: UseProjectMaterialAccessOptions): ProjectMaterialAccessState => {
    const projectScope = useMemo(
        () => ({ projectId, constructionSiteId }),
        [constructionSiteId, projectId],
    );
    const materialAccess = useMemo<ProjectMaterialTabPermissionMap>(() => {
        const hasScopedPermissions = Boolean(materialPermissions);
        return PROJECT_MATERIAL_TAB_PERMISSIONS.reduce<ProjectMaterialTabPermissionMap>((acc, tab) => {
            const scoped = materialPermissions?.[tab.key];
            const canManage = canManageTab || Boolean(scoped?.canManage);
            acc[tab.key] = {
                canView: canManage || (hasScopedPermissions ? Boolean(scoped?.canView) : true),
                canManage,
            };
            return acc;
        }, {} as ProjectMaterialTabPermissionMap);
    }, [canManageTab, materialPermissions]);

    const canManageBoq = materialAccess.boq.canManage;
    const canManagePlanning = materialAccess.planning.canManage;
    const canManageRequest = materialAccess.request.canManage;
    const canManagePo = materialAccess.po.canManage;
    const [boqPbacLoaded, setBoqPbacLoaded] = useState(false);
    const [canEditProjectBoq, setCanEditProjectBoq] = useState(false);
    const [canDeleteProjectBoq, setCanDeleteProjectBoq] = useState(false);
    const [canSubmitProjectRequest, setCanSubmitProjectRequest] = useState(false);
    const [canApproveProjectRequest, setCanApproveProjectRequest] = useState(false);
    const [canViewAvailableStock, setCanViewAvailableStock] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const loadBoqPermissions = async () => {
            setBoqPbacLoaded(false);
            const canEditByGrant = canPerformProjectAction(user, 'project.material_boq.edit', projectScope);
            const canDeleteByGrant = canPerformProjectAction(user, 'project.material_boq.delete', projectScope);
            if (user.role === Role.ADMIN || canManageBoq || (canEditByGrant && canDeleteByGrant)) {
                if (!cancelled) {
                    setCanEditProjectBoq(true);
                    setCanDeleteProjectBoq(true);
                    setBoqPbacLoaded(true);
                }
                return;
            }
            if (!user.id || (!projectId && !constructionSiteId)) {
                if (!cancelled) {
                    setCanEditProjectBoq(false);
                    setCanDeleteProjectBoq(false);
                    setBoqPbacLoaded(true);
                }
                return;
            }

            try {
                const [editPerm, deletePerm] = await Promise.all([
                    projectId
                        ? projectStaffService.checkProjectPermission(user.id, projectId, 'edit', constructionSiteId || undefined)
                        : constructionSiteId
                            ? projectStaffService.checkPermission(user.id, constructionSiteId, 'edit')
                            : Promise.resolve({ allowed: false }),
                    projectId
                        ? projectStaffService.checkProjectPermission(user.id, projectId, 'delete', constructionSiteId || undefined)
                        : constructionSiteId
                            ? projectStaffService.checkPermission(user.id, constructionSiteId, 'delete')
                            : Promise.resolve({ allowed: false }),
                ]);
                if (!cancelled) {
                    setCanEditProjectBoq(canEditByGrant || editPerm.allowed);
                    setCanDeleteProjectBoq(canDeleteByGrant || deletePerm.allowed);
                }
            } catch (error) {
                console.warn('Failed to check project BOQ permissions', error);
                if (!cancelled) {
                    setCanEditProjectBoq(false);
                    setCanDeleteProjectBoq(false);
                }
            } finally {
                if (!cancelled) setBoqPbacLoaded(true);
            }
        };
        void loadBoqPermissions();
        return () => { cancelled = true; };
    }, [canManageBoq, constructionSiteId, projectId, projectScope, user]);

    useEffect(() => {
        let cancelled = false;
        const loadProjectRequestPermissions = async () => {
            const canSubmitByGrant = canPerformProjectAction(user, 'project.material_request.submit', projectScope);
            const canApproveByGrant = canPerformProjectAction(user, 'project.material_request.approve', projectScope);
            const canViewStockByGrant = canPerformProjectAction(user, 'project.material_request.view_available_stock', projectScope);
            if (user.role === Role.ADMIN || canManageRequest || (canSubmitByGrant && canApproveByGrant && canViewStockByGrant)) {
                if (!cancelled) {
                    setCanSubmitProjectRequest(true);
                    setCanApproveProjectRequest(true);
                    setCanViewAvailableStock(true);
                }
                return;
            }
            if (!user.id || (!projectId && !constructionSiteId)) {
                if (!cancelled) {
                    setCanSubmitProjectRequest(false);
                    setCanApproveProjectRequest(false);
                    setCanViewAvailableStock(false);
                }
                return;
            }
            try {
                const checkPermission = (code: string) => projectId
                    ? projectStaffService.checkProjectPermission(user.id, projectId, code, constructionSiteId || undefined)
                    : constructionSiteId
                        ? projectStaffService.checkPermission(user.id, constructionSiteId, code)
                        : Promise.resolve({ allowed: false });
                const [submitPerm, approvePerm, availableStockPerm] = await Promise.all([
                    checkPermission('submit'),
                    checkPermission('approve'),
                    checkPermission('view_available_stock'),
                ]);
                if (!cancelled) {
                    setCanSubmitProjectRequest(canSubmitByGrant || submitPerm.allowed);
                    setCanApproveProjectRequest(canApproveByGrant || approvePerm.allowed);
                    setCanViewAvailableStock(canViewStockByGrant || availableStockPerm.allowed);
                }
            } catch (error) {
                console.warn('Failed to check project material request permissions', error);
                if (!cancelled) {
                    setCanSubmitProjectRequest(false);
                    setCanApproveProjectRequest(false);
                    setCanViewAvailableStock(false);
                }
            }
        };
        void loadProjectRequestPermissions();
        return () => { cancelled = true; };
    }, [canManageRequest, constructionSiteId, projectId, projectScope, user]);

    const visibleMaterialTabs = useMemo(
        () => PROJECT_MATERIAL_TAB_PERMISSIONS.filter(tab => materialAccess[tab.key as ProjectMaterialTabKey].canView),
        [materialAccess],
    );
    const canEditBoq = canManageBoq || canEditProjectBoq;
    const canDeleteBoq = canManageBoq || canDeleteProjectBoq;
    const canCreateMaterialRequest = canManageRequest || canSubmitProjectRequest || user.role === Role.ADMIN;

    return {
        materialAccess,
        visibleMaterialTabs,
        canManageBoq,
        canManagePlanning,
        canManageRequest,
        canManagePo,
        boqPbacLoaded,
        canEditProjectBoq,
        canDeleteProjectBoq,
        canEditBoq,
        canDeleteBoq,
        canSubmitProjectRequest,
        canApproveProjectRequest,
        canViewAvailableStock,
        canCreateMaterialRequest,
    };
};
