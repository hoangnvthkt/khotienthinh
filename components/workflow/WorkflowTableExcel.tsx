import React, { useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { loadXlsx } from '../../lib/loadXlsx';
import { isTableEmpty, parseTableMatrix, tableTemplateFileName, type TableImportResult } from '../../lib/workflowTableExcel';
import { btnPrimary, btnSoft } from './WorkflowInstanceRow';

const PREVIEW_ROWS = 5;

interface Props {
    label: string;
    columns: string[];
    rows: string[][];
    onImport: (rows: string[][]) => void;
}

/** "Tải mẫu Excel" + "Nhập từ Excel" cho trường Bảng: đọc file, cho xem trước rồi mới đổ vào bảng. */
const WorkflowTableExcel: React.FC<Props> = ({ label, columns, rows, onImport }) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState<'export' | 'import' | null>(null);
    const [error, setError] = useState('');
    const [preview, setPreview] = useState<{ fileName: string; result: TableImportResult } | null>(null);
    const [mode, setMode] = useState<'append' | 'replace'>('append');
    const hasData = !isTableEmpty(rows);

    const downloadTemplate = async () => {
        setBusy('export'); setError('');
        try {
            const XLSX = await loadXlsx();
            // Đang có dữ liệu thì xuất kèm để sửa tiếp trên Excel rồi nhập lại.
            const body = hasData ? rows.filter(row => row.some(cell => String(cell ?? '').trim())) : [];
            const sheet = XLSX.utils.aoa_to_sheet([columns, ...body]);
            sheet['!cols'] = columns.map(column => ({ wch: Math.max(14, column.length + 4) }));
            const book = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(book, sheet, 'Du lieu');
            XLSX.writeFile(book, tableTemplateFileName(label));
        } catch (err) {
            console.error('Workflow table template export failed:', err);
            setError('Chưa tạo được file mẫu. Vui lòng thử lại.');
        } finally {
            setBusy(null);
        }
    };

    const readFile = async (file: File | undefined) => {
        if (!file) return;
        setBusy('import'); setError('');
        try {
            const XLSX = await loadXlsx();
            const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
            const sheet = book.Sheets[book.SheetNames[0]];
            const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
            const result = parseTableMatrix(matrix, columns);
            if (result.rows.length === 0) {
                setError(`Không tìm thấy dòng dữ liệu nào trong "${file.name}". Hãy dùng file mẫu và điền từ dòng thứ 2.`);
                return;
            }
            setMode(hasData ? 'append' : 'replace');
            setPreview({ fileName: file.name, result });
        } catch (err) {
            console.error('Workflow table import failed:', err);
            setError(`Không đọc được "${file.name}". Chỉ nhận file Excel (.xlsx, .xls) hoặc .csv.`);
        } finally {
            setBusy(null);
        }
    };

    const apply = () => {
        if (!preview) return;
        const kept = mode === 'append' && hasData ? rows.filter(row => row.some(cell => String(cell ?? '').trim())) : [];
        onImport([...kept, ...preview.result.rows]);
        setPreview(null);
    };

    const result = preview?.result;
    const matched = result ? result.sourceHeaders.filter(Boolean).length : 0;

    return (
        <>
            <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => void downloadTemplate()} disabled={busy !== null} className={btnSoft}
                    title={hasData ? 'Tải bảng hiện tại ra Excel để sửa rồi nhập lại' : 'Tải file Excel có sẵn tên cột để điền'}>
                    {busy === 'export' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Tải mẫu Excel
                </button>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null} className={btnSoft}>
                    {busy === 'import' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}{busy === 'import' ? 'Đang đọc file…' : 'Nhập từ Excel'}
                </button>
                <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.csv"
                    onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ''; }} />
            </div>
            {error && <p role="alert" className="mt-1 w-full text-xs font-semibold text-rose-600">{error}</p>}

            {preview && result && (
                <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Xem trước dữ liệu nhập từ Excel">
                    <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl">
                        <header className="flex items-start gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mint-50 text-mint-700"><FileSpreadsheet size={18} /></span>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-slate-900 dark:text-white">Nhập vào "{label}"</p>
                                <p className="truncate text-xs text-slate-500" title={preview.fileName}>{preview.fileName}</p>
                            </div>
                            <button type="button" onClick={() => setPreview(null)} aria-label="Đóng" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button>
                        </header>

                        <div className="space-y-3 overflow-y-auto px-4 py-3 text-sm">
                            <p className="text-slate-700 dark:text-slate-200">
                                Đọc được <b className="tabular-nums text-leaf-700">{result.rows.length}</b> dòng
                                {!result.byPosition && <> · khớp <b className="tabular-nums text-leaf-700">{matched}/{columns.length}</b> cột</>}
                                {result.skippedEmpty > 0 && <span className="text-slate-400"> · bỏ {result.skippedEmpty} dòng trống</span>}
                            </p>
                            {result.truncated && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">File dài quá, chỉ lấy {result.rows.length} dòng đầu.</p>}
                            {result.byPosition ? (
                                <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                    Không thấy dòng tên cột giống bảng nên đang đọc theo thứ tự cột từ trái sang. Kiểm tra kỹ bên dưới, hoặc tải file mẫu để điền cho chắc.
                                </p>
                            ) : (
                                <ul className="grid gap-1 sm:grid-cols-2">
                                    {columns.map((column, index) => {
                                        const source = result.sourceHeaders[index];
                                        return (
                                            <li key={column} className="flex min-w-0 items-center gap-1.5 text-xs">
                                                {source ? <Check size={13} className="shrink-0 text-leaf-600" /> : <AlertTriangle size={13} className="shrink-0 text-amber-500" />}
                                                <span className="font-semibold text-slate-800 dark:text-slate-100">{column}</span>
                                                <span className="truncate text-slate-400">{source ? (source === column ? '' : `← "${source}"`) : '— file không có, để trống'}</span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                            {result.ignoredHeaders.length > 0 && <p className="text-xs text-slate-400">Bỏ qua cột: {result.ignoredHeaders.join(', ')}</p>}

                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                                <table className="min-w-full text-xs">
                                    <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800">
                                        <tr><th className="px-2 py-1.5">#</th>{columns.map(column => <th key={column} className="min-w-[7rem] whitespace-nowrap px-2 py-1.5">{column}</th>)}</tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {result.rows.slice(0, PREVIEW_ROWS).map((row, ri) => (
                                            <tr key={ri}><td className="px-2 py-1.5 text-slate-400">{ri + 1}</td>{row.map((cell, ci) => <td key={ci} className="min-w-[7rem] whitespace-nowrap px-2 py-1.5 text-slate-700 dark:text-slate-200">{cell || <span className="text-slate-300">—</span>}</td>)}</tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {result.rows.length > PREVIEW_ROWS && <p className="text-xs text-slate-400">… và {result.rows.length - PREVIEW_ROWS} dòng nữa.</p>}

                            {hasData && (
                                <fieldset className="space-y-1.5">
                                    <legend className="mb-1 text-xs font-semibold text-slate-500">Bảng đang có dữ liệu</legend>
                                    <label className="flex items-center gap-2"><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} className="accent-mint-600" />Thêm vào cuối bảng</label>
                                    <label className="flex items-center gap-2"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} className="accent-mint-600" />Thay toàn bộ dữ liệu đang có</label>
                                </fieldset>
                            )}
                        </div>

                        <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
                            <button type="button" onClick={() => setPreview(null)} className={`${btnSoft} flex-1 sm:flex-none`}><ArrowLeft size={14} />Hủy</button>
                            <button type="button" onClick={apply} className={`${btnPrimary} flex-1 sm:flex-none`}><Check size={15} />Nhập {result.rows.length} dòng</button>
                        </footer>
                    </div>
                </div>
            )}
        </>
    );
};

export default WorkflowTableExcel;
