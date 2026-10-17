import * as WebIFC from 'web-ifc';
import { readFileSync, writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, quantize, meshopt, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
const api = new WebIFC.IfcAPI(); api.SetWasmPath(new URL('./node_modules/web-ifc/', `file://${process.cwd()}/`).pathname, true); await api.Init(); api.SetLogLevel?.(WebIFC.LogLevel?.LOG_LEVEL_OFF ?? 6);
const model = api.OpenModel(new Uint8Array(readFileSync(process.argv[2] || (() => { throw new Error('node ifc2glb.mjs <tệp .ifc xuất từ Tekla>'); })())), { COORDINATE_TO_ORIGIN: false });
const AX = [0, 8.5, 17, 25.2, 33.4, 41.6, 49.8, 58, 66, 66.4, 74.4, 82.6, 90.8, 99, 107.2, 115.4, 123.6, 131.8, 140, 150, 160];
const bayOf = x => { for (let i = AX.length - 2; i >= 0; i--) if (x >= AX[i] - 0.3) return i; return 0; };
// Giai đoạn lắp dựng trong đầu việc 4.3.1: bu lông neo (theo móng) → cột → kèo, dầm → giằng, xà gồ, ty → tôn sàn deck. Bỏ đinh, bu lông, đai ốc, tôn bao / sê nô (đã có ở mô hình kiến trúc).
const stageOf = (type, name, mn, mx) => {
  if (name === 'ANCHOR RODS') return 'neo';
  if (name === 'VACH PANEL' || name === 'TON SENO' || name === 'DINH') return null;
  if (name === 'TAM DECK') return 'deck';
  if (/^(XA GO|XAGO|SagRod|CX|GIANG|KEV|NGANG|THANH|KE )/.test(name) || name === 'GIANG KEO' || name === 'GIANG CHEO' || name === 'GIANG NGANG') return 'giang';
  if (/^(BAC|LAN CAN|CON THANG|CHIEU NGHI|RAILING|TAY VIN)$/.test(name)) return 'thang';
  if (type === WebIFC.IFCCOLUMN || name === 'COLUMN') return 'cot';
  const h = mx[1] - mn[1], len = Math.max(mx[0] - mn[0], mx[2] - mn[2]);
  if (h > 3 && h > len) return 'cot';
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
  const bay = bayOf((mn[0] + mx[0]) / 2); const key = `${st}|${bay}`;
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
await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder }).write('xinhai-tekla.glb', doc);
const st = {}; for (const b of buckets.values()) st[b.st] = (st[b.st] || 0) + b.idx.length / 3; console.log(JSON.stringify(st));
