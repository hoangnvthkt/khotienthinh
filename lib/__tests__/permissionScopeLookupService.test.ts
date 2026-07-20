import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapPermissionScopeLookupRows } from '../permissions/permissionScopeLookupService';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('permission scope lookup service', () => {
  it('maps project, warehouse, construction site, and department rows to searchable labels', () => {
    const options = mapPermissionScopeLookupRows({
      projects: [
        { id: 'project-1', code: 'PRJ-A', name: 'Dự án Alpha', clientName: 'Chủ đầu tư A' },
      ],
      warehouses: [
        { id: 'warehouse-1', code: 'KHO-A', name: 'Kho trung tâm', type: 'main' },
      ],
      constructionSites: [
        { id: 'site-1', code: 'CT-A', name: 'Công trình A' },
      ],
      departments: [
        { id: 'dept-1', code: 'KT', name: 'Phòng Kế toán', type: 'department' },
        { id: 'company-1', code: 'CTY', name: 'Công ty', type: 'company' },
      ],
    });

    expect(options.project).toEqual([
      {
        id: 'project-1',
        label: 'PRJ-A · Dự án Alpha',
        subtitle: 'Chủ đầu tư A',
        searchText: 'project-1 PRJ-A Dự án Alpha Chủ đầu tư A',
      },
    ]);
    expect(options.warehouse?.[0]).toMatchObject({
      id: 'warehouse-1',
      label: 'KHO-A · Kho trung tâm',
      subtitle: 'main',
    });
    expect(options.construction_site?.[0]).toMatchObject({
      id: 'site-1',
      label: 'CT-A · Công trình A',
    });
    expect(options.department).toHaveLength(1);
    expect(options.department?.[0]).toMatchObject({
      id: 'dept-1',
      label: 'KT · Phòng Kế toán',
    });
  });

  it('keeps lookup reads mutation-free', () => {
    const source = read('lib/permissions/permissionScopeLookupService.ts');

    expect(source).toContain('supabase.from');
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
  });
});
