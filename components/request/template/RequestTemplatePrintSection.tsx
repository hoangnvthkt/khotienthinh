import React, { useRef, useState } from 'react';
import { FileText, LoaderCircle, Printer, Upload } from 'lucide-react';
import PizZip from 'pizzip';
import { supabase } from '../../../lib/supabase';
import { requestTemplateService } from '../../../lib/requestTemplateService';
import type { RequestTemplateDraft, RequestTemplateDraftAction } from '../../../lib/requestTemplateEditorModel';

interface Props { draft: RequestTemplateDraft; draftVersionId: string | null; dispatch: (action: RequestTemplateDraftAction) => void; }
const MAX_DOCX_BYTES = 10 * 1024 * 1024;
const fixedTokens: Record<string, string> = { code: 'requestCode', title: 'title', creator_name: 'createdBy', created_at_full: 'createdAt', approval_summary: 'description' };

const RequestTemplatePrintSection: React.FC<Props> = ({ draft, draftVersionId, dispatch }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const upload = async (file?: File) => {
    if (!file || !draftVersionId) return;
    if (!file.name.toLowerCase().endsWith('.docx') || file.size > MAX_DOCX_BYTES) { setMessage('Chỉ nhận tệp .docx tối đa 10 MB.'); return; }
    setIsUploading(true); setMessage(null);
    try {
      const zip = new PizZip(await file.arrayBuffer());
      const documentXml = zip.file('word/document.xml')?.asText() ?? '';
      const tokens = [...new Set([...documentXml.matchAll(/\$\{([^}]+)\}/g)].map(match => match[1].trim()).filter(Boolean))];
      const fieldKeys = new Set(draft.fields.map(field => field.key));
      const invalid = tokens.filter(token => !(token in fixedTokens) && !(token.startsWith('field_') && fieldKeys.has(token.slice(6))));
      if (invalid.length) throw new Error(`Placeholder không hỗ trợ: ${invalid.map(token => `\${${token}}`).join(', ')}`);
      const placeholderSchema = Object.fromEntries(tokens.map(token => [token in fixedTokens ? fixedTokens[token] : token.slice(6), true]));
      const storagePath = `request-template-versions/${draftVersionId}/template.docx`;
      const { error: uploadError } = await supabase.storage.from('workflow-templates').upload(storagePath, file, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: true });
      if (uploadError) throw uploadError;
      await requestTemplateService.registerDocxDraft({ draftVersionId, storagePath, placeholderSchema });
      dispatch({ type: 'SET_PRINT', print: { ...draft.print, docxStoragePath: storagePath } });
      setMessage(`Đã xác thực ${tokens.length} placeholder và lưu mẫu DOCX.`);
    } catch (cause) {
      console.error('Upload request template DOCX failed:', cause);
      setMessage(cause instanceof Error ? cause.message : 'Không thể upload mẫu DOCX.');
    } finally { setIsUploading(false); }
  };
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"><header className="border-b border-slate-200 px-5 py-4 dark:border-slate-700"><h2 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-white"><Printer size={19} className="text-accent" /> In đề xuất</h2><p className="mt-1 text-sm text-slate-500">Thiết lập cách người dùng xuất bản in cho đề xuất đã gửi.</p></header><div className="space-y-4 p-5"><label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-4 dark:border-slate-700"><span><span className="block text-sm font-bold text-slate-700 dark:text-slate-200">Cho phép in từ trình duyệt / PDF</span><span className="mt-1 block text-xs text-slate-400">Bật mặc định, dùng bố cục in chuẩn của Vioo.</span></span><input type="checkbox" checked={draft.print.browserPrintEnabled} onChange={event => dispatch({ type: 'SET_PRINT', print: { ...draft.print, browserPrintEnabled: event.target.checked } })} className="h-5 w-5 accent-emerald-600" /></label><div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm dark:border-slate-700"><div className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200"><FileText size={18} /> Mẫu DOCX theo phiên bản</div><p className="mt-2 text-slate-500">Tệp được lưu riêng theo version nháp, không dùng đường dẫn công khai.</p><input ref={inputRef} type="file" accept=".docx" className="hidden" onChange={event => void upload(event.target.files?.[0])} /><button disabled={!draftVersionId || isUploading} onClick={() => inputRef.current?.click()} className="mt-3 inline-flex items-center rounded-lg bg-slate-800 px-3 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-700">{isUploading ? <LoaderCircle size={16} className="mr-1 animate-spin" /> : <Upload size={16} className="mr-1" />}{isUploading ? 'Đang upload...' : draft.print.docxStoragePath ? 'Thay mẫu DOCX' : 'Upload mẫu DOCX'}</button>{!draftVersionId && <p className="mt-2 text-xs text-amber-600">Lưu nháp trước để tạo version cho tệp DOCX.</p>}{message && <p className={`mt-3 text-sm ${message.startsWith('Đã') ? 'text-emerald-600' : 'text-red-600'}`}>{message}</p>}<div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500"><code>${'{code}'}</code><code>${'{title}'}</code><code>${'{creator_name}'}</code><code>${'{created_at_full}'}</code><code>${'{field_amount}'}</code><code>${'{approval_summary}'}</code></div></div></div></section>;
};

export default RequestTemplatePrintSection;
