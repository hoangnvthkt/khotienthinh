import React, { useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ChevronDown,
  FileText,
  Lock,
  Paperclip,
  Save,
  Send,
  Trash2,
  UploadCloud,
  Camera,
  X,
} from "lucide-react";
import { OfficeRichTextEditor } from "./OfficeRichText";
import { OfficeAssistant } from "./OfficeAssistant";
import { OfficeTemplateChooser } from "./OfficeLibrary";
import type { OfficeService } from "../../lib/office/officeService";
import type {
  AudienceKind,
  OfficeAttachment,
  OfficeCatalog,
  OfficeCommandInput,
  OfficeCommandResult,
  OfficeDetail,
  OfficeDraft,
  OfficeGroup,
  OfficeNumberSuggestion,
  RecipientSpec,
} from "../../lib/office/officeTypes";
import {
  CONFIDENTIALITY,
  editableDraft,
  officeFileMime,
  newOfficeDraft,
  officeNumberParts,
  OFFICE_GROUPS,
  URGENCY,
} from "../../lib/office/officePresentation";
import {
  OfficeEmpty,
  OfficeError,
  OfficeField,
  OfficeLoading,
  OfficePicker,
  useOfficeQuery,
} from "./OfficeShared";
import { officeFolderPath } from "./OfficeDetail";
export function useOfficeCommand(service: OfficeService) {
  const attempts = useRef(new Map<string, string>());
  return async (input: Omit<OfficeCommandInput, "key">) => {
    const fingerprint = JSON.stringify(input);
    const key = attempts.current.get(fingerprint) || crypto.randomUUID();
    attempts.current.set(fingerprint, key);
    const result = await service.command({ ...input, key });
    attempts.current.delete(fingerprint);
    return result;
  };
}
const audienceLabels: Record<AudienceKind, string> = {
  company: "Toàn công ty",
  user: "Cá nhân",
  department: "Phòng ban",
  factory: "Nhà máy / đơn vị",
  project: "Dự án",
  site: "Công trường",
  role: "Vai trò nghiệp vụ",
};
export function OfficeAudience({
  service,
  value,
  onChange,
  disabled,
}: {
  service: OfficeService;
  value: RecipientSpec[];
  onChange: (specs: RecipientSpec[]) => void;
  disabled?: boolean;
}) {
  const [kind, setKind] = useState<AudienceKind>("user");
  const preview = useOfficeQuery(
    () => service.audience(value),
    [service, JSON.stringify(value)],
  );
  const add = (item: RecipientSpec) => {
    if (!value.some((s) => s.type === item.type && s.id === item.id))
      onChange([...value, item]);
  };
  return (
    <div className="office-audience">
      <div className="office-chips">
        {value.map((s, i) => (
          <span key={`${s.type}:${s.id}`}>
            <span>{s.label || audienceLabels[s.type]}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Bỏ ${s.label || audienceLabels[s.type]}`}
              onClick={() => onChange(value.filter((_, index) => index !== i))}
            >
              <X size={13} />
            </button>
          </span>
        ))}
      </div>
      <div className="office-audience-add">
        <select
          aria-label="Nhóm người nhận"
          value={kind}
          disabled={disabled}
          onChange={(e) => setKind(e.target.value as AudienceKind)}
        >
          {Object.entries(audienceLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {kind === "company" ? (
          <button
            className="office-secondary"
            type="button"
            disabled={disabled}
            onClick={() => add({ type: "company", label: "Toàn công ty" })}
          >
            Thêm toàn công ty
          </button>
        ) : (
          <OfficePicker
            key={kind}
            service={service}
            kind={kind}
            label={`Tìm ${audienceLabels[kind].toLowerCase()}`}
            onChange={(o) => {
              if (o) add({ type: kind, id: o.id, label: o.name });
            }}
            disabled={disabled}
          />
        )}
      </div>
      {value.length > 0 &&
        (preview.error ? (
          <OfficeError error={preview.error} retry={preview.refresh} />
        ) : (
          <p className="office-helper">
            {preview.loading
              ? "Đang kiểm tra người nhận…"
              : `${preview.data?.total ?? "—"} người nhận hiện tại. Danh sách được chốt khi phát hành.`}
            {!!preview.data?.withoutAccess && (
              <strong className="office-text-danger">
                {" "}
                {preview.data.withoutAccess} người chưa có quyền truy cập
                Office.
              </strong>
            )}
          </p>
        ))}
    </div>
  );
}
interface PendingFile {
  file: File;
  reservation?: OfficeAttachment;
  uploaded?: boolean;
  done?: boolean;
}
export function OfficeDraftPage({
  service,
  catalog,
}: {
  service: OfficeService;
  catalog: OfficeCatalog;
}) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const group = params.get("group") as OfficeGroup;
  const existing = useOfficeQuery(
    () => (id ? service.detail(id) : Promise.resolve(null)),
    [service, id],
  );
  if (id && existing.loading) return <OfficeLoading />;
  if (existing.error)
    return <OfficeError error={existing.error} retry={existing.refresh} />;
  if ((id && !existing.data?.capabilities.edit) || (!id && !catalog.canCreate))
    return <OfficeError error={{ message: "OFFICE_DENIED" }} />;
  return (
    <OfficeDraftForm
      key={id || "new"}
      service={service}
      catalog={catalog}
      existing={existing.data}
      initialGroup={group in OFFICE_GROUPS ? group : undefined}
      initialTemplateId={params.get("template") || undefined}
    />
  );
}
function OfficeDraftForm({
  service,
  catalog,
  existing,
  initialGroup,
  initialTemplateId,
}: {
  service: OfficeService;
  catalog: OfficeCatalog;
  existing: OfficeDetail | null;
  initialGroup?: OfficeGroup;
  initialTemplateId?: string;
}) {
  const navigate = useNavigate();
  const [templateOpen, setTemplateOpen] = useState(!!initialTemplateId);
  const command = useOfficeCommand(service);
  const [draft, setDraft] = useState<OfficeDraft>(() =>
    existing ? editableDraft(existing.document) : newOfficeDraft(initialGroup),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [progress, setProgress] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [attachments, setAttachments] = useState(existing?.attachments || []);
  const saved = useRef<Pick<OfficeCommandResult, "id" | "version"> | null>(
    existing
      ? { id: existing.document.id, version: existing.document.version }
      : null,
  );
  const persistedDraft = useRef(
    existing ? JSON.stringify(editableDraft(existing.document)) : null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const patch = (value: Partial<OfficeDraft>) => {
    setDraft((d) => ({ ...d, ...value }));
    setDirty(true);
  };
  const type = catalog.types.find((t) => t.id === draft.document_type_id);
  const workflows = catalog.workflows.filter(
    (w) =>
      w.is_active &&
      (!w.department_id || w.department_id === draft.issuer_department_id) &&
      (!w.project_id || w.project_id === draft.project_id),
  );
  const chosenWorkflow = workflows.find((w) => w.id === draft.workflow_id);
  const addFiles = (incoming: FileList | File[]) => {
    const selected = Array.from(incoming);
    if (selected.some((f) => f.size > 50 * 1024 * 1024 || f.size === 0)) {
      setError({ message: "OFFICE_UPLOAD_INCOMPLETE" });
      return;
    }
    setFiles((old) => [...old, ...selected.map((file) => ({ file }))]);
    setDirty(true);
  };
  async function uploadInlineImage(file: File): Promise<OfficeAttachment> {
    if (!draft.title.trim() || !draft.document_type_id)
      throw new Error("Điền tiêu đề và loại văn bản trước khi tải ảnh.");
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(
        officeFileMime(file),
      ) ||
      file.size === 0 ||
      file.size > 50 * 1024 * 1024
    )
      throw new Error("OFFICE_FILE_TYPE");
    setBusy(true);
    try {
      if (!saved.current || persistedDraft.current !== JSON.stringify(draft)) {
        saved.current = await command({
          command: saved.current ? "save" : "create",
          documentId: saved.current?.id,
          expectedVersion: saved.current?.version,
          payload: draft,
        });
        persistedDraft.current = JSON.stringify(draft);
      }
      const reserved = await command({
        command: "attachment_begin",
        documentId: saved.current.id,
        expectedVersion: saved.current.version,
        payload: {
          fileName: file.name,
          mimeType: officeFileMime(file),
          size: file.size,
        },
      });
      saved.current = reserved;
      const ref = reserved.attachment!;
      setAttachments((old) => [...old, ref]);
      await service.upload(ref, file);
      saved.current = await command({
        command: "attachment_finish",
        documentId: saved.current.id,
        expectedVersion: saved.current.version,
        payload: { attachmentId: ref.id },
      });
      const ready = { ...ref, status: "READY" as const };
      setAttachments((old) => old.map((f) => (f.id === ref.id ? ready : f)));
      return ready;
    } finally {
      setBusy(false);
    }
  }
  async function save(submit: boolean) {
    if (!formRef.current?.reportValidity()) return;
    setBusy(true);
    setError(null);
    setProgress("Đang lưu bản nháp…");
    try {
      if (!saved.current || persistedDraft.current !== JSON.stringify(draft)) {
        const r = await command({
          command: saved.current ? "save" : "create",
          documentId: saved.current?.id,
          expectedVersion: saved.current?.version,
          payload: draft,
        });
        saved.current = r;
        persistedDraft.current = JSON.stringify(draft);
      }
      for (const item of files) {
        if (item.done) continue;
        setProgress(`Đang tải ${item.file.name}…`);
        if (!item.reservation) {
          const reserved = await command({
            command: "attachment_begin",
            documentId: saved.current.id,
            expectedVersion: saved.current.version,
            payload: {
              fileName: item.file.name,
              mimeType: officeFileMime(item.file),
              size: item.file.size,
            },
          });
          saved.current = reserved;
          item.reservation = reserved.attachment;
          if (!item.reservation) throw new Error("OFFICE_UPLOAD_INCOMPLETE");
        }
        if (!item.uploaded) {
          await service.upload(item.reservation, item.file);
          item.uploaded = true;
        }
        const done = await command({
          command: "attachment_finish",
          documentId: saved.current.id,
          expectedVersion: saved.current.version,
          payload: { attachmentId: item.reservation.id },
        });
        saved.current = done;
        item.done = true;
      }
      if (submit) {
        setProgress("Đang gửi văn bản…");
        saved.current = await command({
          command: "submit",
          documentId: saved.current.id,
          expectedVersion: saved.current.version,
        });
      }
      setDirty(false);
      navigate(`/office/documents/${saved.current.id}`, { replace: true });
    } catch (e) {
      setError(e);
      setFiles([...files]);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  async function removeAttachment(attachment: OfficeAttachment) {
    if (!saved.current) return;
    setBusy(true);
    setError(null);
    try {
      saved.current = await command({
        command: "attachment_remove",
        documentId: saved.current.id,
        expectedVersion: saved.current.version,
        payload: { attachmentId: attachment.id },
      });
      setAttachments((old) => old.filter((f) => f.id !== attachment.id));
      if (
        draft.content.content.some(
          (block) =>
            block.type === "image" && block.attachmentId === attachment.id,
        )
      ) {
        patch({
          content: {
            ...draft.content,
            content: draft.content.content.filter(
              (block) =>
                block.type !== "image" || block.attachmentId !== attachment.id,
            ),
          },
        });
      }
      await service.removeFile(attachment);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const roots = catalog.folders.filter((f) => f.is_active && !f.parent_id);
  const chosenFolder = catalog.folders.find(
    (f) => f.id === draft.archive_folder_id,
  );
  const rootId = chosenFolder?.parent_id || chosenFolder?.id || roots[0]?.id || "";
  const subFolders = catalog.folders.filter(
    (f) => f.is_active && f.parent_id === rootId,
  );
  const rule = catalog.rules.find((r) => r.id === type?.numbering_rule_id);
  const numbered =
    !!type?.requires_number && draft.document_group !== "INCOMING";
  const typeOptions = catalog.types.filter(
    (t) => t.is_active && t.groups.includes(draft.document_group),
  );
  const [numberTaken, setNumberTaken] = useState(false);
  return (
    <div className="office-content office-draft">
      <form
        ref={formRef}
        className="office-panel office-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <header className="office-compose-head">
          <h1>{existing ? "Chỉnh sửa văn bản" : "Tạo văn bản"}</h1>
          <span className="office-compose-badge">
            {type?.name || OFFICE_GROUPS[draft.document_group].label}
          </span>
        </header>
        <fieldset disabled={busy}>
          <OfficeField label="Tiêu đề văn bản" required>
            <input
              autoFocus
              aria-label="Tiêu đề văn bản"
              required
              maxLength={500}
              placeholder="Gõ tên tiêu đề của văn bản"
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </OfficeField>
          <div className="office-form-grid is-three">
            <OfficeField label="Loại văn bản" required>
              <select
                aria-label="Loại văn bản"
                required
                value={draft.document_type_id}
                onChange={(e) => {
                  const t = catalog.types.find((x) => x.id === e.target.value);
                  patch({
                    document_type_id: e.target.value,
                    workflow_id: t?.workflow_id || null,
                    archive_folder_id:
                      t?.archive_folder_id || draft.archive_folder_id,
                    proposed_sequence: null,
                  });
                }}
              >
                <option value="">-- Chọn loại văn bản --</option>
                {typeOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.code})
                  </option>
                ))}
              </select>
            </OfficeField>
            <OfficeField label="Nghiệp vụ" required>
              <select
                aria-label="Nghiệp vụ"
                disabled={!!existing}
                value={draft.document_group}
                onChange={(e) => {
                  const group = e.target.value as OfficeGroup;
                  patch({
                    document_group: group,
                    received_date:
                      group === "INCOMING"
                        ? draft.received_date || draft.document_date
                        : null,
                    ...(type && !type.groups.includes(group)
                      ? { document_type_id: "", workflow_id: null, proposed_sequence: null }
                      : {}),
                  });
                }}
              >
                {(Object.keys(OFFICE_GROUPS) as OfficeGroup[]).map((g) => (
                  <option key={g} value={g}>
                    {OFFICE_GROUPS[g].label}
                  </option>
                ))}
              </select>
            </OfficeField>
            <OfficeField label="Thư mục">
              <select
                aria-label="Thư mục"
                value={chosenFolder?.parent_id ? chosenFolder.id : ""}
                onChange={(e) =>
                  patch({ archive_folder_id: e.target.value || rootId || null })
                }
              >
                <option value="">-- Vui lòng chọn --</option>
                {subFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </OfficeField>
          </div>
          <div className="office-form-grid is-three">
            <OfficeField label="Kho lưu trữ" required>
              {roots.length > 1 ? (
                <select
                  aria-label="Kho lưu trữ"
                  required
                  value={rootId}
                  onChange={(e) =>
                    patch({ archive_folder_id: e.target.value || null })
                  }
                >
                  {roots.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="office-locked" aria-label="Kho lưu trữ">
                  <Lock size={13} />
                  {officeFolderPath(catalog, draft.archive_folder_id || rootId)}
                </span>
              )}
            </OfficeField>
            <OfficeField label="Sổ văn bản">
              <span className="office-locked" aria-label="Sổ văn bản">
                <Lock size={13} />
                {draft.document_group === "INCOMING"
                  ? "Giữ số của đơn vị gửi"
                  : rule?.name || (type ? "Không cấp số" : "Theo loại văn bản")}
              </span>
            </OfficeField>
            <OfficeField label="Ngày văn bản" required>
              <input
                aria-label="Ngày văn bản"
                type="date"
                required
                value={draft.document_date}
                onChange={(e) => patch({ document_date: e.target.value })}
              />
            </OfficeField>
          </div>
          {numbered && type && (
            <OfficeNumberField
              service={service}
              typeId={type.id}
              typeCode={type.code}
              ruleFormat={rule?.format}
              documentId={existing?.document.id}
              value={draft.proposed_sequence ?? null}
              onChange={(proposed_sequence) => patch({ proposed_sequence })}
              onTakenChange={setNumberTaken}
            />
          )}
          {draft.document_group === "INCOMING" && (
            <div className="office-incoming-fields">
              <h3>Thông tin tiếp nhận</h3>
              <div className="office-form-grid">
                <OfficeField label="Đơn vị gửi" required>
                  <input
                    aria-label="Đơn vị gửi"
                    value={draft.source_organization || ""}
                    onChange={(e) =>
                      patch({ source_organization: e.target.value })
                    }
                  />
                </OfficeField>
                <OfficeField label="Số văn bản bên gửi">
                  <input
                    aria-label="Số văn bản bên gửi"
                    value={draft.source_document_number || ""}
                    onChange={(e) =>
                      patch({ source_document_number: e.target.value })
                    }
                  />
                </OfficeField>
                <OfficeField label="Ngày nhận" required>
                  <input
                    aria-label="Ngày nhận"
                    type="date"
                    value={draft.received_date || ""}
                    onChange={(e) =>
                      patch({ received_date: e.target.value || null })
                    }
                  />
                </OfficeField>
                <OfficeField label="Người gửi">
                  <input
                    aria-label="Người gửi"
                    value={draft.source_sender || ""}
                    onChange={(e) => patch({ source_sender: e.target.value })}
                  />
                </OfficeField>
              </div>
            </div>
          )}
          {draft.document_group === "OUTGOING" && (
            <OfficeField label="Đơn vị / đối tác nhận văn bản" required>
              <input
                aria-label="Đơn vị nhận văn bản đi"
                placeholder="Chủ đầu tư, khách hàng, cơ quan…"
                value={draft.external_recipient || ""}
                onChange={(e) => patch({ external_recipient: e.target.value })}
              />
            </OfficeField>
          )}
          <OfficeField label="Gửi từ" hint="Đơn vị ban hành — văn bản được gửi dưới tư cách đơn vị này.">
            <OfficePicker
              service={service}
              kind="department"
              value={draft.issuer_department_id}
              onChange={(o) =>
                patch({ issuer_department_id: o?.id || null, workflow_id: null })
              }
              label="Chọn đơn vị ban hành"
            />
          </OfficeField>
          <OfficeField label="Người theo dõi">
            <OfficePicker
              service={service}
              kind="user"
              label="Thêm người theo dõi"
              onChange={(o) => {
                if (o && !draft.watcher_ids.includes(o.id))
                  patch({ watcher_ids: [...draft.watcher_ids, o.id] });
              }}
            />
            {draft.watcher_ids.map((id) => (
              <div className="office-inline-picker" key={id}>
                <OfficePicker
                  service={service}
                  kind="user"
                  label="Người theo dõi đã chọn"
                  value={id}
                  onChange={(o) =>
                    patch({
                      watcher_ids: draft.watcher_ids
                        .map((x) => (x === id ? o?.id || "" : x))
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            ))}
          </OfficeField>
          <OfficeField label="Người nhận" required>
            <OfficeAudience
              service={service}
              value={draft.recipient_specs}
              onChange={(recipient_specs) => patch({ recipient_specs })}
              disabled={busy}
            />
          </OfficeField>
          {draft.document_group !== "INCOMING" && type?.requires_approval && (
            <OfficeField label="Tuyến duyệt" required>
              <select
                aria-label="Tuyến duyệt"
                value={draft.workflow_id || ""}
                onChange={(e) => patch({ workflow_id: e.target.value || null })}
              >
                <option value="">Chọn tuyến duyệt</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              {!workflows.length && (
                <p className="office-helper">
                  Chưa có tuyến duyệt phù hợp. Bạn có thể lưu nháp
                  {catalog.canConfigure && (
                    <>
                      {" "}
                      và <Link to="/office/settings">cấu hình tuyến duyệt</Link>
                    </>
                  )}
                  .
                </p>
              )}
              {chosenWorkflow && (
                <ol className="office-approval-preview">
                  {chosenWorkflow.steps.map((s, i) => (
                    <li key={i}>
                      <span>{i + 1}</span>
                      <div>
                        <strong>{s.label}</strong>
                        <small>
                          {chosenWorkflow.stepNames?.[s.userId] ||
                            "Người duyệt được cấu hình"}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </OfficeField>
          )}
          <div className="office-inline-actions office-composer-tools">
            <button
              type="button"
              className="office-secondary"
              onClick={() => setTemplateOpen(true)}
            >
              <FileText size={16} />
              Chọn mẫu văn bản
            </button>
            <OfficeAssistant
              service={service}
              documentId={saved.current?.id}
              attachments={attachments}
              editable
              onApply={patch}
            />
          </div>
          <OfficeField label="Nội dung">
            <OfficeRichTextEditor
              images={attachments.filter(
                (f) => f.mime_type.startsWith("image/") && f.status === "READY",
              )}
              onImageUpload={uploadInlineImage}
              label="Nội dung văn bản"
              value={draft.content}
              onChange={(content) => patch({ content })}
              placeholder="Nhập nội dung văn bản…"
              disabled={busy}
            />
          </OfficeField>
          <OfficeField
            label={
              draft.document_group === "INCOMING"
                ? "Tệp gốc & đính kèm"
                : "Tệp đính kèm"
            }
            required={draft.document_group === "INCOMING"}
          >
            <div
              className="office-upload"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy) addFiles(e.dataTransfer.files);
              }}
            >
              <UploadCloud size={25} />
              <p>
                Kéo tệp vào đây hoặc{" "}
                <button type="button" onClick={() => fileInput.current?.click()}>
                  chọn tệp
                </button>
              </p>
              <small>PDF, Word, Excel, ảnh · Tối đa 50 MB/tệp</small>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.txt,.csv"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <label className="office-secondary office-scan-button">
              <Camera size={17} />
              Chụp bản giấy
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="office-file-list">
              {attachments.map((f) => (
                <div key={f.id}>
                  <Paperclip size={16} />
                  <span>{f.file_name}</span>
                  <small>{f.status === "PENDING" ? "Chưa tải xong" : ""}</small>
                  <button
                    type="button"
                    aria-label={`Bỏ ${f.file_name}`}
                    onClick={() => void removeAttachment(f)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {files.map((item, i) => (
                <div key={i}>
                  <Paperclip size={16} />
                  <span>{item.file.name}</span>
                  <small>
                    {item.done
                      ? "Đã tải"
                      : `${(item.file.size / 1024 / 1024).toFixed(1)} MB`}
                  </small>
                  {!item.reservation && (
                    <button
                      type="button"
                      aria-label={`Bỏ ${item.file.name}`}
                      onClick={() =>
                        setFiles((old) => old.filter((_, n) => i !== n))
                      }
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </OfficeField>
          <details className="office-compose-more">
            <summary>
              Thông tin thêm
              <small>Người ký, dự án, công trường, trích yếu, hiệu lực, mức độ khẩn, bảo mật</small>
              <ChevronDown size={17} />
            </summary>
            <div className="office-form-grid">
              <OfficeField label="Người ký">
                <OfficePicker
                  service={service}
                  kind="user"
                  value={draft.signer_user_id}
                  onChange={(o) => patch({ signer_user_id: o?.id || null })}
                  label="Chọn người ký"
                />
              </OfficeField>
              <OfficeField label="Chức danh người ký">
                <input
                  aria-label="Chức danh người ký"
                  placeholder="Ví dụ: Tổng Giám đốc"
                  value={draft.signer_position || ""}
                  onChange={(e) => patch({ signer_position: e.target.value })}
                />
              </OfficeField>
              <OfficeField label="Dự án liên quan">
                <OfficePicker
                  service={service}
                  kind="project"
                  value={draft.project_id}
                  onChange={(o) =>
                    patch({
                      project_id: o?.id || null,
                      construction_site_id: null,
                      workflow_id: null,
                    })
                  }
                  label="Chọn dự án"
                />
              </OfficeField>
              <OfficeField label="Công trường">
                <OfficePicker
                  service={service}
                  kind="site"
                  value={draft.construction_site_id}
                  onChange={(o) => patch({ construction_site_id: o?.id || null })}
                  label="Chọn công trường"
                />
              </OfficeField>
              <OfficeField label="Ngày hiệu lực" hint="Để trống nếu chưa xác định ngày bắt đầu có hiệu lực.">
                <input
                  type="date"
                  aria-label="Ngày hiệu lực"
                  value={draft.effective_on || ""}
                  max={draft.expires_on || undefined}
                  onChange={(e) => patch({ effective_on: e.target.value || null })}
                />
              </OfficeField>
              <OfficeField label="Hiệu lực đến ngày" hint="Để trống nếu văn bản không có ngày hết hiệu lực.">
                <input
                  type="date"
                  aria-label="Hiệu lực đến ngày"
                  min={draft.effective_on || draft.document_date}
                  value={draft.expires_on || ""}
                  onChange={(e) => patch({ expires_on: e.target.value || null })}
                />
              </OfficeField>
              <OfficeField label="Mức độ khẩn">
                <select
                  aria-label="Mức độ khẩn"
                  value={draft.urgency}
                  onChange={(e) =>
                    patch({ urgency: e.target.value as OfficeDraft["urgency"] })
                  }
                >
                  {Object.entries(URGENCY).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </OfficeField>
              <OfficeField label="Bảo mật">
                <select
                  aria-label="Bảo mật"
                  value={draft.confidentiality}
                  onChange={(e) =>
                    patch({
                      confidentiality: e.target
                        .value as OfficeDraft["confidentiality"],
                    })
                  }
                >
                  {Object.entries(CONFIDENTIALITY).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </OfficeField>
            </div>
            <OfficeField label="Trích yếu">
              <textarea
                aria-label="Trích yếu"
                maxLength={2000}
                value={draft.summary}
                onChange={(e) => patch({ summary: e.target.value })}
              />
            </OfficeField>
            <label className="office-check-label">
              <input
                type="checkbox"
                checked={draft.require_acknowledgement}
                onChange={(e) =>
                  patch({ require_acknowledgement: e.target.checked })
                }
              />
              Yêu cầu người nhận xác nhận đã đọc và hiểu
            </label>
          </details>
        </fieldset>
        {error && <OfficeError error={error} />}
        {progress && (
          <p className="office-save-status" role="status">
            {progress}
          </p>
        )}
        <footer className="office-form-footer">
          <span>
            {draft.document_group === "INCOMING"
              ? "Số bên gửi được giữ nguyên. Văn bản đến có trạng thái xử lý riêng."
              : numbered
                ? "Số văn bản chỉ chính thức khi người có quyền bấm Cấp số sau khi duyệt."
                : saved.current
                  ? "Bản nháp đã được lưu trên hệ thống."
                  : "Bản nháp chỉ hiển thị với người được cấp quyền."}
          </span>
          <div>
            <button className="office-secondary" disabled={busy} type="submit">
              <Save size={16} />
              Lưu nháp
            </button>
            <button
              className="office-primary"
              disabled={
                busy ||
                !draft.title.trim() ||
                !draft.document_type_id ||
                (numbered && numberTaken)
              }
              type="button"
              onClick={() => void save(true)}
            >
              <Send size={16} />
              {draft.document_group === "INCOMING"
                ? "Lưu & đăng ký tiếp nhận"
                : "Lưu & gửi duyệt"}
            </button>
          </div>
        </footer>
      </form>
      {templateOpen && (
        <OfficeTemplateChooser
          service={service}
          draft={draft}
          initialId={initialTemplateId}
          onClose={() => setTemplateOpen(false)}
          onApply={(value) => {
            patch(value);
            setTemplateOpen(false);
          }}
        />
      )}
    </div>
  );
}
function OfficeNumberField({
  service,
  typeId,
  typeCode,
  ruleFormat,
  documentId,
  value,
  onChange,
  onTakenChange,
}: {
  service: OfficeService;
  typeId: string;
  typeCode: string;
  ruleFormat?: string;
  documentId?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  onTakenChange: (taken: boolean) => void;
}) {
  const [suggestion, setSuggestion] = useState<OfficeNumberSuggestion | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        service
          .numberSuggestion(typeId, value, documentId)
          .then((s) => {
            if (cancelled) return;
            setSuggestion(s);
            setFailed(false);
            onTakenChange(!!s.taken);
          })
          .catch(() => {
            if (cancelled) return;
            setFailed(true);
            onTakenChange(false);
          });
      },
      value ? 300 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // onTakenChange là setState ổn định của form cha
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, typeId, value, documentId]);
  const year = suggestion?.year ?? new Date().getFullYear();
  const parts = officeNumberParts(
    suggestion?.format || ruleFormat || "{sequence}",
    typeCode,
    year,
  );
  const next = suggestion?.next;
  const full = (n: number) => `${parts.prefix}${n}${parts.suffix}`;
  return (
    <div className="office-field">
      <span className="office-field-label">
        Mã văn bản<span aria-hidden="true"> *</span>
        <small className="office-number-aside">Số chính thức khi Cấp số</small>
      </span>
      <div className="office-number">
        {parts.prefix && <span className="office-number-seg">{parts.prefix}</span>}
        <input
          aria-label="Số văn bản"
          inputMode="numeric"
          maxLength={6}
          placeholder={next ? String(next) : "…"}
          value={value ?? ""}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            onChange(digits ? Math.min(999999, Number(digits)) || null : null);
          }}
        />
        <span className="office-number-seg">{parts.suffix}</span>
      </div>
      {failed ? (
        <small>
          Chưa lấy được số gợi ý. Bạn vẫn lưu được; nếu để trống, hệ thống cấp
          số tiếp theo trong sổ khi Cấp số.
        </small>
      ) : suggestion?.taken && value ? (
        <p className="office-number-msg is-taken" role="alert">
          Số <strong>{suggestion.takenNumber || full(value)}</strong> đã dùng
          {suggestion.takenTitle ? ` cho "${suggestion.takenTitle}"` : " cho văn bản khác"}
          .{next ? <> Số trống tiếp theo là <strong>{next}</strong>.</> : null}
          {next && (
            <button type="button" onClick={() => onChange(next)}>
              Dùng số {next}
            </button>
          )}
        </p>
      ) : value ? (
        <small>
          Mã dự kiến <strong>{full(value)}</strong>.
        </small>
      ) : next ? (
        <small>
          Để trống sẽ cấp số tiếp theo trong sổ khi Cấp số (hiện là{" "}
          <strong>{full(next)}</strong>).
        </small>
      ) : (
        <small>Đang lấy số gợi ý…</small>
      )}
    </div>
  );
}
