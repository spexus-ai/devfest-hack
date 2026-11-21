import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractReceipt } from '../src/qwen.js';
import { inspectReceiptPhoto } from '../src/receipt-documents.js';

function document(id, texts) {
  return texts.map((text, index) => ({ text, id: id + '-L' + index, region: { id } }));
}

const fiscal = document('fiscal', ['КАССОВЫЙ ЧЕК', 'Заказ: 36492', 'ИТОГ: 6070.']);
const bill = document('bill', ['ГОСТЕВОЙ СЧЕТ', 'Открыт: 14.04.2022 Заказ № 36492', 'ИТОГО К ОПЛАТЕ: 6 070,00']);
const slip = document('payment', ['Терминал: 241', 'ДАТА: 14/04/22', 'Сумма: 6 070.00 RUB']);

test('related documents give one original total and preserve its detected currency', () => {
  const lines = [...slip, ...bill, ...fiscal];
  const photo = inspectReceiptPhoto(lines, 'photo');
  assert.deepEqual(photo.documents.map(({ type }) => type), ['payment', 'itemized_bill', 'fiscal']);
  assert.equal(photo.primaryDocumentId, 'bill');
  assert.equal(photo.groupTotalCents, 607000);
  assert.equal(photo.currency, 'RUB');
  assert.deepEqual(photo.issues, []);
});

test('unsupported and conflicting printed currencies stop automatic extraction', async () => {
  const pound = document('receipt', ['TEST CAFE', 'Pasta 20.00 GBP', 'Total 20.00 GBP']);
  const extracted = await extractReceipt({ receiptId: 'photo', lines: pound }, {
    fetcher: () => assert.fail('There is no exchange rate for this receipt'),
  });
  assert.equal(extracted.currency.value, 'GBP');
  assert.deepEqual(extracted.documentIssues.map(({ code }) => code), ['CURRENCY_UNSUPPORTED']);
  const conflicting = document('mixed', ['Food 20.00 EUR', 'Total 20.00 EUR', 'Equivalent: 22.00 USD']);
  assert.deepEqual(inspectReceiptPhoto(conflicting, 'photo').issues.map(({ code }) => code), ['CURRENCY_AMBIGUOUS']);
});

test('matching amounts alone do not merge different orders or payments on different dates', () => {
  const otherOrder = document('fiscal', ['КАССОВЫЙ ЧЕК', 'Заказ: 31567', 'ИТОГ: 6070.00']);
  assert.equal(inspectReceiptPhoto([...otherOrder, ...bill], 'photo').issues[0].code, 'DOCUMENTS_UNMATCHED');

  const oldSlip = document('payment', ['Терминал: 241', 'ДАТА: 10/04/22', 'Сумма: 6 070.00 RUB']);
  assert.equal(inspectReceiptPhoto([...oldSlip, ...bill], 'photo').primaryDocumentId, null);
});

test('several independent receipts and payment-only photos require human input', () => {
  const first = document('first', ['Good Cafe', 'Pasta $20.00', 'TOTAL $20.00']);
  const second = document('second', ['Another Cafe', 'Coffee $2.00', 'TOTAL $2.00']);
  assert.equal(inspectReceiptPhoto([...first, ...second], 'photo').issues[0].code, 'DOCUMENTS_UNMATCHED');
  assert.equal(inspectReceiptPhoto(slip, 'photo').issues[0].code, 'ITEMIZED_DOCUMENT_MISSING');
  assert.equal(inspectReceiptPhoto(first, 'photo').issues.length, 0);
});
