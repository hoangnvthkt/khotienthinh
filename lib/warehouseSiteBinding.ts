import type { HrmConstructionSite, Warehouse } from '../types';

type SupplierDeliveryWarehousePolicyInput = {
  warehouses: Warehouse[];
  constructionSiteId?: string | null;
  warehouseBindingEnforced: boolean;
  currentWarehouseId?: string | null;
};

export type SupplierDeliveryWarehousePolicy = {
  options: Warehouse[];
  selectedWarehouseId: string | null;
  readOnly: boolean;
  blocked: boolean;
  historicalException: boolean;
};

const isActiveWarehouse = (warehouse: Warehouse) => !warehouse.isArchived;

const normalizeName = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('vi-VN')
  .replace(/\b(kho|cong truong)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export const mapWarehouseSiteBindingFromDb = (warehouse: any): Warehouse => ({
  ...warehouse,
  constructionSiteId: warehouse.construction_site_id ?? warehouse.constructionSiteId ?? null,
  isDefaultForSite: warehouse.is_default_for_site ?? warehouse.isDefaultForSite ?? false,
  isArchived: warehouse.is_archived ?? warehouse.isArchived ?? false,
});

export const toWarehouseSiteBindingDb = (warehouse: Warehouse) => ({
  construction_site_id: warehouse.constructionSiteId || null,
  is_default_for_site: warehouse.isDefaultForSite ?? false,
});

export const mapConstructionSiteWarehouseBindingFromDb = (site: any): HrmConstructionSite => ({
  id: site.id,
  name: site.name,
  address: site.address ?? undefined,
  description: site.description ?? undefined,
  latitude: site.latitude == null ? undefined : Number(site.latitude),
  longitude: site.longitude == null ? undefined : Number(site.longitude),
  checkInRadius: site.check_in_radius ?? site.checkInRadius ?? undefined,
  managerId: site.manager_id ?? site.managerId ?? undefined,
  warehouseBindingEnforced: site.warehouse_binding_enforced ?? site.warehouseBindingEnforced ?? false,
  createdAt: site.created_at ?? site.createdAt ?? undefined,
});

export const buildSupplierDeliveryWarehousePolicy = ({
  warehouses,
  constructionSiteId,
  warehouseBindingEnforced,
  currentWarehouseId,
}: SupplierDeliveryWarehousePolicyInput): SupplierDeliveryWarehousePolicy => {
  const activeWarehouses = warehouses.filter(isActiveWarehouse);
  const options = warehouseBindingEnforced
    ? activeWarehouses.filter(warehouse => (
      warehouse.type === 'SITE'
      && warehouse.constructionSiteId === constructionSiteId
    ))
    : activeWarehouses;
  const currentWarehouse = currentWarehouseId
    ? warehouses.find(warehouse => warehouse.id === currentWarehouseId) || null
    : null;
  const currentIsValid = Boolean(currentWarehouse && options.some(warehouse => warehouse.id === currentWarehouse.id));
  const historicalException = Boolean(warehouseBindingEnforced && currentWarehouse && !currentIsValid);
  const defaultWarehouse = options.find(warehouse => warehouse.isDefaultForSite) || null;

  return {
    options,
    selectedWarehouseId: currentIsValid || historicalException
      ? currentWarehouseId || null
      : defaultWarehouse?.id || (options.length === 1 ? options[0].id : null),
    readOnly: warehouseBindingEnforced && options.length === 1 && !historicalException,
    blocked: warehouseBindingEnforced && options.length === 0,
    historicalException,
  };
};

export const getWarehouseBindingLabel = (
  warehouse: Warehouse,
  constructionSites: HrmConstructionSite[],
): 'Chưa liên kết' | 'Đã liên kết' | 'Đã khóa' => {
  if (!warehouse.constructionSiteId) return 'Chưa liên kết';
  const site = constructionSites.find(candidate => candidate.id === warehouse.constructionSiteId);
  return site?.warehouseBindingEnforced ? 'Đã khóa' : 'Đã liên kết';
};

export const suggestConstructionSiteForWarehouse = (
  warehouse: Warehouse,
  constructionSites: HrmConstructionSite[],
): HrmConstructionSite | null => {
  if (warehouse.constructionSiteId || warehouse.type !== 'SITE') return null;
  const warehouseName = normalizeName(warehouse.name);
  if (!warehouseName) return null;
  return constructionSites.find(site => normalizeName(site.name) === warehouseName) || null;
};
