import React, { useEffect, useRef, useState } from 'react';
import type { DailyLogPhoto } from '../../../types';
import { dailyLogWbsService, type CreateDailyLogSourceInput, type DailyLogDocumentBundle, type DailyLogRecentArea } from '../../../lib/dailyLogWbsService';
import { areaCodeFromName } from '../../../lib/dailyLogSlipRules';
import { DailyLogInlineSearch } from './DailyLogInlineSearch';
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
  const [recentAreas, setRecentAreas] = useState<DailyLogRecentArea[]>([]);
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
  useEffect(() => {
    let active = true;
    dailyLogWbsService.getRecentAreas({ projectId, constructionSiteId, date })
      .then(rows => { if (active) setRecentAreas(Array.isArray(rows) ? rows : []); }).catch(() => { if (active) setRecentAreas([]); });
    return () => { active = false; };
  }, [projectId, constructionSiteId, date]);
  const load = async (id: string | null) => dailyLogWbsService.getDocumentBundle({ projectId, constructionSiteId, logDate: date, contributionId: id });
  const choose = async (ids: string[]) => {
    if (flight.current || editorBusy || ids[0] === selected[0]) return;
    if (document && ['draft','returned'].includes(document.contribution!.status)
      && !window.confirm('Chuyển phiếu sẽ bỏ thay đổi chưa lưu. Anh/chị đã lưu phiếu đang sửa chưa?')) return;
    flight.current = true; setBusy(true); setLocalError(null); setNotice(null);
    const request = ++generation.current;
    try { const next = await load(ids[0]); if(request === generation.current) { setDocument(next); setSelected(ids); } }
    catch(caught) { setLocalError(caught instanceof Error ? caught.message : 'Không thể mở phiếu đã chọn.'); }
    finally { flight.current = false; setBusy(false); }
  };
  // Chọn mũi = tạo phiếu ngay; mũi mới lấy mã theo tên để các ngày sau nhận ra cùng một mũi.
  const createSource = async (area?: { code: string; name: string }) => {
    if(flight.current || editorBusy || (!area && !pendingCreate)) return;
    if(area && document && ['draft','returned'].includes(document.contribution!.status)
      && !window.confirm('Mở phiếu mũi khác sẽ bỏ thay đổi chưa lưu. Tiếp tục?')) return;
    const input = pendingCreate || { commandId:crypto.randomUUID(), projectId, constructionSiteId, date, workAreaCode:area!.code, workAreaName:area!.name };
    flight.current = true; setBusy(true); setLocalError(null); setExistingSourceId(null); setPendingCreate(input);
    try { const receipt = await dailyLogWbsService.createSource(input); const next = await load(receipt.contributionId);
      setDocument(next); setSelected([receipt.contributionId]); setPendingCreate(null); }
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
  const mine = (active?.myContributions ?? []).filter(source => source.sourceDocumentVersion === 2);
  const areaOptions = recentAreas.filter(area => !mine.some(source => source.workAreaCode === area.code));
  const selector = <>
      <label>Ngày lập phiếu<input type="date" value={date} disabled={busy || editorBusy} onChange={event => {
        if(!document || window.confirm('Đổi ngày sẽ bỏ thay đổi chưa lưu. Tiếp tục?')) onDateChange(event.target.value);
      }} /></label>
      {active && <fieldset disabled={busy || editorBusy || loading || Boolean(pendingCreate)} className="m-0 min-w-0 border-0 p-0">
        <DailyLogSourcePicker sources={mine} selectedIds={selected} selectionMode="single" onChange={ids => { void choose(ids); }} />
      </fieldset>}
      {active?.permissions.canCreateSource && <div className="dl-v3 max-w-xl">
        <span className="mb-1 block text-sm font-semibold">Ghi phiếu cho mũi thi công</span>
        <DailyLogInlineSearch<{ code: string; name: string; lastDate?: string | null; lastAuthorName?: string | null }> label="Mũi thi công"
          placeholder="Gõ tên mũi / khu vực — vd: Nhà xưởng 1" disabled={busy || editorBusy || loading || Boolean(pendingCreate)}
          items={areaOptions} text={area => `${area.name} ${area.code}`}
          render={area => <span><span className="font-semibold text-mint-700 dark:text-mint-300">{area.name}</span>
            {area.lastDate && <span className="block text-xs text-muted-foreground">Gần nhất {area.lastDate.slice(0, 10).split('-').reverse().join('/')}{area.lastAuthorName ? ` · ${area.lastAuthorName}` : ''}</span>}</span>}
          onPick={area => { void createSource({ code: area.code, name: area.name }); }}
          footer={(query, close) => query && !areaOptions.some(area => area.name.toLocaleLowerCase('vi') === query.toLocaleLowerCase('vi'))
            ? <button type="button" onMouseDown={event => { event.preventDefault(); close(); void createSource({ code: areaCodeFromName(query), name: query }); }}
              className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-left text-sm font-semibold text-teal-700 hover:bg-muted dark:text-teal-300">+ Tạo mũi mới "{query}"</button> : null} />
        <span className="mt-1 block text-xs text-muted-foreground">Chọn mũi là mở phiếu ngay; mũi đã báo cáo gần đây hiện sẵn trong danh sách.</span>
        {pendingCreate && <button type="button" disabled={busy} onClick={() => { void createSource(); }} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold">{busy ? 'Đang tạo phiếu…' : `Thử tạo lại phiếu "${pendingCreate.workAreaName}"`}</button>}
      </div>}
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
      {!document && active && <p>Mở phiếu đã có ở trên, hoặc gõ tên mũi thi công để ghi phiếu mới.</p>}
    </div>
    {document && document.contribution && <DailyLogContributionWorkEditor key={`${document.contribution.id}:${document.contribution.rowVersion}`} bundle={document}
      onClose={onClose} onBusyChange={setEditorBusy} onUploadPhoto={onUploadPhoto}
      onReload={() => reloadDocument(document.contribution!.id)}
      onSubmitted={() => { onSubmitted(); reloadDocument(document.contribution!.id); }}
      onWithdrawn={() => { setNotice('Đã rút phiếu về. Sửa xong bấm "Gửi lại tổng hợp".'); onSubmitted(); reloadDocument(document.contribution!.id); }}
      onDeleted={deleted} recentAreas={recentAreas} />}
  </section>;
};
