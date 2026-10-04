import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  FileText,
  FolderOpen,
  Hash,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import type { OfficeService } from "../../lib/office/officeService";
import type { OfficeCatalog, OfficeGroup, OfficeOption } from "../../lib/office/officeTypes";
import { OFFICE_GROUPS } from "../../lib/office/officePresentation";
import {
  OfficeEmpty,
  OfficeError,
  OfficeField,
  OfficeModal,
  OfficePicker,
} from "./OfficeShared";
import { officePermissionSettingsPath } from "../../lib/office/officeAdminNavigation";
type Kind = "type" | "workflow" | "rule" | "folder";
const tabs: Record<
  Kind,
  { label: string; icon: typeof FileText; description: string }
> = {
  type: {
    label: "Loại văn bản",
    icon: FileText,
    description:
      "Nhóm nghiệp vụ, yêu cầu duyệt, quy tắc số và nơi lưu mặc định.",
  },
  workflow: {
    label: "Tuyến duyệt",
    icon: ShieldCheck,
    description:
      "Thứ tự người duyệt được chốt khi văn bản gửi duyệt; thay đổi chỉ áp dụng cho lần trình tiếp theo.",
  },
  rule: {
    label: "Quy tắc cấp số",
    icon: Hash,
    description:
      "Số tăng độc lập theo loại, quy tắc và năm. Số đã cấp không được tái sử dụng.",
  },
  folder: {
    label: "Kho lưu trữ",
    icon: FolderOpen,
    description:
      "Tổ chức hồ sơ theo cây thư mục. Quyền truy cập được kiểm soát riêng.",
  },
};
export function OfficeSettingsPage({
  service,
  catalog,
  onSaved,
  canManagePermissions = false,
}: {
  service: OfficeService;
  catalog: OfficeCatalog;
  onSaved: () => void;
  canManagePermissions?: boolean;
}) {
  const [kind, setKind] = useState<Kind | "permissions">("type");
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [open, setOpen] = useState(false);
  if (!catalog.canConfigure)
    return <OfficeError error={{ message: "OFFICE_DENIED" }} />;
  const rows =
    kind === "type"
      ? catalog.types
      : kind === "workflow"
        ? catalog.workflows
        : kind === "rule"
          ? catalog.rules
          : catalog.folders;
  return (
    <div className="office-content">
      <div className="office-page-heading">
        <div>
          <p className="office-eyebrow">QUẢN TRỊ OFFICE</p>
          <h1>Cấu hình Office</h1>
          <p>Thiết lập một lần, áp dụng nhất quán trong quy trình hằng ngày.</p>
        </div>
        <button className="office-secondary" onClick={() => setKind("permissions")}><Users size={16} />Phân quyền người dùng</button>
      </div>
      <div className="office-group-tabs">
        {(Object.entries(tabs) as [Kind, (typeof tabs)[Kind]][]).map(
          ([key, t]) => (
            <button
              key={key}
              className={kind === key ? "is-active" : ""}
              onClick={() => setKind(key)}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ),
        )}
        <button className={kind === "permissions" ? "is-active" : ""} onClick={() => setKind("permissions")}><Users size={16} />Phân quyền người dùng</button>
      </div>
      {kind === "permissions" ? <OfficeUserPermissions service={service} canManagePermissions={canManagePermissions} /> : <section className="office-panel">
        <header className="office-section-heading">
          <div>
            <h2>{tabs[kind].label}</h2>
            <p>{tabs[kind].description}</p>
          </div>
          <button
            className="office-primary"
            onClick={() => {
              setEdit(null);
              setOpen(true);
            }}
          >
            <Plus size={16} />
            Thêm mới
          </button>
        </header>
        <div className="office-settings-list">
          {rows.map((row) => (
            <button
              key={row.id}
              onClick={() => {
                setEdit(row);
                setOpen(true);
              }}
            >
              <div>
                <strong>{row.name}</strong>
                <small>
                  {kind === "type"
                    ? `${(row as any).code} · ${(row as any).requires_approval ? "Cần duyệt" : "Không cần duyệt"} · ${(row as any).requires_number ? "Có cấp số" : "Không cấp số"}`
                    : kind === "workflow"
                      ? `${(row as any).steps.length} bước duyệt · Phiên bản ${(row as any).version}`
                      : kind === "rule"
                        ? (row as any).format
                        : (row as any).parent_id
                          ? `Trong ${catalog.folders.find((f) => f.id === (row as any).parent_id)?.name || "thư mục cha"}`
                          : "Thư mục gốc"}
                </small>
              </div>
              <span className={!row.is_active ? "office-text-muted" : ""}>
                {row.is_active ? "Đang sử dụng" : "Ngừng sử dụng"}
              </span>
              <Pencil size={16} />
            </button>
          ))}
          {!rows.length && (
            <OfficeEmpty
              title={`Chưa có ${tabs[kind].label.toLowerCase()}`}
              description="Thêm cấu hình để người soạn có thể lựa chọn khi tạo văn bản."
            />
          )}
        </div>
      </section>}
      {open && kind !== "permissions" && (
        <OfficeConfigDialog
          key={`${kind}:${edit?.id || "new"}`}
          service={service}
          catalog={catalog}
          kind={kind}
          current={edit}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onSaved();
          }}
        />
      )}
    </div>
  );
}
export function OfficeUserPermissions({ service, canManagePermissions }: { service: OfficeService; canManagePermissions: boolean }) {
  const [selected, setSelected] = useState<OfficeOption | null>(null);
  return <section className="office-panel office-access-panel">
    <header className="office-section-heading"><div><h2>Phân quyền người dùng</h2><p>Chọn người cần cấp quyền, sau đó chọn thao tác và phạm vi truy cập trong Office.</p></div></header>
    {canManagePermissions ? <>
      <OfficeField label="Tài khoản cần phân quyền" hint="Quyền ở các ứng dụng khác được giữ nguyên khi anh điều chỉnh Office.">
        <OfficePicker service={service} kind="user" value={selected?.id} onChange={setSelected} label="Tìm theo tên hoặc email" />
      </OfficeField>
      <div className="office-access-actions">
        {selected ? <Link className="office-primary" to={officePermissionSettingsPath(selected.id)}><ShieldCheck size={16} />Phân quyền Office cho {selected.name}</Link> : <button className="office-primary" disabled><ShieldCheck size={16} />Phân quyền Office</button>}
        <Link className="office-secondary" to={officePermissionSettingsPath()}>Danh sách người dùng</Link>
      </div>
    </> : <p className="office-notice">Anh có quyền cấu hình Office. Để cấp quyền cho người dùng, cần thêm quyền quản lý phân quyền hệ thống và truy cập mục Người dùng. Liên hệ quản trị hệ thống để được cấp quyền này.</p>}
    <div className="office-access-guide"><h3>Chọn quyền theo công việc</h3><div className="office-access-grid">
      {[
        ['Người nhận', 'Xem văn bản được gửi hoặc chia sẻ cho mình, phòng ban hoặc công trường.'],
        ['Người soạn', 'Tạo văn bản, chỉnh sửa bản nháp và gửi duyệt.'],
        ['Người duyệt', 'Phê duyệt theo tuyến được giao; không tự duyệt văn bản mình soạn.'],
        ['Văn thư', 'Cấp số và phát hành văn bản đã đáp ứng điều kiện duyệt.'],
        ['Quản trị cấu hình', 'Quản lý loại văn bản, tuyến duyệt, quy tắc cấp số và thư mục.'],
      ].map(([title, description]) => <article key={title}><strong>{title}</strong><p>{description}</p></article>)}
    </div><p className="office-text-muted">Quyền quản trị cấu hình không tự cấp quyền duyệt, phát hành hoặc xem toàn bộ văn bản. Mỗi quyền được cấp theo phạm vi riêng.</p></div>
  </section>;
}
function OfficeConfigDialog({
  service,
  catalog,
  kind,
  current,
  onClose,
  onSaved,
}: {
  service: OfficeService;
  catalog: OfficeCatalog;
  kind: Kind;
  current: Record<string, any> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Record<string, any>>(() =>
    current
      ? { ...current }
      : {
          name: "",
          is_active: true,
          ...(kind === "type"
            ? {
                code: "",
                groups: ["INTERNAL"],
                requires_approval: true,
                requires_number: true,
                numbering_rule_id:
                  catalog.rules.find((r) => r.is_active)?.id || null,
                workflow_id: null,
                archive_folder_id: null,
              }
            : kind === "workflow"
              ? {
                  steps: [{ userId: "", label: "Phê duyệt" }],
                  department_id: null,
                  project_id: null,
                }
              : kind === "rule"
                ? { format: "{sequence}/{year}/{code}-TT" }
                : { parent_id: null }),
        },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const patch = (values: object) => setData((d) => ({ ...d, ...values }));
  const step = (index: number, values: object) =>
    patch({
      steps: data.steps.map((s: any, i: number) =>
        i === index ? { ...s, ...values } : s,
      ),
    });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await service.configure(kind, current?.id || null, data);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <OfficeModal
      title={`${current ? "Chỉnh sửa" : "Thêm"} ${tabs[kind].label.toLowerCase()}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <OfficeField label="Tên" required>
            <input
              autoFocus
              aria-label="Tên cấu hình"
              required
              maxLength={120}
              value={data.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </OfficeField>
          {kind === "type" && (
            <>
              <OfficeField label="Mã loại" required>
                <input
                  aria-label="Mã loại"
                  maxLength={20}
                  required
                  value={data.code}
                  onChange={(e) => patch({ code: e.target.value })}
                />
              </OfficeField>
              <OfficeField label="Nhóm nghiệp vụ" required>
                <div className="office-checkboxes">
                  {(Object.keys(OFFICE_GROUPS) as OfficeGroup[]).map((g) => (
                    <label key={g}>
                      <input
                        type="checkbox"
                        checked={data.groups.includes(g)}
                        onChange={(e) =>
                          patch({
                            groups: e.target.checked
                              ? [...data.groups, g]
                              : data.groups.filter((x: string) => x !== g),
                          })
                        }
                      />
                      {OFFICE_GROUPS[g].label}
                    </label>
                  ))}
                </div>
              </OfficeField>
              <div className="office-checkboxes">
                <label>
                  <input
                    type="checkbox"
                    checked={data.requires_approval}
                    onChange={(e) =>
                      patch({ requires_approval: e.target.checked })
                    }
                  />
                  Yêu cầu duyệt nội dung
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={data.requires_number}
                    onChange={(e) =>
                      patch({ requires_number: e.target.checked })
                    }
                  />
                  Cấp số chính thức
                </label>
              </div>
              <p className="office-helper">
                Văn bản đến giữ số bên gửi, đi qua đăng ký tiếp nhận thay cho
                tuyến duyệt nội dung.
              </p>
              <OfficeField label="Quy tắc số">
                <select
                  aria-label="Quy tắc số"
                  value={data.numbering_rule_id || ""}
                  required={data.requires_number}
                  onChange={(e) =>
                    patch({ numbering_rule_id: e.target.value || null })
                  }
                >
                  <option value="">Chọn quy tắc</option>
                  {catalog.rules
                    .filter(
                      (r) => r.is_active || r.id === data.numbering_rule_id,
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </OfficeField>
              <OfficeField label="Tuyến duyệt mặc định">
                <select
                  aria-label="Tuyến duyệt mặc định"
                  value={data.workflow_id || ""}
                  onChange={(e) =>
                    patch({ workflow_id: e.target.value || null })
                  }
                >
                  <option value="">Người soạn chọn khi tạo</option>
                  {catalog.workflows
                    .filter((w) => w.is_active || w.id === data.workflow_id)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
              </OfficeField>
              <OfficeField label="Kho lưu trữ mặc định">
                <select
                  aria-label="Kho lưu trữ mặc định"
                  value={data.archive_folder_id || ""}
                  onChange={(e) =>
                    patch({ archive_folder_id: e.target.value || null })
                  }
                >
                  <option value="">Chọn khi tạo</option>
                  {catalog.folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </OfficeField>
            </>
          )}
          {kind === "workflow" && (
            <>
              <div className="office-form-grid">
                <OfficeField label="Áp dụng cho phòng ban">
                  <OfficePicker
                    service={service}
                    kind="department"
                    label="Tất cả phòng ban"
                    value={data.department_id}
                    onChange={(o) => patch({ department_id: o?.id || null })}
                  />
                </OfficeField>
                <OfficeField label="Áp dụng cho dự án">
                  <OfficePicker
                    service={service}
                    kind="project"
                    label="Tất cả dự án"
                    value={data.project_id}
                    onChange={(o) => patch({ project_id: o?.id || null })}
                  />
                </OfficeField>
              </div>
              <h3>Các bước duyệt</h3>
              <p className="office-helper">
                Mỗi bước có một người duyệt. Người trình không được tự duyệt văn
                bản của mình.
              </p>
              <div className="office-workflow-editor">
                {data.steps.map((s: any, i: number) => (
                  <div key={i}>
                    <span className="office-step-number">{i + 1}</span>
                    <div>
                      <input
                        aria-label={`Tên bước ${i + 1}`}
                        required
                        placeholder="Ví dụ: Trưởng phòng"
                        value={s.label}
                        onChange={(e) => step(i, { label: e.target.value })}
                      />
                      <OfficePicker
                        service={service}
                        kind="user"
                        label={`Người duyệt bước ${i + 1}`}
                        value={s.userId}
                        onChange={(o) => step(i, { userId: o?.id || "" })}
                      />
                    </div>
                    <div className="office-step-controls">
                      <button
                        type="button"
                        aria-label="Đưa bước lên"
                        disabled={i === 0}
                        onClick={() => {
                          const steps = [...data.steps];
                          [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                          patch({ steps });
                        }}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label="Đưa bước xuống"
                        disabled={i === data.steps.length - 1}
                        onClick={() => {
                          const steps = [...data.steps];
                          [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
                          patch({ steps });
                        }}
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Xóa bước ${i + 1}`}
                        disabled={data.steps.length === 1}
                        onClick={() =>
                          patch({
                            steps: data.steps.filter(
                              (_: any, n: number) => n !== i,
                            ),
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="office-secondary"
                disabled={data.steps.length >= 20}
                onClick={() =>
                  patch({
                    steps: [...data.steps, { userId: "", label: "Phê duyệt" }],
                  })
                }
              >
                <Plus size={15} />
                Thêm bước duyệt
              </button>
            </>
          )}
          {kind === "rule" && (
            <OfficeField
              label="Định dạng số"
              required
              hint="Giữ đủ {sequence}, {year}, {code}. Ví dụ: 234/2026/TB-TT."
            >
              <input
                aria-label="Định dạng số"
                required
                value={data.format}
                onChange={(e) => patch({ format: e.target.value })}
              />
            </OfficeField>
          )}
          {kind === "folder" && (
            <OfficeField label="Thư mục cha">
              <select
                aria-label="Thư mục cha"
                value={data.parent_id || ""}
                onChange={(e) => patch({ parent_id: e.target.value || null })}
              >
                <option value="">Thư mục gốc</option>
                {catalog.folders
                  .filter((f) => f.id !== current?.id)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </OfficeField>
          )}
          <label className="office-checkbox-label">
            <input
              type="checkbox"
              checked={data.is_active}
              onChange={(e) => patch({ is_active: e.target.checked })}
            />
            Đang sử dụng
          </label>
        </fieldset>
        {error && <OfficeError error={error} />}
        <footer>
          <button
            type="button"
            className="office-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Hủy
          </button>
          <button
            type="submit"
            className="office-primary"
            disabled={
              busy ||
              (kind === "type" && !data.groups.length) ||
              (kind === "workflow" && data.steps.some((s: any) => !s.userId))
            }
          >
            {busy ? "Đang lưu…" : "Lưu cấu hình"}
          </button>
        </footer>
      </form>
    </OfficeModal>
  );
}
