import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  FileText,
  Hash,
  LockKeyhole,
  Paperclip,
  Pencil,
  Send,
  ShieldCheck,
  Star,
  UserRound,
  XCircle,
} from "lucide-react";
import { WorkRichTextView } from "../work/WorkRichTextView";
import type { OfficeService } from "../../lib/office/officeService";
import type {
  OfficeAttachment,
  OfficeCatalog,
  OfficeCommand,
  OfficeDetail,
} from "../../lib/office/officeTypes";
import {
  CONFIDENTIALITY,
  displayDate,
  OFFICE_GROUPS,
  processingLabel,
  URGENCY,
} from "../../lib/office/officePresentation";
import {
  OfficeBadge,
  OfficeEmpty,
  OfficeError,
  OfficeField,
  OfficeLoading,
  OfficeModal,
  OfficePagination,
  OfficePicker,
  useOfficeQuery,
} from "./OfficeShared";
import { useOfficeCommand } from "./OfficeDraft";
const actionLabels: Partial<Record<OfficeCommand, string>> = {
  submit: "Gửi duyệt",
  approve: "Duyệt nội dung",
  return: "Trả lại chỉnh sửa",
  reject: "Từ chối",
  issue_number: "Cấp số văn bản",
  publish: "Phát hành văn bản",
  revoke: "Thu hồi văn bản",
  archive: "Lưu trữ",
  assign: "Giao xử lý",
  acknowledge: "Xác nhận tiếp nhận",
  start: "Bắt đầu xử lý",
  complete: "Hoàn thành xử lý",
};
const activityLabels: Record<string, string> = {
  CREATED: "Tạo bản nháp",
  EDITED: "Chỉnh sửa bản nháp",
  SUBMITTED: "Trình duyệt / đăng ký tiếp nhận",
  APPROVED: "Duyệt nội dung",
  RETURNED: "Trả lại chỉnh sửa",
  REJECTED: "Từ chối văn bản",
  NUMBER_ISSUED: "Cấp số văn bản",
  PUBLISHED: "Phát hành văn bản",
  REVOKED: "Thu hồi văn bản",
  ARCHIVED: "Lưu trữ văn bản",
  ASSIGNED: "Giao xử lý",
  ACKNOWLEDGE: "Xác nhận tiếp nhận",
  START: "Bắt đầu xử lý",
  COMPLETE: "Hoàn thành xử lý",
  ATTACHMENT_RESERVED: "Chuẩn bị tải tệp",
  ATTACHMENT_UPLOADED: "Tải tệp đính kèm",
  ATTACHMENT_REMOVED: "Gỡ tệp đính kèm",
};
export function OfficeDetailPage({
  service,
  catalog,
}: {
  service: OfficeService;
  catalog: OfficeCatalog;
}) {
  const { id } = useParams();
  const detail = useOfficeQuery(() => service.detail(id!), [service, id]);
  return (
    <div className="office-content office-detail">
      <Link className="office-back" to="/office/documents">
        <ArrowLeft size={16} />
        Danh sách văn bản
      </Link>
      {detail.loading ? (
        <OfficeLoading />
      ) : detail.error ? (
        <OfficeError error={detail.error} retry={detail.refresh} />
      ) : (
        detail.data && (
          <OfficeDetailContent
            key={id}
            service={service}
            catalog={catalog}
            detail={detail.data}
            refresh={detail.refresh}
          />
        )
      )}
    </div>
  );
}
function OfficeDetailContent({
  service,
  catalog,
  detail,
  refresh,
}: {
  service: OfficeService;
  catalog: OfficeCatalog;
  detail: OfficeDetail;
  refresh: () => void;
}) {
  const d = detail.document,
    caps = detail.capabilities;
  const command = useOfficeCommand(service);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [success, setSuccess] = useState(""),
    [modal, setModal] = useState<OfficeCommand | null>(null),
    [tab, setTab] = useState("content"),
    [readError, setReadError] = useState<unknown>(null);
  const [preview, setPreview] = useState<{
    url: string;
    file: OfficeAttachment;
  } | null>(null);
  const attemptedRead = useRef(false);
  const appliedRead = useRef(false);
  const [recipientStats, setRecipientStats] = useState(detail.recipientStats);
  async function markRead() {
    try {
      await command({ command: "read", documentId: d.id });
      setReadError(null);
      if (!appliedRead.current) {
        appliedRead.current = true;
        setRecipientStats((stats) =>
          stats && stats.unread > 0
            ? { ...stats, read: stats.read + 1, unread: stats.unread - 1 }
            : stats,
        );
      }
    } catch (e) {
      setReadError(e);
    }
  }
  useEffect(() => {
    if (!caps.read || attemptedRead.current) return;
    const readVisible = () => {
      if (document.visibilityState === "visible" && !attemptedRead.current) {
        attemptedRead.current = true;
        void markRead();
      }
    };
    readVisible();
    document.addEventListener("visibilitychange", readVisible);
    return () => document.removeEventListener("visibilitychange", readVisible);
  }, [d.id, caps.read]);
  async function act(action: OfficeCommand, payload: object = {}) {
    setBusy(true);
    setError(null);
    try {
      await command({
        command: action,
        documentId: d.id,
        expectedVersion: d.version,
        payload,
      });
      setModal(null);
      setSuccess("Đã cập nhật văn bản.");
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function openFile(file: OfficeAttachment) {
    setError(null);
    try {
      const url = await service.fileUrl(file);
      setPreview({ url, file });
    } catch (e) {
      setError(e);
    }
  }
  const workflow = detail.approvals.filter((a) => a.round === d.approval_round);
  const currentApproval = workflow.find((a) => a.status === "PENDING");
  const nextAction = caps.approve
    ? "approve"
    : caps.issue_number
      ? "issue_number"
      : caps.publish
        ? "publish"
        : caps.submit
          ? "submit"
          : caps.process
            ? d.received_ack_at
              ? d.processing_status === "IN_PROGRESS"
                ? "complete"
                : "start"
              : "acknowledge"
            : null;
  const guidance = d.revoked_at
    ? "Văn bản đã thu hồi. Không sử dụng nội dung này để thực hiện công việc."
    : d.status === "REJECTED"
      ? "Văn bản đã bị từ chối. Xem lý do trong quy trình duyệt hoặc lịch sử."
      : d.status === "DRAFT"
        ? d.document_group === "INCOMING"
          ? "Hoàn thiện thông tin bên gửi, ngày nhận, tệp gốc và người nhận để đăng ký tiếp nhận."
          : "Hoàn thiện nội dung và người nhận trước khi gửi duyệt."
        : d.status === "RETURNED"
          ? "Xem lý do trả lại, chỉnh sửa rồi gửi duyệt lại."
          : d.status === "PENDING_APPROVAL"
            ? `Đang chờ ${currentApproval?.name || "người được phân công"} duyệt nội dung.`
            : d.status === "WAITING_NUMBER"
              ? "Nội dung đã được duyệt. Văn thư có thể cấp số chính thức."
              : d.status === "APPROVED"
                ? d.document_group === "INCOMING"
                  ? "Văn bản đến đã đăng ký. Người có quyền có thể phân phối tới người nhận."
                  : "Văn bản sẵn sàng để người có quyền phát hành gửi tới người nhận."
                : d.status === "REVOKED"
                  ? "Văn bản đã thu hồi. Không sử dụng nội dung này để thực hiện công việc."
                  : d.status === "ARCHIVED"
                    ? "Văn bản đã được lưu trữ và vẫn có thể tra cứu."
                    : d.document_group === "INCOMING"
                      ? "Văn bản đã được phân phối. Theo dõi người phụ trách và tiến độ xử lý bên dưới."
                      : "Văn bản đã được phát hành. Nội dung và tệp chính được khóa.";
  return (
    <>
      <header className="office-detail-header">
        <div>
          <div className="office-detail-code">
            <span>
              {d.document_number ||
                d.source_document_number ||
                (d.document_group === "INCOMING"
                  ? "Văn bản đến"
                  : "Chưa cấp số")}
            </span>
            <OfficeBadge status={d.status} group={d.document_group} />
            {d.revoked_at && d.status !== "REVOKED" && (
              <OfficeBadge status="REVOKED" />
            )}
          </div>
          <h1>{d.title}</h1>
          <p>
            {OFFICE_GROUPS[d.document_group].label} · {detail.typeName} · Tạo
            bởi {d.creator_name}
          </p>
        </div>
        <div className="office-detail-tools">
          <button
            className={detail.bookmark.favorite ? "is-active" : ""}
            aria-label={detail.bookmark.favorite ? "Bỏ yêu thích" : "Yêu thích"}
            aria-pressed={detail.bookmark.favorite}
            disabled={busy}
            onClick={() =>
              void act("bookmark", {
                ...detail.bookmark,
                favorite: !detail.bookmark.favorite,
              })
            }
          >
            <Star size={19} />
          </button>
          <button
            className={detail.bookmark.following ? "is-active" : ""}
            aria-label={detail.bookmark.following ? "Bỏ theo dõi" : "Theo dõi"}
            aria-pressed={detail.bookmark.following}
            disabled={busy}
            onClick={() =>
              void act("bookmark", {
                ...detail.bookmark,
                following: !detail.bookmark.following,
              })
            }
          >
            <Bell size={19} />
          </button>
        </div>
      </header>
      <div
        className="office-action-banner"
        data-revoked={!!d.revoked_at || d.status === "REVOKED" || undefined}
      >
        <div>
          <ShieldCheck size={20} />
          <p>{guidance}</p>
        </div>
        <div className="office-action-buttons">
          {caps.edit && (
            <Link
              className="office-secondary"
              to={`/office/documents/${d.id}/edit`}
            >
              <Pencil size={15} />
              Chỉnh sửa
            </Link>
          )}
          {caps.approve && (
            <button
              className="office-secondary"
              disabled={busy}
              onClick={() => setModal("return")}
            >
              Trả lại
            </button>
          )}
          {nextAction && (
            <button
              className="office-primary"
              disabled={busy}
              onClick={() => setModal(nextAction as OfficeCommand)}
            >
              {nextAction === "issue_number" ? (
                <Hash size={16} />
              ) : nextAction === "publish" ? (
                <Send size={16} />
              ) : (
                <Check size={16} />
              )}{" "}
              {d.document_group === "INCOMING" && nextAction === "publish"
                ? "Phân phối văn bản"
                : d.document_group === "INCOMING" && nextAction === "submit"
                  ? "Đăng ký tiếp nhận"
                  : actionLabels[nextAction as OfficeCommand]}
            </button>
          )}
        </div>
      </div>
      {error && <OfficeError error={error} retry={refresh} />}{" "}
      {readError && (
        <div className="office-read-error">
          <OfficeError error={readError} retry={() => void markRead()} />
          <small>Chưa ghi nhận trạng thái đã đọc của bạn.</small>
        </div>
      )}
      {success && <p role="status">{success}</p>}
      <div className="office-detail-layout">
        <div className="office-detail-main">
          <section className="office-panel">
            <div
              className="office-detail-tabs"
              role="tablist"
              aria-label="Chi tiết văn bản"
            >
              {[
                ["content", "Nội dung"],
                ...(caps.track
                  ? [
                      [
                        "recipients",
                        `Người nhận${detail.recipientStats ? ` (${detail.recipientStats.total})` : ""}`,
                      ],
                    ]
                  : []),
                ["activity", "Lịch sử"],
              ].map(([key, label]) => (
                <button
                  role="tab"
                  aria-selected={tab === key}
                  key={key}
                  className={tab === key ? "is-active" : ""}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "content" ? (
              <div className="office-document-body">
                {d.summary && (
                  <p className="office-document-summary">{d.summary}</p>
                )}
                {d.content.content.length ? (
                  <WorkRichTextView document={d.content} />
                ) : (
                  <OfficeEmpty
                    title="Nội dung nằm trong tệp đính kèm"
                    description="Mở tệp bên dưới để xem văn bản đầy đủ."
                  />
                )}
                <section className="office-attachments">
                  <h2>
                    <Paperclip size={18} />
                    Tệp đính kèm <span>{detail.attachments.length}</span>
                  </h2>
                  {detail.attachments.length ? (
                    detail.attachments.map((f) => (
                      <button
                        key={f.id}
                        disabled={f.status !== "READY"}
                        onClick={() => void openFile(f)}
                      >
                        <div className="office-file-icon">
                          <FileText size={19} />
                        </div>
                        <span>
                          <strong>{f.file_name}</strong>
                          <small>
                            {(f.size_bytes / 1024 / 1024).toFixed(1)} MB
                            {f.status === "PENDING" ? " · Chưa tải xong" : ""}
                          </small>
                        </span>
                        <Eye size={17} />
                      </button>
                    ))
                  ) : (
                    <p className="office-helper">Không có tệp đính kèm.</p>
                  )}
                </section>
              </div>
            ) : tab === "recipients" ? (
              <OfficeRecipients
                service={service}
                detail={{ ...detail, recipientStats }}
              />
            ) : (
              <OfficeActivityTimeline service={service} id={d.id} />
            )}
          </section>
          {d.document_group === "INCOMING" && (
            <section className="office-panel office-form-section">
              <header>
                <div>
                  <h2>Xử lý văn bản đến</h2>
                  <p>{processingLabel(d.processing_status, d.due_date)}</p>
                </div>
                {caps.assign && (
                  <button
                    className="office-secondary"
                    disabled={busy}
                    onClick={() => setModal("assign")}
                  >
                    {d.assigned_to ? "Giao lại" : "Giao xử lý"}
                  </button>
                )}
              </header>
              {d.assigned_to ? (
                <>
                  <dl className="office-meta">
                    <div>
                      <dt>Người phụ trách</dt>
                      <dd>{detail.assigneeName}</dd>
                    </div>
                    <div>
                      <dt>Hạn xử lý</dt>
                      <dd>{displayDate(d.due_date)}</dd>
                    </div>
                  </dl>
                  <p className="office-processing-instruction">
                    {d.processing_instruction}
                  </p>
                  {d.processing_result && (
                    <div className="office-result">
                      <strong>Kết quả xử lý</strong>
                      <p>{d.processing_result}</p>
                      <small>
                        {displayDate(d.processing_completed_at, true)}
                      </small>
                    </div>
                  )}
                </>
              ) : (
                <p className="office-helper">
                  Chưa giao người xử lý. Sau khi phân phối, người có quyền có
                  thể giao việc kèm thời hạn.
                </p>
              )}
            </section>
          )}
        </div>
        <aside className="office-detail-context">
          <section className="office-panel office-form-section">
            <h2>Thông tin văn bản</h2>
            <dl className="office-meta">
              {[
                ["Ngày văn bản", displayDate(d.document_date)],
                ["Đơn vị ban hành", detail.departmentName],
                ["Người ký", detail.signerName],
                ["Dưới tư cách", d.signer_position],
                ["Mức độ khẩn", URGENCY[d.urgency]],
                ["Bảo mật", CONFIDENTIALITY[d.confidentiality]],
                ["Dự án", detail.projectName],
                [
                  "Kho lưu trữ",
                  catalog.folders.find((f) => f.id === d.archive_folder_id)
                    ?.name,
                ],
                ...(d.document_group === "INCOMING"
                  ? [
                      ["Đơn vị gửi", d.source_organization],
                      ["Số bên gửi", d.source_document_number],
                      ["Ngày nhận", displayDate(d.received_date)],
                    ]
                  : []),
                ...(d.document_group === "OUTGOING"
                  ? [["Gửi tới", d.external_recipient]]
                  : []),
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="office-panel office-form-section">
            <h2>Quy trình duyệt</h2>
            {workflow.length ? (
              <ol className="office-approval-timeline">
                {workflow.map((step) => (
                  <li key={step.id} data-state={step.status}>
                    <span className="office-step-dot">
                      {step.status === "APPROVED" ? (
                        <Check size={13} />
                      ) : (
                        step.step
                      )}
                    </span>
                    <div>
                      <strong>{step.name}</strong>
                      <small>{step.label}</small>
                      <p>
                        {
                          {
                            PENDING: "Đang chờ duyệt",
                            WAITING: "Chưa tới lượt",
                            APPROVED: "Đã duyệt",
                            RETURNED: "Đã trả lại",
                            REJECTED: "Đã từ chối",
                            CANCELLED: "Đã dừng",
                          }[step.status]
                        }
                      </p>
                      {step.acted_at && (
                        <small>{displayDate(step.acted_at, true)}</small>
                      )}
                      {step.comment && <blockquote>{step.comment}</blockquote>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="office-helper">
                {d.status === "DRAFT"
                  ? "Tuyến duyệt sẽ được ghi nhận khi gửi duyệt."
                  : d.document_group === "INCOMING"
                    ? "Văn bản đến được đăng ký và phân phối để xử lý."
                    : "Loại văn bản này không yêu cầu duyệt."}
              </p>
            )}
            <div className="office-official-step">
              <Hash size={17} />
              <span>
                <strong>
                  {d.document_group === "INCOMING"
                    ? d.source_document_number || "Không có số bên gửi"
                    : d.document_number || "Chưa cấp số"}
                </strong>
                <small>
                  {d.document_group === "INCOMING"
                    ? "Số do đơn vị gửi cấp"
                    : d.numbered_at
                      ? displayDate(d.numbered_at, true)
                      : "Cấp số sau khi hoàn tất phê duyệt"}
                </small>
              </span>
            </div>
            <div className="office-official-step">
              <Send size={17} />
              <span>
                <strong>
                  {d.document_group === "INCOMING"
                    ? d.issued_at
                      ? "Đã phân phối"
                      : "Chưa phân phối"
                    : d.issued_at
                      ? "Đã phát hành"
                      : "Chưa phát hành"}
                </strong>
                <small>
                  {d.issued_at
                    ? displayDate(d.issued_at, true)
                    : "Chưa gửi tới người nhận"}
                </small>
              </span>
            </div>
          </section>
          {(caps.revoke || caps.archive || caps.approve) && (
            <section className="office-panel office-more-actions">
              <h3>Thao tác khác</h3>
              {caps.approve && (
                <button disabled={busy} onClick={() => setModal("reject")}>
                  <XCircle size={16} />
                  Từ chối văn bản
                </button>
              )}
              {caps.archive && (
                <button disabled={busy} onClick={() => setModal("archive")}>
                  <Archive size={16} />
                  Lưu trữ văn bản
                </button>
              )}
              {caps.revoke && (
                <button
                  className="office-text-danger"
                  disabled={busy}
                  onClick={() => setModal("revoke")}
                >
                  <XCircle size={16} />
                  Thu hồi văn bản
                </button>
              )}
            </section>
          )}
        </aside>
      </div>
      {modal && (
        <OfficeActionDialog
          action={modal}
          detail={detail}
          service={service}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busy) {
              setModal(null);
              setError(null);
            }
          }}
          onSubmit={(payload) => void act(modal, payload)}
        />
      )}
      {preview && (
        <OfficeModal
          title={preview.file.file_name}
          onClose={() => setPreview(null)}
        >
          <div className="office-file-preview">
            {preview.file.mime_type === "application/pdf" ? (
              <iframe title={preview.file.file_name} src={preview.url} />
            ) : preview.file.mime_type.startsWith("image/") ? (
              <img src={preview.url} alt={preview.file.file_name} />
            ) : (
              <OfficeEmpty
                title="Tải tệp để xem nội dung"
                description="Định dạng này được mở bằng ứng dụng trên thiết bị."
              />
            )}
            <a
              className="office-primary"
              href={preview.url}
              download={preview.file.file_name}
              target="_blank"
              rel="noreferrer"
            >
              <Download size={16} />
              Mở / tải tệp
            </a>
            <small>
              Liên kết có hiệu lực 5 phút. Đóng rồi mở lại nếu hết hạn.
            </small>
          </div>
        </OfficeModal>
      )}
    </>
  );
}
function OfficeActionDialog({
  action,
  detail,
  service,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  action: OfficeCommand;
  detail: OfficeDetail;
  service: OfficeService;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (payload: object) => void;
}) {
  const [reason, setReason] = useState(""),
    [userId, setUserId] = useState(detail.document.assigned_to || ""),
    [dueDate, setDueDate] = useState(detail.document.due_date || ""),
    [instruction, setInstruction] = useState(
      detail.document.processing_instruction || "",
    ),
    [collaborators, setCollaborators] = useState<string[]>(
      detail.document.collaborator_ids || [],
    );
  const label =
    detail.document.document_group === "INCOMING" && action === "publish"
      ? "Phân phối văn bản"
      : detail.document.document_group === "INCOMING" && action === "submit"
        ? "Đăng ký tiếp nhận"
        : actionLabels[action] || "Xác nhận";
  const needReason = ["return", "reject", "revoke"].includes(action);
  const descriptions: Partial<Record<OfficeCommand, string>> = {
    publish:
      "Phát hành sẽ chốt người nhận và khóa nội dung, người ký, số và tệp đính kèm. Người nhận sẽ được thông báo.",
    issue_number:
      "Số được cấp tự động trong sổ văn bản. Số đã cấp được giữ vĩnh viễn; nội dung sẽ được khóa.",
    archive: "Văn bản vẫn có thể tra cứu và người nhận vẫn giữ quyền xem.",
    revoke:
      "Người nhận sẽ được thông báo thu hồi. Số văn bản được giữ trong lịch sử.",
    approve:
      "Xác nhận nội dung đúng và chuyển sang bước tiếp theo của tuyến duyệt.",
    submit: "Nội dung sẽ được khóa trong thời gian chờ duyệt.",
    acknowledge: "Xác nhận bạn đã tiếp nhận yêu cầu xử lý công văn.",
    start: "Bắt đầu xử lý văn bản theo yêu cầu được giao.",
  };
  return (
    <OfficeModal title={label} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(
            action === "assign"
              ? { userId, dueDate, instruction, collaboratorIds: collaborators }
              : action === "complete"
                ? { result: reason }
                : { reason: reason || undefined },
          );
        }}
      >
        <fieldset disabled={busy}>
          {descriptions[action] && <p>{descriptions[action]}</p>}
          {action === "assign" && (
            <>
              <OfficeField label="Người phụ trách" required>
                <OfficePicker
                  service={service}
                  kind="user"
                  label="Chọn người phụ trách"
                  value={userId}
                  onChange={(o) => setUserId(o?.id || "")}
                />
              </OfficeField>
              <OfficeField label="Hạn xử lý" required>
                <input
                  aria-label="Hạn xử lý"
                  type="date"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </OfficeField>
              <OfficeField label="Yêu cầu xử lý" required>
                <textarea
                  aria-label="Yêu cầu xử lý"
                  required
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
              </OfficeField>
              <OfficeField label="Người phối hợp">
                <OfficePicker
                  service={service}
                  kind="user"
                  label="Thêm người phối hợp"
                  onChange={(o) => {
                    if (o && !collaborators.includes(o.id))
                      setCollaborators([...collaborators, o.id]);
                  }}
                />
                {collaborators.map((id) => (
                  <OfficePicker
                    key={id}
                    service={service}
                    kind="user"
                    label="Người phối hợp đã chọn"
                    value={id}
                    onChange={(o) =>
                      setCollaborators(
                        collaborators
                          .map((x) => (x === id ? o?.id || "" : x))
                          .filter(Boolean),
                      )
                    }
                  />
                ))}
              </OfficeField>
            </>
          )}
          {(needReason || action === "complete" || action === "approve") && (
            <OfficeField
              label={
                action === "complete"
                  ? "Kết quả xử lý"
                  : needReason
                    ? "Lý do"
                    : "Ghi chú phê duyệt"
              }
              required={needReason || action === "complete"}
            >
              <textarea
                aria-label={
                  action === "complete" ? "Kết quả xử lý" : "Lý do / ghi chú"
                }
                required={needReason || action === "complete"}
                maxLength={4000}
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </OfficeField>
          )}
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
            className={
              action === "revoke" || action === "reject"
                ? "office-danger"
                : "office-primary"
            }
            disabled={busy || (action === "assign" && !userId)}
          >
            {busy ? "Đang xử lý…" : label}
          </button>
        </footer>
      </form>
    </OfficeModal>
  );
}
function OfficeRecipients({
  service,
  detail,
}: {
  service: OfficeService;
  detail: OfficeDetail;
}) {
  const [page, setPage] = useState(0),
    [filter, setFilter] = useState("all");
  const list = useOfficeQuery(
    () => service.recipients(detail.document.id, page, filter),
    [service, detail.document.id, page, filter],
  );
  return (
    <div className="office-recipient-panel">
      <div className="office-receipt-summary">
        <span>
          <strong>{detail.recipientStats?.read ?? "—"}</strong> đã đọc
        </span>
        <span>
          <strong>{detail.recipientStats?.unread ?? "—"}</strong> chưa đọc
        </span>
        <button
          className="office-secondary"
          onClick={() => {
            setFilter(filter === "all" ? "unread" : "all");
            setPage(0);
          }}
        >
          {filter === "all" ? "Xem người chưa đọc" : "Xem tất cả"}
        </button>
      </div>
      {list.loading ? (
        <OfficeLoading />
      ) : list.error ? (
        <OfficeError error={list.error} retry={list.refresh} />
      ) : list.data?.items.length ? (
        <ul className="office-recipient-list">
          {list.data.items.map((r) => (
            <li key={r.user_id}>
              <UserRound size={18} />
              <strong>{r.name}</strong>
              <span>
                {r.read_at ? (
                  <>
                    <CheckCheck size={15} />
                    {displayDate(r.read_at, true)}
                  </>
                ) : (
                  "Chưa đọc"
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <OfficeEmpty
          title={
            detail.document.issued_at
              ? "Không có người nhận phù hợp"
              : "Chưa phát hành"
          }
          description="Danh sách gửi nhận được chốt khi phát hành văn bản."
        />
      )}
      {list.data && (
        <OfficePagination
          page={page}
          total={list.data.total}
          onChange={setPage}
        />
      )}
    </div>
  );
}
function OfficeActivityTimeline({
  service,
  id,
}: {
  service: OfficeService;
  id: string;
}) {
  const [page, setPage] = useState(0);
  const activity = useOfficeQuery(
    () => service.activity(id, page),
    [service, id, page],
  );
  return (
    <div className="office-activity-panel">
      {activity.loading ? (
        <OfficeLoading />
      ) : activity.error ? (
        <OfficeError error={activity.error} retry={activity.refresh} />
      ) : (
        <>
          <ol className="office-activity">
            {activity.data?.map((event) => (
              <li key={event.id}>
                <span className="office-activity-dot" />
                <div>
                  <strong>
                    {activityLabels[event.description] || "Cập nhật văn bản"}
                  </strong>
                  <p>
                    {event.user_name} · {displayDate(event.created_at, true)}
                  </p>
                  {event.context.number && (
                    <small>{event.context.number}</small>
                  )}
                  {event.context.comment && (
                    <blockquote>{event.context.comment}</blockquote>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="office-pagination">
            <button disabled={!page} onClick={() => setPage((n) => n - 1)}>
              Mới hơn
            </button>
            <button
              disabled={(activity.data?.length || 0) < 25}
              onClick={() => setPage((n) => n + 1)}
            >
              Cũ hơn
            </button>
          </div>
        </>
      )}
    </div>
  );
}
