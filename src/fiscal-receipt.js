const digits = (text) => Number(text.replace(/\D/g, ''));

function lineAmount(text) {
  const match = text.replace(/\s/g, '').match(/^(\d+[.,]\d{2})[*xX](.+)$/);
  if (!match) return null;
  const unit = digits(match[1]);
  const quantity = match[2].match(/^\d+[.,]\d{3}/)?.[0];
  if (quantity) return Math.round(unit * digits(quantity) / 1000);
  if (/^\d+[.,]\d{2}$/.test(match[2]) && digits(match[2]) === unit) return unit;
  return null;
}

export function fiscalReceiptLines(labels, amounts, receiptId) {
  const positions = amounts.map((line) => ({ ...line, cents: lineAmount(line.text) }))
    .filter(({ cents }) => Number.isSafeInteger(cents));
  if (positions.length < 2) return [];
  const totalCents = positions.reduce((sum, { cents }) => sum + cents, 0);
  const last = positions.at(-1);
  const total = amounts.find(({ text, box }) => box.top > last.box.top
    && /^\d+[.,]\d{2}$/.test(text.trim()) && digits(text) === totalCents);
  if (!total || totalCents <= 0) return [];

  const names = labels.filter(({ text }) => /\p{L}{2}/u.test(text)
    && !/кассов|(?:^|\s)[тt][оo][вb][аa][рp]\s*$/iu.test(text));
  const matched = new Set();
  const result = [];
  for (const amount of positions) {
    const rowTop = amount.box.top;
    const height = amount.box.height;
    const label = names.findLast((line) => !matched.has(line.id)
      && line.box.top <= rowTop + height / 4 && rowTop - line.box.top <= height * 2.3);
    if (!label) return [];
    matched.add(label.id);
    if (!amount.cents && /^well[\s,]+done\s*$/i.test(label.text)) continue;
    const left = Math.min(label.box.left, amount.box.left);
    const top = Math.min(label.box.top, amount.box.top);
    const right = Math.max(label.box.left + label.box.width, amount.box.left + amount.box.width);
    const bottom = Math.max(label.box.top + label.box.height, amount.box.top + amount.box.height);
    result.push({ id: receiptId + '-F' + (result.length + 1), text: `${label.text} ${(amount.cents / 100).toFixed(2)}`,
      box: { left, top, width: right - left, height: bottom - top }, words: [...label.words, ...amount.words],
      fiscalItem: { description: label.text, cents: amount.cents } });
  }
  return [...result, { ...total, id: receiptId + '-FT', fiscalTotalCents: totalCents }];
}
