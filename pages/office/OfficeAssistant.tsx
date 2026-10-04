import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import type { OfficeService } from "../../lib/office/officeService";
import type {
  OfficeAiAction,
  OfficeAiResult,
} from "../../lib/office/officeAiService";
import type {
  OfficeAttachment,
  OfficeDraft,
} from "../../lib/office/officeTypes";
import {
  OfficeError,
  OfficeField,
  OfficeLoading,
  OfficeModal,
  useOfficeQuery,
} from "./OfficeShared";
export function OfficeAssistant({
  service,
  documentId,
  attachments = [],
  editable = false,
  onApply,
  searchOnly = false,
}: {
  service: OfficeService;
  documentId?: string;
  attachments?: OfficeAttachment[];
  editable?: boolean;
  onApply?: (patch: Partial<OfficeDraft>) => void;
  searchOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="office-secondary"
        onClick={() => setOpen(true)}
      >
        <Sparkles size={16} />
        {searchOnly ? "Tìm với AI" : "AI hỗ trợ"}
      </button>
      {open && (
        <AssistantDialog
          service={service}
          documentId={documentId}
          attachments={attachments}
          editable={editable}
          onApply={onApply}
          searchOnly={searchOnly}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
function AssistantDialog({
  service,
  documentId,
  attachments,
  editable,
  onApply,
  searchOnly,
  onClose,
}: {
  service: OfficeService;
  documentId?: string;
  attachments: OfficeAttachment[];
  editable: boolean;
  onApply?: (patch: Partial<OfficeDraft>) => void;
  searchOnly: boolean;
  onClose: () => void;
}) {
  const status = useOfficeQuery(() => service.ai.status(), [service]);
  const [action, setAction] = useState<OfficeAiAction>(
      searchOnly ? "search" : editable ? "draft" : "summary",
    ),
    [prompt, setPrompt] = useState(""),
    [file, setFile] = useState(""),
    [result, setResult] = useState<OfficeAiResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const eligible = attachments.filter(
    (f) =>
      f.status === "READY" &&
      ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(
        f.mime_type,
      ),
  );
  const choices: [OfficeAiAction, string][] = searchOnly
    ? [["search", "Tìm kiếm văn bản"]]
    : [
        ...(editable
          ? ([
              ["draft", "Soạn dự thảo"],
              ...(documentId && eligible.length
                ? [["extract", "Đọc bản scan / PDF"]]
                : []),
            ] as [OfficeAiAction, string][])
          : []),
        ...(documentId
          ? ([
              ["summary", "Tóm tắt"],
              ["ask", "Hỏi về văn bản"],
            ] as [OfficeAiAction, string][])
          : []),
      ];
  return (
    <OfficeModal title="Trợ lý Office" onClose={onClose}>
      {status.loading ? (
        <OfficeLoading />
      ) : status.error ? (
        <OfficeError error={status.error} retry={status.refresh} />
      ) : !status.data?.configured ? (
        <div className="office-ai-unavailable">
          <Sparkles size={26} />
          <h2>AI/OCR chưa được kích hoạt</h2>
          <p>
            Quản trị viên có thể cấu hình nhà cung cấp và model để mở tính năng.
            Bạn vẫn có thể soạn, đính kèm bản scan và xử lý văn bản bình thường.
          </p>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            setResult(null);
            try {
              setResult(
                await service.ai.run({
                  action,
                  documentId,
                  attachmentId: file || undefined,
                  prompt,
                }),
              );
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <OfficeField label="Bạn cần hỗ trợ gì?">
              <select
                aria-label="Chức năng AI"
                value={action}
                onChange={(e) => {
                  setAction(e.target.value as OfficeAiAction);
                  setResult(null);
                }}
              >
                {choices.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </OfficeField>
            {action === "extract" ? (
              <OfficeField label="Bản scan / PDF đã lưu" required>
                <select
                  aria-label="Tệp để đọc OCR"
                  value={file}
                  onChange={(e) => setFile(e.target.value)}
                  required
                >
                  <option value="">Chọn tệp…</option>
                  {eligible.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.file_name}
                    </option>
                  ))}
                </select>
                <small>
                  PDF hoặc ảnh tối đa 8 MB. Kiểm tra lại số, ngày và tên riêng
                  sau khi đọc.
                </small>
              </OfficeField>
            ) : (
              action !== "summary" && (
                <OfficeField
                  label={
                    action === "draft"
                      ? "Yêu cầu soạn thảo"
                      : "Nội dung cần tìm / hỏi"
                  }
                  required
                >
                  <textarea
                    aria-label="Yêu cầu AI"
                    required
                    maxLength={4000}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={
                      action === "draft"
                        ? "Ví dụ: Thông báo lịch kiểm kê, các bộ phận chuẩn bị danh sách…"
                        : "Nhập câu hỏi của bạn…"
                    }
                  />
                </OfficeField>
              )
            )}
            <p className="office-helper">
              Khi bạn chạy, nội dung đang được phép xem hoặc tệp đã chọn được
              gửi tới dịch vụ AI của công ty. Kết quả cần được kiểm tra; không
              tự gửi duyệt hay phát hành.
            </p>
          </fieldset>
          {error && <OfficeError error={error} />}
          {result && (
            <div className="office-ai-result">
              <h2>{result.result.title || "Kết quả đề xuất"}</h2>
              {result.result.summary && <p>{result.result.summary}</p>}
              <div className="office-ai-body">{result.result.body}</div>
              {action === "extract" && (
                <dl>
                  {[
                    ["Số bên gửi", result.result.source_document_number],
                    ["Ngày", result.result.document_date],
                    ["Đơn vị gửi", result.result.source_organization],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <dt>{l}</dt>
                      <dd>{v || "Chưa xác định"}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {result.documents && (
                <ul className="office-links-list">
                  {result.documents.items.map((d) => (
                    <li key={d.id}>
                      <Link to={`/office/documents/${d.id}`} onClick={onClose}>
                        <strong>{d.title}</strong>
                        <small>
                          {d.document_number || d.source_document_number}
                        </small>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {result.documents && !result.documents.items.length && (
                <p>Không có văn bản phù hợp trong phạm vi bạn được xem.</p>
              )}
            </div>
          )}
          <footer>
            <button
              type="button"
              className="office-secondary"
              disabled={busy}
              onClick={onClose}
            >
              Đóng
            </button>
            {result && onApply && ["draft", "extract"].includes(action) && (
              <button
                type="button"
                className="office-secondary"
                disabled={busy}
                onClick={() => {
                  const r = result.result;
                  onApply({
                    ...(r.title ? { title: r.title } : {}),
                    ...(r.summary ? { summary: r.summary } : {}),
                    ...(r.body
                      ? {
                          content: {
                            version: 1,
                            type: "doc",
                            content: r.body
                              .split(/\n\n+/)
                              .map((text) => ({
                                type: "paragraph" as const,
                                content: [{ type: "text" as const, text }],
                              })),
                          },
                        }
                      : {}),
                    ...(action === "extract"
                      ? {
                          ...(r.source_document_number
                            ? {
                                source_document_number:
                                  r.source_document_number,
                              }
                            : {}),
                          ...(r.source_organization
                            ? { source_organization: r.source_organization }
                            : {}),
                          ...(r.document_date
                            ? { document_date: r.document_date }
                            : {}),
                          ...(r.source_sender
                            ? { source_sender: r.source_sender }
                            : {}),
                        }
                      : {}),
                  });
                  onClose();
                }}
              >
                Áp dụng vào bản nháp
              </button>
            )}
            <button className="office-primary" disabled={busy}>
              {busy ? "Đang xử lý…" : result ? "Chạy lại" : "Chạy AI"}
            </button>
          </footer>
        </form>
      )}
    </OfficeModal>
  );
}
