import { useEffect, useMemo, useState } from 'react';
import { Role, type User } from '../../../types';
import {
    PROJECT_MATERIAL_TAB_PERMISSIONS,
    type ProjectMaterialTabKey,
    type ProjectMaterialTabPermissionMap,
} from '../../../lib/projectTabPermissions';
import {
    PROJECT_MATERIAL_ACTION_CODES,
    getProjectMaterialCapabilities,
    type ProjectMaterialCapability,
} from '../../../lib/permissions/projectMaterialPermissions';
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
    canSubmitMaterialRequest: boolean;
    canReturnMaterialRequest: boolean;
    canConfirmFulfillment: boolean;
    canEditPlanning: boolean;
    canCreatePo: boolean;
    canApprovePo: boolean;
    canReceivePo: boolean;
    canDeletePo: boolean;
    canManagePoPermission: boolean;
    canCreateCustomMaterial: boolean;
    canApproveCustomMaterial: boolean;
    canRecordWaste: boolean;
    canApproveWaste: boolean;
    materialCapabilities: ProjectMaterialCapability;
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
    const adminCapabilities = useMemo(
        () => getProjectMaterialCapabilities(new Set(), { isAdmin: user.role === Role.ADMIN }),
        [user.role],
    );
    const [boqPbacLoaded, setBoqPbacLoaded] = useState(false);
    const [materialCapabilities, setMaterialCapabilities] = useState<ProjectMaterialCapability>(adminCapabilities);

    useEffect(() => {
        let cancelled = false;
        const loadMaterialCapabilities = async () => {
            setBoqPbacLoaded(false);
            if (user.role === Role.ADMIN) {
                if (!cancelled) {
                    setMaterialCapabilities(adminCapabilities);
                    setBoqPbacLoaded(true);
                }
                return;
            }
            if (!user.id || (!projectId && !constructionSiteId)) {
                if (!cancelled) {
                    setMaterialCapabilities(getProjectMaterialCapabilities(new Set()));
                    setBoqPbacLoaded(true);
                }
                return;
            }

            try {
                const results = await Promise.all(
                    PROJECT_MATERIAL_ACTION_CODES.map(async permissionCode => ({
                        permissionCode,
                        allowed: (await projectStaffService.checkProjectAction({
                            userId: user.id,
                            projectId,
                            constructionSiteId,
                            permissionCode,
                        })).allowed,
                    })),
                );
                if (!cancelled) {
                    const grantedCodes = new Set(results.filter(result => result.allowed).map(result => result.permissionCode));
                    setMaterialCapabilities(getProjectMaterialCapabilities(grantedCodes));
                }
            } catch (error) {
                console.warn('Failed to check project material permissions', error);
                if (!cancelled) setMaterialCapabilities(getProjectMaterialCapabilities(new Set()));
            } finally {
                if (!cancelled) setBoqPbacLoaded(true);
            }
        };
        void loadMaterialCapabilities();
        return () => { cancelled = true; };
    }, [adminCapabilities, constructionSiteId, projectId, user.id, user.role]);

    const materialAccess = useMemo<ProjectMaterialTabPermissionMap>(() => {
        const hasScopedPermissions = Boolean(materialPermissions);
        const explicitViews: Partial<Record<ProjectMaterialTabKey, boolean>> = {
            summary: materialCapabilities.canViewMaterialSummary,
            boq: materialCapabilities.canViewBoq,
            planning: materialCapabilities.canViewPlanning,
            request: materialCapabilities.canViewMaterialRequest,
            custom: materialCapabilities.canViewCustomMaterial,
            po: materialCapabilities.canViewPo,
            waste: materialCapabilities.canViewWaste,
            dashboard: materialCapabilities.canViewMaterialSummary,
        };
        return PROJECT_MATERIAL_TAB_PERMISSIONS.reduce<ProjectMaterialTabPermissionMap>((acc, tab) => {
            const scoped = materialPermissions?.[tab.key];
            const canManage = canManageTab || Boolean(scoped?.canManage);
            acc[tab.key] = {
                canView: Boolean(explicitViews[tab.key as ProjectMaterialTabKey])
                    || canManage
                    || (hasScopedPermissions ? Boolean(scoped?.canView) : true),
                canManage,
            };
            return acc;
        }, {} as ProjectMaterialTabPermissionMap);
    }, [canManageTab, materialCapabilities, materialPermissions]);

    const canManageBoq = materialAccess.boq.canManage;
    const canManagePlanning = materialAccess.planning.canManage;
    const canManageRequest = materialAccess.request.canManage;
    const canManagePo = materialAccess.po.canManage;

    const visibleMaterialTabs = useMemo(
        () => PROJECT_MATERIAL_TAB_PERMISSIONS.filter(tab => materialAccess[tab.key as ProjectMaterialTabKey].canView),
        [materialAccess],
    );
    const canEditProjectBoq = materialCapabilities.canEditBoq;
    const canDeleteProjectBoq = materialCapabilities.canDeleteBoq;
    const canEditBoq = materialCapabilities.canEditBoq;
    const canDeleteBoq = materialCapabilities.canDeleteBoq;
    const canSubmitProjectRequest = materialCapabilities.canSubmitMaterialRequest;
    const canApproveProjectRequest = materialCapabilities.canApproveMaterialRequest;
    const canViewAvailableStock = materialCapabilities.canViewAvailableStock;
    const canCreateMaterialRequest = materialCapabilities.canCreateMaterialRequest;

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
        canSubmitMaterialRequest: materialCapabilities.canSubmitMaterialRequest,
        canReturnMaterialRequest: materialCapabilities.canReturnMaterialRequest,
        canConfirmFulfillment: materialCapabilities.canConfirmFulfillment,
        canEditPlanning: materialCapabilities.canEditPlanning,
        canCreatePo: materialCapabilities.canCreatePo,
        canApprovePo: materialCapabilities.canApprovePo,
        canReceivePo: materialCapabilities.canReceivePo,
        canDeletePo: materialCapabilities.canDeletePo,
        canManagePoPermission: materialCapabilities.canManagePo,
        canCreateCustomMaterial: materialCapabilities.canCreateCustomMaterial,
        canApproveCustomMaterial: materialCapabilities.canApproveCustomMaterial,
        canRecordWaste: materialCapabilities.canRecordWaste,
        canApproveWaste: materialCapabilities.canApproveWaste,
        materialCapabilities,
    };
};
