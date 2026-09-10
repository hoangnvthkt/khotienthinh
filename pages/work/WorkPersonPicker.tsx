import React, { useEffect, useRef, useState } from "react";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import { workError } from "../../lib/work/workForm";
export function WorkPersonPicker({
  service,
  taskId,
  action,
  value,
  onChange,
  names = {},
  multiple = true,
}: {
  service: WorkTaskService;
  taskId: string;
  action: "mention" | "transfer" | "add_assignees";
  value: string[];
  onChange: (ids: string[]) => void;
  names?: Record<string, string>;
  multiple?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [items, setItems] = useState<{ userId: string; name: string }[]>([]),
    [known, setKnown] = useState<Record<string, string>>({}),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<unknown>(null);
  const epoch = useRef(0),
    identity = JSON.stringify([taskId, action, search]),
    current = useRef(identity);
  current.current = identity;
  const [loaded, setLoaded] = useState("");
  async function load(append = false) {
    const n = ++epoch.current,
      key = identity;
    setLoading(true);
    setError(null);
    try {
      const page =
        action === "mention"
          ? await service.mentions(taskId, search, append ? cursor : null)
          : await service.assigneeOptions(
              taskId,
              action,
              search,
              append ? cursor : null,
            );
      if (n !== epoch.current || current.current !== key) return;
      setItems((old) => (append ? [...old, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setLoaded(key);
      setKnown((old) => ({
        ...old,
        ...Object.fromEntries(page.items.map((x) => [x.userId, x.name])),
      }));
    } catch (e) {
      if (n === epoch.current) setError(e);
    } finally {
      if (n === epoch.current) setLoading(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setCursor(null);
    const timer = setTimeout(() => void load(), 200);
    return () => {
      clearTimeout(timer);
      epoch.current++;
    };
  }, [identity, service]);
  return (
    <div className="work-person-picker">
      <div className="work-chips">
        {value.map((id) => (
          <span className="work-chip" key={id}>
            {known[id] || names[id] || "Người đã chọn"}
            <button
              type="button"
              aria-label="Bỏ người đã chọn"
              onClick={() => onChange(value.filter((x) => x !== id))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        className="work-input"
        aria-label={
          action === "mention" ? "Tìm người để nhắc tên" : "Tìm người nhận việc"
        }
        maxLength={100}
        placeholder="Tìm theo tên…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error && (
        <p role="alert">
          {workError(error)}{" "}
          <button type="button" onClick={() => void load()}>
            Thử lại
          </button>
        </p>
      )}
      {loading && <p role="status">Đang tìm…</p>}
      <ul>
        {(loaded === identity ? items : []).map((p) => (
          <li key={p.userId}>
            <button
              type="button"
              aria-pressed={value.includes(p.userId)}
              onClick={() =>
                onChange(
                  multiple
                    ? value.includes(p.userId)
                      ? value.filter((x) => x !== p.userId)
                      : [...value, p.userId]
                    : [p.userId],
                )
              }
            >
              {p.name}
              <span>{value.includes(p.userId) ? "Đã chọn" : ""}</span>
            </button>
          </li>
        ))}
      </ul>
      {!loading && !error && loaded === identity && !items.length && (
        <p>Không có người phù hợp.</p>
      )}
      {cursor && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(true)}
        >
          Xem thêm người
        </button>
      )}
    </div>
  );
}
