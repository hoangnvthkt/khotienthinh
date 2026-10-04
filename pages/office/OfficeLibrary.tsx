import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  FileText,
  Plus,
  History,
  ArrowRight,
  Download,
  Link2,
  Trash2,
} from "lucide-react";
import type { OfficeService } from "../../lib/office/officeService";
import type {
  OfficeCatalog,
  OfficeTemplate,
  OfficeDraft,
  OfficeDetail,
  OfficeTargetType,
  OfficeTarget,
  OfficeVersion,
  OfficeFilters,
} from "../../lib/office/officeTypes";
import {
  OFFICE_GROUPS,
  displayDate,
  localDate,
} from "../../lib/office/officePresentation";
import {
  OFFICE_TEMPLATE_FIELDS,
  fillOfficeText,
  fillOfficeTemplate,
  officeTemplateVariables,
  officeVersionChanges,
  downloadOfficeWorkbook,
} from "../../lib/office/officeExtensions";
import { EMPTY_OFFICE_CONTENT } from "../../lib/office/officeContent";
import {
  OfficeEmpty,
  OfficeError,
  OfficeField,
  OfficeLoading,
  OfficeModal,
  useOfficeQuery,
} from "./OfficeShared";
import { OfficeRichTextEditor, OfficeRichTextView } from "./OfficeRichText";
import { useOfficeCommand } from "./OfficeDraft";

export function OfficeTemplatesPage({
  service,
  catalog,
}: {
  service: OfficeService;
  catalog: OfficeCatalog;
}) {
  const templates = useOfficeQuery(() => service.templates(), [service]);
  const [editing, setEditing] = useState<Partial<OfficeTemplate> | null>(null),
    [history, setHistory] = useState<OfficeTemplate | null>(null);
  return (
    <div className="office-content">
      <div className="office-page-heading">
        <div>
          <p className="office-eyebrow">THƯ VIỆN NỘI DUNG</p>
          <h1>Mẫu văn bản</h1>
          <p>
            Thống nhất cách trình bày. Điền thông tin riêng khi soạn từng văn
            bản.
          </p>
        </div>
        {catalog.canConfigure && (
          <button className="office-primary" onClick={() => setEditing({})}>
            <Plus size={17} />
            Tạo mẫu
          </button>
        )}
      </div>
      {templates.loading ? (
        <OfficeLoading />
      ) : templates.error ? (
        <OfficeError error={templates.error} retry={templates.refresh} />
      ) : (
        <div className="office-template-grid">
          {templates.data?.map((t) => (
            <article className="office-panel office-form-section" key={t.id}>
              <FileText size={22} />
              <h2>{t.name}</h2>
              <p>
                {OFFICE_GROUPS[t.document_group].label} · Phiên bản {t.version}
                {!t.is_active ? " · Ngừng sử dụng" : ""}
              </p>
              <p className="office-helper">
                {t.summary ||
                  t.title ||
                  "Mẫu nội dung có thể tùy chỉnh khi soạn."}
              </p>
              <div className="office-inline-actions">
                {t.is_active && (
                  <Link
                    className="office-primary"
                    to={`/office/new?group=${t.document_group}&template=${t.id}`}
                  >
                    Dùng mẫu <ArrowRight size={15} />
                  </Link>
                )}
                {catalog.canConfigure && (
                  <>
                    <button
                      className="office-secondary"
                      onClick={() => setEditing(t)}
                    >
                      Chỉnh sửa
                    </button>
                    <button
                      className="office-secondary"
                      aria-label={`Lịch sử ${t.name}`}
                      onClick={() => setHistory(t)}
                    >
                      <History size={16} />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
          {!templates.data?.length && (
            <OfficeEmpty
              title="Chưa có mẫu văn bản"
              description="Quản trị Office có thể tạo mẫu thông báo, quyết định hoặc công văn tại đây."
            />
          )}
        </div>
      )}
      {editing && (
        <TemplateEditor
          service={service}
          catalog={catalog}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            templates.refresh();
          }}
        />
      )}
      {history && (
        <TemplateHistory
          service={service}
          template={history}
          onClose={() => setHistory(null)}
        />
      )}
    </div>
  );
}
function TemplateEditor({
  service,
  catalog,
  initial,
  onClose,
  onSaved,
}: {
  service: OfficeService;
  catalog: OfficeCatalog;
  initial: Partial<OfficeTemplate>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState({
    name: "",
    document_group: "ANNOUNCEMENT",
    document_type_id: null,
    title: "",
    summary: "",
    content: EMPTY_OFFICE_CONTENT,
    is_active: true,
    ...initial,
  } as OfficeTemplate);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  return (
    <OfficeModal
      title={initial.id ? "Chỉnh sửa mẫu" : "Tạo mẫu văn bản"}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await service.configure("template", initial.id || null, value);
            onSaved();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <OfficeField label="Tên mẫu" required>
            <input
              aria-label="Tên mẫu"
              required
              maxLength={120}
              value={value.name}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
            />
          </OfficeField>
          <div className="office-form-grid">
            <OfficeField label="Nghiệp vụ">
              <select
                aria-label="Nghiệp vụ của mẫu"
                value={value.document_group}
                onChange={(e) =>
                  setValue({
                    ...value,
                    document_group: e.target
                      .value as OfficeDraft["document_group"],
                    document_type_id: null,
                  })
                }
              >
                {Object.entries(OFFICE_GROUPS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </OfficeField>
            <OfficeField label="Loại văn bản">
              <select
                aria-label="Loại văn bản của mẫu"
                value={value.document_type_id || ""}
                onChange={(e) =>
                  setValue({
                    ...value,
                    document_type_id: e.target.value || null,
                  })
                }
              >
                <option value="">Mọi loại trong nghiệp vụ</option>
                {catalog.types
                  .filter((t) => t.groups.includes(value.document_group))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </OfficeField>
          </div>
          <OfficeField label="Tiêu đề gợi ý">
            <input
              aria-label="Tiêu đề gợi ý"
              maxLength={500}
              value={value.title}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
            />
          </OfficeField>
          <OfficeField label="Trích yếu gợi ý">
            <textarea
              aria-label="Trích yếu gợi ý"
              maxLength={2000}
              value={value.summary}
              onChange={(e) => setValue({ ...value, summary: e.target.value })}
            />
          </OfficeField>
          <details className="office-template-help">
            <summary>Biến có thể chèn trong nội dung</summary>
            <dl>
              {Object.entries(OFFICE_TEMPLATE_FIELDS).map(([k, v]) => (
                <div key={k}>
                  <dt>{`{{${k}}}`}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p>
              Nhập biến vào vị trí cần điền. Số chính thức được điền khi cấp số.
            </p>
          </details>
          <OfficeRichTextEditor
            label="Nội dung mẫu"
            value={value.content}
            onChange={(content) => setValue({ ...value, content })}
            placeholder="Soạn nội dung chuẩn…"
          />
          <label className="office-check-label">
            <input
              type="checkbox"
              checked={value.is_active}
              onChange={(e) =>
                setValue({ ...value, is_active: e.target.checked })
              }
            />
            Cho phép sử dụng mẫu
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
            Đóng
          </button>
          <button className="office-primary" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu mẫu"}
          </button>
        </footer>
      </form>
    </OfficeModal>
  );
}
function TemplateHistory({
  service,
  template,
  onClose,
}: {
  service: OfficeService;
  template: OfficeTemplate;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0),
    [selected, setSelected] = useState<OfficeTemplate | null>(null);
  const history = useOfficeQuery(
    () => service.templateVersions(template.id, page),
    [service, template.id, page],
  );
  return (
    <OfficeModal title={`Lịch sử · ${template.name}`} onClose={onClose}>
      {history.loading ? (
        <OfficeLoading />
      ) : history.error ? (
        <OfficeError error={history.error} />
      ) : (
        <>
          <div className="office-version-list">
            {history.data?.map((v) => (
              <button
                className="office-secondary"
                key={v.version}
                onClick={() => setSelected(v.snapshot)}
              >
                v{v.version} · {v.actor_name} ·{" "}
                {displayDate(v.created_at, true)}
              </button>
            ))}
          </div>
          <div className="office-inline-actions">
            <button
              className="office-secondary"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              Mới hơn
            </button>
            <button
              className="office-secondary"
              disabled={(history.data?.length || 0) < 25}
              onClick={() => setPage(page + 1)}
            >
              Cũ hơn
            </button>
          </div>
          {selected && <OfficeRichTextView document={selected.content} />}
        </>
      )}
    </OfficeModal>
  );
}
export function OfficeTemplateChooser({
  service,
  draft,
  initialId,
  onClose,
  onApply,
}: {
  service: OfficeService;
  draft: OfficeDraft;
  initialId?: string;
  onClose: () => void;
  onApply: (patch: Partial<OfficeDraft>) => void;
}) {
  const templates = useOfficeQuery(() => service.templates(), [service]);
  const [id, setId] = useState(initialId || ""),
    [values, setValues] = useState<Record<string, string>>({
      document_title: draft.title,
      document_date: displayDate(draft.document_date),
      signer_position: draft.signer_position || "",
    });
  const chosen = templates.data?.find(
    (t) =>
      t.id === id &&
      t.is_active &&
      t.document_group === draft.document_group &&
      (!t.document_type_id || t.document_type_id === draft.document_type_id),
  );
  const vars = chosen
    ? officeTemplateVariables({
        ...chosen.content,
        content: [
          ...chosen.content.content,
          {
            type: "paragraph",
            content: [
              { type: "text", text: chosen.title + " " + chosen.summary },
            ],
          },
        ],
      }).filter((v) => v !== "document_number")
    : [];
  return (
    <OfficeModal title="Chọn mẫu văn bản" onClose={onClose}>
      {templates.loading ? (
        <OfficeLoading />
      ) : templates.error ? (
        <OfficeError error={templates.error} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen) {
              onApply({
                content: fillOfficeTemplate(chosen.content, values),
                ...(chosen.title && !draft.title
                  ? { title: fillOfficeText(chosen.title, values) }
                  : {}),
                ...(chosen.summary
                  ? { summary: fillOfficeText(chosen.summary, values) }
                  : {}),
              });
            }
          }}
        >
          <OfficeField label="Mẫu phù hợp">
            <select
              aria-label="Mẫu văn bản"
              value={id}
              onChange={(e) => setId(e.target.value)}
            >
              <option value="">Chọn mẫu…</option>
              {templates.data
                ?.filter(
                  (t) =>
                    t.is_active &&
                    t.document_group === draft.document_group &&
                    (!t.document_type_id ||
                      t.document_type_id === draft.document_type_id),
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · v{t.version}
                  </option>
                ))}
            </select>
          </OfficeField>
          {!templates.data?.length && (
            <OfficeEmpty
              title="Chưa có mẫu"
              description="Bạn vẫn có thể soạn nội dung trực tiếp."
            />
          )}
          {chosen && (
            <>
              <div className="office-form-grid">
                {vars.map((v) => (
                  <OfficeField
                    key={v}
                    label={OFFICE_TEMPLATE_FIELDS[v] || v}
                    required
                  >
                    <input
                      aria-label={OFFICE_TEMPLATE_FIELDS[v] || v}
                      required
                      value={values[v] || ""}
                      onChange={(e) =>
                        setValues({ ...values, [v]: e.target.value })
                      }
                    />
                  </OfficeField>
                ))}
              </div>
              <details open>
                <summary>Xem trước nội dung</summary>
                <OfficeRichTextView
                  document={fillOfficeTemplate(chosen.content, values)}
                />
              </details>
              <p className="office-helper">
                Áp dụng mẫu sẽ thay nội dung đang soạn. Người nhận và tuyến
                duyệt được giữ nguyên.
              </p>
            </>
          )}
          <footer>
            <button
              type="button"
              className="office-secondary"
              onClick={onClose}
            >
              Đóng
            </button>
            <button className="office-primary" disabled={!chosen}>
              Áp dụng mẫu
            </button>
          </footer>
        </form>
      )}
    </OfficeModal>
  );
}
export function OfficeExportButton({
  service,
  filters,
}: {
  service: OfficeService;
  filters: OfficeFilters;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [count, setCount] = useState<number | null>(null);
  return (
    <div>
      <button
        className="office-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setCount(null);
          try {
            const result = await service.export(filters);
            if (!result.items.length) {
              setCount(0);
              return;
            }
            await downloadOfficeWorkbook(
              result.items,
              filters.group === "INCOMING"
                ? "Sổ văn bản đến"
                : filters.group === "OUTGOING"
                  ? "Sổ văn bản đi"
                  : "Danh sách văn bản",
            );
            setCount(result.total);
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={16} />
        {busy ? "Đang xuất…" : "Xuất Excel"}
      </button>
      {error && <OfficeError error={error} />}{" "}
      {count !== null && (
        <small role="status">
          {count
            ? `Đã xuất ${count} văn bản theo bộ lọc.`
            : "Không có văn bản để xuất."}
        </small>
      )}
    </div>
  );
}
export function OfficeReportsPage({ service }: { service: OfficeService }) {
  const today = localDate();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`),
    [to, setTo] = useState(today);
  const valid = from <= to;
  const filters = { from, to };
  const report = useOfficeQuery(
    () =>
      valid
        ? service.report(filters)
        : Promise.reject(new Error("Khoảng ngày chưa hợp lệ.")),
    [service, from, to],
  );
  return (
    <div className="office-content">
      <div className="office-page-heading">
        <div>
          <p className="office-eyebrow">THEO DÕI VẬN HÀNH</p>
          <h1>Báo cáo văn bản</h1>
          <p>Số liệu theo ngày văn bản và phạm vi bạn được xem.</p>
        </div>
        {valid && <OfficeExportButton service={service} filters={filters} />}
      </div>
      <div className="office-report-filters">
        <OfficeField label="Từ ngày">
          <input
            aria-label="Báo cáo từ ngày"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </OfficeField>
        <OfficeField label="Đến ngày">
          <input
            aria-label="Báo cáo đến ngày"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </OfficeField>
      </div>
      {report.loading ? (
        <OfficeLoading />
      ) : report.error ? (
        <OfficeError error={report.error} retry={report.refresh} />
      ) : (
        report.data && (
          <>
            <div className="office-report-kpis">
              {[
                ["Tổng văn bản", report.data.total],
                ["Văn bản đến", report.data.incoming],
                ["Văn bản đi", report.data.outgoing],
                ["Thông báo", report.data.announcements],
                ["Chờ duyệt", report.data.pending],
                ["Quá hạn xử lý", report.data.overdue],
                ["Tôi chưa đọc", report.data.unread],
                [
                  "Duyệt trung bình",
                  report.data.averageApprovalHours === null
                    ? "Chưa có dữ liệu"
                    : `${report.data.averageApprovalHours} giờ`,
                ],
              ].map(([label, value]) => (
                <div className="office-panel" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="office-report-grid">
              <section className="office-panel office-form-section">
                <h2>Văn bản theo tháng</h2>
                {report.data.byMonth.length ? (
                  <table className="office-report-table">
                    <thead>
                      <tr>
                        <th>Tháng</th>
                        <th>Đến</th>
                        <th>Đi</th>
                        <th>Tổng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.data.byMonth.map((m) => (
                        <tr key={m.month}>
                          <th>{m.month}</th>
                          <td>{m.incoming}</td>
                          <td>{m.outgoing}</td>
                          <td>{m.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <OfficeEmpty title="Chưa có văn bản trong kỳ" />
                )}
              </section>
              <section className="office-panel office-form-section">
                <h2>Theo bộ phận ban hành</h2>
                {report.data.byDepartment.map((d) => (
                  <div className="office-report-bar" key={d.name}>
                    <span>{d.name}</span>
                    <strong>{d.total}</strong>
                    <progress max={report.data!.total || 1} value={d.total} />
                  </div>
                ))}
              </section>
            </div>
          </>
        )
      )}
    </div>
  );
}
export function OfficeVersions({
  service,
  detail,
}: {
  service: OfficeService;
  detail: OfficeDetail;
}) {
  const [page, setPage] = useState(0),
    [version, setVersion] = useState<number | null>(null);
  const list = useOfficeQuery(
    () => service.versions(detail.document.id, page),
    [service, detail.document.id, page],
  );
  const selected = useOfficeQuery(
    async () =>
      version
        ? Promise.all([
            service.version(detail.document.id, version),
            version > 1
              ? service.version(detail.document.id, version - 1)
              : Promise.resolve(null),
          ])
        : null,
    [service, detail.document.id, version],
  );
  const v = selected.data?.[0],
    previous = selected.data?.[1];
  return (
    <div className="office-version-panel">
      <p className="office-helper">
        Lịch sử chỉ đọc. Văn bản chính thức được điều chỉnh bằng thu hồi hoặc
        văn bản thay thế.
      </p>
      {list.loading ? (
        <OfficeLoading />
      ) : list.error ? (
        <OfficeError error={list.error} />
      ) : (
        <>
          <div className="office-version-list">
            {list.data?.map((v) => (
              <button
                key={v.version}
                className={`office-secondary ${version === v.version ? "is-active" : ""}`}
                onClick={() => setVersion(v.version)}
              >
                v{v.version} · {v.actor_name}
                <small>{displayDate(v.created_at, true)}</small>
              </button>
            ))}
          </div>
          <div className="office-inline-actions">
            <button
              className="office-secondary"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              Mới hơn
            </button>
            <button
              className="office-secondary"
              disabled={(list.data?.length || 0) < 25}
              onClick={() => setPage(page + 1)}
            >
              Cũ hơn
            </button>
          </div>
        </>
      )}
      {selected.loading ? (
        <OfficeLoading />
      ) : selected.error ? (
        <OfficeError error={selected.error} />
      ) : (
        v?.snapshot && (
          <section className="office-version-preview">
            <h2>Phiên bản {v.version}</h2>
            <p>
              {previous?.snapshot
                ? `Thay đổi: ${officeVersionChanges(previous.snapshot as any, v.snapshot as any).join(", ") || "Thao tác nghiệp vụ; nội dung giữ nguyên"}`
                : "Phiên bản đầu tiên"}
            </p>
            <div className="office-version-compare">
              {previous?.snapshot && (
                <section>
                  <h3>Trước · v{previous.version}</h3>
                  <strong>{previous.snapshot.title}</strong>
                  <OfficeRichTextView document={previous.snapshot.content} />
                </section>
              )}
              <section>
                <h3>Sau · v{v.version}</h3>
                <strong>{v.snapshot.title}</strong>
                <OfficeRichTextView document={v.snapshot.content} />
              </section>
            </div>
            <p>{v.snapshot.attachments?.length || 0} tệp tại thời điểm này</p>
          </section>
        )
      )}
    </div>
  );
}
export function OfficeLinks({
  service,
  detail,
  refresh,
}: {
  service: OfficeService;
  detail: OfficeDetail;
  refresh: () => void;
}) {
  const list = useOfficeQuery(
    () => service.links(detail.document.id),
    [service, detail.document.id, detail.document.version],
  );
  const [kind, setKind] = useState<OfficeTargetType>("document"),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [target, setTarget] = useState<OfficeTarget | null>(null),
    [relation, setRelation] = useState("related"),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const options = useOfficeQuery(
    () => (open ? service.targets(kind, query) : Promise.resolve([])),
    [service, open, kind, query],
  );
  const command = useOfficeCommand(service);
  const labels: Record<string, string> = {
    related: "Liên quan",
    replaces: "Thay thế",
    responds_to: "Phản hồi",
    implements: "Triển khai",
  };
  async function change(mode: "link_add" | "link_remove", payload: object) {
    setBusy(true);
    setError(null);
    try {
      await command({
        command: mode,
        documentId: detail.document.id,
        expectedVersion: detail.document.version,
        payload,
      });
      setOpen(false);
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="office-links-panel">
      <div className="office-section-heading">
        <div>
          <h2>Văn bản & hồ sơ liên quan</h2>
          <p>Chỉ hiện hồ sơ bạn được phép xem ở module nguồn.</p>
        </div>
        {detail.capabilities.edit && (
          <button className="office-secondary" onClick={() => setOpen(true)}>
            <Link2 size={15} />
            Thêm liên kết
          </button>
        )}
      </div>
      {error && <OfficeError error={error} />}
      {list.loading ? (
        <OfficeLoading />
      ) : list.error ? (
        <OfficeError error={list.error} />
      ) : list.data?.length ? (
        <ul className="office-links-list">
          {list.data.map((l) => (
            <li key={l.id}>
              <Link to={l.target.href}>
                <small>
                  {l.incoming ? "Được liên kết từ · " : ""}
                  {labels[l.relation]}
                </small>
                <strong>{l.target.label}</strong>
              </Link>
              {detail.capabilities.edit && !l.incoming && (
                <button
                  className="office-text-button"
                  aria-label={`Gỡ liên kết ${l.target.label}`}
                  disabled={busy}
                  onClick={() => void change("link_remove", { linkId: l.id })}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <OfficeEmpty title="Chưa có liên kết hiển thị" />
      )}
      {open && (
        <OfficeModal title="Liên kết hồ sơ" onClose={() => setOpen(false)}>
          <OfficeField label="Loại hồ sơ">
            <select
              aria-label="Loại hồ sơ liên kết"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as OfficeTargetType);
                setTarget(null);
              }}
            >
              {[
                ["document", "Văn bản Office"],
                ["project", "Dự án"],
                ["work_task", "Công việc"],
                ["project_contract", "Hợp đồng dự án"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </OfficeField>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search);
            }}
            className="office-inline-actions"
          >
            <input
              aria-label="Tìm hồ sơ liên kết"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tên hoặc số hồ sơ…"
            />
            <button className="office-secondary">Tìm</button>
          </form>
          {options.loading ? (
            <OfficeLoading />
          ) : options.error ? (
            <OfficeError error={options.error} />
          ) : (
            <div className="office-target-options">
              {options.data
                ?.filter((t) => t.id !== detail.document.id)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`office-secondary ${target?.id === t.id ? "is-active" : ""}`}
                    onClick={() => setTarget(t)}
                  >
                    {t.label}
                  </button>
                ))}
            </div>
          )}
          <OfficeField label="Mối quan hệ">
            <select
              aria-label="Mối quan hệ"
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
            >
              {Object.entries(labels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </OfficeField>
          {error && <OfficeError error={error} />}
          <footer>
            <button className="office-secondary" onClick={() => setOpen(false)}>
              Đóng
            </button>
            <button
              className="office-primary"
              disabled={!target || busy}
              onClick={() =>
                void change("link_add", {
                  targetType: kind,
                  targetId: target!.id,
                  relation,
                })
              }
            >
              Thêm liên kết
            </button>
          </footer>
        </OfficeModal>
      )}
    </div>
  );
}
