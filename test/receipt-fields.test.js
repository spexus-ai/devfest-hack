import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mealTypeAt, validDate } from '../src/receipt-fields.js';
import { createWorkflow } from '../src/workflow.js';
import { openStore } from '../src/store.js';

test('local time determines the suggested meal type', () => {
  assert.equal(mealTypeAt('09:30'), 'breakfast');
  assert.equal(mealTypeAt('14:55'), 'lunch');
  assert.equal(mealTypeAt('18:00'), 'dinner');
  assert.equal(mealTypeAt(null), null);
  assert.equal(validDate('2024-02-30'), false);
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
    extract: async () => ({ receiptId: 'photo', currency: { value: 'USD' },
      date: { value: date, lineIds: ['date'] }, time: { value: '14:55', lineIds: ['time'] },
      total: { cents: 1200, lineIds: ['total'] },
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
