import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bookmark,
  Building2,
  CheckCheck,
  Clock3,
  FileText,
  Filter,
  FolderOpen,
  Hash,
  Inbox,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import type { OfficeService } from "../../lib/office/officeService";
import type {
  OfficeCatalog,
  OfficeFilters,
  OfficeGroup,
  OfficeSummary,
  OfficeView,
} from "../../lib/office/officeTypes";
import {
  CONFIDENTIALITY,
  displayDate,
  OFFICE_GROUPS,
  OFFICE_STATUSES,
  OFFICE_VIEWS,
  processingLabel,
  URGENCY,
} from "../../lib/office/officePresentation";
import {
  OfficeBadge,
  OfficeEmpty,
  OfficeError,
  OfficeField,
  OfficeLoading,
  OfficePagination,
  OfficePicker,
  useOfficeQuery,
} from "./OfficeShared";
import { OfficeAssistant } from "./OfficeAssistant";
import { OfficeExportButton } from "./OfficeLibrary";
export const groupIcons = {
  ANNOUNCEMENT: Bell,
  INCOMING: ArrowDownLeft,
  OUTGOING: ArrowUpRight,
  INTERNAL: FileText,
};
function DocumentRows({ items }: { items: OfficeSummary[] }) {
  return (
    <div className="office-document-list">
      <div className="office-list-heading">
        <span>Văn bản</span>
        <span>Trạng thái</span>
        <span>Đơn vị / người ban hành</span>
        <span>Ngày văn bản</span>
      </div>
      {items.map((doc) => {
        const Icon = groupIcons[doc.document_group];
        return (
          <Link
            className="office-document-row"
            key={doc.id}
            to={`/office/documents/${doc.id}`}
          >
            <div className="office-document-title">
              <div className="office-file-icon">
                <Icon size={20} />
              </div>
              <div>
                <div className="office-document-code">
                  {doc.document_number ||
                    doc.source_document_number ||
                    (doc.document_group === "INCOMING"
                      ? "Văn bản đến"
                      : "Chưa cấp số")}
                  {doc.is_recipient &&
                    !doc.read_at &&
                    doc.issued_at &&
                    !doc.revoked_at && (
                      <span className="office-unread">Chưa đọc</span>
                    )}
                  {doc.urgency !== "NORMAL" && (
                    <span className="office-urgent">
                      {URGENCY[doc.urgency]}
                    </span>
                  )}
                </div>
                <h3>{doc.title}</h3>
                <p>
                  {doc.type_name}
                  {doc.project_name ? ` · ${doc.project_name}` : ""}
                  {doc.confidentiality === "CONFIDENTIAL" ? " · Bảo mật" : ""}
                </p>
              </div>
            </div>
            <div className="office-row-status">
              <OfficeBadge status={doc.status} group={doc.document_group} />
              {doc.revoked_at && doc.status !== "REVOKED" && (
                <OfficeBadge status="REVOKED" />
              )}
              {doc.processing_status && (
                <small>
                  {processingLabel(doc.processing_status, doc.due_date)}
                </small>
              )}
            </div>
            <div className="office-row-issuer">
              <span>
                {doc.department_name || doc.signer_name || doc.creator_name}
              </span>
              <small>
                {doc.signer_name && doc.department_name
                  ? doc.signer_name
                  : doc.creator_name}
              </small>
            </div>
            <div className="office-row-date">
              <span>{displayDate(doc.document_date)}</span>
              <ArrowRight size={16} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
export function OfficeDashboardPage({
  service,
  catalog,
}: {
  service: OfficeService;
  catalog: OfficeCatalog;
}) {
  const stats = useOfficeQuery(() => service.dashboard(), [service]);
  const latest = useOfficeQuery(
    () => service.list({ pageSize: 6, sort: "newest" }),
    [service],
  );
  const kpis = [
    ["unread", "Chưa đọc", Inbox, "unread"],
    ["approval", "Chờ tôi duyệt", ShieldCheck, "approval"],
    ["numbering", "Chờ cấp số", Hash, "numbering"],
    ["assigned", "Được giao xử lý", Clock3, "assigned"],
  ] as const;
  return (
    <div className="office-content">
      <div className="office-page-heading">
        <div>
          <p className="office-eyebrow">KHÔNG GIAN VĂN BẢN</p>
          <h1>Văn bản rõ ràng. Công việc thông suốt.</h1>
          <p>Tiếp nhận, phê duyệt và theo dõi văn bản trong một nơi.</p>
        </div>
        <span className="office-today">
          {new Intl.DateTimeFormat("vi-VN", {
            weekday: "long",
            day: "numeric",
            month: "long",
            timeZone: "Asia/Ho_Chi_Minh",
          }).format(new Date())}
        </span>
      </div>
      {stats.error ? (
        <OfficeError error={stats.error} retry={stats.refresh} />
      ) : (
        <section className="office-kpis" aria-label="Công việc của tôi">
          {kpis.map(([key, label, Icon, view]) => (
            <Link key={key} to={`/office/documents?view=${view}`}>
              <div>
                <span>{label}</span>
                <Icon size={19} />
              </div>
              <strong>
                {stats.loading ? "—" : (stats.data?.[key] ?? "—")}
              </strong>
              <small>
                Xem văn bản <ArrowRight size={13} />
              </small>
            </Link>
          ))}
        </section>
      )}
      {stats.data && (
        <div className="office-dashboard-strip">
          <span>
            <CheckCheck size={18} />
            <strong>{stats.data.issuedThisMonth}</strong> văn bản phát hành
            tháng này
          </span>
          <span>
            <Bell size={17} />
            <strong>{stats.data.new}</strong> văn bản mới trong 7 ngày
          </span>
          <Link
            className={stats.data.overdue ? "office-text-danger" : ""}
            to="/office/documents?view=overdue"
          >
            <Clock3 size={17} />
            <strong>{stats.data.overdue}</strong> văn bản quá hạn{" "}
            <ArrowRight size={14} />
          </Link>
        </div>
      )}
      <div className="office-dashboard-columns">
        <section className="office-panel">
          <header className="office-section-heading">
            <div>
              <h2>Văn bản gần đây</h2>
              <p>Các văn bản trong phạm vi bạn được xem.</p>
            </div>
            <Link to="/office/documents">
              Xem tất cả <ArrowRight size={15} />
            </Link>
          </header>
          {latest.loading ? (
            <OfficeLoading />
          ) : latest.error ? (
            <OfficeError error={latest.error} retry={latest.refresh} />
          ) : latest.data?.items.length ? (
            <DocumentRows items={latest.data.items} />
          ) : (
            <OfficeEmpty description="Bắt đầu bằng một bản nháp hoặc tiếp nhận công văn đến.">
              {catalog.canCreate && (
                <Link className="office-primary" to="/office/new">
                  Tạo văn bản đầu tiên
                </Link>
              )}
            </OfficeEmpty>
          )}
        </section>
        <aside className="office-panel office-start">
          <p className="office-eyebrow">BẮT ĐẦU TỪ CÔNG VIỆC</p>
          <h2>Bạn muốn làm gì?</h2>
          {(
            Object.entries(OFFICE_GROUPS) as [
              OfficeGroup,
              (typeof OFFICE_GROUPS)[OfficeGroup],
            ][]
          ).map(([key, g]) => {
            const Icon = groupIcons[key];
            return (
              <Link
                key={key}
                to={
                  catalog.canCreate
                    ? `/office/new?group=${key}`
                    : `/office/documents?group=${key}`
                }
              >
                <Icon size={19} />
                <span>
                  <strong>{g.label}</strong>
                  <small>{g.description}</small>
                </span>
                <ArrowRight size={16} />
              </Link>
            );
          })}
          <div className="office-note">
            <ShieldCheck size={18} />
            <p>
              Văn bản được duyệt, cấp số rồi mới phát hành. Mọi thao tác đều có
              lịch sử.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
export function OfficeListPage({
  service,
  catalog,
}: {
  service: OfficeService;
  catalog: OfficeCatalog;
}) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const [advanced, setAdvanced] = useState(false);
  useEffect(
    () => setSearch(params.get("search") || ""),
    [params.get("search")],
  );
  const view = (params.get("view") || "all") as OfficeView;
  const filters = Object.fromEntries(params.entries()) as OfficeFilters;
  filters.page = Number(params.get("page") || 0);
  filters.view = view;
  const list = useOfficeQuery(
    () => service.list(filters),
    [service, params.toString()],
  );
  const change = (key: string, value: string) => {
    setParams((old) => {
      const next = new URLSearchParams(old);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    });
  };
  const nav = [
    ["all", FileText],
    ["unread", Inbox],
    ["approval", ShieldCheck],
    ["numbering", Hash],
    ["assigned", Clock3],
    ["created", Building2],
    ["following", Bell],
    ["favorites", Bookmark],
    ["archive", FolderOpen],
  ] as const;
  const title = OFFICE_VIEWS[view] || "Văn bản";
  const count = Array.from(params.keys()).filter(
    (k) => !["page", "view", "sort", "group"].includes(k),
  ).length;
  return (
    <div className="office-workspace">
      <aside className="office-local-nav" aria-label="Nhóm văn bản">
        <p>CÔNG VIỆC CỦA TÔI</p>
        {nav.map(([key, Icon]) => (
          <button
            key={key}
            className={view === key ? "is-active" : ""}
            onClick={() => change("view", key)}
          >
            <Icon size={17} />
            {OFFICE_VIEWS[key]}
          </button>
        ))}
        <p>KHO LƯU TRỮ</p>
        {catalog.folders
          .filter((f) => f.is_active)
          .map((f) => (
            <button
              key={f.id}
              className={params.get("folderId") === f.id ? "is-active" : ""}
              style={{ paddingLeft: f.parent_id ? 28 : 12 }}
              onClick={() =>
                change("folderId", params.get("folderId") === f.id ? "" : f.id)
              }
            >
              <FolderOpen size={15} />
              <span>{f.name}</span>
            </button>
          ))}
      </aside>
      <div className="office-list-main">
        <div className="office-page-heading">
          <div>
            <h1>{title}</h1>
            <p>Tìm đúng văn bản, nắm rõ trạng thái và bước tiếp theo.</p>
          </div>
          <div className="office-inline-actions">
            <OfficeAssistant service={service} searchOnly />
            <OfficeExportButton service={service} filters={filters} />
          </div>
        </div>
        <div className="office-mobile-view">
          <label>
            Danh sách{" "}
            <select
              value={view}
              onChange={(e) => change("view", e.target.value)}
            >
              {Object.entries(OFFICE_VIEWS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="office-group-tabs">
          <button
            className={!filters.group ? "is-active" : ""}
            onClick={() => change("group", "")}
          >
            Tất cả
          </button>
          {Object.entries(OFFICE_GROUPS).map(([key, g]) => (
            <button
              key={key}
              className={filters.group === key ? "is-active" : ""}
              onClick={() => change("group", key)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="office-list-toolbar">
          <form
            className="office-search"
            onSubmit={(e) => {
              e.preventDefault();
              change("search", search.trim());
            }}
          >
            <Search size={17} />
            <input
              aria-label="Tìm văn bản"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm số, tiêu đề, nội dung, người tạo, đơn vị gửi…"
            />
            <button type="submit">Tìm</button>
          </form>
          <button
            className="office-secondary"
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            <Filter size={16} />
            Bộ lọc{count > 0 && ` (${count})`}
          </button>
          <select
            aria-label="Sắp xếp văn bản"
            value={filters.sort || "newest"}
            onChange={(e) => change("sort", e.target.value)}
          >
            <option value="newest">Mới nhất</option>
            <option value="oldest">Cũ nhất</option>
            <option value="title">Theo tiêu đề</option>
          </select>
        </div>
        {advanced && (
          <div className="office-filter-panel">
            <OfficeField label="Trạng thái">
              <select
                aria-label="Lọc trạng thái"
                value={filters.status || ""}
                onChange={(e) => change("status", e.target.value)}
              >
                <option value="">Tất cả trạng thái</option>
                {Object.entries(OFFICE_STATUSES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </OfficeField>
            <OfficeField label="Loại văn bản">
              <select
                aria-label="Lọc loại"
                value={filters.typeId || ""}
                onChange={(e) => change("typeId", e.target.value)}
              >
                <option value="">Tất cả loại</option>
                {catalog.types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </OfficeField>
            {(
              [
                ["departmentId", "department", "Phòng ban"],
                ["projectId", "project", "Dự án"],
              ] as const
            ).map(([key, kind, label]) => (
              <OfficeField key={key} label={label}>
                <OfficePicker
                  service={service}
                  kind={kind}
                  value={filters[key]}
                  onChange={(o) => change(key, o?.id || "")}
                  label={`Lọc ${label.toLowerCase()}`}
                />
              </OfficeField>
            ))}
            <details className="office-filter-more">
              <summary>Thêm điều kiện lọc</summary>
              <div className="office-filter-extra">
                {(
                  [
                    ["siteId", "site", "Công trường"],
                    ["creatorId", "user", "Người tạo"],
                    ["signerId", "user", "Người ký"],
                  ] as const
                ).map(([key, kind, label]) => (
                  <OfficeField key={key} label={label}>
                    <OfficePicker
                      service={service}
                      kind={kind}
                      value={filters[key]}
                      onChange={(o) => change(key, o?.id || "")}
                      label={`Lọc ${label.toLowerCase()}`}
                    />
                  </OfficeField>
                ))}
                <OfficeField label="Mức độ khẩn">
                  <select
                    aria-label="Lọc mức độ khẩn"
                    value={filters.urgency || ""}
                    onChange={(e) => change("urgency", e.target.value)}
                  >
                    <option value="">Tất cả</option>
                    {Object.entries(URGENCY).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </OfficeField>
                <OfficeField label="Bảo mật">
                  <select
                    aria-label="Lọc bảo mật"
                    value={filters.confidentiality || ""}
                    onChange={(e) => change("confidentiality", e.target.value)}
                  >
                    <option value="">Tất cả</option>
                    {Object.entries(CONFIDENTIALITY).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </OfficeField>
                <OfficeField label="Từ ngày">
                  <input
                    aria-label="Từ ngày"
                    type="date"
                    value={filters.from || ""}
                    onChange={(e) => change("from", e.target.value)}
                  />
                </OfficeField>
                <OfficeField label="Đến ngày">
                  <input
                    aria-label="Đến ngày"
                    type="date"
                    value={filters.to || ""}
                    onChange={(e) => change("to", e.target.value)}
                  />
                </OfficeField>
                <OfficeField label="Kho lưu trữ">
                  <select
                    aria-label="Lọc kho"
                    value={filters.folderId || ""}
                    onChange={(e) => change("folderId", e.target.value)}
                  >
                    <option value="">Tất cả kho</option>
                    {catalog.folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </OfficeField>
              </div>
            </details>
            <button
              className="office-secondary office-filter-done"
              onClick={() => setAdvanced(false)}
            >
              Xem kết quả
            </button>
          </div>
        )}
        {count > 0 && (
          <div className="office-active-filters">
            <span>
              Đang áp dụng {count} bộ lọc
              {filters.search ? ` · “${filters.search}”` : ""}
            </span>
            <button
              onClick={() => {
                setSearch("");
                setParams(view === "all" ? {} : { view });
              }}
            >
              <X size={13} />
              Xóa bộ lọc
            </button>
          </div>
        )}
        <section className="office-panel">
          {list.loading ? (
            <OfficeLoading />
          ) : list.error ? (
            <OfficeError error={list.error} retry={list.refresh} />
          ) : list.data?.items.length ? (
            <DocumentRows items={list.data.items} />
          ) : (
            <OfficeEmpty
              title="Không có văn bản phù hợp"
              description="Thử đổi bộ lọc hoặc chọn một danh sách khác."
            />
          )}
          {list.data && (
            <OfficePagination
              page={filters.page || 0}
              total={list.data.total}
              onChange={(p) => change("page", String(p))}
            />
          )}
        </section>
      </div>
    </div>
  );
}
