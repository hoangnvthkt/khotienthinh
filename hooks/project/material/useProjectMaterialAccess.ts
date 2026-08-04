import { useEffect, useMemo, useState } from 'react';
import { Role, type User } from '../../../types';
import {
    PROJECT_MATERIAL_TAB_PERMISSIONS,
    type ProjectMaterialTabKey,
    type ProjectMaterialTabPermissionMap,
} from '../../../lib/projectTabPermissions';
import {
    PROJECT_MATERIAL_ACTION_CODES,
    getProjectMaterialActionCodesForRoomAction,
    getProjectMaterialCapabilities,
    type ProjectMaterialActionCode,
    type ProjectMaterialCapability,
} from '../../../lib/permissions/projectMaterialPermissions';
import { projectPermissionRoomService } from '../../../lib/projectPermissionRoomService';
import { projectStaffService } from '../../../lib/projectStaffService';
import { getMaterialPoEffectiveCapabilities } from '../../../lib/permissions/projectRoomEffectiveActions';

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
    canViewPo: boolean;
    canEditPo: boolean;
    canSubmitPo: boolean;
    canApprovePo: boolean;
    canConfirmPo: boolean;
    canDeletePo: boolean;
    canViewDirectPurchase: boolean;
    canCreateDirectPurchase: boolean;
    canEditDirectPurchase: boolean;
    canDeleteDirectPurchase: boolean;
    canRecordDirectPurchaseAp: boolean;
    canViewSupplierDelivery: boolean;
    canCreateSupplierDelivery: boolean;
    canEditSupplierDelivery: boolean;
    canDeleteSupplierDelivery: boolean;
    canRecordSupplierDelivery: boolean;
    canUnrecordSupplierDelivery: boolean;
    canReconcileSupplierDelivery: boolean;
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

const BOQ_PBAC_ACTION_CODES = new Set<ProjectMaterialActionCode>([
    'project.material_boq.view',
    'project.material_boq.edit',
    'project.material_boq.delete',
]);

const PO_PBAC_ACTION_CODES = new Set<ProjectMaterialActionCode>([
    'project.material_po.view',
    'project.material_po.create',
    'project.material_po.approve',
    'project.material_po.receive',
    'project.material_po.delete',
    'project.material_po.manage',
]);

const NON_BOQ_PBAC_ACTION_CODES = PROJECT_MATERIAL_ACTION_CODES.filter(
    permissionCode => !BOQ_PBAC_ACTION_CODES.has(permissionCode) && !PO_PBAC_ACTION_CODES.has(permissionCode),
);

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
                const [results, roomActions] = await Promise.all([
                    Promise.all(NON_BOQ_PBAC_ACTION_CODES.map(async permissionCode => ({
                        permissionCode,
                        allowed: (await projectStaffService.checkProjectAction({
                            userId: user.id,
                            projectId,
                            constructionSiteId,
                            permissionCode,
                        })).allowed,
                    }))),
                    projectPermissionRoomService.listMyActions(
                        projectId || constructionSiteId || '',
                        constructionSiteId || null,
                    ),
                ]);
                if (!cancelled) {
                    const grantedCodes = new Set(results.filter(result => result.allowed).map(result => result.permissionCode));
                    roomActions
                        .filter(action => action.roomCode === 'material_planning')
                        .flatMap(action => getProjectMaterialActionCodesForRoomAction(
                            'material_planning', action.actionCode,
                        ))
                        .forEach(permissionCode => grantedCodes.add(permissionCode));
                    setMaterialCapabilities({
                        ...getProjectMaterialCapabilities(grantedCodes),
                        ...getMaterialPoEffectiveCapabilities(roomActions),
                    });
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
            po: materialCapabilities.canViewPo
                || materialCapabilities.canViewDirectPurchase
                || materialCapabilities.canCreateDirectPurchase
                || materialCapabilities.canEditDirectPurchase
                || materialCapabilities.canDeleteDirectPurchase
                || materialCapabilities.canRecordDirectPurchaseAp
                || materialCapabilities.canViewSupplierDelivery
                || materialCapabilities.canCreateSupplierDelivery
                || materialCapabilities.canEditSupplierDelivery
                || materialCapabilities.canDeleteSupplierDelivery
                || materialCapabilities.canRecordSupplierDelivery
                || materialCapabilities.canUnrecordSupplierDelivery
                || materialCapabilities.canReconcileSupplierDelivery,
            waste: materialCapabilities.canViewWaste,
            dashboard: materialCapabilities.canViewMaterialSummary,
        };
        return PROJECT_MATERIAL_TAB_PERMISSIONS.reduce<ProjectMaterialTabPermissionMap>((acc, tab) => {
            const scoped = materialPermissions?.[tab.key];
            const canManage = canManageTab || Boolean(scoped?.canManage);
            acc[tab.key] = {
                canView: tab.key === 'po'
                    ? Boolean(explicitViews.po)
                        || canManage
                        || (hasScopedPermissions ? Boolean(scoped?.canView) : false)
                    : Boolean(explicitViews[tab.key as ProjectMaterialTabKey])
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
        canViewPo: materialCapabilities.canViewPo,
        canEditPo: materialCapabilities.canEditPo,
        canSubmitPo: materialCapabilities.canSubmitPo,
        canApprovePo: materialCapabilities.canApprovePo,
        canConfirmPo: materialCapabilities.canConfirmPo,
        canDeletePo: materialCapabilities.canDeletePo,
        canViewDirectPurchase: materialCapabilities.canViewDirectPurchase,
        canCreateDirectPurchase: materialCapabilities.canCreateDirectPurchase,
        canEditDirectPurchase: materialCapabilities.canEditDirectPurchase,
        canDeleteDirectPurchase: materialCapabilities.canDeleteDirectPurchase,
        canRecordDirectPurchaseAp: materialCapabilities.canRecordDirectPurchaseAp,
        canViewSupplierDelivery: materialCapabilities.canViewSupplierDelivery,
        canCreateSupplierDelivery: materialCapabilities.canCreateSupplierDelivery,
        canEditSupplierDelivery: materialCapabilities.canEditSupplierDelivery,
        canDeleteSupplierDelivery: materialCapabilities.canDeleteSupplierDelivery,
        canRecordSupplierDelivery: materialCapabilities.canRecordSupplierDelivery,
        canUnrecordSupplierDelivery: materialCapabilities.canUnrecordSupplierDelivery,
        canReconcileSupplierDelivery: materialCapabilities.canReconcileSupplierDelivery,
        canCreateCustomMaterial: materialCapabilities.canCreateCustomMaterial,
        canApproveCustomMaterial: materialCapabilities.canApproveCustomMaterial,
        canRecordWaste: materialCapabilities.canRecordWaste,
        canApproveWaste: materialCapabilities.canApproveWaste,
        materialCapabilities,
    };
};
