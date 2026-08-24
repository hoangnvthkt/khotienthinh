# Security Policy

## Reporting a vulnerability

Do not open a public issue and do not include a proof of concept containing real credentials or customer data. Report suspected vulnerabilities to the repository owner through the agreed private audit channel. Include:

- affected component, endpoint or migration;
- reproduction steps and impact;
- proof of concept using synthetic data only; and
- a proposed remediation, if available.

The owner should acknowledge a report within two business days and agree a remediation timeline based on severity.

## Secret-handling rules

- Never commit `.env` files, private keys, service-account files or production exports.
- Browser code may use only explicitly public `VITE_*` configuration. The Supabase anon key is a public client identifier; access must still be protected by RLS.
- `SUPABASE_SERVICE_ROLE_KEY`, AI-provider keys, VAPID private keys and internal webhook secrets belong in Supabase Cloud secrets, never in Vite configuration or browser code.
- If a credential is suspected to have been committed, revoke/rotate it immediately, then remove it from all reachable Git history before sharing the repository.

## Audit boundaries

Auditors receive source access only. Production credentials, customer data, deployment credentials and unrestricted Supabase access are out of scope unless separately authorized in writing. Use an isolated Supabase Cloud project with synthetic data for active testing.

## Dependency risk

Run `npm audit --omit=dev` before each handoff. Any unresolved finding must be triaged with an owner, exposure assessment and compensating control before release. Do not use `npm audit fix --force` without reviewing application compatibility and test results.
