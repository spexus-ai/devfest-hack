import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertAmounts, fixedExchangeRates, receiptConversion } from '../src/currency.js';
import { calculateExpense } from '../src/calculate.js';
import { policyFindings } from '../src/policy-findings.js';
import { conversionText } from '../public/ui.js';

function receipt(receiptId, currency, cents, lines = []) {
  return { receiptId, currency: { value: currency }, total: { cents }, lines, itemized: lines.length > 0 };
}

const policy = { limits: { dinner: 8000, alcohol: 2000 }, effectiveDate: '2026-07-01' };
const context = { type: 'dinner', funding: 'sponsored', attendees: 2, priorReimbursementCents: 0,
  date: '2026-11-21', paidByClaimant: 'yes' };

test('FX rounding preserves the total of positions and negative charges', () => {
  assert.deepEqual(convertAmounts([25, 25, 25], fixedExchangeRates.RUB), [1, 0, 0]);
  assert.equal(convertAmounts([-150], fixedExchangeRates.RUB)[0], -2);
  assert.deepEqual(convertAmounts([1004, 1, -2], fixedExchangeRates.EUR), [1104, 1, -2]);
  assert.equal(receiptConversion(receipt('photo', 'RUB', 607000), fixedExchangeRates).usdCents, 6070);
});

test('the policy equivalent is rounded separately from the EUR amount on the receipt', () => {
  const conversion = receiptConversion(receipt('photo', 'EUR', 1299), fixedExchangeRates);
  assert.equal(conversion.usdCents, 1429);
  assert.equal(conversionText(conversion), '€12.99 on receipt · $14.29 USD for policy calculation (fixed rate 1.10 USD per EUR)');
});

test('an uncertain alcohol classification asks for clarification before exclusion', () => {
  const receipts = [receipt('photo', 'EUR', 1299, [{ id: 'item', description: 'Bolo Rel', kind: 'item', cents: 1299 }])];
  const category = { value: 'alcohol', probability: 0.94 };
  const run = (alcohol) => calculateExpense({ policy, context, receipts,
    judgments: { byLine: { item: { category, alcohol } } } });
  const uncertain = run(0.55);
  assert.deepEqual(uncertain.questions.map(({ code }) => code), ['CATEGORY_UNCLEAR']);
  assert.equal(uncertain.excludedCents, 0);
  const confirmed = run(0.96);
  assert.deepEqual(confirmed.questions, []);
  assert.equal(confirmed.excludedCents, 1429);
});

test('RUB, EUR and USD receipts use each session rate before policy exclusions', () => {
  const receipts = [
    receipt('rub', 'RUB', 607000, [
      { id: 'food', description: 'Food', kind: 'item', category: 'food', cents: 385000 },
      { id: 'beer', description: 'Beer', kind: 'item', category: 'alcohol', cents: 222000 },
    ]),
    receipt('eur', 'EUR', 1000, [{ id: 'pasta', description: 'Pasta', kind: 'item', category: 'food', cents: 1000 }]),
    receipt('usd', 'USD', 1000, [{ id: 'roll', description: 'Roll', kind: 'item', category: 'food', cents: 1000 }]),
  ];
  const exchangeRates = { ...fixedExchangeRates, EUR: { numerator: 12, denominator: 10 } };
  const calculation = calculateExpense({ receipts, policy, context, exchangeRates, judgments: { byLine: {} } });
  assert.equal(calculation.receiptTotalCents, 8270);
  assert.equal(calculation.excludedCents, 2220);
  assert.equal(calculation.requestedCents, 6050);
  assert.equal(calculation.items.reduce((sum, item) => sum + item.cents, 0), calculation.receiptTotalCents);
  assert.deepEqual(calculation.conversions.map(({ currency, sourceCents, usdCents }) => [currency, sourceCents, usdCents]),
    [['EUR', 1000, 1200], ['RUB', 607000, 6070]]);
});

test('itemization is required based on the USD value of the receipt', () => {
  const receipts = [receipt('rub', 'RUB', 120000), receipt('eur', 'EUR', 6900)];
  const calculation = calculateExpense({ receipts, policy, context, judgments: { byLine: {} } });
  const findings = policyFindings({ receipts, policy, context, calculation, now: new Date('2026-11-22') });
  assert.deepEqual(findings.filter(({ code }) => code === 'RECEIPT_NOT_ITEMIZED').map(({ receiptId }) => receiptId), ['eur']);
});
