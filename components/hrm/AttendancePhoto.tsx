import React from 'react';
import { Camera, ImageOff } from 'lucide-react';
import { useSignedStorageUrl } from '../../hooks/useSignedStorageUrl';

interface Props {
  url: string | null | undefined;
  alt: string;
  className: string;
  /** Wrap in a link that opens the full-size photo. */
  linkClassName?: string;
  title?: string;
  children?: React.ReactNode;
}

/** Check-in photo from the private bucket: signs the stored URL before display. */
const AttendancePhoto: React.FC<Props> = ({ url, alt, className, linkClassName, title, children }) => {
  const state = useSignedStorageUrl(url);
  const placeholder = (icon: React.ReactNode, label: string) => (
    <div className={`${className} flex items-center justify-center bg-slate-100 text-slate-400 dark:bg-slate-800`} title={label} aria-label={label}>
      {icon}
    </div>
  );

  if (state.status === 'empty') return placeholder(<Camera size={20} />, 'Chưa có ảnh');
  if (state.status === 'loading') return <div className={`${className} animate-pulse bg-slate-100 dark:bg-slate-800`} aria-label="Đang tải ảnh" />;
  if (state.status === 'error') return placeholder(<ImageOff size={18} />, 'Không xem được ảnh (hết hạn hoặc không có quyền)');

  const image = <img src={state.url} alt={alt} loading="lazy" className={className} />;
  if (!linkClassName) return image;
  return (
    <a href={state.url} target="_blank" rel="noopener noreferrer" className={linkClassName} title={title}>
      {image}
      {children}
    </a>
  );
};

export default AttendancePhoto;
