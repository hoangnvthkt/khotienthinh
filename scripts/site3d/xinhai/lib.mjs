import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
// Thư mục chứa TMB+NM_V1.dae + ảnh vật liệu (SketchUp → File → Export → 3D Model → COLLADA, giải nén zip).
export const DIR = (process.env.SITE3D_DAE_DIR || '').replace(/\/?$/, '/');
if (!process.env.SITE3D_DAE_DIR) throw new Error('Đặt SITE3D_DAE_DIR=<thư mục chứa TMB+NM_V1.dae>');
export async function openPage(script, { gl = false } = {}) {
  const b = await chromium.launch({ channel: 'chrome', args: ['--js-flags=--max-old-space-size=12000', ...(gl ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [])] });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
  page.on('console', m => { if (!/404/.test(m.text())) console.log('page:', m.text().slice(0, 400)); });
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.route('http://local/**', r => {
    let f = decodeURIComponent(new URL(r.request().url()).pathname.slice(1)).replace(/^TMB\+NM_V1\//, '');
    if (f === 'index.html') return r.fulfill({ contentType: 'text/html', body: `<!doctype html><body style="margin:0"><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/"}}</script><script type="module">${script}</script>` });
    const p = DIR + f; if (!existsSync(p)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: readFileSync(p), contentType: f.endsWith('.dae') ? 'model/vnd.collada+xml' : f.endsWith('.png') ? 'image/png' : 'image/jpeg' });
  });
  await page.goto('http://local/index.html');
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
  return { b, page };
}
// Đoạn JS dùng chung trong trang: nạp DAE, xoay thẳng theo trục khu đất.
export const LOAD = `
import * as THREE from 'three'; import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
window.THREE = THREE;
window.loadSite = async () => {
  const c = await new ColladaLoader().loadAsync('http://local/TMB+NM_V1.dae');
  const site = new THREE.Group(); site.add(c.scene); site.rotation.y = window.ROT ?? (14.33 * Math.PI / 180); site.updateMatrixWorld(true);
  const root = c.scene.getObjectByName('SketchUp') || c.scene; window.SITE = site; window.ROOT = root; return site; };
window.triCount = o => { let t = 0; o.traverse(m => { if (m.isMesh) t += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return t; };
window.ready = true;`;
