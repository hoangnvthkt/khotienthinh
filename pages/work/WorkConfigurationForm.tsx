import React, { useEffect, useRef, useState } from "react";
import {
  ConfigAttempt,
  configurationFields,
  parseWorkIntervals,
  type ConfigKind,
  type ConfigRecord,
  type ConfigScope,
  type WorkConfigurationService,
} from "../../lib/work/workConfigurationService";
import { localDeadline, workError } from "../../lib/work/workForm";
interface Props {
  service: WorkConfigurationService;
  commandAttempt: ConfigAttempt;
  scope: ConfigScope;
  kind: ConfigKind;
  record: ConfigRecord | null;
  parent: string | null;
  close: () => void;
  saved: () => void;
}
export function WorkConfigurationForm({
  service,
  commandAttempt,
  scope,
  kind,
  record,
  parent,
  close,
  saved,
}: Props) {
  const [current, setCurrent] = useState(record),
    [generation, setGeneration] = useState(0),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(!!commandAttempt.pending),
    [conflict, setConflict] = useState(false),
    [options, setOptions] = useState<ConfigRecord[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [optionError, setOptionError] = useState<unknown>(null),
    [optionBusy, setOptionBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    attempt = useRef(commandAttempt),
    live = useRef(true),
    form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    live.current = true;
    dialog.current?.showModal();
    const warn = (e: BeforeUnloadEvent) => {
      if (attempt.current.pending) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      live.current = false;
      window.removeEventListener("beforeunload", warn);
    };
  }, []);
  async function calendars(append = false) {
    setOptionBusy(true);
    setOptionError(null);
    try {
      const p = await service.list(
        "calendar_option",
        scope,
        null,
        append ? cursor : null,
      );
      if (live.current) {
        setOptions((old) => (append ? [...old, ...p.items] : p.items));
        setCursor(p.nextCursor);
      }
    } catch (e) {
      if (live.current) setOptionError(e);
    } finally {
      if (live.current) setOptionBusy(false);
    }
  }
  useEffect(() => {
    if (kind === "policy") void calendars();
  }, []);
  const pick = (name: string, fallback: string | number = "") =>
    String(current?.[name] ?? fallback);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setConflict(false);
    try {
      if (!attempt.current.pending) {
        const f = new FormData(e.currentTarget),
          data: Record<string, unknown> = {};
        for (const field of configurationFields[kind]) {
          if (["is_active", "is_default", "is_working_day"].includes(field))
            data[field] = f.has(field);
          else if (field === "working_weekdays")
            data[field] = f.getAll(field).map(Number);
          else if (field === "working_intervals")
            data[field] =
              kind === "exception" && !f.has("is_working_day")
                ? []
                : parseWorkIntervals(String(f.get(field) || ""));
          else if (
            [
              "sort_order",
              "acknowledgement_minutes",
              "execution_minutes",
            ].includes(field)
          )
            data[field] = f.get(field) === "" ? null : Number(f.get(field));
          else if (["effective_from", "effective_to"].includes(field))
            data[field] = f.get(field)
              ? new Date(String(f.get(field))).toISOString()
              : null;
          else data[field] = f.get(field) || null;
        }
        if (kind === "exception" && f.has("remove")) data.remove = true;
        attempt.current.begin({
          kind,
          scope,
          id: current?.id || null,
          version: current?.lock_version || null,
          data,
          reason: String(f.get("reason") || ""),
        });
      }
      setPending(true);
      setBusy(true);
      await attempt.current.run(service);
      if (live.current) saved();
    } catch (e) {
      if (live.current) {
        setError(e);
        setConflict((e as Error).message === "WORK_VERSION_CONFLICT");
      }
    } finally {
      if (live.current) {
        setBusy(false);
        setPending(!!attempt.current.pending);
      }
    }
  }
  async function reload() {
    if (!current) return;
    setBusy(true);
    try {
      const p = await service.list(kind, scope, parent, null, current.id);
      if (!p.items[0]) throw new Error("WORK_CONFIGURATION_NOT_FOUND");
      if (live.current) {
        setCurrent(p.items[0]);
        setGeneration((v) => v + 1);
        setConflict(false);
        setError(null);
      }
    } catch (e) {
      if (live.current) setError(e);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  const input = (
    name: string,
    label: string,
    type = "text",
    fallback: string | number = "",
    required = true,
  ) => (
    <label className="work-label">
      {label}
      <input
        className="work-input"
        name={name}
        type={type}
        defaultValue={pick(name, fallback)}
        required={required}
        minLength={name === "name" ? 2 : undefined}
        maxLength={name === "name" ? 160 : undefined}
        min={type === "number" ? 0 : undefined}
      />
    </label>
  );
  return (
    <dialog
      ref={dialog}
      className="work-config-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!attempt.current.pending && !busy) close();
      }}
      aria-labelledby="work-config-title"
    >
      <h2 id="work-config-title">
        {current ? "Sửa cấu hình" : "Thêm cấu hình"}
      </h2>
      <p>
        Mọi thay đổi được ghi lịch sử. Deadline và SLA đã ghi nhận trên công
        việc được giữ nguyên.
      </p>
      <form ref={form} onSubmit={save} key={generation}>
        <fieldset
          disabled={busy || pending || conflict}
          className="work-settings-fields"
        >
          {kind !== "exception" && input("name", "Tên")}
          {kind === "group" && (
            <>
              {input("description", "Mô tả", "text", "", false)}
              {input("sort_order", "Thứ tự", "number", 0)}
            </>
          )}
          {(kind === "calendar" || kind === "exception") && (
            <>
              {kind === "calendar" && (
                <>
                  {input("timezone", "Múi giờ", "text", "Asia/Ho_Chi_Minh")}
                  <div>
                    <span className="work-label">Ngày làm việc trong tuần</span>
                    <div className="work-settings-tabs">
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                        <label key={d}>
                          <input
                            type="checkbox"
                            name="working_weekdays"
                            value={d}
                            defaultChecked={(
                              current?.working_weekdays || [1, 2, 3, 4, 5]
                            ).includes(d)}
                          />
                          {d === 0 ? "Chủ nhật" : `Thứ ${d + 1}`}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {kind === "exception" && (
                <>
                  <input
                    type="hidden"
                    name="calendar_id"
                    value={parent || ""}
                  />
                  {input("exception_date", "Ngày ngoại lệ", "date")}
                  <label>
                    <input
                      type="checkbox"
                      name="is_working_day"
                      defaultChecked={current?.is_working_day || false}
                    />{" "}
                    Là ngày làm việc thay thế
                  </label>
                  {input("label", "Ghi chú", "text", "", false)}
                </>
              )}
              <label className="work-label">
                Các ca giờ
                <input
                  className="work-input"
                  name="working_intervals"
                  placeholder="08:00-12:00, 13:00-17:00"
                  defaultValue={(current?.working_intervals || [])
                    .map((i) => `${i.start.slice(0, 5)}-${i.end.slice(0, 5)}`)
                    .join(", ")}
                  required={kind === "calendar"}
                />
                <small>
                  Ngăn các ca bằng dấu phẩy. Ngày nghỉ không dùng ca giờ.
                </small>
              </label>
              {kind === "calendar" && scope.type === "global" && (
                <label>
                  <input
                    type="checkbox"
                    name="is_default"
                    defaultChecked={current?.is_default || false}
                  />{" "}
                  Lịch mặc định toàn hệ thống
                </label>
              )}
              {kind === "exception" && current && (
                <label>
                  <input type="checkbox" name="remove" /> Xóa ngoại lệ, khôi
                  phục lịch tuần cho ngày này
                </label>
              )}
            </>
          )}
          {kind === "policy" && (
            <>
              <label className="work-label">
                Lịch áp dụng
                <select
                  name="calendar_id"
                  className="work-input"
                  required
                  defaultValue={pick("calendar_id")}
                >
                  <option value="">Chọn lịch</option>
                  {current?.calendar_id &&
                    !options.some((o) => o.id === current.calendar_id) && (
                      <option value={current.calendar_id}>
                        Lịch hiện tại (đã lưu)
                      </option>
                    )}
                  {options
                    .filter((o) => o.is_active)
                    .map((o) => (
                      <option value={o.id} key={o.id}>
                        {o.name}
                        {o.scope_type === "global" ? " · Toàn hệ thống" : ""}
                      </option>
                    ))}
                </select>
              </label>
              {optionError && <p role="alert">{workError(optionError)}</p>}
              <button
                className="work-secondary"
                disabled={optionBusy}
                type="button"
                onClick={() => void calendars(!!cursor)}
              >
                {optionBusy
                  ? "Đang tải lịch…"
                  : cursor
                    ? "Thêm lựa chọn lịch"
                    : "Tải lại lựa chọn lịch"}
              </button>
              <label className="work-label">
                Mức ưu tiên
                <select
                  className="work-input"
                  name="priority"
                  defaultValue={pick("priority")}
                >
                  <option value="">Mọi ưu tiên</option>
                  <option value="normal">Bình thường</option>
                  <option value="important">Quan trọng</option>
                  <option value="urgent">Khẩn cấp</option>
                </select>
              </label>
              {input(
                "acknowledgement_minutes",
                "SLA xác nhận (phút làm việc)",
                "number",
                60,
              )}
              {input(
                "execution_minutes",
                "SLA thực hiện (phút làm việc, tùy chọn)",
                "number",
                "",
                false,
              )}
              <label className="work-label">
                Có hiệu lực từ (giờ trên thiết bị)
                <input
                  name="effective_from"
                  className="work-input"
                  type="datetime-local"
                  required
                  defaultValue={localDeadline(
                    current?.effective_from || new Date().toISOString(),
                  )}
                />
              </label>
              <label className="work-label">
                Kết thúc hiệu lực (tùy chọn)
                <input
                  name="effective_to"
                  className="work-input"
                  type="datetime-local"
                  defaultValue={localDeadline(
                    current?.effective_to || undefined,
                  )}
                />
              </label>
            </>
          )}
          {kind !== "exception" && (
            <label>
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={current?.is_active !== false}
              />{" "}
              Đang sử dụng
            </label>
          )}
          <label className="work-label">
            Lý do thay đổi
            <textarea
              className="work-input"
              name="reason"
              required
              minLength={3}
              maxLength={1000}
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="work-error">
            {workError(error)}
          </p>
        )}
        {pending && !busy && (
          <p role="status">
            Chưa xác định kết quả lưu. Hãy thử lại cùng yêu cầu để kiểm tra kết
            quả, không tạo thay đổi trùng.
          </p>
        )}
        {conflict && (
          <button
            className="work-secondary"
            type="button"
            disabled={busy}
            onClick={() => void reload()}
          >
            Nạp phiên bản mới để sửa lại
          </button>
        )}
        <div className="work-settings-tabs">
          <button
            className="work-primary"
            type="submit"
            disabled={busy || conflict}
          >
            {busy
              ? "Đang lưu…"
              : pending
                ? "Thử lại yêu cầu đã lưu"
                : "Lưu cấu hình"}
          </button>
          <button
            className="work-secondary"
            type="button"
            disabled={pending || busy}
            onClick={close}
          >
            Đóng
          </button>
        </div>
      </form>
    </dialog>
  );
}
