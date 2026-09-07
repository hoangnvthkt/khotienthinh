import { ImageMagick, MagickFormat, MagickImageInfo, MagickReadSettings, ResourceLimits, initializeImageMagick } from '@imagemagick/magick-wasm';

export class InvalidFile extends Error {
  constructor() { super('WORK_INVALID_FILE'); }
}
export type Output = { name: string; mimeType: string; bytes: Uint8Array; width?: number; height?: number };
let initialized: Promise<void> | undefined;
function initialize() {
  return initialized ??= (async () => {
    const wasm = await Deno.readFile(new URL('x86/magick.wasm', import.meta.resolve('@imagemagick/magick-wasm')));
    await initializeImageMagick(wasm);
    ResourceLimits.memory = 96n * 1024n * 1024n;
    ResourceLimits.maxMemoryRequest = 96n * 1024n * 1024n;
    ResourceLimits.disk = 0n;
    ResourceLimits.width = 4096n;
    ResourceLimits.height = 4096n;
    // ImageMagick needs temporary clone slots even for one static image.
    ResourceLimits.listLength = 16n;
    ResourceLimits.maxProfileSize = 1024n * 1024n;
  })();
}
const ascii = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);
function validateSignature(bytes: Uint8Array, mime: string) {
  const head = ascii(bytes.subarray(0, 16));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/jpeg') {
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new InvalidFile();
  } else if (mime === 'image/png') {
    if (!bytes.subarray(0, 8).every((v, i) => v === [137,80,78,71,13,10,26,10][i]) || bytes.length < 45) throw new InvalidFile();
    let end = false;
    for (let offset = 8; offset < bytes.length;) {
      if (offset + 12 > bytes.length) throw new InvalidFile();
      const size = view.getUint32(offset), type = ascii(bytes.subarray(offset + 4, offset + 8));
      if (type === 'acTL' || offset + size + 12 > bytes.length) throw new InvalidFile();
      offset += size + 12;
      if (type === 'IEND') { if (offset !== bytes.length || size !== 0) throw new InvalidFile(); end = true; }
    }
    if (!end) throw new InvalidFile();
  } else if (mime === 'image/webp') {
    if (!head.startsWith('RIFF') || head.slice(8,12) !== 'WEBP' || bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length) throw new InvalidFile();
    for (let offset = 12; offset < bytes.length;) {
      if (offset + 8 > bytes.length) throw new InvalidFile();
      const type = ascii(bytes.subarray(offset, offset + 4)), size = view.getUint32(offset + 4, true);
      if (type === 'ANIM' || type === 'ANMF' || (type === 'VP8X' && (bytes[offset + 8] & 2))) throw new InvalidFile();
      offset += 8 + size + (size % 2);
      if (offset > bytes.length) throw new InvalidFile();
    }
  } else if (mime === 'application/pdf') {
    if (!/^%PDF-1\.[0-7]|^%PDF-2\.0/.test(head) || !/%%EOF\s*$/.test(ascii(bytes.subarray(-1024)))) throw new InvalidFile();
  } else if (mime === 'text/plain') {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new InvalidFile(); }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) || /^\s*(?:<!doctype|<html|<svg|<script|%PDF-)/i.test(text)) throw new InvalidFile();
  } else throw new InvalidFile();
}
export async function processFile(bytes: Uint8Array, mimeType: string, expectedSize: number, keepOriginal: boolean, maxEdge = 1920): Promise<Output[]> {
  const isImage = mimeType.startsWith('image/');
  if (bytes.length !== expectedSize || bytes.length < 1 || bytes.length > (isImage ? 5242880 : 26214400)) throw new InvalidFile();
  if (!Number.isInteger(maxEdge) || maxEdge < 320 || maxEdge > 1920) throw new Error('WORK_INVALID_IMAGE_CONFIG');
  validateSignature(bytes, mimeType);
  if (!isImage) return [{ name: 'original', mimeType, bytes }];
  await initialize();
  try {
    const format = mimeType === 'image/jpeg' ? MagickFormat.Jpeg : mimeType === 'image/png' ? MagickFormat.Png : MagickFormat.WebP;
    const settings = new MagickReadSettings(); settings.format = format;
    const info = new MagickImageInfo(); info.read(bytes, settings);
    if (info.width < 1 || info.height < 1 || info.width > 4096 || info.height > 4096 || info.width * info.height > 4_000_000) throw new InvalidFile();
    return ImageMagick.read(bytes, format, img => {
      img.autoOrient(); img.strip();
      for (const name of img.attributeNames) img.removeAttribute(name);
      const resize = (edge: number) => {
        const ratio = Math.min(1, edge / Math.max(img.width, img.height));
        if (ratio < 1) img.resize(Math.max(1, Math.round(img.width * ratio)), Math.max(1, Math.round(img.height * ratio)));
      };
      resize(maxEdge);
      const outputs: Output[] = [];
      img.quality = 80;
      outputs.push({ name: 'display.webp', mimeType: 'image/webp', width: img.width, height: img.height, bytes: img.write(MagickFormat.WebP, data => data.slice()) });
      outputs.push({ name: 'fallback.png', mimeType: 'image/png', width: img.width, height: img.height, bytes: img.write(MagickFormat.Png, data => data.slice()) });
      resize(320);
      outputs.push({ name: 'thumbnail.webp', mimeType: 'image/webp', width: img.width, height: img.height, bytes: img.write(MagickFormat.WebP, data => data.slice()) });
      if (keepOriginal) outputs.push({ name: 'original', mimeType, bytes });
      return outputs;
    });
  } catch { throw new InvalidFile(); }
}

/** Fixed synthetic fixture only; internal deployment probe never reads a user's file. */
export async function imageProcessorHealth() {
  const fixture = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAADUExURf8AABniCTcAAAAHdElNRQfqCQcEFCT+aFPUAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTA5LTA3VDA0OjIwOjM2KzAwOjAwKF24VAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0wOS0wN1QwNDoyMDozNiswMDowMFkAAOgAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMDktMDdUMDQ6MjA6MzYrMDA6MDAOFSE3AAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  const outputs = await processFile(fixture,'image/png',fixture.length,false);
  return { ok: outputs.length === 3 && outputs.every(x => x.width === 2 && x.height === 1 && x.bytes.length > 0), processor: 'magick-wasm', formats: ['webp','png'] };
}
