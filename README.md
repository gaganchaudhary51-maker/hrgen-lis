# HRGen LIS Enterprise

Enterprise online/offline LIS foundation for diagnostic laboratories, collection centres and referral networks.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Development demo login: `admin / admin123`.
Change this credential before any real deployment.

## Included enterprise API foundation

- Tenant-aware lab/user records
- Super Admin and Lab Owner separation
- Role and permission checks from `data/access-control.json`
- Patient/order/billing creation
- Payment-ready order totals with discount and tax
- Sample collection, receiving, acceptance/rejection status
- Department worklist endpoint
- Idempotent offline sync endpoint using `clientEventId`
- Audit events for protected mutations
- Permission-sensitive user and test management
- Report and AI-summary API boundaries

## Online/offline contract

The browser can create immutable local events with a unique `clientEventId`. When online, send them to `POST /api/sync` with the current bearer token. The server ignores duplicate event IDs. Clinical final verification and released reports must use server-authorized actions and must never be silently overwritten during synchronization.

## Production gate

This JSON persistence layer is for development only. Before commercial deployment, migrate to PostgreSQL or another transactional database, use Argon2id/bcrypt password hashing, secure cookie sessions or short-lived tokens, HTTPS, encryption at rest, rate limiting, CSRF protection, tenant isolation tests, backups, monitoring and disaster recovery. NABL support in the product does not itself grant accreditation.
