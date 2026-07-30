import React from 'react';
import { Bell, FileText, Gauge, MapPin, Printer, UsersRound } from 'lucide-react';

export type RequestTemplateSection =
  | 'GENERAL' | 'FORM' | 'APPROVAL'
  | 'WATCHERS' | 'PRINT' | 'NOTIFICATIONS';

const sections: Array<{ id: RequestTemplateSection; label: string; description: string; icon: React.ElementType }> = [
  { id: 'GENERAL', label: 'Thiết lập chung', description: 'Thông tin và phạm vi dùng', icon: Gauge },
  { id: 'FORM', label: 'Mẫu form đề xuất', description: 'Các trường dữ liệu tùy chỉnh', icon: FileText },
  { id: 'APPROVAL', label: 'Luồng phê duyệt', description: 'Khối duyệt và cách vận hành', icon: MapPin },
  { id: 'WATCHERS', label: 'Người theo dõi', description: 'Thành viên nhận thông tin', icon: UsersRound },
  { id: 'PRINT', label: 'In đề xuất', description: 'Bản in trình duyệt và DOCX', icon: Printer },
  { id: 'NOTIFICATIONS', label: 'Thông báo', description: 'Sự kiện gửi thông báo', icon: Bell },
];

interface Props {
  active: RequestTemplateSection;
  onChange: (section: RequestTemplateSection) => void;
}

const RequestTemplateSettingsNav: React.FC<Props> = ({ active, onChange }) => <nav aria-label="Thiết lập mẫu yêu cầu" className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 lg:border-b-0 lg:border-r">
  <div className="flex gap-1 overflow-x-auto px-3 py-2 lg:block lg:space-y-1 lg:px-3 lg:py-4">
    {sections.map(section => {
      const Icon = section.icon;
      const selected = section.id === active;
      return <button key={section.id} type="button" onClick={() => onChange(section.id)} className={`flex min-w-max items-center gap-3 rounded-xl px-3 py-2.5 text-left transition lg:w-full ${selected ? 'bg-emerald-50 text-accent dark:bg-emerald-900/25' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'}`}>
        <Icon size={18} className={selected ? 'text-accent' : 'text-slate-400'} />
        <span><span className="block text-sm font-bold">{section.label}</span><span className="hidden text-xs text-slate-400 lg:block">{section.description}</span></span>
      </button>;
    })}
  </div>
</nav>;

export default RequestTemplateSettingsNav;
