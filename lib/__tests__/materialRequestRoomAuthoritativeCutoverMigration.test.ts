import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const directory = join(process.cwd(), "supabase/migrations");
const migrationFile = readdirSync(directory).find((file) =>
  file.endsWith("_material_request_room_authoritative_cutover.sql"),
);
const sql = migrationFile
  ? readFileSync(join(directory, migrationFile), "utf8")
  : "";

describe("Material Request authoritative Room cutover", () => {
  it("pilots seven actions, leaves verify audit-only and disables their PBAC fallback", () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain("where room_code = 'material_request'");
    expect(sql).toContain(
      "when action_code = 'verify' then 'audit_only' else 'pilot'",
    );
    expect(sql).toContain("when action_code = 'verify' then true else false");
    expect(sql).toContain("project.material_request.confirm_fulfillment");
  });

  it("packages prerequisites and preserves locked actions in an empty Room", () => {
    expect(sql).toContain("prerequisite_action_codes");
    expect(sql).toContain("required_actions = '{}'::text[]");
    expect(sql).toContain("binding.enforcement_status = 'audit_only'");
    expect(sql).toContain(
      "replace_project_permission_room_members_room_cutover_legacy",
    );
  });

  it("freezes PBAC without deleting audit grants", () => {
    expect(sql).toContain("v_preserved_cutover_grants");
    expect(sql).toContain("guard_material_request_pbac_grant_write");
    expect(sql).toContain("permission_code like 'project.material_request.%'");
  });

  it("requires Room plus ownership or assignment for workflow operations", () => {
    expect(sql).toContain("Room submit permission required");
    expect(sql).toContain("Room approve permission required");
    expect(sql).toContain("project_workflow_actor_can_act");
    expect(sql).toContain("assert_material_request_room_recipients");
    expect(sql).toContain("'material_request', 'confirm'");
    expect(sql).toContain("'material_request', 'view'");
  });

  it("protects the parent and exposes only least-privilege projections", () => {
    expect(sql).toContain("guard_project_material_request_workflow_fields");
    expect(sql).toContain("material_request_parent_can_view");
    expect(sql).toContain("list_project_material_request_procurement_demand");
    expect(sql).toContain("get_project_material_request_aggregate");
    expect(sql).toContain("get_project_material_request_available_stock");
  });
});
