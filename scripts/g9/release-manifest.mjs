#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ERP_COMPLETION_COMMANDS = Object.freeze([
  'material_plan.save',
  'material_plan.convert',
  'procurement.assign',
  'procurement.allocate',
  'procurement.po.create',
  'wms.transfer.dispatch',
  'wms.transfer.receive',
  'wms.transfer.dispose',
  'wms.inventory_count.start',
  'wms.inventory_count.post',
  'finance.invoice.record',
  'finance.invoice.reverse',
  'finance.payment.post',
  'finance.payment.reverse',
]);

const PERSONAS = ['buyer', 'qs', 'warehouse', 'qc', 'accountant', 'manager'];
const JOURNEYS = Array.from({ length: 8 }, (_, index) => `J0${index + 1}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{7,40}$/i;
const PLACEHOLDER = /(^\s*$|<[^>]+>|\b(todo|tbd|placeholder|replace[-_ ]?me)\b)/i;

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const concrete = value => typeof value === 'string' && !PLACEHOLDER.test(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

export const validateErpCompletionReleaseManifest = (manifest, options = {}) => {
  const errors = [];
  if (!object(manifest)) return ['manifest.object_required'];
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion.unsupported');
  if (!concrete(manifest.releaseId)) errors.push('releaseId.concrete_required');
  if (!SHA.test(String(manifest.commitSha || ''))) errors.push('commitSha.invalid');
  if (!/^\d{14}$/.test(String(manifest.migrationHead || ''))) errors.push('migrationHead.invalid');
  if (!['preview', 'staging', 'production'].includes(manifest.environment)) errors.push('environment.invalid');
  if (!['draft', 'ready', 'active', 'paused', 'completed'].includes(manifest.status)) errors.push('status.invalid');
  if (options.requireActivatable && manifest.status !== 'ready') errors.push('status.ready_required');

  if (!object(manifest.scope)) errors.push('scope.object_required');
  else {
    for (const field of ['projectId', 'constructionSiteId']) {
      if (!concrete(manifest.scope[field])) errors.push(`scope.${field}.concrete_required`);
    }
    for (const field of ['warehouseIds', 'supplierIds']) {
      if (!Array.isArray(manifest.scope[field]) || manifest.scope[field].some(value => !concrete(value))) {
        errors.push(`scope.${field}.invalid`);
      }
    }
  }

  const actors = Array.isArray(manifest.actors) ? manifest.actors : [];
  for (const persona of PERSONAS) {
    if (!actors.some(actor => actor?.persona === persona && UUID.test(String(actor.userId || '')))) {
      errors.push(`persona:${persona}.actor_required`);
    }
  }
  const actorKeys = actors.map(actor => `${actor?.persona}:${actor?.userId}`);
  if (new Set(actorKeys).size !== actorKeys.length) errors.push('actors.duplicate_assignment');
  if (new Set(actors.map(actor => actor?.userId)).size !== actors.length) {
    errors.push('actors.distinct_users_required');
  }
  if (actors.some(actor => !PERSONAS.includes(actor?.persona))) errors.push('actors.unsupported_persona');

  const enabled = Array.isArray(manifest.commands?.enabled) ? manifest.commands.enabled : [];
  const completion = Array.isArray(manifest.commands?.completion) ? manifest.commands.completion : [];
  for (const command of [...enabled, ...completion]) {
    if (!ERP_COMPLETION_COMMANDS.includes(command)) errors.push(`command:${command}.unsupported`);
  }
  if (new Set(enabled).size !== enabled.length || new Set(completion).size !== completion.length) {
    errors.push('commands.duplicate');
  }
  for (const command of completion) {
    if (!enabled.includes(command)) errors.push(`command:${command}.completion_not_enabled`);
  }

  const journeys = Array.isArray(manifest.journeys) ? manifest.journeys : [];
  for (const id of JOURNEYS) {
    const journey = journeys.find(value => value?.id === id);
    if (!journey) {
      errors.push(`journey:${id}.required`);
      continue;
    }
    if (!['not_run', 'blocked', 'failed', 'passed'].includes(journey.status)) errors.push(`journey:${id}.status_invalid`);
    if (!concrete(journey.expected)) errors.push(`journey:${id}.expected_required`);
    if (journey.status === 'passed') {
      if (!concrete(journey.actual)) errors.push(`journey:${id}.actual_required`);
      if (!concrete(journey.evidence)) errors.push(`journey:${id}.evidence_required`);
      if (!concrete(journey.cleanup)) errors.push(`journey:${id}.cleanup_required`);
      if (!concrete(journey.signedOffBy)) errors.push(`journey:${id}.signedOffBy_required`);
      if (/fixture|synthetic|mock/i.test(String(journey.evidence || ''))
          || /automation|bot|agent/i.test(String(journey.signedOffBy || ''))) {
        errors.push(`journey:${id}.business_signoff_required`);
      }
    }
  }
  if (journeys.some(value => !JOURNEYS.includes(value?.id))) errors.push('journeys.unsupported_id');

  for (const field of ['release', 'dataException', 'support', 'rollback']) {
    if (!concrete(manifest.owners?.[field])) errors.push(`owners.${field}.concrete_required`);
  }
  for (const field of ['criticalMinutes', 'highMinutes', 'standardMinutes']) {
    if (!positiveInteger(manifest.sla?.[field])) errors.push(`sla.${field}.positive_integer_required`);
  }
  if (!(manifest.sla?.criticalMinutes <= manifest.sla?.highMinutes
      && manifest.sla?.highMinutes <= manifest.sla?.standardMinutes)) errors.push('sla.order_invalid');

  const startsAt = Date.parse(manifest.window?.startsAt);
  const expiresAt = Date.parse(manifest.window?.expiresAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(expiresAt) || expiresAt <= startsAt) errors.push('window.invalid');

  if (!concrete(manifest.rollback?.previousArtifact)) errors.push('rollback.previousArtifact.required');
  if (!concrete(manifest.rollback?.recoveryRunbook)) errors.push('rollback.recoveryRunbook.required');
  if (!Array.isArray(manifest.rollback?.pauseOn) || manifest.rollback.pauseOn.length === 0
      || manifest.rollback.pauseOn.some(value => !concrete(value))) errors.push('rollback.pauseOn.required');
  if (!Array.isArray(manifest.limitations) || manifest.limitations.length === 0
      || manifest.limitations.some(value => !concrete(value?.id) || !concrete(value?.owner) || !concrete(value?.disposition))) {
    errors.push('limitations.owner_disposition_required');
  }
  return [...new Set(errors)];
};

const run = () => {
  const args = process.argv.slice(2);
  const path = args.find(value => !value.startsWith('--'));
  if (!path) throw new Error('Usage: release-manifest.mjs <manifest.json> [--activatable]');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const errors = validateErpCompletionReleaseManifest(manifest, { requireActivatable: args.includes('--activatable') });
  if (errors.length) {
    errors.forEach(error => process.stderr.write(`${error}\n`));
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`ERP completion release manifest valid: ${manifest.releaseId}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
