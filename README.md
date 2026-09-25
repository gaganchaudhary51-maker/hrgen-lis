# HRGen LIS

HRGen LIS is an offline-first laboratory information system for Indian diagnostic labs. The product includes billing, test catalogue management, patient capture, result entry, reference-range flags, printable bills, WhatsApp-ready workflows, dashboard metrics, role-aware API authentication, audit-ready backend primitives, and JSON backup/export.

## Quick start

```bash
npm install
npm start
```

Open `http://localhost:3000` and sign in with the demo account:

- Username: `admin`
- Password: `admin123`

Set `JWT_SECRET` in production. If `DATABASE_URL` is supplied, use the Postgres-ready server implementation and keep the database credentials outside source control.

## Product workflow

1. Create a patient bill from **New Bill**.
2. Select tests from the searchable catalogue.
3. Print or share the bill.
4. Enter numeric results in **Result Entry**.
5. Review LOW/HIGH flags and interpretation.
6. Verify and release the report using your lab's authorized process.
7. Export a JSON backup from **Settings**.

## Commercial readiness checklist

Before onboarding a real lab, configure the lab name, address, phone, WhatsApp number, test prices, reference ranges, user roles, and backup policy. The demo login is intentionally included only for evaluation and must be replaced or disabled for production use.

## Important safety note

This software assists lab operations; it does not replace qualified medical review, validation, calibration, or regulatory compliance. Abnormal values must be reviewed by authorized clinical staff before a report is released.
