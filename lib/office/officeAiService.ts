import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfficePage, OfficeSummary } from "./officeTypes";
export type OfficeAiAction = "draft" | "extract" | "summary" | "ask" | "search";
export interface OfficeAiResult {
  result: {
    title: string;
    summary: string;
    body: string;
    source_document_number: string;
    source_organization: string;
    source_sender: string;
    document_date: string;
    search: string;
    group: string;
  };
  sourceVersion: number | null;
  documents?: OfficePage<OfficeSummary>;
}
export interface OfficeAiService {
  status: () => Promise<{ configured: boolean }>;
  run: (input: {
    action: OfficeAiAction;
    documentId?: string;
    attachmentId?: string;
    prompt?: string;
  }) => Promise<OfficeAiResult>;
}
export const unavailableOfficeAi: OfficeAiService = {
  status: async () => ({ configured: false }),
  run: async () => {
    throw new Error("OFFICE_AI_NOT_CONFIGURED");
  },
};
export function createOfficeAiService(
  functions: SupabaseClient["functions"],
): OfficeAiService {
  const invoke = async <T>(body: object): Promise<T> => {
    const { data, error } = await functions.invoke("office-assistant", {
      body,
    });
    if (error) {
      let code = "OFFICE_AI_FAILED";
      try {
        const response = await error.context?.json();
        if (response?.error) code = response.error;
      } catch {
        /* Unavailable endpoint remains an error, not an invented result. */
      }
      throw new Error(code);
    }
    if (!data) throw new Error("OFFICE_AI_FAILED");
    return data;
  };
  return {
    status: () => invoke<{ configured: boolean }>({ action: "status" }),
    run: (input) => invoke(input),
  };
}
