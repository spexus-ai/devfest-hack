export function issue(code, message, extra = {}) {
  return { code, message, ...extra };
}

function printedAmount(cents, sources) {
  return sources.some((source) =>
    Array.from(source.text.matchAll(/(?:\d{1,3}(?:,\d{3})+|\d+)[.,]\d{2}(?!\d)/g), ([token]) =>
      Math.round(Number(token.includes('.') ? token.replaceAll(',', '') : token.replace(',', '.')) * 100))
      .includes(Math.abs(cents)));
}

export function reconcileReceipt(receipt) {
  const { receiptId, sourceLines } = receipt;
  const issues = [];
  const lines = receipt.lines.map((line) => ({
    ...line,
    cents: line.kind === 'discount' && Number.isInteger(line.cents) ? -Math.abs(line.cents) : line.cents,
  }));
  if (receipt.currency?.value !== 'USD') {
    issues.push(issue('CURRENCY_UNVERIFIED', 'Укажите, что чек выставлен в USD.', { receiptId, field: 'currency' }));
  }
  if (!Number.isInteger(receipt.total?.cents) || receipt.total.cents < 0) {
    issues.push(issue('TOTAL_UNREADABLE', 'Укажите итог по оригиналу чека.', { receiptId, field: 'total' }));
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
