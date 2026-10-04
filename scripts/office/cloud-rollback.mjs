// Explicitly authorized Cloud rollback-only runner; never applies migration history.
import { readFileSync } from "node:fs";
const project = new URL(process.env.VITE_SUPABASE_URL).hostname.split(".")[0];
if (!project || !process.env.SUPABASE_ACCESS_TOKEN)
  throw new Error("Load the repository .env");
const files = [
  "supabase/migrations/20261004085552_office_p0_document_lifecycle.sql",
  ...process.argv.slice(2),
];
const chunks = files.map((file) => readFileSync(file, "utf8"));
if (chunks.some((sql) => /^\s*(commit|rollback|begin)\s*;/im.test(sql)))
  throw new Error("Input must not control the transaction");
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `begin; set local lock_timeout='3s'; set local statement_timeout='45s';\n${chunks.join("\n")}\nrollback;`,
    }),
  },
);
const text = await response.text();
if (!response.ok) {
  console.error(text);
  process.exitCode = 1;
} else
  console.log(
    "PASS: Office migration and requested assertions executed; transaction rolled back.",
    text,
  );
