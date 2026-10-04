import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import SearchableSelect from "../../components/common/SearchableSelect";
import type { OfficeService } from "../../lib/office/officeService";
import type {
  AudienceKind,
  OfficeGroup,
  OfficeOption,
  OfficeStatus,
} from "../../lib/office/officeTypes";
import {
  OFFICE_STATUSES,
  officeError,
} from "../../lib/office/officePresentation";

export function useOfficeQuery<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const n = ++sequence.current;
    setLoading(true);
    setError(null);
    setData(null);
    load()
      .then((value) => {
        if (sequence.current === n) setData(value);
      })
      .catch((e) => {
        if (sequence.current === n) setError(e);
      })
      .finally(() => {
        if (sequence.current === n) setLoading(false);
      });
    return () => {
      sequence.current++;
    };
  }, [...deps, revision]);
  return { data, error, loading, refresh: () => setRevision((n) => n + 1) };
}
export function OfficeError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="office-error" role="alert">
      <AlertCircle size={19} />
      <div>
        <p>{officeError(error)}</p>
        {retry && (
          <button type="button" onClick={retry}>
            <RefreshCw size={14} /> Thử lại
          </button>
        )}
      </div>
    </div>
  );
}
export function OfficeLoading() {
  return (
    <div className="office-loading" role="status">
      <Loader2 className="office-spin" size={21} /> Đang tải văn bản…
    </div>
  );
}
export function OfficeEmpty({
  title = "Chưa có văn bản",
  description = "Văn bản phù hợp sẽ xuất hiện tại đây.",
  children,
}: {
  title?: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="office-empty">
      <FileText size={32} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function OfficeBadge({
  status,
  group,
}: {
  status: OfficeStatus;
  group?: OfficeGroup;
}) {
  return (
    <span className="office-badge" data-status={status}>
      {group === "INCOMING" && status === "ISSUED"
        ? "Đã phân phối"
        : OFFICE_STATUSES[status] || "Không rõ trạng thái"}
    </span>
  );
}
export function OfficePagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="office-pagination">
      <span>
        {total === 0
          ? "0 văn bản"
          : `${page * 25 + 1}–${Math.min((page + 1) * 25, total)} / ${total}`}
      </span>
      <div>
        <button
          aria-label="Trang trước"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <span>Trang {page + 1}</span>
        <button
          aria-label="Trang tiếp"
          disabled={(page + 1) * 25 >= total}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
export function OfficePicker({
  service,
  kind,
  value,
  onChange,
  label,
  disabled = false,
}: {
  service: OfficeService;
  kind: Exclude<AudienceKind, "company">;
  value?: string | null;
  onChange: (value: OfficeOption | null) => void;
  label: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 180);
    return () => clearTimeout(timer);
  }, [query]);
  const options = useOfficeQuery(
    () => service.options(kind, search, value ? [value] : []),
    [service, kind, search, value],
  );
  // Keep the selected option visible during the next server search.
  const [known, setKnown] = useState<OfficeOption[]>([]);
  useEffect(() => {
    if (options.data) setKnown(options.data);
  }, [options.data]);
  return (
    <div className="office-picker">
      <SearchableSelect
        options={options.data || known}
        value={value}
        getOptionValue={(x) => x.id}
        getOptionLabel={(x) => x.name}
        onChange={(option) => {
          setQuery("");
          onChange(option);
        }}
        onSearchChange={setQuery}
        ariaLabel={label}
        placeholder={label}
        disabled={disabled}
        emptyLabel={options.loading ? "Đang tìm…" : "Không có kết quả"}
        inputClassName="office-picker-input"
      />
      {options.error && (
        <OfficeError error={options.error} retry={options.refresh} />
      )}
    </div>
  );
}
export function OfficeField({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="office-field">
      <span className="office-field-label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function OfficeModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="office-modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label="Đóng" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
