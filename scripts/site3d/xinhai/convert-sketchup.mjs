import { openPage, LOAD } from './lib.mjs'; import { writeFileSync } from 'node:fs';
const PAGE = LOAD + `
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
const PART = { group_901: 'NNC', group_114: 'NX', group_829: 'GD1', group_1: 'XE5C', group_563: 'XE_TRUOC', group_24: 'XE_GOC', group_593: 'CONG', group_583: 'BAOVE',
  group_27: 'SAN_TRUOC', group_109: 'SAN_TRUOC', group_579: 'PHU_DONG', group_581: 'PHU_DONG', group_577: 'PHU_DONG', group_566: 'PHU_DONG', group_572: 'PHU_DONG', group_0: 'NEN', group_576: 'DIAHINH' };
const DROP = new Set(['group_707', 'group_113']);
const levelOf = y => (y < 4.5 ? 0 : y < 8.7 ? 1 : y < 12.5 ? 2 : 3);
const catOf = o => { for (let n = o; n; n = n.parent) { const m = /^Ifc([A-Za-z]+?)(StandardCase|ElementProxy|Element)?_-_/.exec(n.name || ''); if (m) return m[1]; } return 'misc'; };
window.convert = async () => { window.ROT = -14.33 * Math.PI / 180;
  const site = await loadSite();
  const C = new THREE.Vector3(304, 0, -116); // tâm khu đất sau khi xoay thẳng
  const bushes = [];
  const g707 = ROOT.getObjectByName('group_707');
  for (const ch of g707.children) { const bx = new THREE.Box3().setFromObject(ch); if (bx.isEmpty()) continue; const c = bx.getCenter(new THREE.Vector3()).sub(C), s = bx.getSize(new THREE.Vector3()); bushes.push([+c.x.toFixed(2), +c.z.toFixed(2), +s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)]); }
  for (const n of [...DROP]) { const o = ROOT.getObjectByName(n); o?.parent.remove(o); }
  site.updateMatrixWorld(true);
  // Vật liệu chuẩn PBR.
  const matCache = new Map();
  const stdMat = m => { if (matCache.has(m.uuid)) return matCache.get(m.uuid);
    const nm = (m.name || '').toLowerCase(), glass = m.transparent || m.opacity < 1 || /glass|kinh|kính|vitre|verre|water|nuoc/.test(nm);
    const s = new THREE.MeshStandardMaterial({ name: m.name, color: m.color ? m.color.clone() : new THREE.Color('#cccccc'), map: m.map || null, roughness: glass ? 0.1 : /metal|inox|thép|steel|alu|ton|tôn|corrugated/.test(nm) ? 0.45 : 0.85,
      metalness: /metal|inox|steel|alu|chrome/.test(nm) ? 0.5 : glass ? 0.3 : 0, transparent: glass, opacity: glass ? Math.min(m.opacity ?? 1, 0.55) : 1, side: THREE.FrontSide });
    if (s.map) { s.map.colorSpace = THREE.SRGBColorSpace; const src = s.map.image?.src || ''; s.map.userData.mimeType = /\\.png/i.test(src) ? 'image/png' : 'image/jpeg'; }
    matCache.set(m.uuid, s); return s; };
  // Đếm số lần dùng chung hình học (mẫu lặp: cửa, cầu thang, đèn…).
  const useCount = new Map(); site.traverse(o => { if (o.isMesh) useCount.set(o.geometry.uuid, (useCount.get(o.geometry.uuid) || 0) + 1); });
  const buckets = new Map(), inst = new Map(); let nMesh = 0, triIn = 0;
  const box = new THREE.Box3();
  site.traverse(o => {
    if (!o.isMesh) return; nMesh++;
    let top = o; while (top.parent && top.parent !== ROOT) top = top.parent; const part = PART[top.name] || 'KHAC';
    const g = o.geometry, tris = (g.index ? g.index.count : g.attributes.position.count) / 3; triIn += tris;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    box.setFromObject(o); const yMin = box.min.y, xc = (box.min.x + box.max.x) / 2 - C.x;
    const zc = (box.min.z + box.max.z) / 2 - C.z;
    let part2 = part;
    if (part === 'NX' && xc > 57.2) part2 = 'NVP';
    if (part === 'NEN' && xc > -105 && xc < 78 && zc > -112 && zc < -1) part2 = 'NEN_GD2';
    const cat = catOf(o), lv = levelOf(yMin), xbin = part2 === 'NX' ? Math.max(0, Math.min(17, Math.floor((xc + 84.5) / 7.861))) : 0;
    const shared = useCount.get(g.uuid) >= 3 && tris >= 1500;
    // Tách từng nhóm vật liệu của hình học.
    const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : g.attributes.position.count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = stdMat(mats[gr.materialIndex] || mats[0]);
      let sub = g.index ? g : g; // tách tam giác theo nhóm
      const idx = g.index ? g.index.array.slice(gr.start, gr.start + gr.count) : null;
      const ng = new THREE.BufferGeometry();
      for (const a of ['position', 'normal', 'uv']) if (g.attributes[a]) ng.setAttribute(a, g.attributes[a]);
      if (idx) ng.setIndex(new THREE.BufferAttribute(idx, 1)); else ng.setDrawRange(gr.start, gr.count);
      let piece = idx ? ng : (() => { const out = new THREE.BufferGeometry(); for (const a of ['position', 'normal', 'uv']) if (g.attributes[a]) { const at = g.attributes[a]; out.setAttribute(a, new THREE.BufferAttribute(at.array.slice(gr.start * at.itemSize, (gr.start + gr.count) * at.itemSize), at.itemSize)); } return out; })();
      if (shared) { const key = g.uuid + '|' + mat.uuid + '|' + part2; if (!inst.has(key)) inst.set(key, { geo: piece.index ? piece.toNonIndexed() : piece, mat, part: part2, cat, mats: [] }); inst.get(key).mats.push({ m: o.matrixWorld.clone(), lv, xbin }); continue; }
      const p = (piece.index ? piece.toNonIndexed() : piece.clone()); p.applyMatrix4(o.matrixWorld); p.translate(-C.x, 0, -C.z);
      if (!p.attributes.uv) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
      if (!p.attributes.normal) p.computeVertexNormals();
      const det = part2 === 'NNC' || part2 === 'NX' || part2 === 'NVP';
      const key = [part2, det ? cat : '', det ? lv : '', xbin, mat.uuid].join('|');
      if (!buckets.has(key)) buckets.set(key, { part: part2, cat, lv, xbin, mat, geos: [] }); buckets.get(key).geos.push(p);
    }
  });
  const out = new THREE.Scene(); let triOut = 0;
  for (const [key, b] of buckets) { const merged = mergeVertices(mergeGeometries(b.geos, false), 1e-4); const m = new THREE.Mesh(merged, b.mat); m.name = [b.part, b.cat, b.lv, b.xbin].join('|'); m.userData = { part: b.part, cat: b.cat, lv: b.lv, xbin: b.xbin }; out.add(m); triOut += merged.index.count / 3; }
  const T = new THREE.Matrix4().makeTranslation(-C.x, 0, -C.z); let instCount = 0;
  for (const [key, it] of inst) { const geo = mergeVertices(it.geo, 1e-4); if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    for (const e of it.mats) { const m = new THREE.Mesh(geo, it.mat); m.matrixAutoUpdate = false; m.matrix.copy(T).multiply(e.m); m.matrix.decompose(m.position, m.quaternion, m.scale); m.name = [it.part, it.cat, e.lv, e.xbin, 'inst'].join('|'); m.userData = { part: it.part, cat: it.cat, lv: e.lv, xbin: e.xbin }; out.add(m); instCount++; } triOut += geo.index.count / 3 * it.mats.length; }
  // Chờ ảnh vật liệu tải xong; ảnh hỏng thì bỏ map, giữ màu.
  const texs = new Set(); for (const m of matCache.values()) if (m.map) texs.add(m);
  for (let t = 0; t < 120; t++) { if ([...texs].every(m => m.map.image && m.map.image.complete)) break; await new Promise(r => setTimeout(r, 250)); }
  let badTex = 0; for (const m of texs) { const im = m.map?.image; if (!im || !(im.naturalWidth > 0)) { m.map = null; m.needsUpdate = true; badTex++; } }
  const glb = await new GLTFExporter().parseAsync(out, { binary: true, maxTextureSize: 1024, onlyVisible: true });
  window.GLB = new Uint8Array(glb);
  return { badTex, nMesh, triIn, buckets: buckets.size, instGeoms: inst.size, instCount, triOut, bytes: window.GLB.length, bushes, mats: matCache.size };
};
window.chunk = (i, n) => { const a = window.GLB.subarray(i, i + n); let s = ''; for (let k = 0; k < a.length; k += 0x8000) s += String.fromCharCode.apply(null, a.subarray(k, k + 0x8000)); return btoa(s); };`;
const { b, page } = await openPage(PAGE);
const t0 = Date.now();
const r = await page.evaluate(() => convert());
console.log('convert', ((Date.now() - t0) / 1000).toFixed(1), 's', JSON.stringify({ ...r, bushes: r.bushes.length }));
const parts = []; for (let i = 0; i < r.bytes; i += 8 << 20) parts.push(Buffer.from(await page.evaluate(([i, n]) => chunk(i, n), [i, 8 << 20]), 'base64'));
writeFileSync('xinhai-raw.glb', Buffer.concat(parts)); writeFileSync('xinhai-bushes.json', JSON.stringify(r.bushes));
console.log('wrote raw glb', (r.bytes / 1e6).toFixed(1), 'MB');
await b.close();
