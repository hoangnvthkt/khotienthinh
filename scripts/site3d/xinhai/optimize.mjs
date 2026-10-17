import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, meshopt, weld, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read('xinhai-raw.glb');
await doc.transform(dedup());
// Phần không phải nhà đang theo dõi: bỏ pháp tuyến (GLTFLoader tự tô phẳng), bỏ UV nếu không có ảnh vật liệu → hàn đỉnh được, giảm tam giác được.
const KEEP = new Set(['NNC', 'NVP']);
for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (!m) continue; const part = n.getName().split('|')[0]; if (KEEP.has(part)) continue;
  for (const p of m.listPrimitives()) { p.setAttribute('NORMAL', null); if (!p.getMaterial()?.getBaseColorTexture()) p.setAttribute('TEXCOORD_0', null); } }
await doc.transform(weld());
// Phần nền / phụ / nhà máy giai đoạn 1 giảm mạnh; nhà đang thi công giữ chi tiết.
const RATIO = { GD1: 0.3, PHU_DONG: 0.2, SAN_TRUOC: 0.15, XE5C: 0.3, XE_TRUOC: 0.3, XE_GOC: 0.3, CONG: 0.3, BAOVE: 0.5, NX: 0.5 };
const seen = new Set(); let before = 0, after = 0;
for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (!m || seen.has(m)) continue; seen.add(m); const part = n.getName().split('|')[0]; const r = RATIO[part]; 
  for (const p of m.listPrimitives()) { const c0 = p.getIndices().getCount() / 3; before += c0; if (r && c0 > 300) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: r, error: 0.004, lockBorder: false }); after += p.getIndices().getCount() / 3; } }
console.log('tris', before, '->', after);
await doc.transform(prune(), quantize({ quantizeTexcoord: 0 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write('xinhai.glb', doc); console.log('wrote xinhai.glb');
