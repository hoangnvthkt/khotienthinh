/** Camera input is reduced only when the user has not requested original retention.
 * Evidence always takes the untouched file path. The server still validates bytes. */
export async function prepareWorkImage(
  file: File,
  retainOriginal: boolean,
): Promise<File> {
  // Only camera JPEGs are normalized here. PNG/WebP stay untouched so the
  // server can reject animated containers instead of silently flattening them.
  if (file.type !== "image/jpeg" || retainOriginal) return file;
  if (file.size > 32 * 1024 * 1024) throw new Error("WORK_INVALID_FILE");
  const header = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  if (header[0] !== 255 || header[1] !== 216 || header[2] !== 255)
    throw new Error("WORK_INVALID_FILE");
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("WORK_INVALID_FILE");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("WORK_INVALID_FILE"))),
        "image/webp",
        0.86,
      ),
    );
    if (blob.type !== "image/webp" || blob.size > 5 * 1024 * 1024)
      throw new Error("WORK_INVALID_FILE");
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", {
      type: blob.type,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}
