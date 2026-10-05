import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { formatWorkflowFileSize, getWorkflowFileKind, type WorkflowFileValue } from '../../lib/workflowFiles';
import { downloadWorkflowFile, fetchWorkflowFileBlob, hasDownloadableFile } from '../../lib/workflowFileTransfer';
import { loadXlsx } from '../../lib/loadXlsx';

const MAX_PREVIEW_ROWS = 300;

type SheetMap = Record<string, any[][]>;

const SheetsView: React.FC<{ sheets: SheetMap; sheetNames: string[] }> = ({ sheets, sheetNames }) => {
    const [active, setActive] = useState(sheetNames[0] || '');
    const rows = sheets[active] || [];
    const shown = rows.slice(0, MAX_PREVIEW_ROWS);
    return (
        <div className="space-y-2">
            {sheetNames.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                    {sheetNames.map(name => (
                        <button key={name} type="button" onClick={() => setActive(name)} className={`rounded-lg px-2.5 py-1 text-xs font-bold ${name === active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>{name}</button>
                    ))}
                </div>
            )}
            <div className="max-h-[62vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="min-w-full border-collapse text-xs">
                    <tbody>
                        {shown.map((row, rowIndex) => (
                            <tr key={rowIndex} className={rowIndex === 0 ? 'bg-slate-50 font-bold dark:bg-slate-800' : ''}>
                                {(row || []).map((cell, cellIndex) => (
                                    <td key={cellIndex} className="whitespace-nowrap border border-slate-100 px-2 py-1 text-slate-700 dark:border-slate-800 dark:text-slate-300">{cell === undefined || cell === null ? '' : String(cell)}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {rows.length > MAX_PREVIEW_ROWS && <p className="text-[11px] text-slate-400">Chỉ hiển thị {MAX_PREVIEW_ROWS}/{rows.length} dòng đầu. Tải về để xem đầy đủ.</p>}
        </div>
    );
};

type PreviewState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'url'; url: string }
    | { status: 'sheets'; sheets: SheetMap; sheetNames: string[] }
    | { status: 'none' };

const usePreviewContent = (file: WorkflowFileValue): PreviewState => {
    const [state, setState] = useState<PreviewState>({ status: 'loading' });
    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;
        const kind = getWorkflowFileKind(file);
        setState({ status: 'loading' });
        const run = async () => {
            if (kind === 'other') { setState({ status: 'none' }); return; }
            if (kind === 'excel' && file.excelData && file.sheetNames) {
                setState({ status: 'sheets', sheets: file.excelData, sheetNames: file.sheetNames });
                return;
            }
            if (!hasDownloadableFile(file)) { setState({ status: 'error', message: 'File cũ không còn dữ liệu xem trước.' }); return; }
            try {
                const blob = await fetchWorkflowFileBlob(file);
                if (cancelled) return;
                if (kind === 'excel') {
                    const XLSX = await loadXlsx();
                    const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
                    const sheets: SheetMap = {};
                    workbook.SheetNames.forEach(name => { sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }) as any[][]; });
                    if (!cancelled) setState({ status: 'sheets', sheets, sheetNames: workbook.SheetNames });
                    return;
                }
                // Typed blob so the browser renders PDFs/images inline instead of downloading.
                const typed = new Blob([blob], { type: kind === 'pdf' ? 'application/pdf' : blob.type || file.fileType || file.mimeType || 'image/png' });
                objectUrl = URL.createObjectURL(typed);
                setState({ status: 'url', url: objectUrl });
            } catch (error) {
                console.error('Workflow file preview error:', error);
                if (!cancelled) setState({ status: 'error', message: 'Không tải được bản xem trước. Bấm "Tải về" để mở trên máy.' });
            }
        };
        void run();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [file]);
    return state;
};

const KindIcon: React.FC<{ file: WorkflowFileValue; size?: number }> = ({ file, size = 14 }) => {
    const kind = getWorkflowFileKind(file);
    if (kind === 'image') return <ImageIcon size={size} className="shrink-0 text-sky-500" />;
    if (kind === 'excel') return <FileSpreadsheet size={size} className="shrink-0 text-emerald-600" />;
    if (kind === 'pdf') return <FileText size={size} className="shrink-0 text-rose-500" />;
    return <Paperclip size={size} className="shrink-0 text-slate-400" />;
};

interface Props {
    files: WorkflowFileValue[];
    startIndex?: number;
    onClose: () => void;
}

/** Preview several attached files in one viewer: ← / → to switch, Esc to close, download any. */
const WorkflowFilePreview: React.FC<Props> = ({ files, startIndex = 0, onClose }) => {
    const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(files.length - 1, 0)));
    const file = files[index];
    const state = usePreviewContent(file);
    const hasMany = files.length > 1;

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowRight') setIndex(current => Math.min(current + 1, files.length - 1));
            if (event.key === 'ArrowLeft') setIndex(current => Math.max(current - 1, 0));
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [files.length, onClose]);

    if (!file) return null;
    const kind = getWorkflowFileKind(file);

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Xem trước ${file.fileName}`}>
            <div className="flex max-h-[92vh] w-[94vw] max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
                <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                    <KindIcon file={file} size={18} />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100" title={file.fileName}>{file.fileName}</p>
                        <p className="text-[11px] text-slate-400">{[hasMany ? `${index + 1}/${files.length}` : '', formatWorkflowFileSize(file.fileSize)].filter(Boolean).join(' · ')}</p>
                    </div>
                    {hasMany && (
                        <div className="flex items-center gap-1">
                            <button type="button" onClick={() => setIndex(index - 1)} disabled={index === 0} aria-label="Tệp trước" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-slate-700"><ChevronLeft size={18} /></button>
                            <button type="button" onClick={() => setIndex(index + 1)} disabled={index === files.length - 1} aria-label="Tệp sau" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-slate-700"><ChevronRight size={18} /></button>
                        </div>
                    )}
                    <button type="button" onClick={() => void downloadWorkflowFile(file)} disabled={!hasDownloadableFile(file)} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">
                        <Download size={13} /> Tải về
                    </button>
                    <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"><X size={18} /></button>
                </div>

                <div className="min-h-[40vh] flex-1 overflow-auto p-4">
                    {state.status === 'loading' && kind !== 'other' && <p className="py-20 text-center text-sm font-medium text-slate-400">Đang tải bản xem trước…</p>}
                    {state.status === 'error' && <p className="py-20 text-center text-sm font-medium text-slate-400">{state.message}</p>}
                    {state.status === 'none' && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <FileText size={48} className="mb-3 opacity-50" />
                            <p className="text-sm font-medium">Không xem trước được loại file này</p>
                            <p className="mt-1 text-xs">Bấm "Tải về" để mở trên máy tính</p>
                        </div>
                    )}
                    {state.status === 'url' && kind === 'image' && <div className="flex justify-center"><img src={state.url} alt={file.fileName} className="max-h-[70vh] max-w-full rounded-lg shadow" /></div>}
                    {state.status === 'url' && kind === 'pdf' && <iframe src={state.url} title={file.fileName} className="h-[70vh] w-full rounded-lg border border-slate-200 dark:border-slate-700" />}
                    {state.status === 'sheets' && <SheetsView sheets={state.sheets} sheetNames={state.sheetNames} />}
                </div>

                {hasMany && (
                    <div className="flex gap-2 overflow-x-auto border-t border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                        {files.map((item, itemIndex) => (
                            <button key={`${item.storagePath || item.fileName}-${itemIndex}`} type="button" onClick={() => setIndex(itemIndex)} className={`flex max-w-[14rem] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${itemIndex === index ? 'border-emerald-400 bg-white text-emerald-700 dark:bg-slate-900' : 'border-transparent text-slate-500 hover:bg-white dark:hover:bg-slate-900'}`}>
                                <KindIcon file={item} size={13} /> <span className="truncate">{item.fileName}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default WorkflowFilePreview;
