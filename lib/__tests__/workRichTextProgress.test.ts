import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as workForm from "../work/workForm";

describe("Work rich text and progress contracts", () => {
  it("extracts searchable plain text from supported rich blocks", () => {
    const document = {
      version: 1,
      type: "doc",
      content: [
        { type: "heading", level: 2, content: [{ type: "text", text: "Kết quả" }] },
        {
          type: "bullet_list",
          content: [
            { type: "list_item", content: [{ type: "text", text: "Hồ sơ A" }] },
            { type: "list_item", content: [{ type: "text", text: "Hồ sơ B" }] },
          ],
        },
        { type: "blockquote", content: [{ type: "text", text: "Đã kiểm tra" }] },
      ],
    };

    expect(workForm.documentText(document as any)).toBe(
      "Kết quả\nHồ sơ A\nHồ sơ B\nĐã kiểm tra",
    );
  });

  it("accepts integer progress from zero through one hundred only", () => {
    const validate = (workForm as any).validateWorkProgress as (value: unknown) => number;
    expect(validate(0)).toBe(0);
    expect(validate("65")).toBe(65);
    expect(validate(100)).toBe(100);
    expect(() => validate(25.5)).toThrow("WORK_INVALID_PROGRESS");
    expect(() => validate(-1)).toThrow("WORK_INVALID_PROGRESS");
    expect(() => validate(101)).toThrow("WORK_INVALID_PROGRESS");
  });

  it("defines guarded content draft and progress persistence", () => {
    const directory = join(process.cwd(), "supabase", "migrations");
    const file = readdirSync(directory).find((name) =>
      name.endsWith("_work_task_content_progress.sql"),
    );
    const sql = file && existsSync(join(directory, file))
      ? readFileSync(join(directory, file), "utf8").toLowerCase().replace(/\s+/g, " ")
      : "";

    expect(file).toBeTruthy();
    expect(sql).toContain("progress_percent integer not null default 0");
    expect(sql).toContain("result_draft_document jsonb");
    expect(sql).toContain("result_draft_text text");
    expect(sql).toContain("description_update");
    expect(sql).toContain("result_draft_update");
    expect(sql).toContain("progress_update");
    expect(sql).toContain("canupdatedescription");
    expect(sql).toContain("canupdateresultdraft");
    expect(sql).toContain("canupdateprogress");
    expect(sql).toContain("task.progress_updated");
    expect(sql).toContain("task.description_updated");
    expect(sql).toContain("task.result_draft_updated");
  });
});
