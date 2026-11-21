import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { checksum } from '../src/receipts.js';
import { openStore } from '../src/store.js';
import { createMailSender } from '../src/mail-send.js';

const path = new URL('./fixtures/receipt-smoke.png', import.meta.url).pathname;
const sha256 = checksum(await readFile(path));

function setup() {
  const store = openStore(':memory:');
  store.createSession({ id: 'test', claimantId: 'employee', status: 'waiting_for_send_confirmation',
    revision: 1, policy: { id: 'policy', sha256: 'hash' } });
  store.addDraft({
    sessionId: 'test', revision: 1, status: 'draft', messageId: 'test@example.test',
    from: 'employee@example.test', to: 'accounting@example.test', subject: 'Fixture', text: 'Fixture',
    attachments: [{ path, sha256, filename: 'receipt.png', mime: 'image/png' }],
  });
  return store;
}

test('definite SMTP refusal can be retried explicitly', async () => {
  const store = setup();
  let runs = 0;
  const sender = createMailSender({ store, transport: { sendMail: async () => {
    if (++runs === 1) throw Object.assign(new Error('rejected'), { responseCode: 550 });
    return { accepted: ['accounting@example.test'] };
  } } });
  assert.equal((await sender.confirm('test', 1, 'employee')).status, 'send_failed');
  assert.equal((await sender.confirm('test', 1, 'employee')).status, 'submitted_for_review');
  assert.equal(runs, 2);
  store.close();
});

test('ambiguous SMTP timeout is reconciled by Message-ID without resending', async () => {
  const store = setup();
  let runs = 0;
  let found;
  const sender = createMailSender({ store, mailpit: { findByMessageId: async () => found },
    transport: { sendMail: async () => { runs++; throw new Error('timeout after data'); } } });
  assert.equal((await sender.confirm('test', 1, 'employee')).status, 'delivery_unknown');
  assert.equal((await sender.confirm('test', 1, 'employee')).status, 'delivery_unknown');
  found = { ID: 'mail-id' };
  assert.equal((await sender.confirm('test', 1, 'employee')).status, 'submitted_for_review');
  assert.equal(runs, 1);
  store.close();
});
