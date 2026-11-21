import { issue } from './reconcile.js';

export const mealTypes = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', other: 'Other' };
export const fundingTypes = {
  sponsored: 'Sponsored funds', federal: 'Federal funds', discretionary: 'Discretionary funds',
  general: 'General funds', unknown: 'Unknown',
};
export const eventFields = [
  { field: 'type', text: 'What type of business meal or event was this?', options: mealTypes },
  { field: 'date', text: 'On what date did the event take place?', input: 'date' },
  { field: 'time', text: 'What time did the event take place? The receipt did not confirm the time.', input: 'time' },
  { field: 'attendees', text: 'How many people attended?', input: 'integer' },
  { field: 'purpose', text: 'What was the specific business purpose of the event?', input: 'text' },
  { field: 'funding', text: 'Which funding source should cover the reimbursement?', options: fundingTypes },
  { field: 'paidByClaimant', text: 'Did you personally pay the expenses?', options: { yes: 'Yes', no: 'No' } },
];

function day(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.NaN;
  const result = Date.parse(date + 'T00:00:00.000Z');
  return Number.isFinite(result) && new Date(result).toISOString().slice(0, 10) === date ? result : Number.NaN;
}

export function policyFindings({ policy, context, receipts, calculation, now = new Date() }) {
  const findings = [];
  const elapsed = (day(now.toISOString().slice(0, 10)) - day(context.date)) / 86400000;
  if (!Number.isFinite(elapsed) || elapsed < 0 || context.date < policy.effectiveDate) {
    findings.push(issue('EVENT_DATE_REVIEW_REQUIRED', 'Check which policy applies to the event date.'));
  } else if (elapsed > 60) {
    findings.push(issue('SUBMISSION_OR_APPROVAL_AFTER_60_DAYS', 'The event took place more than 60 days ago.'));
  }
  if (!Object.hasOwn(policy.limits, context.type) || context.type === 'alcohol') {
    findings.push(issue('EVENT_TYPE_REVIEW_REQUIRED', 'This event type requires a separate review.'));
  }
  if (context.paidByClaimant !== 'yes') {
    findings.push(issue('CLAIMANT_NOT_PAYER', 'The claimant has not confirmed that they paid the expenses personally.'));
  }
  if (context.funding === 'unknown') {
    findings.push(issue('FUNDING_SOURCE_REVIEW_REQUIRED', 'The funding source for reimbursement is still unconfirmed.'));
  }
  if (context.priorReimbursementCents > 0) {
    findings.push(issue('DUPLICATE_OR_THIRD_PARTY_REIMBURSEMENT',
      'Verify the amount already paid and the remaining reimbursement.'));
  }
  for (const receipt of receipts) {
    if (receipt.itemized) continue;
    const conversion = calculation.conversions?.find(({ receiptId }) => receiptId === receipt.receiptId);
    if ((conversion?.usdCents ?? receipt.total?.cents) >= 7500) {
      findings.push(issue('RECEIPT_NOT_ITEMIZED', 'An itemized receipt is required for this amount.',
        { receiptId: receipt.receiptId }));
    }
    if (receipt.sourceLines?.some(({ text }) => /\b(?:alcohol|wine|beer|liquor)\b/i.test(text))) {
      findings.push(issue('ICRX_REVIEW_REQUIRED', 'The entire non-itemized receipt containing alcohol requires ICRX review.',
        { receiptId: receipt.receiptId }));
    }
    if (!calculation.items.some(({ receiptId }) => receiptId === receipt.receiptId)) {
      findings.push(issue('RECEIPT_CONTENT_REVIEW_REQUIRED', 'The receipt line items could not be determined.',
        { receiptId: receipt.receiptId }));
    }
  }
  return findings;
}
