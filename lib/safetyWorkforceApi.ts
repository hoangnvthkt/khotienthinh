import type {
  SafetyAssignWorkerInput,
  SafetyAttachment,
  SafetyCard,
  SafetyCreateWorkerForSiteInput,
  SafetyRosterFilters,
  SafetySiteWorkforceOptions,
  SafetyTransferWorkerInput,
  SafetyWorkerDetailPayload,
  SafetyWorkerDocumentPatch,
  SafetyWorkerLookupResult,
  SafetyWorkerProfilePatch,
  SafetyWorkerRosterPage,
  SafetyWorkforceDashboard,
} from '../types';
import { supabase } from './supabase';
import {
  buildSafetyWorkforceCacheKey,
  getSafetyWorkforceCached,
  invalidateSafetyWorkforceScope,
  SAFETY_WORKFORCE_TTL,
  setSafetyWorkforceCacheActor,
  type SafetyWorkforceCacheScope,
  type SafetyWorkforceResource,
} from './safetyWorkforceCache';
import {
  parseSafetyCard,
  parseSafetySiteWorkforceOptions,
  parseSafetyWorkerDetailPayload,
  parseSafetyWorkerLookupResult,
  parseSafetyWorkerRosterPage,
  parseSafetyWorkforceDashboard,
} from './safetyWorkforceModel';
import { safeSafetyStorageFileName } from './safetyPassportService';

export type SafetyWorkforceRequestScope = SafetyWorkforceCacheScope;

export const SAFETY_WORKFORCE_ATTACHMENT_BUCKET = 'safety-passport-attachments';

const INVALIDATION = {
  profile: ['roster', 'detail', 'dashboard'],
  assignment: ['roster', 'active', 'detail', 'dashboard'],
  card: ['active', 'detail', 'dashboard'],
} as const satisfies Record<string, readonly SafetyWorkforceResource[]>;

const assertScope = (scope: SafetyWorkforceRequestScope): void => {
  if (!scope.userId?.trim() || !scope.projectId?.trim() || !scope.constructionSiteId?.trim()) {
    throw new Error('SAFETY_SCOPE_REQUIRED');
  }
};

const prepareScope = (scope: SafetyWorkforceRequestScope): void => {
  assertScope(scope);
  setSafetyWorkforceCacheActor(scope.userId);
};

const rpc = async (name: string, params: Record<string, unknown>): Promise<unknown> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
};

const unique = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

const attachmentPath = (attachment?: SafetyAttachment | null): string | null => {
  if (!attachment) return null;
  if (attachment.storagePath) return attachment.storagePath;
  return attachment.url && !/^https?:\/\//i.test(attachment.url) ? attachment.url : null;
};

const createSignedUrlMap = async (paths: string[]): Promise<Map<string, string | null>> => {
  const deduplicated = unique(paths);
  if (deduplicated.length === 0) return new Map();

  try {
    const { data, error } = await supabase.storage
      .from(SAFETY_WORKFORCE_ATTACHMENT_BUCKET)
      .createSignedUrls(deduplicated, 300);
    if (error) return new Map(deduplicated.map(path => [path, null]));

    const signed = new Map<string, string | null>(deduplicated.map(path => [path, null]));
    for (const item of data || []) {
      if (item.path) signed.set(item.path, item.signedUrl || null);
    }
    return signed;
  } catch {
    return new Map(deduplicated.map(path => [path, null]));
  }
};

const signAttachment = (
  attachment: SafetyAttachment,
  signed: Map<string, string | null>,
): SafetyAttachment => {
  const path = attachmentPath(attachment);
  if (!path) return attachment;
  const signedUrl = signed.get(path) || null;
  return {
    ...attachment,
    storagePath: path,
    url: signedUrl || attachment.url,
    ...(signedUrl ? { previewUrl: signedUrl } : {}),
  };
};

const signRosterPage = async (page: SafetyWorkerRosterPage): Promise<SafetyWorkerRosterPage> => {
  const paths = unique(page.items.map(item => item.worker.photoStoragePath));
  const signed = await createSignedUrlMap(paths);
  return {
    ...page,
    items: page.items.map(item => {
      const path = item.worker.photoStoragePath;
      return {
        ...item,
        worker: {
          ...item.worker,
          ...(path ? { photoUrl: signed.get(path) || null } : {}),
        },
      };
    }),
  };
};

const signDetail = async (
  detail: SafetyWorkerDetailPayload,
  includeSensitive: boolean,
): Promise<SafetyWorkerDetailPayload> => {
  const sensitiveAttachments = includeSensitive
    ? [
        ...detail.documents.flatMap(document => document.attachments),
        ...detail.certificates.flatMap(certificate => certificate.attachments),
      ]
    : [];
  const paths = unique([
    detail.rosterItem.worker.photoStoragePath,
    attachmentPath(detail.profile.photoAttachment),
    ...sensitiveAttachments.map(attachmentPath),
  ]);
  const signed = await createSignedUrlMap(paths);
  const rosterPhotoPath = detail.rosterItem.worker.photoStoragePath;

  return {
    ...detail,
    rosterItem: {
      ...detail.rosterItem,
      worker: {
        ...detail.rosterItem.worker,
        ...(rosterPhotoPath ? { photoUrl: signed.get(rosterPhotoPath) || null } : {}),
      },
    },
    profile: {
      ...detail.profile,
      photoAttachment: detail.profile.photoAttachment
        ? signAttachment(detail.profile.photoAttachment, signed)
        : null,
    },
    documents: detail.documents.map(document => ({
      ...document,
      attachments: includeSensitive
        ? document.attachments.map(attachment => signAttachment(attachment, signed))
        : document.attachments,
    })),
    certificates: detail.certificates.map(certificate => ({
      ...certificate,
      attachments: includeSensitive
        ? certificate.attachments.map(attachment => signAttachment(attachment, signed))
        : certificate.attachments,
    })),
  };
};

const cachedRead = <T,>(
  scope: SafetyWorkforceRequestScope,
  resource: SafetyWorkforceResource,
  variant: Record<string, string | number | boolean | null | undefined> | undefined,
  loader: () => Promise<T>,
): Promise<T> => {
  prepareScope(scope);
  const key = buildSafetyWorkforceCacheKey(scope, resource, variant);
  return getSafetyWorkforceCached(key, SAFETY_WORKFORCE_TTL[resource], loader);
};

const invalidate = (
  scope: SafetyWorkforceRequestScope,
  resources: readonly SafetyWorkforceResource[],
): void => invalidateSafetyWorkforceScope(scope, [...resources]);

const commandDetail = async (
  scope: SafetyWorkforceRequestScope,
  name: string,
  params: Record<string, unknown>,
): Promise<SafetyWorkerDetailPayload> => {
  prepareScope(scope);
  const value = parseSafetyWorkerDetailPayload(await rpc(name, params));
  return signDetail(value, value.sensitiveLoaded);
};

export const safetyWorkforceApi = {
  async getDashboard(scope: SafetyWorkforceRequestScope): Promise<SafetyWorkforceDashboard> {
    return cachedRead(scope, 'dashboard', undefined, async () =>
      parseSafetyWorkforceDashboard(await rpc('get_safety_passport_dashboard', {
        p_project_id: scope.projectId,
        p_construction_site_id: scope.constructionSiteId,
      })));
  },

  async listRoster(
    scope: SafetyWorkforceRequestScope,
    filters: SafetyRosterFilters,
  ): Promise<SafetyWorkerRosterPage> {
    const resource: SafetyWorkforceResource = filters.assignmentStatus === 'active' ? 'active' : 'roster';
    return cachedRead(scope, resource, {
      search: filters.search || null,
      membershipStatus: filters.membershipStatus || null,
      assignmentStatus: filters.assignmentStatus || null,
      eligibilityStatus: filters.eligibilityStatus || null,
      documentStatus: filters.documentStatus || null,
      cursorCreatedAt: filters.cursor?.createdAt || null,
      cursorId: filters.cursor?.id || null,
      limit: filters.limit,
    }, async () => signRosterPage(parseSafetyWorkerRosterPage(
      await rpc('list_safety_site_worker_roster', {
        p_project_id: scope.projectId,
        p_construction_site_id: scope.constructionSiteId,
        p_search: filters.search?.trim() || null,
        p_membership_status: filters.membershipStatus || null,
        p_assignment_status: filters.assignmentStatus || null,
        p_eligibility_status: filters.eligibilityStatus || null,
        p_document_status: filters.documentStatus || null,
        p_cursor_created_at: filters.cursor?.createdAt || null,
        p_cursor_id: filters.cursor?.id || null,
        p_limit: filters.limit,
      }),
    )));
  },

  async getDetail(
    scope: SafetyWorkforceRequestScope,
    membershipId: string,
    includeSensitive: boolean,
  ): Promise<SafetyWorkerDetailPayload> {
    if (!membershipId.trim()) return Promise.reject(new Error('SAFETY_SCOPE_REQUIRED'));
    return cachedRead(scope, 'detail', { membershipId, includeSensitive }, async () => signDetail(
      parseSafetyWorkerDetailPayload(await rpc('get_safety_site_worker_detail', {
        p_project_id: scope.projectId,
        p_construction_site_id: scope.constructionSiteId,
        p_membership_id: membershipId,
        p_include_sensitive: includeSensitive,
      })),
      includeSensitive,
    ));
  },

  async lookupExact(
    scope: SafetyWorkforceRequestScope,
    input: { workerCode?: string; identityType?: string; identityNumber?: string },
  ): Promise<SafetyWorkerLookupResult | null> {
    prepareScope(scope);
    return parseSafetyWorkerLookupResult(await rpc('lookup_safety_worker_exact', {
      p_project_id: scope.projectId,
      p_construction_site_id: scope.constructionSiteId,
      p_worker_code: input.workerCode?.trim() || null,
      p_identity_type: input.identityType?.trim() || null,
      p_identity_number: input.identityNumber?.trim() || null,
    }));
  },

  async listOptions(scope: SafetyWorkforceRequestScope): Promise<SafetySiteWorkforceOptions> {
    return cachedRead(scope, 'options', undefined, async () =>
      parseSafetySiteWorkforceOptions(await rpc('list_safety_site_workforce_options', {
        p_project_id: scope.projectId,
        p_construction_site_id: scope.constructionSiteId,
      })));
  },

  async createProfile(
    scope: SafetyWorkforceRequestScope,
    input: SafetyCreateWorkerForSiteInput,
  ): Promise<SafetyWorkerDetailPayload> {
    const detail = await commandDetail(scope, 'create_safety_worker_profile_for_site', {
      p_project_id: scope.projectId,
      p_construction_site_id: scope.constructionSiteId,
      p_worker_kind: input.workerKind,
      p_profile: input.profile,
      p_subcontractor_id: input.subcontractorId,
      p_team_id: input.teamId,
    });
    invalidate(scope, INVALIDATION.profile);
    return detail;
  },

  async updateProfile(
    scope: SafetyWorkforceRequestScope,
    membershipId: string,
    patch: SafetyWorkerProfilePatch,
  ): Promise<SafetyWorkerDetailPayload> {
    const detail = await commandDetail(scope, 'update_safety_worker_profile_for_site', {
      p_membership_id: membershipId,
      p_profile: patch,
    });
    invalidate(scope, INVALIDATION.profile);
    return detail;
  },

  async saveDocuments(
    scope: SafetyWorkforceRequestScope,
    membershipId: string,
    documents: SafetyWorkerDocumentPatch[],
  ): Promise<SafetyWorkerDetailPayload> {
    const detail = await commandDetail(scope, 'upsert_safety_worker_documents_for_site', {
      p_membership_id: membershipId,
      p_documents: documents,
    });
    invalidate(scope, INVALIDATION.profile);
    return detail;
  },

  async assign(
    scope: SafetyWorkforceRequestScope,
    input: SafetyAssignWorkerInput,
  ): Promise<SafetyWorkerDetailPayload> {
    const assignment = {
      ...(input.roleName !== undefined ? { roleName: input.roleName } : {}),
      ...(input.workType !== undefined ? { workType: input.workType } : {}),
    };
    const detail = await commandDetail(scope, 'assign_safety_worker_to_site', {
      p_membership_id: input.membershipId,
      p_started_at: input.startedAt,
      p_subcontractor_id: input.subcontractorId,
      p_team_id: input.teamId,
      p_assignment: assignment,
    });
    invalidate(scope, INVALIDATION.assignment);
    return detail;
  },

  async endAssignment(
    scope: SafetyWorkforceRequestScope,
    assignmentId: string,
    endedAt: string,
    reason: string,
  ): Promise<SafetyWorkerDetailPayload> {
    const detail = await commandDetail(scope, 'end_safety_worker_assignment', {
      p_assignment_id: assignmentId,
      p_ended_at: endedAt,
      p_reason: reason,
    });
    invalidate(scope, INVALIDATION.assignment);
    return detail;
  },

  async transfer(
    scope: SafetyWorkforceRequestScope,
    input: SafetyTransferWorkerInput,
  ): Promise<SafetyWorkerDetailPayload> {
    if (
      input.targetProjectId !== scope.projectId
      || input.targetConstructionSiteId !== scope.constructionSiteId
    ) {
      throw new Error('SAFETY_SCOPE_MISMATCH');
    }
    const detail = await commandDetail(scope, 'transfer_safety_worker_site', {
      p_assignment_id: input.assignmentId,
      p_target_project_id: input.targetProjectId,
      p_target_construction_site_id: input.targetConstructionSiteId,
      p_started_at: input.startedAt,
      p_subcontractor_id: input.subcontractorId,
      p_team_id: input.teamId,
    });
    const sourceScope: SafetyWorkforceRequestScope = {
      userId: scope.userId,
      projectId: input.sourceProjectId,
      constructionSiteId: input.sourceConstructionSiteId,
    };
    invalidate(sourceScope, INVALIDATION.assignment);
    invalidate(scope, INVALIDATION.assignment);
    return detail;
  },

  async issueCard(
    scope: SafetyWorkforceRequestScope,
    assignmentId: string,
    expiresAt: string,
    templateId?: string,
  ): Promise<SafetyWorkerDetailPayload> {
    const detail = await commandDetail(scope, 'issue_safety_assignment_card', {
      p_assignment_id: assignmentId,
      p_expires_at: expiresAt,
      p_template_id: templateId || null,
    });
    invalidate(scope, INVALIDATION.card);
    return detail;
  },

  async renewCard(
    scope: SafetyWorkforceRequestScope,
    cardId: string,
    expiresAt: string,
  ): Promise<SafetyWorkerDetailPayload> {
    const detail = await commandDetail(scope, 'renew_safety_assignment_card', {
      p_card_id: cardId,
      p_expires_at: expiresAt,
    });
    invalidate(scope, INVALIDATION.card);
    return detail;
  },

  async revokeCard(
    scope: SafetyWorkforceRequestScope,
    cardId: string,
    reason: string,
  ): Promise<SafetyWorkerDetailPayload> {
    const detail = await commandDetail(scope, 'revoke_safety_assignment_card', {
      p_card_id: cardId,
      p_reason: reason,
    });
    invalidate(scope, INVALIDATION.card);
    return detail;
  },

  async logCardPrint(scope: SafetyWorkforceRequestScope, cardId: string): Promise<void> {
    prepareScope(scope);
    await rpc('log_safety_card_print', { p_card_id: cardId });
    invalidate(scope, INVALIDATION.card);
  },

  async lookupCard(qrToken: string, userId: string): Promise<SafetyCard | null> {
    if (!qrToken.trim() || !userId.trim()) throw new Error('SAFETY_SCOPE_REQUIRED');
    const cacheScope = { userId, projectId: 'qr', constructionSiteId: 'qr' };
    return cachedRead(cacheScope, 'card_lookup', { qrToken }, async () => {
      const value = await rpc('get_safety_card_by_qr', { p_qr_token: qrToken.trim() });
      if (value === null) return null;
      const card = parseSafetyCard(value);
      const photo = card.worker?.photoAttachment;
      const path = attachmentPath(photo);
      if (!photo || !path || !card.worker) return card;
      const signed = await createSignedUrlMap([path]);
      return {
        ...card,
        worker: {
          ...card.worker,
          photoAttachment: signAttachment(photo, signed),
        },
      };
    });
  },

  async uploadWorkerAttachment(
    workerId: string,
    category: string,
    file: File,
  ): Promise<SafetyAttachment> {
    const normalizedWorkerId = workerId.trim();
    const normalizedCategory = category.trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
    if (!normalizedWorkerId || !normalizedCategory || !file.name.trim()) {
      throw new Error('SAFETY_INVALID_RPC_PAYLOAD');
    }
    const id = globalThis.crypto.randomUUID();
    const path = `${normalizedWorkerId}/${normalizedCategory}/${id}-${safeSafetyStorageFileName(file.name)}`;
    const { data, error } = await supabase.storage
      .from(SAFETY_WORKFORCE_ATTACHMENT_BUCKET)
      .upload(path, file, {
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
    if (error) throw error;
    const storagePath = data?.path || path;
    return {
      id,
      name: file.name,
      fileName: file.name,
      url: storagePath,
      storagePath,
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
      category: normalizedCategory,
      uploadedAt: new Date().toISOString(),
    };
  },
};
