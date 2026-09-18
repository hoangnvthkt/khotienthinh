import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import PermissionModuleEditor from '../../components/permissions/PermissionModuleEditor';
import type { PermissionAdminCatalog } from '../../lib/permissions/permissionTypes';
import type { UserPermissionGrant } from '../../types';

const catalog: PermissionAdminCatalog = { generatedAt: '2026-09-14T00:00:00Z', applications: [{
  code: 'asset', label: 'Tài sản', sortOrder: 1, hasDefaultViewBundle: true,
  modules: [{ code: 'asset.catalog', label: 'Danh mục', sortOrder: 1, actions: [{
    action: 'view', label: 'Xem', permissionCode: 'asset.catalog.view',
    scopeTypes: ['global', 'warehouse'], sortOrder: 1, riskLevel: 'normal', grantReadiness: 'enforced',
    directGrantAllowed: true, directGrantRequiresExpiry: false, isDefaultView: true, defaultScopeType: 'global',
  }] }],
}] };
const initial: UserPermissionGrant[] = [
  { id: 'global', userId: 'fixture', permissionCode: 'asset.catalog.view', scopeType: 'global', scopeId: '*', isActive: true },
  ...['A', 'B'].map(id => ({ id, userId: 'fixture', permissionCode: 'asset.catalog.view', scopeType: 'warehouse' as const, scopeId: id, isActive: true })),
];
const Fixture = () => {
  const [grants, setGrants] = useState(initial);
  return <>
    <PermissionModuleEditor catalog={catalog} grants={grants} targetUserId="fixture" onChange={setGrants}
      initialExpandedApplicationCodes={['asset']}
      inheritedSources={[{ permissionCode: 'asset.catalog.view', sourceType: 'ROLE', sourceCode: 'Warehouse-C-role',
        scopeType: 'warehouse', scopeId: 'C', isBusinessApproval: false, metadata: {} }]}
    />
    <button onClick={() => setGrants([...initial])}>Simulate reload</button>
    <output aria-label="Stored draft">{JSON.stringify(grants.map(g => g.id))}</output>
  </>;
};
createRoot(document.getElementById('root')!).render(<Fixture />);
