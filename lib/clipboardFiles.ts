const pad = (value: number) => String(value).padStart(2, '0');

// Screenshots and images copied from a browser arrive as "image.png"; give them a readable,
// unique name so several pasted images in one comment do not all look the same.
const isGenericPastedName = (name: string) => !name || /^image\.[a-z0-9]+$/i.test(name);

/**
 * Files carried by a paste (copied images, screenshots, or files copied in Finder/Explorer).
 * Returns an empty list for plain-text pastes so the caller can let the text through.
 */
export const getClipboardFiles = (data: DataTransfer | null, now = new Date()): File[] => {
  if (!data) return [];
  const files = Array.from(data.files || []);
  const source = files.length > 0
    ? files
    : Array.from(data.items || [])
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file));
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return source.map((file, index) => {
    if (!isGenericPastedName(file.name)) return file;
    const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const suffix = source.length > 1 ? `-${index + 1}` : '';
    return new File([file], `anh-dan-${stamp}${suffix}.${extension}`, { type: file.type, lastModified: file.lastModified });
  });
};
