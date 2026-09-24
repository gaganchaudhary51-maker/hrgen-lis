# Report and authorization specification

## Report states

`draft` -> `provisional_verified` -> `final_verified` -> `released` -> `amended`

- Technicians may enter results and submit for provisional verification.
- Only an authorized pathologist/doctor may final-verify and release clinical reports.
- A released report is immutable. An amendment creates a new version and stores the old value, new value, reason, actor, verifier and notification status.
- AI may generate a clearly marked draft summary only. It cannot sign, final-verify or release a report.

## Configurable formats

The report template service will support A4, A5, pre-printed letterhead, single-test, consolidated, department, package, partial, provisional, final, amended, B2B and outsource formats.

Each template can configure lab logo, header/footer, margins, patient demographics, barcode/accession, collection/receiving/report timestamps, method, analyzer, reference intervals, critical flags, interpretation, authorized signatory, registration number, QR verification, page numbering and disclaimers.

## Permission-sensitive branding

- Lab Owner controls logo, report templates and signatory mapping for their lab.
- Pathologist controls clinical interpretation and signature authorization.
- Referral/B2B users see only assigned released reports.
- Finance users do not receive result-editing rights.
- Super Admin does not automatically receive patient clinical access.
