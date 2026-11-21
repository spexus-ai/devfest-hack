import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifiedReceiptFields, mealTypeAt } from '../src/receipt-fields.js';
import { createWorkflow } from '../src/workflow.js';
import { openStore } from '../src/store.js';

test('printed ISO date, 12-hour time and final total fill the event context', () => {
  const fields = verifiedReceiptFields({}, [
    { id: 'date', text: 'Date: 2024-02-01' }, { id: 'time', text: 'Time: 2:55:36 PM' },
    { id: 'subtotal', text: 'SUBTOTAL 330.00' }, { id: 'total', text: 'TOTAL: $418.70' },
  ]);
  assert.deepEqual(fields, {
    date: { value: '2024-02-01', lineIds: ['date'] }, time: { value: '14:55', lineIds: ['time'] },
    total: { cents: 41870, lineIds: ['total'] },
  });
  assert.equal(mealTypeAt(fields.time.value), 'lunch');
});

test('ambiguous slash dates and conflicting grand totals are left unanswered', () => {
  const fields = verifiedReceiptFields({ date: { value: '2024-02-01', lineIds: ['date'] } }, [
    { id: 'date', text: 'Date: 02/01/24' }, { id: 'x', text: 'TOTAL 17.50' }, { id: 'y', text: 'TOTAL 17.60' },
  ]);
  assert.equal(fields.date.value, null);
  assert.equal(fields.total.cents, null);
  assert.equal(mealTypeAt(null), null);
});

test('the chat preserves the purpose and asks once about a conflicting meal type', async (t) => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const sessionId = 'test-session';
  const actor = { id: 'employee' };
  const date = new Date().toISOString().slice(0, 10);
  store.createSession({ id: sessionId, claimantId: actor.id, status: 'processing', revision: 0,
    policy: { id: 'test', sha256: 'test', effectiveDate: '2020-01-01', limits: { lunch: 5000, dinner: 8000, alcohol: 2000 } },
    context: { type: 'dinner', attendees: 2, purpose: 'Встреча', funding: 'discretionary', paidByClaimant: 'yes' } });
  store.addReceipt(sessionId, { id: 'photo' });
  const source = [{ id: 'date', text: 'Date: ' + date }, { id: 'time', text: 'Time: 2:55 PM' },
    { id: 'item', text: 'Pasta $12.00' }, { id: 'total', text: 'TOTAL $12.00' }];
  const workflow = createWorkflow({ store, ocr: async () => source,
    extract: async () => ({ receiptId: 'photo', currency: { value: 'USD' }, ...verifiedReceiptFields({}, source),
      lines: [{ id: 'pasta', lineIds: ['item'], kind: 'item', cents: 1200, description: 'Pasta', category: 'food' }] }),
    classify: async () => ({ byLine: {}, purpose: 0 }) });
  await workflow.schedule(sessionId);
  const before = store.getSession(sessionId);
  assert.equal(before.context.date, date);
  assert.equal(before.context.time, '14:55');
  assert.equal(before.context.priorReimbursementCents, 0);
  assert.deepEqual(before.questions.map(({ code }) => code), ['MEAL_TIME_MISMATCH']);
  workflow.answer(before, actor, { field: 'type', value: 'dinner' });
  await workflow.schedule(sessionId);
  const after = store.getSession(sessionId);
  assert.equal(after.status, 'waiting_for_send_confirmation');
  assert.equal(after.context.purpose, 'Встреча');
  assert.equal(after.calculation.requestedCents, 1200);
  assert.deepEqual(after.questions, []);
});
