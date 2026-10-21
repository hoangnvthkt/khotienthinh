// In ứng viên top-K cho một truy vấn để gán nhãn tay:  node candidates.mjs items|partners|projects "truy vấn" ["truy vấn 2" …]
import { readFileSync } from 'node:fs';
import { rank } from './match.mjs';
const [set, ...qs] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(new URL(`./data/${set}.json`, import.meta.url)));
const nameOf = set === 'projects' ? r => `${r.code} ${r.name} ${r.client_name || ''}` : r => r.name;
for (const q of qs) {
  console.log(`\n# ${q}`);
  for (const { r, s } of rank(q, rows, nameOf, 8, { stop: set === 'partners' })) console.log(`  ${s.toFixed(2)}  ${r.code || r.sku || ''}  ${r.name}${r.unit ? ' · ' + r.unit : ''}${r.client_name ? ' · ' + r.client_name : ''}${r.tax_code && r.tax_code !== '0' ? ' · MST ' + r.tax_code : ''}`);
}
