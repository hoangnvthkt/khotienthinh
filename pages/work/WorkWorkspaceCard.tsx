import React from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  FolderKanban,
  Pin,
  PinOff,
  Users,
} from "lucide-react";
import type { WorkspaceSummary } from "../../lib/work/workWorkspaceTypes";
import {
  workspaceCover,
  workspaceKindLabel,
  workspaceRoute,
} from "./workspacePresentation";

const kindIcon = {
  department: Building2,
  project: FolderKanban,
  collaboration: Users,
};

export function WorkWorkspaceCard({
  workspace,
  pinBusy,
  onPin,
}: {
  workspace: WorkspaceSummary;
  pinBusy: boolean;
  onPin: (next: boolean) => void;
}) {
  const Icon = kindIcon[workspace.kind];
  const avatarCount = Math.min(workspace.memberCount, 4);
  const sourceLabel = workspace.sourceName && workspace.sourceName !== workspace.name
    ? workspace.sourceName
    : "Đồng bộ từ sơ đồ tổ chức";
  return (
    <article className={`work-space-card work-space-${workspace.colorKey}`}>
      <div className="work-space-cover">
        <img src={workspaceCover(workspace.kind)} alt="" loading="lazy" />
        <span className="work-space-kind"><Icon size={15} />{workspaceKindLabel[workspace.kind]}</span>
        <button
          type="button"
          className="work-space-pin"
          aria-label={workspace.pinned ? `Bỏ ghim ${workspace.name}` : `Ghim ${workspace.name}`}
          aria-pressed={workspace.pinned}
          disabled={pinBusy}
          onClick={() => onPin(!workspace.pinned)}
        >
          {workspace.pinned ? <PinOff size={17} /> : <Pin size={17} />}
        </button>
      </div>
      <Link className="work-space-card-link" to={workspaceRoute(workspace.id)}>
        <div className="work-space-card-title">
          <div>
            <h3>{workspace.name}</h3>
            <p>{workspace.sourceName ? sourceLabel : "Không gian cộng tác độc lập"}</p>
          </div>
          {workspace.status === "archived" && <span className="work-space-archived">Đã lưu trữ</span>}
        </div>
        <div className="work-space-metrics" aria-label="Tổng quan không gian">
          <span><strong>{workspace.myActionCount}</strong> cần tôi xử lý</span>
          <span><strong>{workspace.visibleOpenTaskCount}</strong> việc đang mở</span>
        </div>
        <div className="work-space-card-footer">
          <div className="work-space-avatars" aria-label={`${workspace.memberCount} thành viên`}>
            {Array.from({ length: avatarCount }, (_, index) => (
              <span key={index} aria-hidden="true"><Users size={13} /></span>
            ))}
            {workspace.memberCount > 4 && <b>+{workspace.memberCount - 4}</b>}
          </div>
          <span className="work-space-open">Mở không gian <span aria-hidden="true">→</span></span>
        </div>
      </Link>
    </article>
  );
}
