import React, { useCallback, useState } from 'react';
import SafetyImageGalleryModal from '../safety/SafetyImageGalleryModal';

// Xem ảnh hiện trường ngay trên giao diện: ← / → chuyển ảnh, + / − phóng to (dùng chung trình xem ảnh của An toàn).
export type ViewerPhoto = { url: string; name: string; fileType?: string };

export function useDailyLogPhotoViewer() {
  const [state, setState] = useState<{ photos: ViewerPhoto[]; index: number } | null>(null);
  const open = useCallback((photos: ViewerPhoto[], index = 0) => {
    if (photos.length) setState({ photos: photos.map(photo => ({ ...photo, fileType: photo.fileType || 'image/jpeg' })), index });
  }, []);
  const viewer = state && <SafetyImageGalleryModal attachments={state.photos} currentIndex={state.index}
    onClose={() => setState(null)} onIndexChange={index => setState(current => current && { ...current, index })} />;
  return { open, viewer };
}
