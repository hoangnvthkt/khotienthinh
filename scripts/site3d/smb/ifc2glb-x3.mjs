import * as WebIFC from 'web-ifc';
import { readFileSync, writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, quantize, meshopt, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
const api = new WebIFC.IfcAPI(); api.SetWasmPath(new URL('./node_modules/web-ifc/', import.meta.url).pathname, true); await api.Init(); api.SetLogLevel?.(WebIFC.LogLevel?.LOG_LEVEL_OFF ?? 6);
const model = api.OpenModel(new Uint8Array(readFileSync(process.argv[2] || (() => { throw new Error('node ifc2glb.mjs <tệp .ifc xuất từ Tekla>'); })())), { COORDINATE_TO_ORIGIN: false });
// Xưởng 3 SMB: khung theo chiều dài (trục z Tekla, −75 → 0, đầu −75 là đầu tây gần cổng). Bước = khoảng giữa hai khung.
const AX = [-75, -66, -56.5, -47, -37.5, -28, -18.5, -9, 0.5];
const bayOf = z => { for (let i = AX.length - 2; i >= 0; i--) if (z >= AX[i] - 0.3) return i; return 0; };
const SKIP = /^(TMA|TTTRONG|MAT DUNG|TON 6S|TON THUNG|TON THUNG NGOAI|TON THUNGCNP|OP GOC NGOAI|DINH VACH|NOC GIO|DIEM HOI NOC GIO|HOI NG|UPNOCCG|UPNOCMAI|ONG NUOC|Washer|Nut|LockNut|XOI CHAN TT)$/;
const stageOf = (type, name, mn, mx) => {
  if (SKIP.test(name)) return null;
  if ((mx[0] - mn[0]) * (mx[2] - mn[2]) > 300 && mx[1] - mn[1] < 0.6) return null; // tấm sàn / tôn phẳng lớn (đã có ở mô hình kiến trúc)
  if (name === 'ANCHOR ROD') return 'neo';
  if (/^(BAC|CHIEU|CHAN|THANH CAI|TC)$/.test(name)) return 'thang';
  if (type === WebIFC.IFCCOLUMN && /^(COLUMN|COT)$/.test(name) || name === 'COT') return 'cot';
  if (/^(XA GO|XA GO NG|XA GO CP|SagRod|CX|GIANG|GIANG DOC|XTHUNG|KE DO|NGANG|MB|CHAN TT|Z TON THUNG|DUOI CS TON|TREN CS TON|DUNG CS TON|KE DUOI CS KINH|THUNGD|V HOI|XN CNP|CHAN CNP KE|MANG THOAT)$/.test(name)) return 'giang';
  if (type === WebIFC.IFCCOLUMN) return 'cot';
  return 'keo';
};
const COLOR = { neo: [0.55, 0.56, 0.58], cot: [0.52, 0.2, 0.15], keo: [0.6, 0.24, 0.18], giang: [0.74, 0.76, 0.79], deck: [0.78, 0.8, 0.83], thang: [0.25, 0.27, 0.3] };
const buckets = new Map(); let kept = 0, skipped = 0;
api.StreamAllMeshes(model, mesh => {
  const id = mesh.expressID, type = api.GetLineType(model, id);
  if (type === WebIFC.IFCDISCRETEACCESSORY || type === WebIFC.IFCMECHANICALFASTENER) { skipped++; return; }
  const line = api.GetLine(model, id); const name = line.Name?.value || '';
  const parts = []; const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < mesh.geometries.size(); i++) { const g = mesh.geometries.get(i); const geo = api.GetGeometry(model, g.geometryExpressID);
    const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize()), idx = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize()); const m = g.flatTransformation;
    const pos = new Float32Array(v.length / 2);
    for (let k = 0, j = 0; k < v.length; k += 6, j += 3) { const x = v[k], y = v[k + 1], z = v[k + 2]; const X = m[0] * x + m[4] * y + m[8] * z + m[12], Y = m[1] * x + m[5] * y + m[9] * z + m[13], Z = m[2] * x + m[6] * y + m[10] * z + m[14];
      pos[j] = X; pos[j + 1] = Y; pos[j + 2] = Z; if (X < mn[0]) mn[0] = X; if (Y < mn[1]) mn[1] = Y; if (Z < mn[2]) mn[2] = Z; if (X > mx[0]) mx[0] = X; if (Y > mx[1]) mx[1] = Y; if (Z > mx[2]) mx[2] = Z; }
    parts.push([pos, idx.slice()]); geo.delete(); }
  const st = stageOf(type, name, mn, mx); if (!st) { skipped++; return; }
  const bay = bayOf((mn[2] + mx[2]) / 2); const key = `${st}|${bay}`;
  const b = buckets.get(key) || { st, bay, pos: [], idx: [], n: 0 }; buckets.set(key, b);
  for (const [pos, idx] of parts) { const base = b.n; for (const p of pos) b.pos.push(p); for (const i of idx) b.idx.push(i + base); b.n += pos.length / 3; }
  kept++;
});
console.log('kept', kept, 'skipped', skipped, 'buckets', buckets.size);
const doc = new Document(); const buf = doc.createBuffer(); const scene = doc.createScene('tekla');
const mats = Object.fromEntries(Object.entries(COLOR).map(([k, c]) => [k, doc.createMaterial(k).setBaseColorFactor([...c, 1]).setMetallicFactor(k === 'giang' || k === 'deck' ? 0.6 : 0.3).setRoughnessFactor(0.5).setDoubleSided(true)]));
let tris = 0;
for (const b of buckets.values()) {
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.pos)).setBuffer(buf);
  const idx = doc.createAccessor().setType('SCALAR').setArray(b.n > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx)).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(idx).setMaterial(mats[b.st]);
  const node = doc.createNode(`TK|${b.st}|${b.bay}`).setMesh(doc.createMesh(`TK|${b.st}|${b.bay}`).addPrimitive(prim)); scene.addChild(node); tris += b.idx.length / 3;
}
console.log('tris', tris);
await MeshoptEncoder.ready;
await doc.transform(weld(), dedup(), prune(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder }).write(process.argv[3] || 'tekla.glb', doc);
const st = {}; for (const b of buckets.values()) st[b.st] = (st[b.st] || 0) + b.idx.length / 3; console.log(JSON.stringify(st));
