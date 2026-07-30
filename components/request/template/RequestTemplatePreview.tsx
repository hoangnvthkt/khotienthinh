import React, { useState } from 'react';
import { FileText, Printer, UsersRound } from 'lucide-react';
import type { RequestTemplateDraft } from '../../../lib/requestTemplateEditorModel';

type Tab = 'FORM' | 'APPROVAL' | 'PRINT';

const RequestTemplatePreview: React.FC<{ draft: RequestTemplateDraft }> = ({ draft }) => {
  const [tab, setTab] = useState<Tab>('FORM');

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Xem trước mẫu</h2>
        <p className="mt-1 text-sm text-slate-500">
          Preview sử dụng chính cấu hình bản nháp, chưa tạo đề xuất thực tế.
        </p>
      </header>
      <div className="border-b border-slate-200 px-5 dark:border-slate-700">
        <div className="flex gap-5 overflow-x-auto">
          {([
            { id: 'FORM', label: 'Form đề xuất', icon: FileText },
            { id: 'APPROVAL', label: 'Tiến trình duyệt', icon: UsersRound },
            { id: 'PRINT', label: 'Trang in', icon: Printer },
          ] as const).map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-1.5 border-b-2 py-3 text-sm font-bold ${
                  tab === item.id ? 'border-accent text-accent' : 'border-transparent text-slate-400'
                }`}
              >
                <Icon size={15} />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="p-5">
        {tab === 'FORM' && (
          <div className="space-y-3">
            <h3 className="font-bold text-slate-800 dark:text-white">
              {draft.name || 'Tên mẫu yêu cầu'}
            </h3>
            {draft.description && <p className="text-sm text-slate-500">{draft.description}</p>}
            {draft.fields.map(field => (
              <label key={field.key} className="block">
                <span className="mb-1 block text-sm font-bold text-slate-700 dark:text-slate-200">
                  {field.label}
                  {field.required && <span className="ml-1 text-red-500">*</span>}
                </span>
                {field.fieldType === 'textarea' ? (
                  <textarea
                    disabled
                    rows={3}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                ) : field.fieldType === 'select' ? (
                  <select
                    disabled
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option>Chọn một giá trị</option>
                    {field.options.filter(Boolean).map(option => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                ) : field.fieldType === 'table' ? (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          {(field.options.filter(Boolean).length > 0
                            ? field.options.filter(Boolean)
                            : ['Cột 1', 'Cột 2']
                          ).map(col => (
                            <th key={col} className="px-2.5 py-1.5 font-bold text-slate-600 dark:text-slate-300">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {(field.options.filter(Boolean).length > 0
                            ? field.options.filter(Boolean)
                            : ['Cột 1', 'Cột 2']
                          ).map((col, idx) => (
                            <td key={idx} className="px-2.5 py-2 text-slate-400">
                              ...
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <input
                    disabled
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                )}
              </label>
            ))}
            {draft.fields.length === 0 && (
              <p className="text-sm text-slate-400">Chưa có trường dữ liệu.</p>
            )}
          </div>
        )}
        {tab === 'APPROVAL' && (
          <ol className="space-y-3">
            {draft.approverBlocks.map((block, index) => (
              <li key={block.key} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-accent dark:bg-emerald-900/30">
                  {index + 1}
                </span>
                <div>
                  <p className="font-bold text-slate-800 dark:text-white">{block.name}</p>
                  <p className="text-sm text-slate-500">
                    {block.source === 'DIRECT_MANAGER'
                      ? 'Quản lý trực tiếp, xác định khi gửi'
                      : block.source === 'DYNAMIC_CREATOR_SELECT'
                      ? `Người tạo chọn khi gửi · tối thiểu ${block.minimumDynamicApprovers ?? 1} người`
                      : `${block.fixedUserIds.length} người duyệt`}{' '}
                    {block.slaHours ? `· SLA ${block.slaHours} giờ` : ''}
                  </p>
                </div>
              </li>
            ))}
            {draft.approverBlocks.length === 0 && (
              <p className="text-sm text-slate-400">Chưa có khối duyệt.</p>
            )}
          </ol>
        )}
        {tab === 'PRINT' && (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
            <Printer className="mx-auto text-slate-300" size={30} />
            <p className="mt-2 font-bold text-slate-700 dark:text-slate-200">
              {draft.name || 'Đề xuất'}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              {draft.print.browserPrintEnabled
                ? 'Bản in trình duyệt/PDF đang bật.'
                : 'Bản in trình duyệt/PDF đang tắt.'}
            </p>
            {draft.print.docxStoragePath && (
              <p className="mt-2 text-xs text-emerald-600">Đã có mẫu DOCX theo phiên bản.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default RequestTemplatePreview;
