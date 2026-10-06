import { unavailableOfficeAi, type OfficeAiService } from "./officeAiService";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeOfficeFilters } from "./officePresentation";
import type {
  OfficePeopleKind,
  OfficePerson,
  OfficeTemplate,
  OfficeVersion,
  OfficeReport,
  OfficeTarget,
  OfficeTargetType,
  OfficeLink,
  AudienceKind,
  OfficeActivity,
  OfficeAttachment,
  OfficeCatalog,
  OfficeCommandInput,
  OfficeCommandResult,
  OfficeNumberSuggestion,
  OfficeDashboard,
  OfficeDetail,
  OfficeFilters,
  OfficeOption,
  OfficePage,
  OfficeRecipient,
  OfficeSummary,
  RecipientSpec,
} from "./officeTypes";
/** Storage adapter boundary: UI and domain services never choose a provider/bucket. */
export interface OfficeFileStore {
  upload(ref: OfficeAttachment, file: File): Promise<void>;
  url(ref: OfficeAttachment): Promise<string>;
  remove(ref: OfficeAttachment): Promise<void>;
}
export function createOfficeFileStore(
  storage: SupabaseClient["storage"],
): OfficeFileStore {
  return {
    async upload(ref, file) {
      const { error } = await storage
        .from(ref.bucket)
        .upload(ref.path, file, { contentType: ref.mime_type, upsert: false });
      // A previous upload may have succeeded before its response was lost. The reservation
      // cannot be overwritten; attachment_finish still checks server size and MIME.
      if (
        error &&
        String(error.statusCode) !== "409" &&
        (error as { code?: string }).code !== "Duplicate" &&
        (error as { error?: string }).error !== "Duplicate"
      )
        throw error;
    },
    async url(ref) {
      const { data, error } = await storage
        .from(ref.bucket)
        .createSignedUrl(ref.path, 300);
      if (error || !data?.signedUrl)
        throw error || new Error("OFFICE_FILE_URL");
      return data.signedUrl;
    },
    async remove(ref) {
      const { error } = await storage.from(ref.bucket).remove([ref.path]);
      if (error) throw error;
    },
  };
}
export function createOfficeService(
  client: Pick<SupabaseClient, "rpc">,
  files?: OfficeFileStore,
  ai: OfficeAiService = unavailableOfficeAi,
) {
  async function query<T>(name: string, params: object = {}): Promise<T> {
    const { data, error } = await client.rpc("office_query", {
      p_query: name,
      p_params: params,
    });
    if (error) throw error;
    if (data === null) throw new Error("OFFICE_EMPTY_RESPONSE");
    return data as T;
  }
  return {
    ai,
    templates: () => query<OfficeTemplate[]>("templates"),
    templateVersions: (id: string, page = 0) =>
      query<(OfficeVersion & { snapshot: OfficeTemplate })[]>(
        "template_versions",
        { id, page },
      ),
    versions: (id: string, page = 0) =>
      query<OfficeVersion[]>("versions", { id, page }),
    version: (id: string, version: number) =>
      query<OfficeVersion>("version", { id, version }),
    links: (id: string) => query<OfficeLink[]>("links", { id }),
    targets: (kind: OfficeTargetType, search: string) =>
      query<OfficeTarget[]>("target_options", { kind, search }),
    report: (filters: OfficeFilters) =>
      query<OfficeReport>("report", normalizeOfficeFilters(filters)),
    export: (filters: OfficeFilters) =>
      query<OfficePage<OfficeSummary> & { generatedAt: string }>(
        "export",
        normalizeOfficeFilters(filters),
      ),
    catalog: () => query<OfficeCatalog>("catalog"),
    dashboard: () => query<OfficeDashboard>("dashboard"),
    list: (filters: OfficeFilters) =>
      query<OfficePage<OfficeSummary>>("list", normalizeOfficeFilters(filters)),
    detail: (id: string) => query<OfficeDetail>("detail", { id }),
    options: (
      kind: Exclude<AudienceKind, "company">,
      search = "",
      ids: string[] = [],
    ) => query<OfficeOption[]>("options", { kind, search, ids }),
    audience: (specs: RecipientSpec[]) =>
      query<{
        total: number;
        withoutAccess: number;
        names: { name: string }[];
      }>("audience", { specs }),
    people: (id: string, kind: OfficePeopleKind, page = 0) => query<OfficePage<OfficePerson>>("people", { id, kind, page }),
    recipients: (id: string, page = 0, filter = "all") =>
      query<OfficePage<OfficeRecipient>>("recipients", { id, page, filter }),
    activity: (id: string, page = 0) =>
      query<OfficeActivity[]>("activity", { id, page }),
    async numberSuggestion(
      typeId: string,
      sequence?: number | null,
      documentId?: string | null,
    ): Promise<OfficeNumberSuggestion> {
      const { data, error } = await client.rpc("office_number_suggestion_v1", {
        p_document_type_id: typeId,
        p_sequence: sequence ?? null,
        p_document_id: documentId ?? null,
      });
      if (error) throw error;
      if (!data) throw new Error("OFFICE_EMPTY_RESPONSE");
      return data as OfficeNumberSuggestion;
    },
    async command(input: OfficeCommandInput): Promise<OfficeCommandResult> {
      const { data, error } = await client.rpc("office_command", {
        p_command: input.command,
        p_document_id: input.documentId || null,
        p_payload: input.payload || {},
        p_expected_version: input.expectedVersion ?? null,
        p_idempotency_key: input.key,
      });
      if (error) throw error;
      if (!data) throw new Error("OFFICE_EMPTY_RESPONSE");
      return data;
    },
    async configure(
      kind: "type" | "workflow" | "rule" | "folder" | "template",
      id: string | null,
      data: object,
    ): Promise<string> {
      const result = await client.rpc("office_configure", {
        p_kind: kind,
        p_id: id || null,
        p_data: data,
      });
      if (result.error) throw result.error;
      return result.data;
    },
    upload: (ref: OfficeAttachment, file: File) => {
      if (!files) throw new Error("OFFICE_STORAGE_UNAVAILABLE");
      return files.upload(ref, file);
    },
    fileUrl: (ref: OfficeAttachment) => {
      if (!files) throw new Error("OFFICE_STORAGE_UNAVAILABLE");
      return files.url(ref);
    },
    removeFile: (ref: OfficeAttachment) => {
      if (!files) throw new Error("OFFICE_STORAGE_UNAVAILABLE");
      return files.remove(ref);
    },
  };
}
export type OfficeService = ReturnType<typeof createOfficeService>;
