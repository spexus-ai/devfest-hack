import assert from 'node:assert/strict';
import test from 'node:test';
import { extractReceipt } from '../src/qwen.js';
import { applyCorrections, createWorkflow } from '../src/workflow.js';
import { openStore } from '../src/store.js';
import { prepareMailDraft } from '../src/mail-draft.js';
import { createMailSender } from '../src/mail-send.js';
import { fixedExchangeRates } from '../src/currency.js';

const lines = [
  { id: 'seller', text: 'CAFÉ CENTRAL', box: { left: 12, top: 18, width: 90, height: 10 } },
  { id: 'meal', text: 'Menu 15,00' },
  { id: 'vat', text: 'IVA 13% 1,50 | IVA 23% 1,00' },
  { id: 'total', text: 'TOTAL EUR 1?,50' },
  { id: 'tax-id', text: 'NIF 111222333', words: [{ text: '111222333', left: 20, width: 25 }] },
];

const reply = {
  documentStatus: 'receipt',
  merchant: { value: 'Café Central', lineIds: ['seller'] },
  date: { value: null, lineIds: [] },
  time: { value: null, lineIds: [] },
  currency: { value: 'EUR', lineIds: ['total'] },
  total: { cents: 1750, lineIds: ['meal', 'vat', 'total'] },
  tax: { cents: 250, treatment: 'added', lineIds: ['vat'] },
  lines: [{ kind: 'item', description: 'Menu', cents: 1500, lineIds: ['meal'] }],
};

function extract(result, inspect = () => {}) {
  return extractReceipt({ receiptId: 'R1', lines }, { key: 'test', fetcher: async (_url, request) => {
    inspect(JSON.parse(request.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
  } });
}

test('Qwen supplies the total and tax from OCR evidence and OCR geometry is sent', async () => {
  const extracted = await extract(reply, (request) => {
    const sent = JSON.parse(request.messages[1].content);
    assert.deepEqual(sent[0].box, lines[0].box);
    assert.equal(sent.find(({ id }) => id === 'tax-id').text, 'NIF [ID]');
    assert.equal(sent.find(({ id }) => id === 'tax-id').words, undefined);
    assert.equal(request.response_format.json_schema.strict, true);
  });
  const [receipt] = applyCorrections([extracted]);
  assert.deepEqual(receipt.total, reply.total);
  assert.deepEqual(receipt.tax, reply.tax);
  assert.deepEqual(receipt.issues, []);
  assert.deepEqual(receipt.lines.filter(({ kind }) => kind === 'tax').map(({ cents }) => cents), [250]);

  const [included] = applyCorrections([extracted], [{ receiptId: 'R1', field: 'taxTreatment', value: 'included' }]);
  assert.equal(included.tax.cents, 250);
  assert.deepEqual(included.lines.map(({ kind }) => kind), ['item']);
});

test('receipt questions follow missing values and Qwen document status', async () => {
  const unknowns = await extract({ ...reply, total: { cents: null, lineIds: ['total'] },
    tax: { cents: 250, treatment: null, lineIds: ['vat'] } });
  const [paused] = applyCorrections([unknowns]);
  assert.deepEqual(paused.issues.map(({ field }) => field), ['total', 'taxTreatment']);

  const empty = { value: null, lineIds: [] };
  const invalid = await extract({ documentStatus: 'multiple_receipts', merchant: empty, date: empty, time: empty,
    currency: empty, total: { cents: null, lineIds: [] }, tax: { cents: null, treatment: null, lineIds: [] }, lines: [] });
  const [photo] = applyCorrections([invalid]);
  assert.equal(photo.itemized, false);
  assert.deepEqual(photo.issues.map(({ code }) => code), ['DOCUMENTS_UNMATCHED']);
});

test('VAT is already included when the priced items equal the receipt total', async () => {
  const [receipt] = applyCorrections([await extract({ ...reply,
    total: { cents: 1299, lineIds: ['total'] }, tax: { ...reply.tax, cents: 243 },
    lines: [{ ...reply.lines[0], cents: 1299 }],
  })]);
  assert.equal(receipt.tax.treatment, 'included');
  assert.equal(receipt.tax.cents, 243);
  assert.deepEqual(receipt.lines.map(({ cents }) => cents), [1299]);
  assert.deepEqual(receipt.issues, []);

  const [ambiguous] = applyCorrections([await extract({ ...reply,
    total: { cents: 1600, lineIds: ['total'] },
  })]);
  assert.deepEqual(ambiguous.issues.map(({ code }) => code), ['TAX_EXCEEDS_RECEIPT_TOTAL']);
});

test('an unsent draft is recalculated and versioned using the saved item judgments', async (t) => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const session = store.createSession({ id: 's', revision: 1, status: 'waiting_for_send_confirmation',
    claimantId: 'employee', claimantEmail: 'employee@example.test', claimantName: 'Employee',
    policy: { id: 'test', sha256: 'test', effectiveDate: '2000-01-01', limits: { breakfast: 3000, alcohol: 2000 } },
    context: { date: new Date().toISOString().slice(0, 10), type: 'breakfast', attendees: 1, funding: 'federal',
      purpose: 'Planning', paidByClaimant: 'yes' }, exchangeRates: fixedExchangeRates,
    judgment: { byLine: { item: { category: { value: 'food', probability: 0.99 } } } },
    reviewReceipts: [{ receiptId: 'r', currency: { value: 'EUR' }, total: { cents: 1299 },
      tax: { cents: 243, treatment: 'added', lineIds: [] }, lines: [
        { id: 'item', kind: 'item', description: 'Cake', cents: 1299, lineIds: [] },
        { id: 'r-tax', kind: 'tax', description: 'Tax', cents: 243, lineIds: [] },
      ] }], calculation: { requestedCents: 1696 },
  });
  store.addDraft({ sessionId: session.id, revision: 1, messageId: 'old', status: 'draft' });
  const workflow = createWorkflow({ store, classify: () => assert.fail('Expected saved judgments') });
  workflow.onReady((ready) => prepareMailDraft(store, ready));
  workflow.refreshDraftTax(session);
  workflow.refreshDraftTax(store.getSession(session.id));
  assert.equal(store.getSession(session.id).revision, 2);
  const draft = store.getDraft(session.id, 2);
  assert.deepEqual([draft.payload.amounts.receiptTotalCents, draft.payload.amounts.requestedCents], [1429, 1429]);
  assert.match(draft.preview, /2\.43 EUR \(included in item prices\)/);
  assert.doesNotMatch(draft.preview, /Item: Tax/);
  const mail = createMailSender({ store, transport: { sendMail: () => assert.fail('Unexpected send') } });
  await assert.rejects(mail.confirm(session.id, 1, 'employee'), { status: 409 });
});

test('the provider contract still rejects unknown evidence and missing tax fields', async () => {
  await assert.rejects(extract({ ...reply, total: { cents: 1750, lineIds: ['absent'] } }), /missing OCR lines/);
  let calls = 0;
  await assert.rejects(extract({ ...reply, tax: undefined }, () => { calls += 1; }), /does not match the receipt schema/);
  assert.equal(calls, 2);
});

test('a malformed Qwen answer is retried once with the same OCR input', async () => {
  const requests = [];
  const result = await extractReceipt({ receiptId: 'R1', lines }, { key: 'test', fetcher: async (_url, request) => {
    requests.push(JSON.parse(request.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify(requests.length === 1 ? {} : reply) } }],
      usage: { prompt_tokens: 100, cost: 0.01 } });
  } });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].messages[1], requests[0].messages[1]);
  assert.match(requests[1].messages[0].content, /previous answer was rejected/);
  assert.deepEqual(result.total, reply.total);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.usage, { prompt_tokens: 200, cost: 0.02 });
});
