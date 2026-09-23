import { describe, expect, it } from 'vitest';
import { dossierSourceLabel, resolveDossierSourceRoute, resolveDossierDocumentRef } from '../procurement/procurementV2Presentation';

describe('Procurement V2 dossier presentation', () => {
  it('uses business labels and exact source routes', () => {
    expect(dossierSourceLabel('material_plan')).toBe('Kế hoạch vật tư');
    expect(dossierSourceLabel('project_material_request')).toBe('Đề xuất vật tư');
    expect(resolveDossierSourceRoute({ adapter: 'material_plan', id: 'plan-1' }))
      .toBe('/project-v2/plans/plan-1');
    expect(resolveDossierSourceRoute({ adapter: 'project_material_request', id: 'mr-1' }))
      .toBe('/rq/mr-1');
  });

  it('validates return route through the existing trace adapter', () => {
    expect(() => resolveDossierDocumentRef({ type: 'purchase_order', id: 'po-1', engine: 'purchase_order' }, '//evil'))
      .toThrow('INVALID_RETURN_ROUTE');
  });
});
