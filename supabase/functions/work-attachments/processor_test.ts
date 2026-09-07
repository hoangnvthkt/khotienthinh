import { strict as assert } from 'node:assert';
import { ImageMagick, MagickColors, MagickFormat, Orientation, initializeImageMagick } from '@imagemagick/magick-wasm';
import { processFile, InvalidFile, imageProcessorHealth } from './processor.ts';
const wasm = await Deno.readFile(new URL('x86/magick.wasm', import.meta.resolve('@imagemagick/magick-wasm')));
await initializeImageMagick(wasm);
Deno.test('normalizes EXIF orientation, strips metadata, bounds variants and preserves original only when requested', async () => {
  const source = ImageMagick.read(MagickColors.Red, 800, 400, img => {
    img.orientation = Orientation.RightTop;
    // EXIF orientation tag=6. Include a separate sensitive profile that must disappear.
    img.setProfile('exif', new Uint8Array([69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]));
    img.comment = 'GPS private location';
    return img.write(MagickFormat.Jpeg, data => data.slice());
  });
  const result = await processFile(source, 'image/jpeg', source.length, false, 640);
  assert.deepEqual(result.map(x => x.name), ['display.webp','fallback.png','thumbnail.webp']);
  assert.equal(result[0].width, 320); assert.equal(result[0].height, 640);
  assert.equal(result[2].width, 160); assert.equal(result[2].height, 320);
  for (const output of result) ImageMagick.read(output.bytes, img => {
    assert.equal(img.profileNames.includes('exif'), false); assert.equal(img.comment, null);
    assert.equal(img.width, output.width); assert.equal(img.height, output.height);
  });
  const retained = await processFile(source, 'image/jpeg', source.length, true);
  assert.deepEqual(retained.at(-1)!.bytes, source);
});
Deno.test('rejects spoofed MIME, size mismatch, corrupt image, invalid UTF-8 and unsupported formats', async () => {
  const text = new TextEncoder().encode('hello');
  for (const [bytes,mime,size] of [[text,'image/jpeg',5],[text,'text/plain',4],[new Uint8Array([255,216,255,217]),'image/jpeg',4],[new Uint8Array([255]),'text/plain',1],[text,'text/html',5]] as const) {
    await assert.rejects(() => processFile(bytes,mime,size,false), InvalidFile);
  }
  assert.equal((await processFile(text,'text/plain',5,false))[0].name, 'original');
  const pdf = new TextEncoder().encode('%PDF-1.7\nfixture\n%%EOF\n');
  assert.equal((await processFile(pdf,'application/pdf',pdf.length,false))[0].mimeType, 'application/pdf');
  await assert.rejects(() => processFile(pdf,'text/plain',pdf.length,false), InvalidFile);
});
Deno.test('rejects oversized decoded images before raster processing and animated containers', async () => {
  const large = ImageMagick.read(MagickColors.Blue, 2100, 2000, img => img.write(MagickFormat.Png, data => data.slice()));
  await assert.rejects(() => processFile(large,'image/png',large.length,false), InvalidFile);
  const webp = new Uint8Array(30); webp.set(new TextEncoder().encode('RIFF')); new DataView(webp.buffer).setUint32(4,22,true); webp.set(new TextEncoder().encode('WEBPVP8X'),8); new DataView(webp.buffer).setUint32(16,10,true); webp[20]=2;
  await assert.rejects(() => processFile(webp,'image/webp',webp.length,false), InvalidFile);
});
Deno.test('accepts PNG transparency and static WebP without upscaling', async () => {
  for (const [format,mime] of [[MagickFormat.Png,'image/png'],[MagickFormat.WebP,'image/webp']] as const) {
    const source = ImageMagick.read(MagickColors.Transparent, 40, 20, img => img.write(format, data => data.slice()));
    const result = await processFile(source,mime,source.length,false);
    assert.equal(result[0].width,40); assert.equal(result[0].height,20);
    ImageMagick.read(result[1].bytes, img => assert.equal(img.hasAlpha,true));
  }
});

Deno.test('fixed deployment health fixture executes the real processor', async () => { assert.equal((await imageProcessorHealth()).ok,true); });
