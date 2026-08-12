import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('../supabase', () => ({
  supabase: {
    rpc,
    storage: { from: vi.fn() },
  },
}));

import {
  fetchFleetVehicleCandidates,
  fetchFleetVehicleProfiles,
  fetchFleetVehicleTypeOptions,
  fetchVehicleDriverAuthorizationCandidates,
  fetchVehicleDriverAuthorizationsAdmin,
  setFleetVehicleAssetImage,
} from '../vehicleBookingService';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('vehicle booking fleet completion service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: [], error: null });
  });

  it('uses permission-scoped read RPCs for fleet and HRM candidates', async () => {
    await fetchFleetVehicleCandidates();
    await fetchFleetVehicleProfiles();
    await fetchFleetVehicleTypeOptions();
    await fetchVehicleDriverAuthorizationCandidates();
    await fetchVehicleDriverAuthorizationsAdmin();

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'get_fleet_vehicle_candidates',
      'get_fleet_vehicle_profiles_admin',
      'get_fleet_vehicle_type_options',
      'get_vehicle_driver_candidates',
      'get_vehicle_driver_authorizations_admin',
    ]);
  });

  it('updates the asset master image through the guarded fleet RPC', async () => {
    rpc.mockResolvedValueOnce({ data: { success: true }, error: null });

    await setFleetVehicleAssetImage('asset-1', 'https://example.test/vehicle.jpg');

    expect(rpc).toHaveBeenCalledWith('set_fleet_vehicle_asset_image', {
      p_asset_id: 'asset-1',
      p_image_url: 'https://example.test/vehicle.jpg',
    });
  });
});

describe('vehicle booking fleet completion UI contract', () => {
  it('adds image upload to the asset master form', () => {
    const assetCatalog = read('pages/ts/AssetCatalog.tsx');
    expect(assetCatalog).toContain('uploadAssetImage');
    expect(assetCatalog).toContain('imageUrl');
    expect(assetCatalog).toContain('Ảnh tài sản');
  });

  it('uses HRM identity and vehicle asset presentation in booking screens', () => {
    const createPage = read('pages/booking/VehicleBookingCreatePage.tsx');
    const dispatcher = read('pages/booking/DispatcherWorkbenchPage.tsx');
    const fleet = read('pages/booking/FleetManagementPage.tsx');

    expect(createPage).toContain('asset_image_url');
    expect(createPage).toContain('employee_avatar_url');
    expect(dispatcher).toContain('asset_image_url');
    expect(dispatcher).toContain('employee_avatar_url');
    expect(fleet).toContain('fetchFleetVehicleCandidates');
    expect(fleet).toContain('fetchVehicleDriverAuthorizationCandidates');
  });
});

describe('vehicle booking fleet completion migrations', () => {
  const migrationDir = join(process.cwd(), 'supabase/migrations');
  const migrationBySuffix = (suffix: string) => {
    const file = readdirSync(migrationDir).find(name => name.endsWith(`_${suffix}.sql`));
    return file ? readFileSync(join(migrationDir, file), 'utf8') : '';
  };

  it('creates a constrained public asset image bucket with guarded writes', () => {
    const sql = migrationBySuffix('asset_vehicle_images');
    expect(sql).toContain("'asset-images'");
    expect(sql).toContain('5242880');
    expect(sql).toContain("'image/jpeg'");
    expect(sql).toContain('booking.vehicle.manage_fleet');
    expect(sql).toMatch(/for insert\s+to authenticated/i);
    expect(sql).toMatch(/for delete\s+to authenticated/i);
  });

  it('adds private implementations and invoker wrappers without changing command RPCs', () => {
    const sql = migrationBySuffix('vehicle_booking_fleet_management_completion');
    for (const name of [
      'get_fleet_vehicle_candidates',
      'get_fleet_vehicle_profiles_admin',
      'get_vehicle_driver_candidates',
      'get_vehicle_driver_authorizations_admin',
      'set_fleet_vehicle_asset_image',
    ]) expect(sql).toContain(name);
    expect(sql).toContain('app_private');
    expect(sql).toMatch(/security invoker/i);
    expect(sql).not.toMatch(/public\.[\s\S]{0,120}security definer/i);
    expect(sql).toContain("category.type = 'vehicle'");
    expect(sql).toContain("employee.status = 'Đang làm việc'");
    expect(sql).toContain('asset.code');
    expect(sql).toContain('asset.name');
  });

  it('publishes a permission-scoped canonical fleet vehicle-type catalog', () => {
    const sql = migrationBySuffix('vehicle_booking_driver_vehicle_compatibility');
    expect(sql).toContain('get_fleet_vehicle_type_options');
    expect(sql).toContain('booking.vehicle.manage_authorizations');
    expect(sql).toContain('booking.vehicle.dispatch');
    expect(sql).toMatch(/security invoker/i);
    expect(sql).toContain('DRIVER_VEHICLE_TYPE_MISMATCH');
  });
});
