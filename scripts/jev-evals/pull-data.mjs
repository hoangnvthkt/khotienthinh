#!/usr/bin/env node
// Kéo dữ liệu tham chiếu thật (chỉ đọc) về scripts/jev-evals/data/*.json — thư mục này KHÔNG commit (.gitignore).
//   JEV_EVAL_ENV=/Users/admin/khotienthinh/.env node scripts/jev-evals/pull-data.mjs
import { writeFileSync } from 'node:fs';
import { cloudSql, loadEnv } from './cloud.mjs';

const env = loadEnv();
const out = (name, rows) => { writeFileSync(new URL(`./data/${name}.json`, import.meta.url), JSON.stringify(rows, null, 1)); console.log(name, rows.length); };

out('items', await cloudSql(env, `select id, sku, name, unit, category from items where coalesce(status,'active')='active' and retired_at is null and merged_into_id is null order by name`));
out('projects', await cloudSql(env, `select id, code, name, client_name, status from projects where coalesce(is_hidden,false)=false order by code`));
out('partners', await cloudSql(env, `select id, code, name, tax_code, classifications from business_partners where is_active order by name`));
out('po_vendors', await cloudSql(env, `select vendor_id, vendor_name, count(*) n from purchase_orders where vendor_name is not null group by vendor_id, vendor_name order by n desc`));
out('assistant_user_messages', await cloudSql(env, `select content from assistant_messages where role='user' order by created_at`));
