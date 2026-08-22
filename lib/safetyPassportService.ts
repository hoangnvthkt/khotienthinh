import type {
  SafetyCard,
  SafetyPassportAssignmentStatus,
  SafetyPassportCertificateStatus,
  SafetyPassportContractor,
  SafetyPassportDocumentReadiness,
  SafetyProjectAssignment,
  SafetyProjectWorkerRow,
  SafetyWorkerCertificate,
  SafetyWorkerDocument,
  SafetyWorkerDocumentType,
  SafetyWorkerProfile,
} from '../types';
import { CANONICAL_SAFETY_DOCUMENT_TYPES } from './safetyPassportConfig';

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const inDaysIso = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const asArray = <T,>(value: T[] | null | undefined): T[] => Array.isArray(value) ? value : [];

export const getSafetyCertificateStatus = (
  certificate: Pick<SafetyWorkerCertificate, 'expiryDate' | 'status'>,
): SafetyPassportCertificateStatus => {
  if (certificate.status === 'rejected') return 'rejected';
  if (certificate.status === 'revoked') return 'revoked';
  if (!certificate.expiryDate) return 'valid';
  if (certificate.expiryDate < todayIso()) return 'expired';
  if (certificate.expiryDate <= inDaysIso(30)) return 'expiring_soon';
  return 'valid';
};

export const getSafetyAssignmentStatusLabel = (status: SafetyPassportAssignmentStatus): string => {
  switch (status) {
    case 'eligible': return 'Đủ điều kiện';
    case 'missing_profile': return 'Thiếu hồ sơ';
    case 'missing_certificate': return 'Thiếu chứng chỉ';
    case 'expired_certificate': return 'Hết hạn chứng chỉ';
    case 'missing_site_requirement': return 'Thiếu yêu cầu công trình';
    case 'suspended': return 'Tạm khóa';
    default: return status;
  }
};

export const maskSafetyIdentityNumber = (value?: string | null): string => {
  const text = (value || '').replace(/\s+/g, '');
  if (!text) return '-';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${'*'.repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;
};

export const getSafetyWorkerDocumentReadiness = (
  document?: Pick<SafetyWorkerDocument, 'status' | 'expiryDate' | 'attachments'> | null,
): SafetyPassportDocumentReadiness => {
  if (!document || document.status === 'missing') return 'missing';
  if (document.status === 'rejected') return 'rejected';
  if (document.status === 'expired') return 'expired';
  if (document.expiryDate && document.expiryDate < todayIso()) return 'expired';
  if (asArray(document.attachments).length === 0) return 'missing';
  return 'valid';
};

const isCanonicalSafetyDocumentType = (value?: string | null): value is SafetyWorkerDocumentType =>
  Boolean(value && (CANONICAL_SAFETY_DOCUMENT_TYPES as string[]).includes(value));

export const buildSafetyCardQrPath = (qrToken: string): string => `/safety-card/${qrToken}`;

export const buildSafetyCardQrUrl = (qrToken: string): string => {
  const base = typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}`;
  return `${base}#${buildSafetyCardQrPath(qrToken)}`;
};

export const safeSafetyStorageFileName = (name: string): string => {
  const safe = name.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'safety-passport-file';
};

const documentsByWorkerId = (documents: SafetyWorkerDocument[]): Map<string, SafetyWorkerDocument[]> => {
  const map = new Map<string, SafetyWorkerDocument[]>();
  documents.forEach(document => {
    map.set(document.workerId, [...(map.get(document.workerId) || []), document]);
  });
  return map;
};

const canonicalDocumentsByType = (
  documents: SafetyWorkerDocument[],
): Partial<Record<SafetyWorkerDocumentType, SafetyWorkerDocument>> => documents.reduce<Partial<Record<SafetyWorkerDocumentType, SafetyWorkerDocument>>>((accumulator, document) => {
  if (isCanonicalSafetyDocumentType(document.documentType) && !accumulator[document.documentType]) {
    accumulator[document.documentType] = document;
  }
  return accumulator;
}, {});

const getProfileReadiness = (
  worker: SafetyWorkerProfile | null,
  documents: Partial<Record<SafetyWorkerDocumentType, SafetyWorkerDocument>>,
): SafetyPassportDocumentReadiness => {
  if (!worker) return 'missing';
  const hasIdentityAttachment = asArray(worker.identityAttachments).length > 0
    || getSafetyWorkerDocumentReadiness(documents.identity_front) === 'valid'
    || getSafetyWorkerDocumentReadiness(documents.identity_back) === 'valid';
  if (
    worker.status !== 'active'
    || !worker.fullName?.trim()
    || !worker.workerCode?.trim()
    || !worker.photoAttachment
    || !worker.identityNumber?.trim()
    || !hasIdentityAttachment
  ) return 'missing';
  return 'valid';
};

export const buildSafetyProjectWorkerRows = (params: {
  assignments: SafetyProjectAssignment[];
  workers: SafetyWorkerProfile[];
  contractors: SafetyPassportContractor[];
  documents: SafetyWorkerDocument[];
  cards: SafetyCard[];
}): SafetyProjectWorkerRow[] => {
  const workerMap = new Map(params.workers.map(worker => [worker.id, worker]));
  const contractorMap = new Map(params.contractors.map(contractor => [contractor.id, contractor]));
  const documentsMap = documentsByWorkerId(params.documents);
  const cardByAssignment = new Map<string, SafetyCard>();
  params.cards.forEach(card => {
    if (!cardByAssignment.has(card.assignmentId)) cardByAssignment.set(card.assignmentId, card);
  });

  return params.assignments.map(assignment => {
    const worker = assignment.worker || workerMap.get(assignment.workerId) || null;
    const workerDocuments = worker ? documentsMap.get(worker.id) || [] : [];
    const documents = canonicalDocumentsByType(workerDocuments);
    const contractor = assignment.contractor
      || (assignment.contractorId ? contractorMap.get(assignment.contractorId) || null : null)
      || worker?.contractor
      || (worker?.contractorId ? contractorMap.get(worker.contractorId) || null : null);

    return {
      assignment: { ...assignment, worker, contractor },
      worker,
      contractor,
      card: cardByAssignment.get(assignment.id) || null,
      documents,
      identityNumberMasked: maskSafetyIdentityNumber(worker?.identityNumber),
      healthStatus: getSafetyWorkerDocumentReadiness(documents.health_check),
      insuranceStatus: getSafetyWorkerDocumentReadiness(documents.insurance),
      profileStatus: getProfileReadiness(worker, documents),
    };
  });
};
