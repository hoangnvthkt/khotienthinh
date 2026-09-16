#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url));

const templateScope = (template, permissionCode) =>
  template.permissionScopes?.[permissionCode] || template.permissionScopeType || null;

export const evaluateRoleTemplateReadiness = ({ blueprints, decisions, catalogActions }) => {
  const actions = new Map(catalogActions.map(action => [action.permissionCode, action]));
  const approvedDecisions = decisions.decisions.filter(decision => decision.status === 'owner_approved');
  const applications = new Map(blueprints.applications.map(application => [application.code, application]));
  const results = [];

  for (const ownerDecision of approvedDecisions) {
    const applicationCode = ownerDecision.decision?.applicationCode;
    const application = applications.get(applicationCode);
    const approvedTemplates = ownerDecision.decision?.templates || [];

    for (const approvedTemplate of approvedTemplates) {
      const template = application?.templates.find(candidate => candidate.code === approvedTemplate.code);
      const blockers = [];
      if (!application) blockers.push({ type: 'missing_application', applicationCode });
      if (!template) blockers.push({ type: 'missing_template', templateCode: approvedTemplate.code });
      if (!approvedTemplate.actors?.length) blockers.push({ type: 'missing_actor_mapping' });
      if (!approvedTemplate.assignmentScope?.scopeType || !approvedTemplate.assignmentScope?.scopeId) {
        blockers.push({ type: 'missing_assignment_scope' });
      }

      for (const permissionCode of template?.permissionCodes || []) {
        const action = actions.get(permissionCode);
        const scopeType = templateScope(template, permissionCode);
        if (!action) {
          blockers.push({ type: 'missing_catalog_action', permissionCode });
          continue;
        }
        if (!['enforced', 'verified'].includes(action.grantReadiness)) {
          blockers.push({
            type: 'grant_readiness', permissionCode,
            actual: action.grantReadiness, required: ['enforced', 'verified'],
          });
        }
        if (!scopeType) {
          blockers.push({ type: 'missing_item_scope', permissionCode });
        } else if (!action.scopeTypes.includes(scopeType)) {
          blockers.push({
            type: 'unsupported_item_scope', permissionCode, scopeType,
            supportedScopeTypes: action.scopeTypes,
          });
        }
      }

      results.push({
        cohort: ownerDecision.cohort,
        applicationCode,
        templateCode: approvedTemplate.code,
        permissionCount: template?.permissionCodes?.length || 0,
        canPilot: blockers.length === 0,
        blockers,
      });
    }
  }

  const blockedActionMap = new Map();
  for (const result of results) {
    for (const blocker of result.blockers.filter(item => item.permissionCode)) {
      const current = blockedActionMap.get(blocker.permissionCode) || {
        permissionCode: blocker.permissionCode,
        blockerTypes: new Set(),
        templates: new Set(),
        grantReadiness: blocker.actual || null,
      };
      current.blockerTypes.add(blocker.type);
      current.templates.add(result.templateCode);
      if (blocker.actual) current.grantReadiness = blocker.actual;
      blockedActionMap.set(blocker.permissionCode, current);
    }
  }
  const blockedActions = [...blockedActionMap.values()]
    .map(item => ({
      permissionCode: item.permissionCode,
      blockerTypes: [...item.blockerTypes].sort(),
      templates: [...item.templates].sort(),
      grantReadiness: item.grantReadiness,
    }))
    .sort((left, right) => left.permissionCode.localeCompare(right.permissionCode));

  return {
    decisionVersion: decisions.version,
    approvedCohorts: approvedDecisions.map(decision => decision.cohort).sort(),
    pendingCohorts: decisions.decisions
      .filter(decision => decision.status === 'owner_pending')
      .map(decision => decision.cohort)
      .sort(),
    templates: results,
    pilotReadyTemplates: results.filter(result => result.canPilot).length,
    blockedTemplates: results.filter(result => !result.canPilot).length,
    blockerCount: results.reduce((count, result) => count + result.blockers.length, 0),
    uniqueBlockedActions: blockedActions.length,
    blockedActions,
  };
};

const runCloudCheck = expectedProjectRef => {
  if (!expectedProjectRef) {
    throw new Error('Usage: check-task12-4-2-role-template-readiness.mjs <expected-project-ref>');
  }
  const projectRoot = resolve(scriptDirectory, '../..');
  const linkedRef = readFileSync(resolve(projectRoot, 'supabase/.temp/project-ref'), 'utf8').trim();
  if (linkedRef !== expectedProjectRef) {
    throw new Error(`Cloud target mismatch: expected ${expectedProjectRef}, received ${linkedRef || '<unset>'}`);
  }
  const blueprints = JSON.parse(readFileSync(
    resolve(scriptDirectory, 'task12-4-2-role-template-blueprints.json'), 'utf8',
  ));
  const decisions = JSON.parse(readFileSync(
    resolve(scriptDirectory, 'task12-4-2-owner-decisions.json'), 'utf8',
  ));
  const sql = `select permission_code as "permissionCode", grant_readiness as "grantReadiness", scope_modes as "scopeTypes" from public.permission_actions where is_active order by permission_code`;
  const query = spawnSync('npx', [
    '--yes', 'supabase@2.116.0', 'db', 'query', '--linked', '--agent=no', '--output', 'json', sql,
  ], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (query.status !== 0) {
    throw new Error(`Cloud readiness query failed: ${query.stderr.trim() || 'unknown error'}`);
  }
  const response = JSON.parse(query.stdout);
  const catalogActions = Array.isArray(response) ? response : response.rows;
  const report = evaluateRoleTemplateReadiness({ blueprints, decisions, catalogActions });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.blockedTemplates > 0) process.exitCode = 2;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCloudCheck(process.argv[2]);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Role-template readiness check failed'}\n`);
    process.exitCode = 1;
  }
}
