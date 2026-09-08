import React, { useEffect, useRef, useState } from "react";
import type { WorkTaskAttachment } from "../../lib/work/workTypes";
import {
  workAttachmentPreviewRoute,
  type createWorkAttachmentService,
} from "../../lib/work/workAttachmentService";
import { workError } from "../../lib/work/workForm";

type Service = ReturnType<typeof createWorkAttachmentService>;
const TEXT_LIMIT = 1024 * 1024;

async function readBoundedText(response: Response, signal: AbortSignal) {
  if (!response.ok) throw new Error("WORK_ATTACHMENT_READ_FAILED");
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { text: new TextDecoder().decode(bytes.slice(0, TEXT_LIMIT)), truncated: bytes.length > TEXT_LIMIT };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  let truncated = false;
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = TEXT_LIMIT - size;
      if (value.byteLength > remaining) {
        text += decoder.decode(value.slice(0, Math.max(0, remaining)), { stream: true });
        truncated = true;
        await reader.cancel();
        break;
      }
      size += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (size === TEXT_LIMIT) {
        const extra = await reader.read();
        truncated = !extra.done;
        if (!extra.done) await reader.cancel();
        break;
      }
    }
    text += decoder.decode();
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return { text, truncated };
  } finally {
    reader.releaseLock();
  }
}

export function WorkAttachmentPreview({ file, service, disabled = false }: {
  file: WorkTaskAttachment;
  service: Service;
  disabled?: boolean;
}) {
  const route = workAttachmentPreviewRoute(file.mime_type, file.variants);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const abort = useRef<AbortController | null>(null);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);

  function clearContent() {
    request.current++;
    abort.current?.abort();
    abort.current = null;
    if (expiry.current) clearTimeout(expiry.current);
    expiry.current = null;
    setUrl("");
    setText("");
    setTruncated(false);
    setLoading(false);
  }
  function close() {
    clearContent();
    setOpen(false);
    window.setTimeout(() => trigger.current?.focus(), 0);
  }
  async function load() {
    if (!route) return;
    clearContent();
    const token = request.current;
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError(null);
    try {
      const signed = await service.read(file.id, route.variant);
      if (token !== request.current || controller.signal.aborted) return;
      expiry.current = setTimeout(() => {
        setUrl("");
        setText("");
        setError(new Error("WORK_ATTACHMENT_EXPIRED"));
      }, Math.max(1, signed.expiresIn - 5) * 1000);
      if (route.kind === "text") {
        const content = await readBoundedText(await fetch(signed.signedUrl, { signal: controller.signal }), controller.signal);
        if (token !== request.current || controller.signal.aborted) return;
        setText(content.text);
        setTruncated(content.truncated);
      } else setUrl(signed.signedUrl);
    } catch (caught) {
      if (token === request.current && !(caught instanceof DOMException && caught.name === "AbortError")) setError(caught);
    } finally {
      if (token === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    void load();
  }, [open, file.id]);
  useEffect(() => () => {
    request.current++;
    abort.current?.abort();
    if (expiry.current) clearTimeout(expiry.current);
  }, []);

  if (!route) return null;
  return <>
    <button ref={trigger} type="button" disabled={disabled} onClick={() => setOpen(true)} aria-label={`Xem trước ${file.file_name}`}>Xem trước</button>
    {open && <dialog ref={dialog} className="work-attachment-preview" aria-labelledby={`work-preview-${file.id}`} onCancel={(event) => { event.preventDefault(); close(); }}>
      <header><div><p className="work-eyebrow">XEM TRƯỚC TỆP</p><h2 id={`work-preview-${file.id}`}>{file.file_name}</h2></div><button type="button" className="work-secondary" onClick={close}>Đóng xem trước</button></header>
      <div className="work-preview-stage" aria-live="polite">
        {loading && <p>Đang tải bản xem trước…</p>}
        {error && <div className="work-preview-error"><p role="alert" className="work-error">{workError(error)}</p><button type="button" className="work-primary" onClick={() => void load()}>Thử tải lại</button></div>}
        {!loading && !error && route.kind === "image" && url && <img src={url} alt={file.file_name} onError={() => { setUrl(""); setError(new Error("WORK_ATTACHMENT_EXPIRED")); }} />}
        {!loading && !error && route.kind === "pdf" && url && <iframe src={url} title={`Xem trước ${file.file_name}`} />}
        {!loading && !error && route.kind === "text" && <><pre>{text}</pre>{truncated && <p className="work-notice">Tệp dài hơn 1 MiB. Bản xem trước đã được rút gọn.</p>}</>}
      </div>
    </dialog>}
  </>;
}
