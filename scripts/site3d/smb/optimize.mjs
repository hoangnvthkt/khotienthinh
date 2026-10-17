// Tối ưu GLB: hàn đỉnh, giảm tam giác theo phần (RATIO json), lượng tử hoá, nén meshopt. node opt-generic.mjs vào.glb ra.glb [ratio.json]
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, meshopt, weld, simplifyPrimitive, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'; import { readFileSync } from 'node:fs';
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const [inp, out, ratioFile] = process.argv.slice(2); const RATIO = ratioFile ? JSON.parse(readFileSync(ratioFile, 'utf8')) : {};
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp);
const KEEPN = new Set((process.env.KEEP_NORMALS || '').split(',').filter(Boolean));
for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (!m) continue; const part = n.getName().split('|')[0]; for (const p of m.listPrimitives()) { if (!p.getMaterial()?.getBaseColorTexture()) p.setAttribute('TEXCOORD_0', null); if (!KEEPN.has(part)) p.setAttribute('NORMAL', null); } }
await doc.transform(dedup(), weld());
let before = 0, after = 0;
for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (!m) continue; const [part, cat] = n.getName().split('|'); const r = RATIO[`${part}|${cat}`] ?? RATIO[part] ?? RATIO['*'];
  for (const p of m.listPrimitives()) { const c0 = p.getIndices().getCount() / 3; before += c0; if (r && r < 1 && c0 > 300) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: r, error: 0.004, lockBorder: false }); after += p.getIndices().getCount() / 3; } }
console.log('tris', before, '->', after);
const sharp = (await import('sharp')).default;
await doc.transform(prune(), textureCompress({ encoder: sharp, resize: [512, 512], quality: 78 }), quantize({ quantizeTexcoord: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(out, doc); console.log('wrote', out);
