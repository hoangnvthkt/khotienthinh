import type { User } from '../../types';
import {
  getAssetAssignmentCapabilities,
  getAssetAuditCapabilities,
  getAssetCatalogRecordCapabilities,
  getAssetMaintenanceCapabilities,
  getAssetTransferCapabilities,
} from './assetPermissionCapabilities';
import type { AssetPermissionTarget } from './assetPermissionScope';

export interface AssetActionPolicy {
  allowed: boolean;
  reason?: string;
}

type CatalogOperation = 'create' | 'edit' | 'delete' | 'dispose' | 'import' | 'transfer_stock';
type AssignmentOperation = 'assign' | 'return' | 'transfer';
type MaintenanceOperation = 'create' | 'complete' | 'import';
type AuditOperation = 'perform' | 'export';

const allow = (): AssetActionPolicy => ({ allowed: true });
const deny = (reason: string): AssetActionPolicy => ({ allowed: false, reason });

export const buildAssetCatalogActionPolicy = (
  user: User | null | undefined,
  operation: CatalogOperation,
  target: AssetPermissionTarget | { source: AssetPermissionTarget; destination: AssetPermissionTarget },
): AssetActionPolicy => {
  if (operation === 'transfer_stock') {
    const transferTarget = target as { source: AssetPermissionTarget; destination: AssetPermissionTarget };
    return getAssetTransferCapabilities(user, transferTarget).canTransferStock
      ? allow()
      : deny('Bạn chưa được cấp quyền điều chuyển tồn tài sản trong phạm vi nguồn và đích.');
  }

  const capabilities = getAssetCatalogRecordCapabilities(user, target as AssetPermissionTarget);
  const allowed = {
    create: capabilities.canCreate,
    edit: capabilities.canEdit,
    delete: capabilities.canDelete,
    dispose: capabilities.canDispose,
    import: capabilities.canImport,
  }[operation];

  return allowed ? allow() : deny(`Bạn chưa được cấp quyền ${{
    create: 'tạo tài sản',
    edit: 'sửa tài sản',
    delete: 'xóa tài sản',
    dispose: 'xuất hủy tài sản',
    import: 'import tài sản',
  }[operation]} trong phạm vi này.`);
};

export const buildAssetAssignmentActionPolicy = (
  user: User | null | undefined,
  operation: AssignmentOperation,
  target: AssetPermissionTarget,
): AssetActionPolicy => {
  const capabilities = getAssetAssignmentCapabilities(user, target);
  const allowed = {
    assign: capabilities.canAssign,
    return: capabilities.canReturn,
    transfer: capabilities.canTransfer,
  }[operation];

  return allowed ? allow() : deny(`Bạn chưa được cấp quyền ${{
    assign: 'cấp phát tài sản',
    return: 'thu hồi tài sản',
    transfer: 'luân chuyển tài sản',
  }[operation]} trong phạm vi này.`);
};

export const buildAssetMaintenanceActionPolicy = (
  user: User | null | undefined,
  operation: MaintenanceOperation,
  target: AssetPermissionTarget,
): AssetActionPolicy => {
  const capabilities = getAssetMaintenanceCapabilities(user, target);
  const allowed = {
    create: capabilities.canCreate,
    complete: capabilities.canComplete,
    import: capabilities.canImport,
  }[operation];

  return allowed ? allow() : deny(`Bạn chưa được cấp quyền ${{
    create: 'tạo phiếu bảo trì',
    complete: 'hoàn tất bảo trì',
    import: 'import bảo trì',
  }[operation]} trong phạm vi này.`);
};

export const buildAssetAuditActionPolicy = (
  user: User | null | undefined,
  operation: AuditOperation,
  target: AssetPermissionTarget,
): AssetActionPolicy => {
  const capabilities = getAssetAuditCapabilities(user, target);
  const allowed = {
    perform: capabilities.canPerformAudit,
    export: capabilities.canExportAudit,
  }[operation];

  return allowed ? allow() : deny(`Bạn chưa được cấp quyền ${{
    perform: 'thực hiện kiểm kê',
    export: 'xuất Excel kiểm kê',
  }[operation]} trong phạm vi này.`);
};
