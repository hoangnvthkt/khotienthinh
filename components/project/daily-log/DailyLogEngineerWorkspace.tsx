import React, { useEffect, useRef, useState } from 'react';
import type { DailyLogPhoto } from '../../../types';
import { dailyLogWbsService, type CreateDailyLogSourceInput, type DailyLogDocumentBundle } from '../../../lib/dailyLogWbsService';
import { DailyLogSourcePicker } from './DailyLogSourcePicker';
import { DailyLogContributionWorkEditor } from './DailyLogContributionWorkEditor';
import './daily-log-engineer.css';

export const DailyLogEngineerWorkspace: React.FC<{
  bundle: DailyLogDocumentBundle | null; loading?: boolean; error?: string | null;
  projectId: string; constructionSiteId: string | null; date: string;
  onDateChange(date: string): void; onClose(): void; onSubmitted(): void;
  onUploadPhoto(file: File): Promise<DailyLogPhoto>;
}> = ({ bundle, loading, error, projectId, constructionSiteId, date, onDateChange, onClose, onSubmitted, onUploadPhoto }) => {
  const [document, setDocument] = useState<DailyLogDocumentBundle | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [create, setCreate] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<CreateDailyLogSourceInput | null>(null);
  const [existingSourceId, setExistingSourceId] = useState<string | null>(null);
  // Fresh list after a delete; the parent's bundle still lists the removed slip.
  const [listBundle, setListBundle] = useState<DailyLogDocumentBundle | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const flight = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  const load = async (id: string | null) => dailyLogWbsService.getDocumentBundle({ projectId, constructionSiteId, logDate: date, contributionId: id });
  const choose = async (ids: string[]) => {
    if (flight.current || editorBusy || ids[0] === selected[0]) return;
    if (document && ['draft','returned'].includes(document.contribution!.status)
      && !window.confirm('Chuyển phiếu sẽ bỏ thay đổi chưa lưu. Anh/chị đã lưu phiếu đang sửa chưa?')) return;
    flight.current = true; setBusy(true); setLocalError(null); setNotice(null);
    const request = ++generation.current;
    try { const next = await load(ids[0]); if(request === generation.current) { setDocument(next); setSelected(ids); setCreate(false); } }
    catch(caught) { setLocalError(caught instanceof Error ? caught.message : 'Không thể mở phiếu đã chọn.'); }
    finally { flight.current = false; setBusy(false); }
  };
  const createSource = async () => {
    if(flight.current || editorBusy || !code.trim() || !name.trim()) return;
    const input = pendingCreate || { commandId:crypto.randomUUID(), projectId, constructionSiteId, date, workAreaCode:code.trim(), workAreaName:name.trim() };
    flight.current = true; setBusy(true); setLocalError(null); setExistingSourceId(null); setPendingCreate(input);
    try { const receipt = await dailyLogWbsService.createSource(input); const next = await load(receipt.contributionId);
      setDocument(next); setSelected([receipt.contributionId]); setCreate(false); setPendingCreate(null); setCode(''); setName(''); }
    catch(caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Chưa xác nhận được kết quả tạo phiếu.');
      const known = caught as {code?:string;cause?:{code?:string};existingContributionId?:string};
      // A definite server rejection permits correcting input; a transport-unknown
      // result keeps the same create command and freezes its payload for retry.
      if(known.code || known.cause?.code) setPendingCreate(null);
      if(known.existingContributionId) setExistingSourceId(known.existingContributionId);
    }
    finally { flight.current = false; setBusy(false); }
  };
  const reloadDocument = (id: string) => { setBusy(true); load(id).then(setDocument).catch(caught => setLocalError(caught.message)).finally(() => setBusy(false)); };
  const deleted = (areaName: string) => {
    generation.current += 1; setDocument(null); setSelected([]); setNotice(`Đã xóa phiếu nháp "${areaName}".`); onSubmitted();
    setBusy(true); load(null).then(setListBundle).catch(caught => setLocalError(caught.message)).finally(() => setBusy(false));
  };
  const active = document || listBundle || bundle;
  const selector = <>
      <label>Ngày lập phiếu<input type="date" value={date} disabled={busy || editorBusy} onChange={event => {
        if(!document || window.confirm('Đổi ngày sẽ bỏ thay đổi chưa lưu. Tiếp tục?')) onDateChange(event.target.value);
      }} /></label>
      {active && <fieldset disabled={busy || editorBusy || loading || Boolean(pendingCreate)} className="m-0 min-w-0 border-0 p-0">
        <DailyLogSourcePicker sources={(active.myContributions ?? []).filter(source => source.sourceDocumentVersion === 2)} selectedIds={selected} selectionMode="single"
          onChange={ids => { void choose(ids); }} onCreateArea={active.permissions.canCreateSource ? () => {
            if(!document || !['draft','returned'].includes(document.contribution!.status) || window.confirm('Tạo phiếu khác sẽ bỏ thay đổi chưa lưu. Tiếp tục?')) { setCreate(true); setDocument(null); setSelected([]); }
          } : undefined} />
      </fieldset>}
    </>;
  return <section className="daily-log-engineer-slip" aria-label="Phiếu của tôi">
    <div className="dl-slip-body dl-slip-selector">
      {!document && <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Phiếu của tôi</h2>
        {!document && <button type="button" onClick={onClose}>Đóng</button>}</div>
      }
      {loading && <p role="status">Đang tải danh sách phiếu…</p>}
      {notice && !localError && <p role="status" className="dl-slip-info">{notice}</p>}
      {(error || localError) && <div role="alert" className="dl-slip-error"><p>{localError || error}</p>
        {existingSourceId && <button type="button" disabled={busy} onClick={() => { void choose([existingSourceId]); }}>Mở phiếu có sẵn</button>}</div>}
      {document ? <details key={document.contribution!.id} className="dl-slip-selection"><summary>Đổi ngày hoặc phiếu</summary><div>{selector}</div></details> : selector}
      {create && <div className="dl-slip-detail-fields"><label>Mã khu vực mới<input value={code} disabled={busy || Boolean(pendingCreate)} onChange={event => setCode(event.target.value)} /></label>
        <label>Tên khu vực mới<input value={name} disabled={busy || Boolean(pendingCreate)} onChange={event => setName(event.target.value)} /></label>
        <button type="button" disabled={busy || !code.trim() || !name.trim()} onClick={() => { void createSource(); }}>{busy ? 'Đang tạo phiếu…' : pendingCreate ? 'Thử tạo lại' : 'Tạo phiếu'}</button>
        {!pendingCreate && <button type="button" disabled={busy} onClick={() => setCreate(false)}>Hủy tạo phiếu</button>}</div>}
      {!document && !create && active && <p>Chọn phiếu cần ghi, hoặc tạo phiếu khu vực / mũi thi công mới.</p>}
    </div>
    {document && document.contribution && <DailyLogContributionWorkEditor key={`${document.contribution.id}:${document.contribution.rowVersion}`} bundle={document}
      onClose={onClose} onBusyChange={setEditorBusy} onUploadPhoto={onUploadPhoto}
      onReload={() => reloadDocument(document.contribution!.id)}
      onSubmitted={() => { onSubmitted(); reloadDocument(document.contribution!.id); }}
      onWithdrawn={() => { setNotice('Đã rút phiếu về. Sửa xong bấm "Gửi lại tổng hợp".'); onSubmitted(); reloadDocument(document.contribution!.id); }}
      onDeleted={deleted} />}
  </section>;
};
