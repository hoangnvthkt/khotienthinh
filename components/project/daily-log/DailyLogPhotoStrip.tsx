import React from 'react';
import { FileText } from 'lucide-react';

interface Photo { url: string; name?: string | null; fileType?: string | null }

const isImage = (photo: Photo) => !photo.fileType
  ? /\.(jpe?g|png|webp|gif|heic)(\?|$)/i.test(photo.url) || !/\.[a-z0-9]{2,5}(\?|$)/i.test(photo.url)
  : /^(image|jpe?g|png|webp|gif|heic)/i.test(photo.fileType);

// Thumbnails instead of text links. Private-bucket URLs are signed by the
// app-wide PrivateStorageLinkResolver when they reach the DOM.
export function DailyLogPhotoStrip({ photos, label }: { photos: Photo[]; label: string }) {
  if (!photos.length) return null;
  return <div className="flex flex-wrap gap-2">
    {photos.map((photo, index) => isImage(photo)
      ? <a key={`${photo.url}-${index}`} href={photo.url} target="_blank" rel="noreferrer" title={photo.name || label}
          className="block h-20 w-20 overflow-hidden rounded-lg border border-border bg-muted">
          <img src={photo.url} alt={photo.name || `${label} ${index + 1}`} loading="lazy" className="h-full w-full object-cover" />
        </a>
      : <a key={`${photo.url}-${index}`} href={photo.url} target="_blank" rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-teal-800 dark:text-teal-200">
          <FileText size={14} aria-hidden />{photo.name || label}
        </a>)}
  </div>;
}
