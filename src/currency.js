// Rates express USD per unit of the original currency.
export const fixedExchangeRates = Object.freeze({
  RUB: Object.freeze({ numerator: 1, denominator: 100 }),
  EUR: Object.freeze({ numerator: 11, denominator: 10 }),
});

export const supportedCurrency = (currency) => currency === 'USD' || Object.hasOwn(fixedExchangeRates, currency);

export function receiptConversion(receipt, exchangeRates) {
  const currency = receipt.currency?.value;
  const rate = exchangeRates?.[currency];
  const sourceCents = receipt.total?.cents;
  if (!rate || !Number.isSafeInteger(sourceCents) || sourceCents < 0 || receipt.documentIssues?.length
      || sourceCents > Number.MAX_SAFE_INTEGER / Math.max(1, rate.numerator / rate.denominator)) return null;
  return { receiptId: receipt.receiptId, currency, sourceCents, usdCents: convertAmounts([sourceCents], rate)[0], rate };
}

// Convert a receipt as a whole. Assign rounding cents to the largest fractional
// remainders so the converted positions still sum to the rounded receipt total.
export function convertAmounts(amounts, { numerator, denominator }) {
  const divisor = BigInt(denominator);
  const factor = BigInt(numerator);
  const parts = amounts.map((amount, index) => {
    const scaled = BigInt(amount) * factor;
    const remainder = (scaled % divisor + divisor) % divisor;
    return { index, scaled, remainder, cents: (scaled - remainder) / divisor };
  });
  const total = parts.reduce((sum, part) => sum + part.scaled, 0n);
  const magnitude = total < 0n ? -total : total;
  const rounded = ((magnitude + divisor / 2n) / divisor) * (total < 0n ? -1n : 1n);
  let adjustment = rounded - parts.reduce((sum, part) => sum + part.cents, 0n);
  const byRemainder = parts.slice().sort((a, b) => Number(b.remainder - a.remainder) || a.index - b.index);
  for (const part of byRemainder) {
    if (!adjustment) break;
    part.cents += 1n;
    adjustment -= 1n;
  }
  return parts.map(({ cents }) => {
    const value = Number(cents);
    if (!Number.isSafeInteger(value)) throw new RangeError('The converted amount is too large.');
    return value;
  });
}
