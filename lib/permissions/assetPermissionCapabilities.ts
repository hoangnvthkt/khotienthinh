import type { User } from '../../types';
import { canViewRoute } from './permissionService';
import type { AssetPermissionTarget } from './assetPermissionScope';
import { hasAssetAction } from './assetPermissionScope';

export const getAssetCatalogRouteCapabilities = (user: User | null | undefined) => ({
  canViewCatalog: canViewRoute(user, '/ts/catalog'),
  canViewDashboard: canViewRoute(user, '/ts/dashboard'),
});

export const getAssetCatalogRecordCapabilities = (
  user: User | null | undefined,
  target?: AssetPermissionTarget,
) => ({
  canCreate: hasAssetAction(user, 'asset.catalog.create', target),
  canEdit: hasAssetAction(user, 'asset.catalog.edit', target),
  canDelete: hasAssetAction(user, 'asset.catalog.delete', target),
  canDispose: hasAssetAction(user, 'asset.catalog.dispose', target),
  canImport: hasAssetAction(user, 'asset.catalog.import', target),
});

export const getAssetCategoryCapabilities = (
  user: User | null | undefined,
  target?: AssetPermissionTarget,
) => ({
  canCreateCategory: hasAssetAction(user, 'asset.catalog.edit', target),
  canEditCategory: hasAssetAction(user, 'asset.catalog.edit', target),
  canDeleteCategory: hasAssetAction(user, 'asset.catalog.edit', target),
});

export const getAssetTransferCapabilities = (
  user: User | null | undefined,
  input: { source: AssetPermissionTarget; destination: AssetPermissionTarget },
) => ({
  canTransferStock: hasAssetAction(user, 'asset.catalog.transfer_stock', input.source)
    && hasAssetAction(user, 'asset.catalog.transfer_stock', input.destination),
});

export const getAssetAssignmentCapabilities = (
  user: User | null | undefined,
  target?: AssetPermissionTarget,
) => ({
  canAssign: hasAssetAction(user, 'asset.assignment.assign', target),
  canReturn: hasAssetAction(user, 'asset.assignment.return', target),
  canTransfer: hasAssetAction(user, 'asset.assignment.transfer', target),
});

export const getAssetMaintenanceCapabilities = (
  user: User | null | undefined,
  target?: AssetPermissionTarget,
) => ({
  canCreate: hasAssetAction(user, 'asset.maintenance.create', target),
  canComplete: hasAssetAction(user, 'asset.maintenance.complete', target),
  canImport: hasAssetAction(user, 'asset.maintenance.import', target),
});

export const getAssetAuditCapabilities = (
  user: User | null | undefined,
  target?: AssetPermissionTarget,
) => ({
  canPerformAudit: hasAssetAction(user, 'asset.audit.perform', target),
  canExportAudit: hasAssetAction(user, 'asset.audit.export', target),
});
