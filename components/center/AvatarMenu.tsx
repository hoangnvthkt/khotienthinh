import React, { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

// Bấm avatar → menu cá nhân (chủ SP 10/10): thông tin cá nhân, phiếu lương, cài đặt, đăng xuất.
// Dùng chung cho avatar ở đầu Trung tâm và avatar cuối thanh bên trái.

export interface AvatarMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Đăng xuất: tách khỏi nhóm trên, chữ đỏ. */
  danger?: boolean;
}

const AvatarMenu: React.FC<{
  name: string;
  subtitle?: string | null;
  items: AvatarMenuItem[];
  /** Vị trí menu so với nút: dưới-phải (đầu trang) hoặc trên-phải (thanh bên). */
  placement?: 'below' | 'beside';
  buttonClassName: string;
  children: React.ReactNode;
}> = ({ name, subtitle, items, placement = 'below', buttonClassName, children }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);
  const main = items.filter(item => !item.danger);
  const danger = items.filter(item => item.danger);
  const render = (item: AvatarMenuItem) => {
    const Icon = item.icon;
    return (
      <button key={item.key} type="button" role="menuitem" className="vcc-amenu-item" data-danger={item.danger || undefined}
        onClick={() => { setOpen(false); item.onSelect(); }}>
        <Icon size={15} /> {item.label}
      </button>
    );
  };
  return (
    <div className="vcc-amenu-wrap" ref={ref}>
      <button type="button" className={buttonClassName} aria-haspopup="menu" aria-expanded={open} aria-label={`Tài khoản ${name}`}
        title={name} onClick={() => setOpen(value => !value)}>
        {children}
      </button>
      {open && (
        <div className="vcc-amenu" role="menu" aria-label="Tài khoản" data-placement={placement}>
          <div className="vcc-amenu-head">
            <div className="vcc-ellipsis font-semibold">{name}</div>
            {subtitle && <div className="vcc-ellipsis text-xs vcc-muted">{subtitle}</div>}
          </div>
          {main.map(render)}
          {danger.length > 0 && <div className="vcc-amenu-sep" />}
          {danger.map(render)}
        </div>
      )}
    </div>
  );
};

export default AvatarMenu;
