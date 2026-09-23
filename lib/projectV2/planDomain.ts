import { formatDecimal6, parseQuantity6 } from '../procurement/decimal';
import type {
  ProjectV2AllowedActions, ProjectV2AllowedActionsInput, ProjectV2MaterialCandidate,
  ProjectV2MaterialGroup, ProjectV2MaterialRequirementInput, ProjectV2PlanDraft,
  ProjectV2ValidationIssue,
} from '../../types/projectV2';

const SCALE = 1_000_000n;

export function getProjectV2AllowedActions(input: ProjectV2AllowedActionsInput): ProjectV2AllowedActions {
  const { status, capabilities, actorId, creatorId, submitterId } = input;
  const editable = status === 'draft' || status === 'returned';
  const separateApprover = Boolean(actorId && creatorId && submitterId)
    && actorId !== creatorId && actorId !== submitterId;
  return {
    edit: editable && capabilities.edit,
    submit: editable && capabilities.submit,
    approve: status === 'pending_approval' && capabilities.approve && separateApprover,
    return: status === 'pending_approval' && capabilities.return && separateApprover,
    revise: status === 'approved' && capabilities.revise,
    cancel: (editable || status === 'approved') && capabilities.cancel,
  };
}

export function calculateMaterialRequirement(input: ProjectV2MaterialRequirementInput): string | null {
  const { workQty, normFactor, coefficient, conversionNumerator, conversionDenominator } = input;
  if ([workQty, normFactor, coefficient, conversionNumerator, conversionDenominator].some(value => value === null)) {
    return null;
  }
  const work = parseQuantity6(workQty!);
  const norm = parseQuantity6(normFactor!);
  const factor = parseQuantity6(coefficient!);
  const numerator = parseQuantity6(conversionNumerator!);
  const denominator = parseQuantity6(conversionDenominator!);
  if (denominator === 0n) throw new Error('INVALID_CONVERSION: Denominator must be positive.');
  const divisor = denominator * SCALE * SCALE;
  const product = work * norm * factor * numerator;
  const scaled = (product + divisor / 2n) / divisor;
  return canonicalQuantity(scaled);
}

function canonicalQuantity(value: bigint): string {
  const checked = parseQuantity6(formatDecimal6(value));
  const whole = checked / SCALE;
  const fractional = (checked % SCALE).toString().padStart(6, '0');
  return `${whole}.${fractional}`;
}

export function groupMaterialRequirementLines(lines: readonly ProjectV2MaterialCandidate[]): ProjectV2MaterialGroup[] {
  const groups: ProjectV2MaterialGroup[] = [];
  const byKey = new Map<string, ProjectV2MaterialGroup>();
  const sourceKeys = new Set<string>();
  for (const line of lines) {
    for (const source of line.derivations) {
      const sourceKey = JSON.stringify([source.sourcePlanId, source.sourceRevision,
        source.sourceLineId, source.normResourceId, source.normRevision,
        line.neededDate, line.destinationId, source.derivedQuantity]);
      if (sourceKeys.has(sourceKey)) throw new Error('DUPLICATE_SOURCE: A source derivation is already included.');
      sourceKeys.add(sourceKey);
    }
    // A missing identity or quantity remains a separate, visibly incomplete row.
    const complete = Boolean(line.itemId && line.unit && line.neededDate && line.destinationId && line.quantity !== null);
    const key = complete ? JSON.stringify([line.itemId, line.unit, line.neededDate, line.destinationId]) : null;
    let group = key ? byKey.get(key) : undefined;
    if (!group) {
      group = { itemId: line.itemId, unit: line.unit, neededDate: line.neededDate,
        destinationId: line.destinationId, quantity: line.quantity, lineIds: [], derivations: [] };
      groups.push(group);
      if (key) byKey.set(key, group);
    } else {
      group.quantity = canonicalQuantity(parseQuantity6(group.quantity!) + parseQuantity6(line.quantity!));
    }
    group.lineIds.push(line.lineId);
    group.derivations.push(...line.derivations);
  }
  return groups;
}

function issue(field: string, code: string): ProjectV2ValidationIssue {
  return { field, code, blocking: true };
}

function validDate(value: string | null): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validQuantity(value: string | null): boolean {
  if (value === null) return false;
  try { parseQuantity6(value); return true; } catch { return false; }
}

export function validateProjectV2PlanDraft(draft: ProjectV2PlanDraft): ProjectV2ValidationIssue[] {
  const issues: ProjectV2ValidationIssue[] = [];
  if (!draft.projectId) issues.push(issue('projectId', 'missing_project'));
  if (!validDate(draft.periodStart)) issues.push(issue('periodStart', 'invalid_date'));
  if (!validDate(draft.periodEnd) || draft.periodEnd < draft.periodStart) issues.push(issue('periodEnd', 'invalid_date'));
  if (!draft.lines.length) issues.push(issue('lines', 'missing_lines'));

  if (draft.type === 'month') {
    for (const line of draft.lines) {
      const prefix = `lines.${line.lineId}`;
      if (!validQuantity(line.quantity)) issues.push(issue(`${prefix}.quantity`, line.quantity === null ? 'unknown_quantity' : 'invalid_quantity'));
      if (!line.unit) issues.push(issue(`${prefix}.unit`, 'missing_unit'));
      if (!line.contractItemId) issues.push(issue(`${prefix}.contractItemId`, 'missing_contract_item'));
      if (!line.baselineRevision) issues.push(issue(`${prefix}.baselineRevision`, 'missing_baseline'));
    }
  } else if (draft.type === 'construction') {
    for (const line of draft.lines) {
      const prefix = `lines.${line.lineId}`;
      if (!validQuantity(line.quantity)) issues.push(issue(`${prefix}.quantity`, line.quantity === null ? 'unknown_quantity' : 'invalid_quantity'));
      if (!line.unit) issues.push(issue(`${prefix}.unit`, 'missing_unit'));
      if (!line.workItemId) issues.push(issue(`${prefix}.workItemId`, 'missing_work_item'));
      if (!validDate(line.workStart)) issues.push(issue(`${prefix}.workStart`, 'invalid_date'));
      if (!validDate(line.workEnd) || (line.workStart && line.workEnd && line.workEnd < line.workStart)) issues.push(issue(`${prefix}.workEnd`, 'invalid_date'));
      if (!line.sources.length && !line.baselineExceptionReason?.trim())
        issues.push(issue(`${prefix}.sources`, 'missing_source'));
      if (line.sources.length && line.baselineExceptionReason?.trim())
        issues.push(issue(`${prefix}.sources`, 'source_exception_conflict'));
    }
  } else {
    for (const line of draft.lines) {
      const prefix = `lines.${line.lineId}`;
      if (!validQuantity(line.quantity)) issues.push(issue(`${prefix}.quantity`, line.quantity === null ? 'unknown_quantity' : 'invalid_quantity'));
      if (!line.unit) issues.push(issue(`${prefix}.unit`, 'missing_unit'));
      if (!line.itemId) issues.push(issue(`${prefix}.itemId`, 'missing_item'));
      if (!validDate(line.neededDate)) issues.push(issue(`${prefix}.neededDate`, 'invalid_date'));
      if (!line.destinationId) issues.push(issue(`${prefix}.destinationId`, 'missing_destination'));
      if (!line.derivations.length) issues.push(issue(`${prefix}.derivations`, 'missing_source'));
      let derivedTotal = 0n;
      let allDerivedKnown = line.derivations.length > 0;
      for (const [index, derivation] of line.derivations.entries()) {
        const sourcePrefix = `${prefix}.derivations.${index}`;
        if (!derivation.sourcePlanId) issues.push(issue(`${sourcePrefix}.sourcePlanId`, 'missing_source'));
        if (!Number.isInteger(derivation.sourceRevision) || derivation.sourceRevision < 1) issues.push(issue(`${sourcePrefix}.sourceRevision`, 'invalid_source_revision'));
        if (!derivation.sourceLineId) issues.push(issue(`${sourcePrefix}.sourceLineId`, 'missing_source'));
        if (!validQuantity(derivation.sourceWorkQuantity)) issues.push(issue(`${sourcePrefix}.sourceWorkQuantity`, 'invalid_quantity'));
        if (!derivation.normResourceId || derivation.normRevision === null || derivation.normFactor === null) issues.push(issue(`${sourcePrefix}.normFactor`, 'missing_norm'));
        if (derivation.conversionNumerator === null || derivation.conversionDenominator === null) issues.push(issue(`${sourcePrefix}.conversionNumerator`, 'missing_conversion'));
        if (derivation.normFactor !== null && !validQuantity(derivation.normFactor)) issues.push(issue(`${sourcePrefix}.normFactor`, 'invalid_quantity'));
        if (derivation.coefficient === null || !validQuantity(derivation.coefficient)) issues.push(issue(`${sourcePrefix}.coefficient`, 'invalid_quantity'));
        if (derivation.conversionNumerator !== null && !validQuantity(derivation.conversionNumerator)) issues.push(issue(`${sourcePrefix}.conversionNumerator`, 'invalid_quantity'));
        if (derivation.conversionDenominator !== null && (!validQuantity(derivation.conversionDenominator) || parseQuantity6(derivation.conversionDenominator) === 0n)) issues.push(issue(`${sourcePrefix}.conversionDenominator`, 'invalid_conversion'));
        if (derivation.derivedQuantity === null || !validQuantity(derivation.derivedQuantity)) issues.push(issue(`${sourcePrefix}.derivedQuantity`, 'unknown_quantity'));
        if (validQuantity(derivation.derivedQuantity)) derivedTotal += parseQuantity6(derivation.derivedQuantity!);
        else allDerivedKnown = false;
        if (validQuantity(derivation.sourceWorkQuantity) && validQuantity(derivation.normFactor)
          && validQuantity(derivation.coefficient) && validQuantity(derivation.conversionNumerator)
          && validQuantity(derivation.conversionDenominator)
          && parseQuantity6(derivation.conversionDenominator!) > 0n
          && validQuantity(derivation.derivedQuantity)) {
          const calculated = calculateMaterialRequirement({ workQty: derivation.sourceWorkQuantity,
            normFactor: derivation.normFactor, coefficient: derivation.coefficient,
            conversionNumerator: derivation.conversionNumerator,
            conversionDenominator: derivation.conversionDenominator });
          if (calculated !== derivation.derivedQuantity) {
            issues.push(issue(`${sourcePrefix}.derivedQuantity`, 'derived_quantity_mismatch'));
          }
        }
      }
      if (allDerivedKnown && validQuantity(line.quantity) && derivedTotal !== parseQuantity6(line.quantity!)) {
        issues.push(issue(`${prefix}.quantity`, 'derived_quantity_mismatch'));
      }
    }
  }
  return issues;
}
