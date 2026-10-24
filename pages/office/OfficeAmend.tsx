import React, { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  ChevronDown,
  Paperclip,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { OfficeRichTextEditor } from "./OfficeRichText";
import { useOfficeCommand } from "./OfficeDraft";
import { officeFolderPath } from "./OfficeDetail";
import type { OfficeService } from "../../lib/office/officeService";
import type {
  OfficeAttachment,
  OfficeCatalog,
  OfficeDetail,
} from "../../lib/office/officeTypes";
import {
  CONFIDENTIALITY,
  displayDate,
  officeFileMime,
  URGENCY,
} from "../../lib/office/officePresentation";
import {
  OfficeError,
  OfficeField,
  OfficeLoading,
  OfficeModal,
  OfficePicker,
  useOfficeQuery,
} from "./OfficeShared";

/** Các trường Quản trị Office được sửa sau khi văn bản đã ban hành. */
interface AmendFields {
  title: string;
  summary: string;
  content: OfficeDetail["document"]["content"];
  document_date: string;
  effective_on: string | null;
  expires_on: string | null;
  signer_user_id: string | null;
  signer_position: string | null;
  urgency: OfficeDetail["document"]["urgency"];
  confidentiality: OfficeDetail["document"]["confidentiality"];
  archive_folder_id: string | null;
  require_acknowledgement: boolean;
}
const FIELD_LABELS: Record<keyof AmendFields, string> = {
  title: "Tiêu đề",
  summary: "Tóm tắt",
  content: "Nội dung",
  document_date: "Ngày văn bản",
  effective_on: "Ngày hiệu lực",
  expires_on: "Ngày hết hiệu lực",
  signer_user_id: "Người ký",
  signer_position: "Chức vụ người ký",
  urgency: "Mức độ khẩn",
  confidentiality: "Bảo mật",
  archive_folder_id: "Thư mục lưu trữ",
  require_acknowledgement: "Yêu cầu xác nhận đã đọc",
};
function pickFields(document: OfficeDetail["document"]): AmendFields {
  return {
    title: document.title,
    summary: document.summary,
    content: document.content,
    document_date: document.document_date,
    effective_on: document.effective_on ?? null,
    expires_on: document.expires_on,
    signer_user_id: document.signer_user_id,
    signer_position: document.signer_position,
    urgency: document.urgency,
    confidentiality: document.confidentiality,
    archive_folder_id: document.archive_folder_id,
    require_acknowledgement: document.require_acknowledgement,
  };
}
export function changedAmendFields(before: AmendFields, after: AmendFields) {
  return (Object.keys(FIELD_LABELS) as (keyof AmendFields)[]).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}
export function OfficeAmendPage({
  service,
  catalog,
}: {
  service: OfficeService;
  catalog: OfficeCatalog;
}) {
  const { id } = useParams();
  const detail = useOfficeQuery(() => service.detail(id!), [service, id]);
  return (
    <div className="office-content office-amend">
      <Link className="office-back" to={`/office/documents/${id}`}>
        <ArrowLeft size={16} />
        Quay lại văn bản
      </Link>
      {detail.loading ? (
        <OfficeLoading />
      ) : detail.error ? (
        <OfficeError error={detail.error} retry={detail.refresh} />
      ) : !detail.data?.capabilities.amend ? (
        <div className="office-error" role="alert">
          <AlertTriangle size={19} />
          <p>
            Chỉ Quản trị Office sửa được văn bản đã ban hành. Nếu cần chỉnh nội
            dung, hãy liên hệ Quản trị Office hoặc thu hồi và ban hành bản thay
            thế.
          </p>
        </div>
      ) : (
        <OfficeAmendForm
          key={id}
          service={service}
          catalog={catalog}
          detail={detail.data}
        />
      )}
    </div>
  );
}
export function OfficeAmendForm({
  service,
  catalog,
  detail,
}: {
  service: OfficeService;
  catalog: OfficeCatalog;
  detail: OfficeDetail;
}) {
  const d = detail.document;
  const navigate = useNavigate();
  const command = useOfficeCommand(service);
  const original = useMemo(() => pickFields(d), [d]);
  const baseVersion = useRef(d.version);
  const version = useRef(d.version);
  const [fields, setFields] = useState<AmendFields>(original);
  const [attachments, setAttachments] = useState(detail.attachments);
  const [pending, setPending] = useState<File[]>([]);
  const [removed, setRemoved] = useState<OfficeAttachment[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const patch = (value: Partial<AmendFields>) =>
    setFields((old) => ({ ...old, ...value }));
  const changed = changedAmendFields(original, fields);
  const summaryOfChanges = [
    ...changed.map((key) => FIELD_LABELS[key]),
    ...(pending.length ? [`thêm ${pending.length} tệp đính kèm`] : []),
    ...(removed.length ? [`bỏ ${removed.length} tệp đính kèm`] : []),
  ];
  const audience = detail.recipientStats?.total;
  const roots = catalog.folders.filter((f) => f.is_active && !f.parent_id);
  const chosenFolder = catalog.folders.find(
    (f) => f.id === fields.archive_folder_id,
  );
  const rootId = chosenFolder?.parent_id || chosenFolder?.id || roots[0]?.id || "";
  const subFolders = catalog.folders.filter(
    (f) => f.is_active && f.parent_id === rootId,
  );
  const addFiles = (incoming: FileList | File[]) => {
    const selected = Array.from(incoming);
    if (selected.some((f) => f.size > 50 * 1024 * 1024 || f.size === 0)) {
      setError({ message: "OFFICE_UPLOAD_INCOMPLETE" });
      return;
    }
    setPending((old) => [...old, ...selected]);
  };
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      for (const file of removed) {
        setProgress(`Đang bỏ ${file.file_name}…`);
        const result = await command({
          command: "attachment_remove",
          documentId: d.id,
          expectedVersion: version.current,
          payload: { attachmentId: file.id },
        });
        version.current = result.version;
      }
      for (const file of pending) {
        setProgress(`Đang tải ${file.name}…`);
        const reserved = await command({
          command: "attachment_begin",
          documentId: d.id,
          expectedVersion: version.current,
          payload: {
            fileName: file.name,
            mimeType: officeFileMime(file),
            size: file.size,
          },
        });
        version.current = reserved.version;
        if (!reserved.attachment) throw new Error("OFFICE_UPLOAD_INCOMPLETE");
        await service.upload(reserved.attachment, file);
        const done = await command({
          command: "attachment_finish",
          documentId: d.id,
          expectedVersion: version.current,
          payload: { attachmentId: reserved.attachment.id },
        });
        version.current = done.version;
      }
      setProgress("Đang lưu và gửi thông báo…");
      await command({
        command: "amend",
        documentId: d.id,
        expectedVersion: version.current,
        payload: {
          ...Object.fromEntries(changed.map((key) => [key, fields[key]])),
          baseVersion: baseVersion.current,
          reason: reason.trim(),
        },
      });
      navigate(`/office/documents/${d.id}`, { replace: true });
    } catch (e) {
      setError(e);
      setConfirming(false);
      // Tệp đã xử lý xong không làm lại; đọc lại trạng thái thật từ máy chủ.
      try {
        const fresh = await service.detail(d.id);
        version.current = fresh.document.version;
        setAttachments(fresh.attachments);
        setPending([]);
        setRemoved([]);
      } catch {
        /* giữ nguyên màn hình để người dùng thử lại */
      }
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  return (
    <>
      <header className="office-amend-head">
        <div>
          <p className="office-eyebrow">
            {d.document_number || d.source_document_number || "Đã ban hành"}
          </p>
          <h1>Sửa văn bản đã ban hành</h1>
          <p>{d.title}</p>
        </div>
      </header>
      <div className="office-amend-warning" role="note">
        <AlertTriangle size={20} />
        <div>
          <strong>Văn bản này đã phát hành ngày {displayDate(d.issued_at)}</strong>
          <p>
            Mọi thay đổi được ghi vào lịch sử kèm tên bạn và lý do, đồng thời
            báo cho{" "}
            {audience
              ? `${audience} người nhận`
              : "người nhận, người theo dõi và người ký"}
            . Số văn bản, loại văn bản và danh sách người nhận không đổi.
          </p>
        </div>
      </div>
      {error && <OfficeError error={error} />}
      <form
        ref={formRef}
        className="office-panel office-compose"
        onSubmit={(e) => {
          e.preventDefault();
          if (formRef.current?.reportValidity()) setConfirming(true);
        }}
      >
        <fieldset disabled={busy}>
          <OfficeField label="Tiêu đề văn bản" required>
            <input
              aria-label="Tiêu đề văn bản"
              required
              maxLength={500}
              value={fields.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </OfficeField>
          <OfficeField label="Tóm tắt / trích yếu">
            <textarea
              aria-label="Tóm tắt"
              maxLength={2000}
              rows={2}
              value={fields.summary}
              onChange={(e) => patch({ summary: e.target.value })}
            />
          </OfficeField>
          <OfficeRichTextEditor
            label="Nội dung văn bản"
            placeholder="Nội dung chính thức của văn bản"
            value={fields.content}
            disabled={busy}
            images={attachments}
            onChange={(content) => patch({ content })}
          />
          <OfficeField label="Tệp đính kèm">
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
              <small>
                Tệp thay thế được tải lên như tệp mới; bỏ tệp cũ để thay hẳn.
              </small>
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
            <div className="office-file-list">
              {attachments.map((f) => (
                <div key={f.id} data-removed={removed.includes(f) || undefined}>
                  <Paperclip size={16} />
                  <span>{f.file_name}</span>
                  <small>{removed.includes(f) ? "Sẽ bị bỏ" : "Đang đính kèm"}</small>
                  <button
                    type="button"
                    aria-label={
                      removed.includes(f)
                        ? `Giữ lại ${f.file_name}`
                        : `Bỏ ${f.file_name}`
                    }
                    onClick={() =>
                      setRemoved((old) =>
                        old.includes(f)
                          ? old.filter((x) => x !== f)
                          : [...old, f],
                      )
                    }
                  >
                    {removed.includes(f) ? <X size={15} /> : <Trash2 size={15} />}
                  </button>
                </div>
              ))}
              {pending.map((file, i) => (
                <div key={`${file.name}-${i}`}>
                  <Paperclip size={16} />
                  <span>{file.name}</span>
                  <small>Tệp mới · {(file.size / 1024 / 1024).toFixed(1)} MB</small>
                  <button
                    type="button"
                    aria-label={`Bỏ ${file.name}`}
                    onClick={() =>
                      setPending((old) => old.filter((_, n) => n !== i))
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              {!attachments.length && !pending.length && (
                <p className="office-helper">Chưa có tệp đính kèm.</p>
              )}
            </div>
          </OfficeField>
          <details className="office-compose-more">
            <summary>
              Thông tin ban hành
              <small>Người ký, ngày hiệu lực, mức độ khẩn, bảo mật, thư mục</small>
              <ChevronDown size={17} />
            </summary>
            <div className="office-form-grid">
              <OfficeField label="Người ký">
                <OfficePicker
                  service={service}
                  kind="user"
                  value={fields.signer_user_id}
                  onChange={(o) => patch({ signer_user_id: o?.id || null })}
                  label="Chọn người ký"
                />
              </OfficeField>
              <OfficeField label="Chức danh người ký">
                <input
                  aria-label="Chức danh người ký"
                  value={fields.signer_position || ""}
                  onChange={(e) =>
                    patch({ signer_position: e.target.value || null })
                  }
                />
              </OfficeField>
              <OfficeField label="Ngày văn bản">
                <input
                  aria-label="Ngày văn bản"
                  type="date"
                  value={fields.document_date}
                  onChange={(e) => patch({ document_date: e.target.value })}
                />
              </OfficeField>
              <OfficeField label="Ngày hiệu lực">
                <input
                  aria-label="Ngày hiệu lực"
                  type="date"
                  value={fields.effective_on || ""}
                  onChange={(e) =>
                    patch({ effective_on: e.target.value || null })
                  }
                />
              </OfficeField>
              <OfficeField label="Ngày hết hiệu lực">
                <input
                  aria-label="Ngày hết hiệu lực"
                  type="date"
                  value={fields.expires_on || ""}
                  onChange={(e) => patch({ expires_on: e.target.value || null })}
                />
              </OfficeField>
              <OfficeField label="Mức độ khẩn">
                <select
                  aria-label="Mức độ khẩn"
                  value={fields.urgency}
                  onChange={(e) =>
                    patch({ urgency: e.target.value as AmendFields["urgency"] })
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
                  value={fields.confidentiality}
                  onChange={(e) =>
                    patch({
                      confidentiality: e.target
                        .value as AmendFields["confidentiality"],
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
              <OfficeField label="Thư mục lưu trữ">
                <select
                  aria-label="Thư mục lưu trữ"
                  value={chosenFolder?.parent_id ? chosenFolder.id : ""}
                  onChange={(e) =>
                    patch({ archive_folder_id: e.target.value || rootId || null })
                  }
                >
                  <option value="">{officeFolderPath(catalog, rootId)}</option>
                  {subFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </OfficeField>
            </div>
            <label className="office-checkbox">
              <input
                type="checkbox"
                checked={fields.require_acknowledgement}
                onChange={(e) =>
                  patch({ require_acknowledgement: e.target.checked })
                }
              />
              Yêu cầu người nhận xác nhận đã đọc và hiểu nội dung
            </label>
          </details>
          <OfficeField label="Lý do sửa" required>
            <textarea
              aria-label="Lý do sửa"
              required
              maxLength={4000}
              rows={2}
              placeholder="Ví dụ: Sửa sai sót số liệu tại mục 2 theo chỉ đạo của Ban TGĐ"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </OfficeField>
        </fieldset>
        <footer className="office-amend-actions">
          <p>
            <BellRing size={16} />
            {summaryOfChanges.length
              ? `Sẽ ghi lịch sử và báo: ${summaryOfChanges.join(", ")}`
              : "Chưa có thay đổi nào so với bản đang ban hành."}
          </p>
          <div>
            <Link
              className="office-secondary"
              to={`/office/documents/${d.id}`}
              aria-disabled={busy}
            >
              Hủy bỏ
            </Link>
            <button
              type="submit"
              className="office-primary"
              disabled={busy || !summaryOfChanges.length || !reason.trim()}
            >
              {busy ? progress || "Đang lưu…" : "Lưu và thông báo"}
            </button>
          </div>
        </footer>
      </form>
      {confirming && (
        <OfficeModal
          title="Xác nhận sửa văn bản đã ban hành"
          onClose={() => !busy && setConfirming(false)}
        >
          <div className="office-amend-confirm">
            <p>
              Văn bản <strong>{d.document_number || d.title}</strong> sẽ được cập
              nhật và{" "}
              {audience ? `${audience} người nhận` : "người liên quan"} nhận
              thông báo kèm nội dung đã sửa.
            </p>
            <ul>
              {summaryOfChanges.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <blockquote>{reason.trim()}</blockquote>
            {error && <OfficeError error={error} />}
            <footer>
              <button
                type="button"
                className="office-secondary"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Xem lại
              </button>
              <button
                type="button"
                className="office-primary"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? progress || "Đang lưu…" : "Sửa và gửi thông báo"}
              </button>
            </footer>
          </div>
        </OfficeModal>
      )}
    </>
  );
}
