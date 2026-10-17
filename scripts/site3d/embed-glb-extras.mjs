// Gắn dữ liệu phụ (JSON) vào extras của cảnh trong tệp GLB — sửa thẳng khối JSON, không giải nén / nén lại phần hình (giữ nguyên meshopt).
// Công trường 3D đọc gltf.scene.userData (GLTFLoader chép extras của cảnh sang userData), ví dụ bụi cây viền của XinHai.
// Dùng: node scripts/site3d/embed-glb-extras.mjs <vào.glb> <ra.glb> <khóa>=<tệp.json> [...]
//   node scripts/site3d/embed-glb-extras.mjs docs/command-center/mockups/xinhai/xinhai.glb /tmp/architecture.glb bushes=docs/command-center/mockups/xinhai/xinhai-bushes.json
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output, ...pairs] = process.argv.slice(2);
if (!input || !output || !pairs.length) {
  console.error('node scripts/site3d/embed-glb-extras.mjs <vào.glb> <ra.glb> <khóa>=<tệp.json> [...]');
  process.exit(1);
}
const glb = readFileSync(input);
if (glb.readUInt32LE(0) !== 0x46546c67 || glb.readUInt32LE(4) !== 2) throw new Error(`${input} không phải GLB 2.0`);
const jsonLength = glb.readUInt32LE(12);
if (glb.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Khối đầu tiên không phải JSON');
const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8').replace(/[ \0]+$/, ''));
const rest = glb.subarray(20 + jsonLength); // các khối sau (BIN) giữ nguyên từng byte
const sceneIndex = json.scene ?? 0;
const scene = json.scenes?.[sceneIndex];
if (!scene) throw new Error('GLB không có cảnh');
scene.extras = { ...(scene.extras || {}) };
for (const pair of pairs) {
  const at = pair.indexOf('=');
  if (at < 1) throw new Error(`Sai cú pháp "${pair}" (cần khóa=tệp.json)`);
  const key = pair.slice(0, at);
  scene.extras[key] = JSON.parse(readFileSync(pair.slice(at + 1), 'utf8'));
  console.log(`extras.${key}: ${Array.isArray(scene.extras[key]) ? `${scene.extras[key].length} dòng` : 'đã gắn'}`);
}
let text = Buffer.from(JSON.stringify(json), 'utf8');
const pad = (4 - (text.length % 4)) % 4;
if (pad) text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + rest.length, 8);
header.writeUInt32LE(text.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
writeFileSync(output, Buffer.concat([header, text, rest]));
console.log(`${output}: ${(12 + 8 + text.length + rest.length).toLocaleString('vi-VN')} byte`);
