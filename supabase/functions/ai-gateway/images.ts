// Ảnh gửi kèm skill đọc ảnh (base64 không tiền tố data:). Tách riêng để skills.ts không kéo SDK nhà cung cấp vào test.
export interface ImagePart { mime: 'image/jpeg' | 'image/png' | 'image/webp'; b64: string }
