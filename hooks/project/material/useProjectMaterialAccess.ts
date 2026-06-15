import { useEffect, useMemo, useState } from 'react';
import { Role, type User } from '../../../types';
import {
    PROJECT_MATERIAL_TAB_PERMISSIONS,
    type ProjectMaterialTabKey,
    type ProjectMaterialTabPermissionMap,
} from '../../../lib/projectTabPermissions';
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
            if (user.role === Role.ADMIN || canManageBoq) {
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
                    setCanEditProjectBoq(editPerm.allowed);
                    setCanDeleteProjectBoq(deletePerm.allowed);
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
    }, [canManageBoq, constructionSiteId, projectId, user.id, user.role]);

    useEffect(() => {
        let cancelled = false;
        const loadProjectRequestPermissions = async () => {
            if (user.role === Role.ADMIN || canManageRequest) {
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
                    setCanSubmitProjectRequest(submitPerm.allowed);
                    setCanApproveProjectRequest(approvePerm.allowed);
                    setCanViewAvailableStock(availableStockPerm.allowed);
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
    }, [canManageRequest, constructionSiteId, projectId, user.id, user.role]);

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
