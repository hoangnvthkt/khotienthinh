import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(process.argv[2]);
const st = {}; let tex = 0;
for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (!m) continue; const [part, cat] = n.getName().split('|'); const k = part + '|' + cat; for (const p of m.listPrimitives()) { st[k] = (st[k] || 0) + p.getIndices().getCount() / 3; } }
for (const t of doc.getRoot().listTextures()) tex += t.getImage()?.byteLength || 0;
for (const [k, v] of Object.entries(st).sort((a, b) => b[1] - a[1])) console.log(k.padEnd(20), Math.round(v));
console.log('textures bytes', tex);
