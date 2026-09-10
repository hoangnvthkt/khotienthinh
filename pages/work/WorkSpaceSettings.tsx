import React, { useRef, useState } from "react";
import { Archive, RotateCcw, Save } from "lucide-react";
import { ConfigAttempt, type WorkConfigurationService } from "../../lib/work/workConfigurationService";
import type { WorkWorkspaceService } from "../../lib/work/workWorkspaceService";
import type { WorkspaceSummary } from "../../lib/work/workWorkspaceTypes";
import { workError } from "../../lib/work/workForm";
import { ScopeSettings } from "./WorkSettings";

export function WorkSpaceSettings({ workspace, actorId, workspaceService, configurationService, changed }: {
  workspace: WorkspaceSummary;
  actorId: string;
  workspaceService: WorkWorkspaceService;
  configurationService: WorkConfigurationService;
  changed: (workspace: WorkspaceSummary) => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [reason, setReason] = useState("Cập nhật thông tin Workspace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const commandKey = useRef(crypto.randomUUID());
  const configAttempt = useRef(new ConfigAttempt(`work-workspace-configuration:${actorId}:${workspace.id}`));
  async function command(kind: "update_profile" | "archive" | "restore") {
    setBusy(true); setError(null);
    try {
      const updated = await workspaceService.command(
        workspace.id,
        kind,
        kind === "update_profile" ? { name: name.trim() } : {},
        workspace.lockVersion,
        reason,
        commandKey.current,
      );
      commandKey.current = crypto.randomUUID();
      changed(updated);
    } catch (nextError) { setError(nextError); }
    finally { setBusy(false); }
  }
  if (!workspace.capabilities.canConfigure && !workspace.capabilities.canArchive) {
    return <section className="work-space-panel"><div className="work-space-empty"><h2>Cấu hình dành cho quản trị viên</h2><p>Thành viên vẫn có thể xem và xử lý công việc trong không gian này.</p></div></section>;
  }
  return <section className="work-space-panel" aria-labelledby="workspace-settings-title">
    <div className="work-panel-heading"><div><h2 id="workspace-settings-title">Cấu hình Workspace</h2><p>Thông tin, nhóm việc, lịch làm việc và chính sách SLA chỉ áp dụng trong không gian này.</p></div></div>
    {workspace.capabilities.canArchive && <section className="work-settings-card">
      <h3>Thông tin không gian</h3>
      <label className="work-label">Tên Workspace<input className="work-input" minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} disabled={busy || workspace.status === "archived"} /></label>
      <label className="work-label">Lý do thay đổi<input className="work-input" minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
      {error && <p className="work-error" role="alert">{workError(error)}</p>}
      <div className="work-settings-tabs">
        {workspace.status === "active" ? <>
          <button className="work-home-primary" disabled={busy || name.trim() === workspace.name || !reason.trim()} onClick={() => void command("update_profile")}><Save size={16} /> Lưu tên</button>
          <button className="work-home-secondary" disabled={busy || !reason.trim()} onClick={() => void command("archive")}><Archive size={16} /> Lưu trữ Workspace</button>
        </> : <button className="work-home-primary" disabled={busy || !reason.trim()} onClick={() => void command("restore")}><RotateCcw size={16} /> Khôi phục Workspace</button>}
      </div>
    </section>}
    {workspace.capabilities.canConfigure && workspace.status === "active" ? <ScopeSettings service={configurationService} scope={{ type: "workspace", workspaceId: workspace.id }} attempt={configAttempt.current} /> : workspace.status === "archived" ? <div className="work-space-empty"><h3>Workspace đang chỉ đọc</h3><p>Khôi phục Workspace trước khi thay đổi lịch hoặc SLA.</p></div> : null}
  </section>;
}
