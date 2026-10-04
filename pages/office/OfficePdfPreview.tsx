import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, version, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { OfficeError } from './OfficeShared';

GlobalWorkerOptions.workerSrc = workerUrl;

/** One page at a time keeps mobile memory bounded, including large document scans. */
export default function OfficePdfPreview({ url, title }: { url: string; title: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(300);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [text, setText] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setPdf(null); setPage(1); setError(null); setBusy(true);
    const assets = import.meta.env.DEV ? '/node_modules/pdfjs-dist/' : `${import.meta.env.BASE_URL}pdfjs/${version}/`;
    const task = getDocument({ url, isEvalSupported: false, cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/` });
    void task.promise.then(value => { if (active) setPdf(value); }).catch(error => {
      if (active) { setError(error?.name === 'PasswordException' ? new Error('PDF có mật khẩu. Vui lòng tải tệp và mở bằng ứng dụng PDF trên thiết bị.') : new Error('Không đọc được PDF. Anh/chị có thể tải tệp hoặc thử mở bằng ứng dụng khác.')); setBusy(false); }
    });
    return () => { active = false; void task.destroy(); };
  }, [url]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(100, Math.floor(entries[0].contentRect.width) - 16)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true;
    let render: RenderTask | undefined;
    const target = canvas.current;
    setBusy(true); setError(null); setText('');
    void (async () => {
      const source = await pdf.getPage(page);
      if (!active) return;
      const base = source.getViewport({ scale: 1 });
      const viewport = source.getViewport({ scale: width / base.width * zoom });
      // Limit backing canvas to 6 megapixels on high-DPI phones.
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6_000_000 / (viewport.width * viewport.height)));
      target.width = Math.ceil(viewport.width * ratio);
      target.height = Math.ceil(viewport.height * ratio);
      target.style.width = `${viewport.width}px`;
      target.style.height = `${viewport.height}px`;
      render = source.render({ canvas: target, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (!active) return;
      setBusy(false);
      const content = await source.getTextContent();
      if (active) setText(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    })().catch(error => { if (active && error?.name !== 'RenderingCancelledException') { setError(new Error('Không hiển thị được trang PDF này. Vui lòng thử trang khác hoặc tải tệp.')); setBusy(false); } });
    return () => { active = false; render?.cancel(); };
  }, [pdf, page, width, zoom]);
  return <div className="office-pdf" ref={container}>
    <div className="office-pdf-toolbar">
      <button type="button" className="office-secondary" aria-label="Trang trước" disabled={!pdf || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} /></button>
      <span role="status">{pdf ? `Trang ${page} / ${pdf.numPages}` : 'Đang đọc PDF…'}</span>
      <button type="button" className="office-secondary" aria-label="Trang sau" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} /></button>
      <button type="button" className="office-secondary" aria-label="Thu nhỏ" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))}><Minus size={16} /></button>
      <button type="button" className="office-secondary" aria-label="Phóng to" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.5))}><Plus size={16} /></button>
    </div>
    {error && <OfficeError error={error} />}
    {busy && !error && <p role="status">Đang hiển thị trang…</p>}
    <div className="office-pdf-page" aria-busy={busy}><canvas ref={canvas} aria-label={`${title}, trang ${page}`} role="img" style={{ visibility: busy || error ? 'hidden' : 'visible' }} /></div>
    {text && <details className="office-pdf-text"><summary>Đọc nội dung chữ của trang</summary><p>{text}</p></details>}
  </div>;
}
