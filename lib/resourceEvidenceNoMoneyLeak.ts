const moneyKey = /(^|_)(unit_?cost|total_?cost|cost|rate|amount|currency|price|money|accrual|transaction|transactions|payable)(_|$)/i;

export const assertResourceEvidenceHasNoMoneyKeys = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(assertResourceEvidenceHasNoMoneyKeys);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    if (moneyKey.test(normalizedKey)) throw new Error(`RESOURCE_EVIDENCE_MONEY_KEY:${key}`);
    assertResourceEvidenceHasNoMoneyKeys(child);
  }
};
