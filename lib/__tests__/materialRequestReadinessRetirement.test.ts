import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPermissionActionByCode } from '../permissions/permissionRegistry';
import { resolvePermissionActionReadiness } from '../permissions/permissionReadiness';

const permissions = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/permissions/projectMaterialPermissions.ts'),
  'utf8',
);
const materialTab = fs.readFileSync(
  path.resolve(process.cwd(), 'pages/project/MaterialTab.tsx'),
  'utf8',
);

const action = (permissionCode: string) => {
  const found = getPermissionActionByCode(permissionCode);
  if (!found) throw new Error('Missing fixture ' + permissionCode);
  return found;
};

describe('Material Request readiness retirement', () => {
  it('keeps fulfilment confirmation on its dedicated permission', () => {
    expect(permissions).toContain("'project.material_request.confirm_fulfillment'");
    expect(permissions).not.toContain("'project.material_request.confirm',");
    expect(permissions).not.toContain("'project.material_request.verify',");
    expect(materialTab).toMatch(
      /MATERIAL_REQUEST_CONFIRM_PERMISSION\s*=\s*'project\.material_request\.confirm_fulfillment'/,
    );
  });

  it('keeps retired actions out of the frontend verified set', () => {
    for (const permissionCode of [
      'project.material_request.confirm',
      'project.material_request.verify',
    ]) {
      expect(resolvePermissionActionReadiness(action(permissionCode))).toBe('declared');
    }
  });
});
