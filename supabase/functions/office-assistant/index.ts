import { createClient } from "@supabase/supabase-js";
import { createOfficeAiHandler } from "./handler.ts";
Deno.serve(
  createOfficeAiHandler({
    client: (token) =>
      createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        },
      ),
    config: () => ({
      key: Deno.env.get("OFFICE_AI_API_KEY") || "",
      model: Deno.env.get("OFFICE_AI_MODEL") || "",
    }),
    fetch,
  }),
);
