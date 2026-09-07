import React, { useEffect, useRef, useState } from "react";
import type {
  WorkOption,
  WorkOptionKind,
  WorkTaskService,
} from "../../lib/work/workTaskService";
import type { WorkScope } from "../../lib/work/workTypes";
import { workError } from "../../lib/work/workForm";
interface Props {
  service: WorkTaskService;
  kind: WorkOptionKind;
  scope: WorkScope | null;
  label: string;
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  clearable?: boolean;
  labels?: Record<string, string>;
}
export function WorkPicker({
  service,
  kind,
  scope,
  label,
  value,
  onChange,
  multiple = true,
  clearable = true,
  labels = {},
}: Props) {
  const [loadedIdentity, setLoadedIdentity] = useState("");
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [items, setItems] = useState<WorkOption[]>([]),
    [cursor, setCursor] = useState<{ id: string } | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<unknown>(null),
    [known, setKnown] = useState<Record<string, string>>({});
  const seq = useRef(0),
    scopeId = JSON.stringify(scope);
  const requestIdentity = JSON.stringify([kind, scopeId, search]);
  const current = useRef(requestIdentity);
  current.current = requestIdentity;
  async function load(append = false) {
    const n = ++seq.current,
      identity = requestIdentity;
    setLoading(true);
    setError(null);
    try {
      const page = await service.options(
        kind,
        scope,
        search,
        append ? cursor : null,
      );
      if (seq.current !== n || current.current !== identity) return;
      setLoadedIdentity(identity);
      setItems((old) => (append ? [...old, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setKnown((old) => ({
        ...old,
        ...Object.fromEntries(page.items.map((x) => [x.id, x.name])),
      }));
    } catch (e) {
      if (seq.current === n && current.current === identity) setError(e);
    } finally {
      if (seq.current === n) setLoading(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setCursor(null);
    if (!open) return;
    const timer = setTimeout(() => void load(), 200);
    return () => {
      clearTimeout(timer);
      seq.current++;
    };
  }, [open, requestIdentity, service]);
  return (
    <div className="work-picker">
      <span className="work-label">{label}</span>
      <div className="work-chips">
        {value.map((id) => (
          <span className="work-chip" key={id}>
            {labels[id] || known[id] || "Lựa chọn đã lưu"}
            {clearable && (
              <button
                type="button"
                aria-label={`Bỏ ${labels[id] || known[id] || label}`}
                onClick={() => onChange(value.filter((x) => x !== id))}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="work-input work-picker-trigger"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Chọn {label.toLowerCase()} <span>⌄</span>
      </button>
      {open && (
        <div className="work-picker-panel">
          <input
            className="work-input"
            aria-label={`Tìm ${label.toLowerCase()}`}
            placeholder="Tìm theo tên…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {loading && <p role="status">Đang tìm…</p>}
          {error ? (
            <p role="alert">
              {workError(error)}{" "}
              <button type="button" onClick={() => void load()}>
                Thử lại
              </button>
            </p>
          ) : (
            <ul>
              {(loadedIdentity === requestIdentity ? items : []).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={value.includes(item.id)}
                    onClick={() => {
                      onChange(
                        multiple
                          ? value.includes(item.id)
                            ? value.filter((x) => x !== item.id)
                            : [...value, item.id]
                          : [item.id],
                      );
                      if (!multiple) setOpen(false);
                    }}
                  >
                    {item.name}
                    <small>
                      {item.kind === "department"
                        ? "Phòng ban"
                        : item.kind === "project"
                          ? "Dự án"
                          : value.includes(item.id)
                            ? "Đã chọn"
                            : ""}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!loading && !error && !items.length && (
            <p>Không có lựa chọn phù hợp.</p>
          )}
          {cursor && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(true)}
            >
              Xem thêm lựa chọn
            </button>
          )}
        </div>
      )}
    </div>
  );
}
