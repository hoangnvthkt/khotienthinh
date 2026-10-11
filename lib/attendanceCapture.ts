// Chấm công trên điện thoại: chụp bằng camera của máy (không xin quyền camera của trang web)
// và hướng dẫn cấp quyền vị trí đúng theo loại máy (sự cố 11/10/2026: hỏi quyền mỗi lần chấm).

export type DevicePlatform = 'ios' | 'android' | 'other';

export const detectPlatform = (
  agent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  maxTouchPoints: number = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0,
): DevicePlatform => {
  if (/iPhone|iPad|iPod/i.test(agent)) return 'ios';
  // iPadOS báo mình là Mac nhưng có màn cảm ứng.
  if (/Macintosh/i.test(agent) && maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(agent)) return 'android';
  return 'other';
};

/** Điện thoại / máy tính bảng dùng camera của máy; máy tính giữ khung camera trực tiếp. */
export const shouldUseNativeCamera = (platform: DevicePlatform = detectPlatform()): boolean => platform !== 'other';

/** Ảnh chấm công phải vừa chụp: chặn chọn ảnh cũ trong máy và ảnh chụp sẵn để lâu. */
export const PHOTO_MAX_AGE_MS = 2 * 60 * 1000;

export const isFreshPhoto = (takenAt: number, now: number = Date.now()): boolean =>
  Number.isFinite(takenAt) && takenAt > 0 && now - takenAt <= PHOTO_MAX_AGE_MS && takenAt - now <= 60_000;

export const locationPermissionSteps = (platform: DevicePlatform): string[] => {
  if (platform === 'ios') {
    return [
      'Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Trang web Safari → Khi dùng ứng dụng, bật Vị trí chính xác.',
      'Cài đặt → Ứng dụng → Safari → Vị trí → Cho phép (iOS 17 trở về trước: Cài đặt → Safari → Vị trí).',
      'Quay lại Vioo, bấm nút lấy lại vị trí.',
    ];
  }
  if (platform === 'android') {
    return [
      'Bấm biểu tượng bên trái thanh địa chỉ Chrome → Quyền → Vị trí → Cho phép.',
      'Nếu mở Vioo từ biểu tượng trên màn hình chính: giữ biểu tượng Vioo → Thông tin ứng dụng → Quyền → Vị trí → Cho phép.',
      'Bật Vị trí (GPS) trong thanh cài đặt nhanh rồi bấm nút lấy lại vị trí.',
    ];
  }
  return [
    'Bấm biểu tượng ổ khóa bên trái thanh địa chỉ → Vị trí → Cho phép.',
    'Tải lại trang rồi bấm nút lấy lại vị trí.',
  ];
};

/** Mẹo hiện đúng lúc trình duyệt sắp hỏi quyền vị trí, để lần sau không bị hỏi lại. */
export const locationPromptTip = (platform: DevicePlatform): string | null => {
  if (platform === 'ios') return 'Để lần sau không bị hỏi lại: Cài đặt → Ứng dụng → Safari → Vị trí → Cho phép.';
  if (platform === 'android') return 'Khi Chrome hỏi, chọn “Khi dùng trang web” (không chọn “Chỉ lần này”) để lần sau không bị hỏi lại.';
  return null;
};

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';

export const queryLocationPermission = async (): Promise<PermissionStatus> => {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state === 'granted' || status.state === 'denied' || status.state === 'prompt' ? status.state : 'unknown';
  } catch {
    return 'unknown';
  }
};

/** Thu nhỏ ảnh, đóng dấu giờ + địa điểm, nén JPEG (khoảng 40–80 KB). */
export const stampPhoto = async (
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  placeName: string,
  options: { maxEdge: number; quality: number; mirror?: boolean; canvas?: HTMLCanvasElement },
): Promise<Blob> => {
  const scale = Math.min(1, options.maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  const canvas = options.canvas || document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không tạo được ảnh chấm công.');

  if (options.mirror) ctx.setTransform(-1, 0, 0, 1, width, 0);
  ctx.drawImage(source, 0, 0, width, height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.fillRect(0, height - 56, width, 56);
  ctx.fillStyle = '#fff';
  ctx.font = '600 15px sans-serif';
  ctx.fillText(new Date().toLocaleString('vi-VN'), 14, height - 33);
  ctx.fillText(placeName, 14, height - 12);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', options.quality));
  if (!blob?.size) throw new Error('Ảnh chấm công rỗng.');
  return blob;
};

/** Đọc ảnh từ camera của máy (trình duyệt tự xoay theo EXIF khi vẽ ảnh). */
export const loadImageFile = (file: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Không đọc được ảnh vừa chụp. Hãy chụp lại.'));
  };
  image.src = url;
});
