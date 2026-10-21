// Đọc COLLADA (SketchUp) trong Node: xmldom thay DOMParser, ảnh vật liệu chỉ ghi tên tệp (gắn lại khi xuất GLB).
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';

export const THREE = await import('three');
const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
globalThis.DOMParser = class { parseFromString(t, m) { const doc = new DOMParser({ onError: () => {} }).parseFromString(t, m); doc.querySelector = sel => { const id = /\[id="([^"]+)"\]/.exec(sel)?.[1]; return id ? doc.getElementById(id) : null; }; return doc; } };
THREE.TextureLoader.prototype.load = function (url) { const t = new THREE.Texture(); t.userData.file = decodeURIComponent(url.split('/').pop()); return t; };
export function loadDae(file) {
  const t0 = Date.now(); const text = readFileSync(file, 'utf8'); console.error('read', ((Date.now() - t0) / 1000).toFixed(1), 's', (text.length / 1e6).toFixed(0), 'M chars');
  const c = new ColladaLoader().parse(text, 'http://local/dae/');
  console.error('parsed', ((Date.now() - t0) / 1000).toFixed(1), 's, heap', (process.memoryUsage().heapUsed / 1e9).toFixed(1), 'GB');
  c.scene.updateMatrixWorld(true); return c.scene;
}
export const triCount = o => { let t = 0; o.traverse(m => { if (m.isMesh) t += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return t; };
