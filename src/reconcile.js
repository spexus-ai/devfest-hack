import { supportedCurrency } from './currency.js';

export function issue(code, message, extra = {}) {
  return { code, message, ...extra };
}

export function withEvidence(extraction, sourceLines) {
  return { ...extraction, sourceLines };
}

export function refreshAddedTax(receipt) {
  if (!receipt.tax) return;
  const { cents, treatment, lineIds } = receipt.tax;
  const id = receipt.receiptId + '-tax';
  const previous = receipt.lines.find((line) => line.id === id);
  receipt.lines = receipt.lines.filter((line) => line.id !== id);
  if (treatment === 'added' && cents > 0) {
    receipt.lines.push({ ...previous, id, kind: 'tax', description: 'Tax', cents, lineIds });
  }
}

export function reconcileReceipt(receipt) {
  const { receiptId } = receipt;
  if (receipt.documentIssues?.length) return { ...receipt, issues: receipt.documentIssues, itemized: false };

  const issues = [];
  if (!supportedCurrency(receipt.currency?.value)) {
    issues.push(issue('CURRENCY_UNVERIFIED', 'Enter the currency printed on the original receipt.', { receiptId, field: 'currency' }));
  }
  if (receipt.total?.cents == null) {
    issues.push(issue('TOTAL_UNREADABLE', 'Enter the total shown on the original receipt.',
      { receiptId, field: 'total', lineIds: receipt.total?.lineIds }));
  }
  if (receipt.tax?.treatment === 'added' && receipt.tax.cents == null) {
    issues.push(issue('TAX_UNREADABLE', 'Enter the amount of tax charged separately on the receipt.',
      { receiptId, field: 'taxAmount', lineIds: receipt.tax.lineIds }));
  } else if (receipt.tax?.cents > 0 && receipt.tax.treatment == null) {
    issues.push(issue('TAX_TREATMENT_UNCLEAR', 'Is the tax already included in the item prices?',
      { receiptId, field: 'taxTreatment', lineIds: receipt.tax.lineIds,
        options: { included: 'Included in prices', added: 'Added to prices' } }));
  }
  for (const line of receipt.lines) {
    if (line.cents == null) {
      issues.push(issue('AMOUNT_UNREADABLE', 'Confirm this item price from the original receipt: ' + line.description,
        { receiptId, lineId: line.id, lineIds: line.lineIds, field: 'amount' }));
    }
  }
  return { ...receipt, issues, itemized: receipt.lines.some((line) => line.kind === 'item') };
}
