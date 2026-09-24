# HRGen LIS Enterprise Foundation

This repository is being evolved from a local prototype into a multi-tenant, online/offline LIS for small laboratories and enterprise diagnostic networks.

## Phase 1 delivered

- Role and permission catalogue in `data/access-control.json`.
- Tenant-aware entity and sample/report lifecycle specification in `data/lis-schema.json`.
- Owner-controlled modules: small labs can enable only billing, collection, results and reports; larger labs can enable QC, inventory, procurement, B2B, analyzers, NABL and AI draft assistance.
- Separation of platform Super Admin from Lab Owner: Super Admin manages tenants/platform operations, while Lab Owner controls clinical users and lab data.

## Target workflow

```text
Order/Billing -> Collection -> Receiving -> Acceptance/Rejection -> Processing
-> Result Entry -> Provisional Verification -> Final Verification
-> Signed Report Release -> Amendment/Audit
```

## Online and offline design

- Online mode uses the Express API and a server-side transactional store.
- Offline mode keeps an encrypted local outbox and immutable event IDs, then synchronizes when connectivity returns.
- Every mutation must include `labId`, `actorId`, `clientEventId`, timestamp and an audit reason where applicable.
- Conflicts are resolved by domain rules; released reports and final verifications are never silently overwritten.

## Enterprise safety requirements before production

The current JSON backend remains a development/demo store. Production deployment must move to PostgreSQL (or an equivalent transactional database), use secure password hashing, server-side sessions or short-lived tokens, encryption in transit and at rest, backups, rate limiting, CSRF protection, structured audit storage, and a tested disaster-recovery process.

NABL/ISO support is evidence tooling, not accreditation. The lab still needs approved SOPs, competent staff, calibration, IQC/EQA, document control, CAPA and assessor evidence.
