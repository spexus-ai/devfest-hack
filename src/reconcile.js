import { supportedCurrency } from './currency.js';
import { verifiedReceiptFields } from './receipt-fields.js';

export function issue(code, message, extra = {}) {
  return { code, message, ...extra };
}

function printedAmount(cents, sources) {
  return sources.some((source) =>
    Array.from(source.text.matchAll(/\d+(?:[., \u00a0\u202f]\d{3})*[.,]\s?\d{2}(?!\d)/g), ([token]) =>
      Number(token.replace(/\D/g, '')))
      .includes(Math.abs(cents)));
}

export function withEvidence(extraction, lines) {
  const sourceLines = extraction.documents?.length > 1 && extraction.primaryDocumentId
    ? lines.filter(({ region }) => region?.id === extraction.primaryDocumentId)
    : lines;
  if (Object.hasOwn(extraction, 'time')) return { ...extraction, sourceLines };
  const { date, time } = verifiedReceiptFields(extraction, sourceLines, extraction.groupTotalCents);
  return { ...extraction, date, time, sourceLines };
}

export function reconcileReceipt(receipt) {
  const { receiptId, sourceLines } = receipt;
  const issues = [];
  const lines = receipt.lines.map((line) => ({
    ...line,
    cents: line.kind === 'discount' && Number.isInteger(line.cents) ? -Math.abs(line.cents) : line.cents,
  }));
  if (receipt.documentIssues?.length) {
    return { ...receipt, lines, issues: receipt.documentIssues, itemized: false };
  }
  if (!supportedCurrency(receipt.currency?.value)) {
    issues.push(issue('CURRENCY_UNVERIFIED', 'Укажите валюту, напечатанную на оригинале чека.', { receiptId, field: 'currency' }));
  }
  if (!Number.isInteger(receipt.total?.cents) || receipt.total.cents < 0) {
    issues.push(issue('TOTAL_UNREADABLE', 'Укажите итог по оригиналу чека.', { receiptId, field: 'total' }));
  } else if (receipt.groupTotalCents != null && receipt.groupTotalCents !== receipt.total.cents) {
    issues.push(issue('DOCUMENT_TOTAL_MISMATCH', 'Укажите итог, который совпадает с подтверждённой оплатой.',
      { receiptId, field: 'total' }));
  }

  for (const line of lines) {
    const validAmount = Number.isInteger(line.cents) && (line.cents >= 0 || line.kind === 'discount');
    const verified = line.corrected || !sourceLines?.length
      || printedAmount(line.cents, sourceLines.filter((source) => line.lineIds.includes(source.id)));
    if (!validAmount || !verified) {
      issues.push(issue('AMOUNT_UNREADABLE', 'Подтвердите цену позиции по оригиналу: ' + line.description,
        { receiptId, lineId: line.id, lineIds: line.lineIds, field: 'amount' }));
    }
  }
  if (lines.length && !issues.some((entry) => ['TOTAL_UNREADABLE', 'AMOUNT_UNREADABLE'].includes(entry.code))) {
    const sum = lines.reduce((total, line) => total + line.cents, 0);
    if (sum !== receipt.total.cents) {
      issues.push(issue('TOTAL_MISMATCH', 'Позиции, скидки и сборы не сходятся с итогом чека.',
        { receiptId, field: 'reconcile', sum, total: receipt.total.cents }));
    }
  }
  return { ...receipt, lines, issues, itemized: lines.some((line) => line.kind === 'item') };
}
