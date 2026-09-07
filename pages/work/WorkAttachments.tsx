import React, { useEffect, useRef, useState } from "react";
import type {
  createWorkAttachmentService,
  WorkUploadReservation,
  WorkAttachmentVariant,
} from "../../lib/work/workAttachmentService";
import type {
  WorkTaskAttachment,
  WorkTaskCapabilities,
  WorkAttachmentKind,
} from "../../lib/work/workTypes";
import { prepareWorkImage } from "../../lib/work/workImageInput";
import { workError } from "../../lib/work/workForm";
type Service = ReturnType<typeof createWorkAttachmentService>;
const kindLabels: Record<WorkAttachmentKind, string> = {
  input: "Đầu vào",
  discussion: "Thảo luận",
  result: "Kết quả",
  evidence: "Bằng chứng",
};
export interface WorkPendingUpload {
  key: string;
  file: File;
  prepared?: File;
  kind: WorkAttachmentKind;
  keep: boolean;
  reservation?: WorkUploadReservation;
  uploaded?: boolean;
  ready?: boolean;
  error?: unknown;
}
export interface WorkUploadState {
  items: WorkPendingUpload[];
  busy: boolean;
}
function Thumbnail({
  file,
  service,
}: {
  file: WorkTaskAttachment;
  service: Service;
}) {
  const box = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false),
    [url, setUrl] = useState(""),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setUrl("");
    setError(false);
    service
      .read(file.id, "thumbnail")
      .then((r) => {
        if (live) {
          setUrl(r.signedUrl);
          timer = setTimeout(
            () => setUrl(""),
            Math.max(1, r.expiresIn - 5) * 1000,
          );
        }
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [file.id, service, visible, retry]);
  return (
    <div ref={box} className="work-thumbnail">
      {url ? (
        <img
          src={url}
          alt={file.file_name}
          loading="lazy"
          decoding="async"
          onError={() => {
            setUrl("");
            setError(true);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setVisible(true);
            setRetry((x) => x + 1);
          }}
        >
          {error ? "Thử tải ảnh" : visible ? "Tải lại ảnh" : "Ảnh đính kèm"}
        </button>
      )}
    </div>
  );
}
export function WorkAttachments({
  taskId,
  files,
  caps,
  service,
  onChanged,
  uploads,
  locked,
}: {
  taskId: string;
  files: WorkTaskAttachment[];
  caps: WorkTaskCapabilities;
  service: Service;
  onChanged: () => void;
  uploads: WorkUploadState;
  locked: boolean;
}) {
  const [, redraw] = useState(0),
    [kind, setKind] = useState<WorkAttachmentKind>("discussion"),
    [keep, setKeep] = useState(false),
    [error, setError] = useState<unknown>(null),
    [view, setView] = useState<{ name: string; url: string } | null>(null),
    [reading, setReading] = useState(false);
  const alive = useRef(true),
    reader = useRef(0),
    expiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    dialog = useRef<HTMLDialogElement>(null);
  const allowed = Object.entries({
    input: caps.canAttachInput,
    discussion: caps.canAttachDiscussion,
    result: caps.canAttachResult,
    evidence: caps.canAttachEvidence,
  })
    .filter(([, v]) => v)
    .map(([k]) => k as WorkAttachmentKind);
  const selected = allowed.includes(kind) ? kind : allowed[0];
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reader.current++;
      clearTimeout(expiry.current);
    };
  }, []);
  useEffect(() => {
    if (view) dialog.current?.showModal();
  }, [view]);
  useEffect(() => {
    if (!uploads.items.some((x) => !x.ready)) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploads.items.length, uploads.items.filter((x) => x.ready).length]);
  async function read(
    file: WorkTaskAttachment,
    variant: WorkAttachmentVariant,
  ) {
    const n = ++reader.current;
    setReading(true);
    setError(null);
    try {
      const r = await service.read(file.id, variant);
      if (!alive.current || n !== reader.current) return;
      if (variant === "original") {
        const a = document.createElement("a");
        a.href = r.signedUrl;
        a.download = file.file_name;
        a.rel = "noopener noreferrer";
        a.target = "_blank";
        a.click();
      } else {
        setView({ name: file.file_name, url: r.signedUrl });
        clearTimeout(expiry.current);
        expiry.current = setTimeout(
          () => setView(null),
          Math.max(1, r.expiresIn - 5) * 1000,
        );
      }
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current && n === reader.current) setReading(false);
    }
  }
  async function upload() {
    if (uploads.busy) return;
    uploads.busy = true;
    redraw((x) => x + 1);
    try {
      for (const item of uploads.items) {
        if (item.ready) continue;
        item.error = null;
        try {
          item.prepared ||= await prepareWorkImage(
            item.file,
            item.keep || item.kind === "evidence",
          );
          item.reservation ||= await service.begin(
            taskId,
            item.prepared,
            item.kind,
            item.keep,
            item.key,
          );
          if (!item.uploaded) {
            try {
              await service.upload(item.reservation, item.prepared);
            } catch (e) {
              if (String((e as { statusCode?: string }).statusCode) !== "409")
                throw e;
            }
            item.uploaded = true;
          }
          await service.finalize(item.reservation.id);
          item.ready = true;
        } catch (e) {
          item.error = e;
        }
        if (alive.current) redraw((x) => x + 1);
      }
    } finally {
      uploads.busy = false;
      if (alive.current) {
        redraw((x) => x + 1);
        onChanged();
      }
    }
  }
  return (
    <section className="work-section">
      <h3>Đính kèm</h3>
      {error && (
        <p className="work-error" role="alert">
          {workError(error)}
        </p>
      )}
      <ul className="work-attachment-grid">
        {files.map((f) => (
          <li key={f.id}>
            {f.variants.thumbnail && <Thumbnail file={f} service={service} />}
            <strong>{f.file_name}</strong>
            <small>
              {kindLabels[f.attachment_kind]} · {Math.ceil(f.size_bytes / 1024)}{" "}
              KB
            </small>
            <div className="work-actions">
              {f.variants.display && (
                <button
                  disabled={reading}
                  onClick={() => void read(f, "display")}
                >
                  Xem ảnh
                </button>
              )}
              {f.variants.fallback && (
                <button
                  disabled={reading}
                  onClick={() => void read(f, "fallback")}
                >
                  Ảnh PNG
                </button>
              )}
              {f.variants.original && (
                <button
                  disabled={reading}
                  onClick={() => void read(f, "original")}
                >
                  Tải bản gốc
                </button>
              )}
              {f.can_delete && (
                <button
                  disabled={locked || uploads.busy}
                  onClick={async () => {
                    if (!window.confirm(`Xóa đính kèm “${f.file_name}”?`))
                      return;
                    try {
                      await service.remove(f.id);
                      if (alive.current) onChanged();
                    } catch (e) {
                      if (alive.current) setError(e);
                    }
                  }}
                >
                  Xóa tệp
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!files.length && <p>Chưa có tệp đính kèm.</p>}
      {allowed.length > 0 && (
        <fieldset
          className="work-upload-form"
          disabled={locked || uploads.busy}
        >
          <label className="work-label">
            Loại đính kèm
            <select
              className="work-input"
              value={selected}
              onChange={(e) => setKind(e.target.value as WorkAttachmentKind)}
            >
              {allowed.map((k) => (
                <option key={k} value={k}>
                  {kindLabels[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={keep || selected === "evidence"}
              disabled={selected === "evidence"}
              onChange={(e) => setKeep(e.target.checked)}
            />{" "}
            Giữ bản gốc
          </label>
          <p className="work-hint">
            Ảnh JPEG không giữ bản gốc sẽ được thu nhỏ trước khi tải. Bằng chứng
            luôn giữ nguyên tệp. Bản gốc: ảnh tối đa 5 MiB / 4 megapixel; PDF,
            TXT tối đa 25 MiB.
          </p>
          <input
            type="file"
            multiple
            aria-label="Thêm đính kèm công việc"
            accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
            onChange={(e) => {
              const chosen = Array.from(e.currentTarget.files || []);
              uploads.items.push(
                ...chosen.map((file) => ({
                  key: crypto.randomUUID(),
                  file,
                  kind: selected,
                  keep: keep || selected === "evidence",
                })),
              );
              e.currentTarget.value = "";
              redraw((x) => x + 1);
            }}
          />
        </fieldset>
      )}
      <ul className="work-files">
        {uploads.items.map((item) => (
          <li key={item.key}>
            <strong>{item.file.name}</strong> · {kindLabels[item.kind]}
            {item.ready ? (
              <span>Đã tải</span>
            ) : (
              <>
                {item.error && (
                  <p role="alert" className="work-error">
                    {workError(item.error)}
                  </p>
                )}
                {!uploads.busy && (
                  <button
                    onClick={() => {
                      uploads.items = uploads.items.filter((x) => x !== item);
                      redraw((x) => x + 1);
                    }}
                  >
                    Bỏ tệp chờ
                  </button>
                )}
                {item.error instanceof Error &&
                  ["WORK_ATTACHMENT_EXPIRED", "WORK_INVALID_FILE"].includes(
                    item.error.message,
                  ) && (
                    <button
                      disabled={uploads.busy}
                      onClick={() => {
                        Object.assign(item, {
                          key: crypto.randomUUID(),
                          reservation: undefined,
                          uploaded: false,
                          error: null,
                        });
                        redraw((x) => x + 1);
                      }}
                    >
                      Chuẩn bị tải lại
                    </button>
                  )}
              </>
            )}
          </li>
        ))}
      </ul>
      {uploads.items.some((i) => !i.ready) && (
        <button
          className="work-primary"
          disabled={locked || uploads.busy || !allowed.length}
          onClick={() => void upload()}
        >
          {uploads.busy ? "Đang tải và xử lý…" : "Tải các tệp đã chọn"}
        </button>
      )}
      {view && (
        <dialog
          ref={dialog}
          className="work-image-dialog"
          onCancel={() => setView(null)}
          aria-label={view.name}
        >
          <button className="work-secondary" onClick={() => setView(null)}>
            Đóng ảnh
          </button>
          <p>{view.name}</p>
          <img
            src={view.url}
            alt={view.name}
            onError={() => {
              setView(null);
              setError(new Error("WORK_ATTACHMENT_EXPIRED"));
            }}
          />
        </dialog>
      )}
    </section>
  );
}
