import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import type { OfficeAttachment } from '../../lib/office/officeTypes';
import type { OfficeService } from '../../lib/office/officeService';
import { OfficeEmpty, OfficeError, OfficeModal } from './OfficeShared';

const OfficePdfPreview = lazy(() => import('./OfficePdfPreview'));

export function OfficeFilePreview({ file, service, onClose, onDownloaded }: {
  file: OfficeAttachment; service: OfficeService; onClose: () => void; onDownloaded: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [recordError, setRecordError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl: string | undefined;
    setError(null); setUrl(null);
    void (async () => {
      const signedUrl = await service.fileUrl(file);
      const response = await fetch(signedUrl, { signal: abort.signal });
      if (!response.ok) throw new Error('Không tải được tệp. Vui lòng thử lại.');
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([blob], { type: file.mime_type }));
      setUrl(objectUrl);
    })().catch(error => { if (!abort.signal.aborted) setError(error); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, service, attempt]);
  const recordDownload = async () => {
    try {
      await service.command({ command: 'download', documentId: file.document_id, payload: { attachmentId: file.id }, key: crypto.randomUUID() });
      setRecordError(false); onDownloaded();
    } catch { setRecordError(true); }
  };
  return <OfficeModal title={file.file_name} onClose={onClose}><div className="office-file-preview">
    {!url && !error && <p role="status">Đang mở tệp đính kèm…</p>}
    {error && <OfficeError error={error} retry={() => setAttempt(value => value + 1)} />}
    {url && <>
      <div className="office-preview-actions">
        <a className="office-secondary" href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} />Mở toàn màn hình</a>
        <a className="office-primary" href={url} download={file.file_name} onClick={() => void recordDownload()}><Download size={16} />Tải tệp</a>
      </div>
      {file.mime_type === 'application/pdf' ? <Suspense fallback={<p role="status">Đang mở trình xem PDF…</p>}><OfficePdfPreview title={file.file_name} url={url} /></Suspense> : file.mime_type.startsWith('image/') ? <img src={url} alt={file.file_name} onError={() => setError(new Error('Không hiển thị được ảnh. Vui lòng thử tải lại.'))} /> : <OfficeEmpty title="Tải tệp để xem nội dung" description="Định dạng này được mở bằng ứng dụng trên thiết bị." />}
      <small>PDF/ảnh mở ngay tại đây. Có thể chuyển trang, phóng to hoặc tải tệp để lưu trên thiết bị.</small>
    </>}
    {recordError && <p role="status">Đã bắt đầu tải tệp, nhưng chưa ghi nhận được lịch sử tải. <button className="office-secondary" onClick={() => void recordDownload()}>Ghi nhận lại</button></p>}
  </div></OfficeModal>;
}
