---
policy_id: UMICH-BUSINESS-HOSTING-2026-07
name: University of Michigan Business Meals and Hosting - Agent-Ready Policy Digest
language: en
currency: USD
source_organization: University of Michigan
source_policy: SPG 507.10-1
source_last_updated: 2026-07-01
retrieved_on: 2026-11-21
scope: Employee business meals, business hosting, and related reimbursement approvals
status: derived_operational_summary_not_official_policy_text
sources:
  - https://spg.umich.edu/policy/507.10-1
  - https://procurement.umich.edu/u-m-employees/expense-reporting/
  - https://procurement.umich.edu/updated-business-hosting-limits-now-in-effect/
  - https://finance.umich.edu/General_Guidance_on_Late_Expense_Reimbursements
  - https://procurement.umich.edu/per-diem-or-hosting-get-travel-meal-expense-reporting-right/
---

# Purpose and authority

This is an **agent-oriented paraphrase and normalized decision guide**, NOT a verbatim copy or an official University of Michigan policy. Use the linked official policy and guidance as authoritative sources. This digest describes current (July 2026) requirements for processing restaurant/business-hosting expenses. Local unit or grant rules may be stricter. Where facts or approvals are missing, **do not invent them**.

## Scope and classification

- Business meals involve guests, colleagues, or donors and substantive, focused discussions advancing university business. A vague generic aim is not enough.
- A personal meal while traveling is generally governed by travel per diem, not business hosting. Employees dining together after work or attending a conference do not automatically qualify for hosting reimbursement.
- When a meal was hosted/provided during business travel, the employee's travel per diem for that meal must be adjusted.
- Ordinary business hosting and special donor-development/recruitment activities have different allowance rules.
- The source policy applies to faculty and staff; nonemployee reimbursements may require a different form and process.

## Required evidence

- Submitter / employee, date and time or date of event, specific business purpose, type of meal, number of attendees, claimed total, currency, funding source and a receipt when required.
- **Itemized receipt required for any expense of USD 75 or more.** The receipt should show item descriptions, date and amount paid. A department can require receipts at lower thresholds.
- For receipts paid via third-party electronic methods, itemized documentation additionally should identify supplier, purchase date, item description, quantity, and per-item purchase price.
- When a receipt is lost or missing, documentary approval by a higher administrative authority is required.
- If hosting with the same group recurs more frequently than monthly, require a **unique dated agenda** describing topics discussed.
- A business purpose must be specific: capture who/what was discussed and relevance to university business. Unsupported, generic claims need human clarification.
- The official text does **not** impose a universal requirement that every attendee's legal name and company must be provided. Such a requirement can be added as a demo/local rule, but must not be attributed to U-M.

## Financial limits (effective July 1, 2026)

Amounts are **USD per person**:

| Category | Limit | Unit |
|---|---:|---|
| Breakfast | 30 | per person |
| Lunch | 50 | per person |
| Dinner | 80 | per person |
| Refreshments/snacks | 30 | per person per day |
| Alcohol | 20 | per person per event |

- Non-alcoholic drinks, taxes, gratuities, and service/delivery fees count toward the meal limit.
- Alcohol has its own per-person/per-event limit, inclusive of its attributable taxes and tips. Flag alcohol with an `X` class. Do not allocate alcohol to federal or sponsored funding sources. Prefer available discretionary funding according to relevant ICRX guidance.
- Typical tipping is about 15–20%, but the authoritative page says the amount is at the unit's discretion. **Do not turn 20% into a universal hard rejection threshold.**
- Venue rental/deposits, linens/decorations, AV/equipment rental, and bartender or waitstaff fees (excluding gratuity) are not counted in the per-person hosting meal cost; handle as separate types, subject to applicable rules.
- For donor development and recruiting, meal and alcohol costs may be claimed at actual expense instead of the usual per-person caps if reasonable for the particular event. This is **not** a blanket exemption from all checks.
- Non-alcoholic specialty beverages containing cannabis/THC/psilocybin are prohibited under the published hosting guidance.

## Excess expense / exception handling

- An expense above a published per-person limit is **not automatically disallowed**. Obtain a detailed explanation and approval from a supervisor or higher administrative authority.
- Segregate over-limit expenses and associated tax/tips; do not charge the excess to General or Federal funds.
- When an expense departs from policy, document higher-authority approval and justification as required by SPG 507.10-1.
- Do not assume that an approver can authorize a prohibited funding source.
- If a receipt containing alcohol is not itemized, published ICRX guidance says the entire meal must be allocated as ICRX; route for funding review instead of estimating arbitrary alcohol amounts.

## Submission and approval

- Employee out-of-pocket expenses must be submitted **completely and accurately, including corrections and approvals, within 60 calendar days** from the transaction date, end of trip or hosted event, as applicable.
- Late/incomplete submissions or approvals may be denied tax-free reimbursement. Tax Compliance & Planning may need to review, and certain reimbursements may instead be taxable payroll income at the unit's discretion. Do not automatically reject all late claims or classify them as tax-free.
- The expense must be submitted by the person who incurred it. An employee cannot claim reimbursement for an expense paid by someone else.
- Ensure no duplicate/full reimbursement from another source; partial reimbursement is limited to the difference after third-party reimbursement.
- Every business-hosting expense must be approved by the employee's default approver (normally a supervisor) or higher administrative authority. Employees **cannot approve their own report** or that of anyone they report to, functionally or administratively.
- Approvers review receipts, business purpose, correctness of funding source, budget and policy compliance. Recommended approval turnaround in tax guidance is 48 hours, not an absolute deadline.
- The system used by U-M employees is Emburse Enterprise. Guest/nonemployee expenses may use a Travel and Business Hosting Expense Report (TBHER).

## Decision rules for an expense-processing agent

The following statuses and sequencing are **demo agent implementation choices**, not official U-M workflow definitions.

1. Extract receipt line items, quantities, tax/tips, subtotal, grand total, merchant and date. Preserve OCR field-level confidence and source coordinates where available. Reconcile arithmetic.
2. Classify expense as `business_meal`, `personal_travel_meal`, `refreshments`, `donor_or_recruitment_hosting`, or `unknown`; ask for supporting context if ambiguous.
3. Validate submitter, attendees count, specific business purpose, receipt threshold, event age, funding class, and prior reimbursement records.
4. Split restaurant line items into nonalcoholic meal, alcohol, and separately treated venue/equipment/other components. Allocate tax and tip with an explicit method and retain its provenance; if reliable allocation is impossible, request human clarification.
5. Compare per-person cost to category limit. Where attendee count is uncertain, stop and ask. Where a special exception applies, request substantiation and reasonableness review.
6. Create structured findings with codes:
   - `BUSINESS_PURPOSE_MISSING_OR_VAGUE`
   - `RECEIPT_REQUIRED_MISSING`
   - `RECEIPT_NOT_ITEMIZED`
   - `MEAL_LIMIT_EXCEEDED`
   - `ALCOHOL_LIMIT_EXCEEDED`
   - `ALCOHOL_FUNDING_RESTRICTION`
   - `RECURRING_HOSTING_AGENDA_REQUIRED`
   - `SUBMISSION_OR_APPROVAL_AFTER_60_DAYS`
   - `PERSONAL_TRAVEL_MEAL_NOT_HOSTING`
   - `PER_DIEM_ADJUSTMENT_REQUIRED`
   - `DUPLICATE_OR_THIRD_PARTY_REIMBURSEMENT`
   - `CLAIMANT_NOT_PAYER`
   - `FUNDING_SOURCE_REVIEW_REQUIRED`
   - `MISSING_RECEIPT_AUTHORITY_APPROVAL`
   - `POLICY_EXCEPTION_APPROVAL_REQUIRED`
7. Prepare a draft expense report; never invent documentary approval or alter originals.
8. If any issue cannot be resolved by objective rules, put the report in `PENDING_INFORMATION` or `PENDING_HUMAN_APPROVAL` with exact reasons and supporting evidence.
9. Even for a compliant claim, seek the designated human approver's decision before reimbursement or final export.
10. Only after recorded approval and funding validation may the agent prepare an export. **No payment, external transmission, or irreversible submission without separately authorized action.**

## Suggested JSON output (schema illustration)

```json
{
  "policy_id": "UMICH-BUSINESS-HOSTING-2026-07",
  "claim_id": "claim-001",
  "receipt_sha256": "<hex digest>",
  "classification": "business_meal",
  "meal_type": "dinner",
  "attendee_count": 2,
  "receipt_total": {"amount": 175.00, "currency": "USD"},
  "meal_total_including_tax_tip": 145.00,
  "alcohol_total_including_tax_tip": 30.00,
  "meal_limit_total": 160.00,
  "alcohol_limit_total": 40.00,
  "business_purpose": "Discussed project milestones with external partners",
  "policy_findings": [],
  "status": "PENDING_HUMAN_APPROVAL",
  "approver_id": null,
  "approved_at": null,
  "allowed_to_export": false
}
```

## Audit trail requirements (demo design)

For every agent action record: `timestamp_utc`, `actor`, `action`, `claim_id`, `receipt_sha256`, `input_version`, `policy_id`, `rule_id`, `evidence`, `before_state`, `after_state`, `decision`, `explanation`, `approval_actor`, `approval_timestamp`, and `export_id` when relevant. Keep extraction, validation, human approval and external export separate, immutable events. Preserve the unmodified receipt and machine-readable extraction.

## References and conflict resolution

1. SPG 507.10-1 (official, updated July 1, 2026): https://spg.umich.edu/policy/507.10-1
2. Current U-M expense reporting and business hosting guidelines: https://procurement.umich.edu/u-m-employees/expense-reporting/
3. Limits effective July 1, 2026: https://procurement.umich.edu/updated-business-hosting-limits-now-in-effect/
4. Late reimbursement guidance: https://finance.umich.edu/General_Guidance_on_Late_Expense_Reimbursements
5. Travel meals vs business hosting: https://procurement.umich.edu/per-diem-or-hosting-get-travel-meal-expense-reporting-right/

When sources conflict, prefer the current SPG and current Procurement guidance, not older archived limits or forms. Do not apply a corporate demo policy as though it were official U-M policy.
