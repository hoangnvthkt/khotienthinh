// SMB: COLLADA (SketchUp) → GLB trong Node. Gom khối theo "phần|loại|vật liệu", ảnh vật liệu gắn lại từ tệp.
// node --max-old-space-size=13000 convert-dae.mjs <tệp.dae> <ra.glb> map-smb.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { loadDae, THREE } from './node-dae.mjs';
import { Document, NodeIO } from '@gltf-transform/core';
const [daeFile, outFile, mapFile] = process.argv.slice(2);
const MAP = mapFile ? JSON.parse(readFileSync(mapFile, 'utf8')) : { parts: {}, cats: {}, drop: [] };
const scene = loadDae(daeFile);
const root = scene.getObjectByName('SketchUp') || scene;
const DROP = new Set(MAP.drop || []);
const doomed = []; root.traverse(o => { if (DROP.has(o.name)) doomed.push(o); }); for (const o of doomed) o.parent?.remove(o);
console.log('dropped', doomed.length);
scene.updateMatrixWorld(true);
const [CX, CZ] = MAP.center || [0, 0];
// phần = nhóm cấp 1 (theo bảng), loại = nhóm cấp 2 (theo bảng hoặc quy tắc theo hộp bao), tầng = theo cao độ (nhà nhiều tầng).
const partOf = new Map(), catOf = new Map(), lvOf = new Map();
const bb = new THREE.Box3();
for (const top of root.children) { const part = MAP.parts[top.name] ?? MAP.defaultPart ?? ''; top.traverse(o => partOf.set(o, part));
  const rule = MAP.rules?.[part];
  for (const k of top.children) { let cat = MAP.cats[k.name];
    if (!cat && rule === 'factory') { bb.setFromObject(k); const h = bb.max.y - bb.min.y; cat = bb.isEmpty() ? 'body' : bb.min.y >= 11 ? 'roof' : (h < 0.5 && bb.min.y > 2) ? 'slab' : 'body'; }
    k.traverse(o => catOf.set(o, cat || 'misc')); } }
const FACADE = MAP.facade ? new RegExp(MAP.facade, 'i') : null;
const buckets = new Map(); const matKey = new Map(); let triIn = 0;
const keyOfMat = m => { if (matKey.has(m)) return matKey.get(m); const k = `${m.name}|${m.color?.getHexString()}|${m.map?.userData.file || ''}|${m.transparent ? 1 : 0}|${m.opacity ?? 1}`; matKey.set(m, k); return k; };
scene.traverse(o => {
  if (!o.isMesh) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const g0 = o.geometry; const pos = g0.attributes.position; if (!pos) return;
  const groups = g0.groups.length ? g0.groups : [{ start: 0, count: g0.index ? g0.index.count : pos.count, materialIndex: 0 }];
  const ng = g0.index ? g0.toNonIndexed() : g0;
  for (const gr of groups) {
    const m = mats[gr.materialIndex] || mats[0]; const part = partOf.get(o) ?? ''; let cat = catOf.get(o) ?? 'misc';
    let lv = 0;
    if (MAP.rules?.[part] === 'floors') { bb.setFromObject(o); lv = Math.max(0, Math.min(MAP.maxLevel ?? 4, Math.floor((bb.min.y - (MAP.floorBase ?? 0.2) + 0.3) / (MAP.floorH ?? 3.6)))); cat = FACADE && FACADE.test(m.name || '') ? 'facade' : 'body'; }
    const key = `${part}|${cat}|${lv}|${keyOfMat(m)}`;
    const b = buckets.get(key) || { part, cat, lv, m, pos: [], nor: [], uv: [], n: 0 }; buckets.set(key, b);
    const P = ng.attributes.position, N = ng.attributes.normal, U = ng.attributes.uv;
    const mw = o.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(mw), v = new THREE.Vector3();
    for (let i = gr.start; i < gr.start + gr.count; i += 1) {
      v.fromBufferAttribute(P, i).applyMatrix4(mw); b.pos.push(v.x - CX, v.y, v.z - CZ);
      if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); b.nor.push(v.x, v.y, v.z); } else b.nor.push(0, 1, 0);
      if (U) b.uv.push(U.getX(i), 1 - U.getY(i)); else b.uv.push(0, 0);
      b.n += 1;
    }
    triIn += gr.count / 3;
  }
});
console.log('buckets', buckets.size, 'tris', triIn);
const doc = new Document(); const buf = doc.createBuffer(); const sc = doc.createScene('site');
const texCache = new Map(); const DIR = dirname(daeFile);
const texOf = file => { if (texCache.has(file)) return texCache.get(file); const p = join(DIR, file); let t = null;
  if (existsSync(p)) { const ext = extname(file).toLowerCase(); const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : null; if (mime) t = doc.createTexture(file).setImage(readFileSync(p)).setMimeType(mime); }
  texCache.set(file, t); return t; };
const gmats = new Map();
const gmatOf = m => { const k = keyOfMat(m); if (gmats.has(k)) return gmats.get(k);
  const nm = (m.name || '').toLowerCase(), glass = m.transparent || (m.opacity ?? 1) < 1 || /glass|kinh|kính|water|nuoc/.test(nm);
  const c = m.color || new THREE.Color(0.8, 0.8, 0.8);
  const gm = doc.createMaterial(m.name || 'm').setBaseColorFactor([c.r, c.g, c.b, glass ? Math.min(m.opacity ?? 1, 0.55) : 1])
    .setRoughnessFactor(glass ? 0.1 : /metal|inox|thép|steel|alu|ton|tôn/.test(nm) ? 0.45 : 0.85).setMetallicFactor(/metal|inox|steel|alu|chrome/.test(nm) ? 0.5 : 0);
  if (glass) gm.setAlphaMode('BLEND');
  const tex = m.map?.userData.file ? texOf(m.map.userData.file) : null; if (tex) gm.setBaseColorTexture(tex);
  gmats.set(k, gm); return gm; };
let triOut = 0;
for (const b of buckets.values()) {
  const prim = doc.createPrimitive().setMaterial(gmatOf(b.m))
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.pos)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.nor)).setBuffer(buf));
  if (b.m.map?.userData.file && texOf(b.m.map.userData.file)) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(b.uv)).setBuffer(buf));
  const name = `${b.part}|${b.cat}|${b.lv}|0`; sc.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim))); triOut += b.n / 3;
}
console.log('triOut', triOut, 'materials', gmats.size, 'textures', [...texCache.values()].filter(Boolean).length);
await new NodeIO().write(outFile, doc);
console.log('wrote', outFile);
