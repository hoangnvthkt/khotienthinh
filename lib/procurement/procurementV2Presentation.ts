import type { ProcurementDocumentRef } from '../../types/procurementWorkbench';
import type { ProcurementV2Source } from '../../types/procurementV2';
import { resolveProcurementDocument } from './documentAdapters';

export const dossierSourceLabel = (source: ProcurementV2Source): string =>
  source === 'material_plan' ? 'Kế hoạch vật tư' : 'Đề xuất vật tư';

export const resolveDossierSourceRoute = (source: { adapter: ProcurementV2Source;
  id: string | null; revision?: number | null; canOpen?: boolean }): string => {
  if (source.canOpen === false || !source.id?.trim()) throw new Error('PROCUREMENT_SOURCE_REF_INVALID');
  const id = encodeURIComponent(source.id);
  return source.adapter === 'material_plan'
    ? `/project-v2/plans/${id}${source.revision ? `?revision=${source.revision}` : ''}` : `/rq/${id}`;
};

export const resolveDossierDocumentRef = (ref: ProcurementDocumentRef, returnTo: string) =>
  resolveProcurementDocument(ref, returnTo);
