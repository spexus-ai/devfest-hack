import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import nodemailer from 'nodemailer';
import { checksum } from '../src/receipts.js';
import { createMailpit } from '../src/mailpit.js';

const base = process.env.VERIFY_BASE_URL ?? 'http://127.0.0.1:3000';
const mailpit = createMailpit();
const start = performance.now();

async function call(path, input = {}) {
  const headers = new Headers();
  if (input.cookie) headers.set('cookie', input.cookie);
  if (input.body && process.env.EXPENSE_PUBLIC_ORIGIN) headers.set('origin', process.env.EXPENSE_PUBLIC_ORIGIN);
  if (input.body && !(input.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(base + path, {
    method: input.method ?? (input.body ? 'POST' : 'GET'),
    headers, signal: AbortSignal.timeout(120000),
    body: input.body instanceof FormData ? input.body : input.body ? JSON.stringify(input.body) : undefined,
  });
  const target = input.status ?? null;
  if (target ? response.status !== target : !response.ok) {
    throw new Error(path + ' HTTP ' + response.status + ' ' + (await response.text()).slice(0, 350));
  }
  if (target && target >= 400 || response.status === 204) return response;
  return { response, data: await response.json() };
}

async function login(name) {
  const { response } = await call('/api/login', {
    body: { email: name + '@example.test', password: process.env['DEMO_' + name.toUpperCase() + '_PASSWORD'] ?? name + '-demo' },
  });
  return response.headers.get('set-cookie').split(';')[0];
}

const employee = await login('employee');
const reviewer = await login('reviewer');
const authority = await login('authority');
const today = new Date().toISOString().slice(0, 10);

async function snapshot(id) {
  const { data } = await call('/api/sessions/' + id, { cookie: employee });
  return data;
}

async function waitFor(id, predicate) {
  for (const until = Date.now() + 120000; Date.now() < until;) {
    const state = await snapshot(id);
    if (state.status === 'processing_failed') throw new Error('Сбой конвейера: ' + state.failure);
    if (predicate(state)) return state;
    await wait(500);
  }
  const state = await snapshot(id);
  throw new Error('Ожидание сессии ' + id + ' истекло: ' + JSON.stringify({
    status: state.status, questions: state.questions, failure: state.failure,
  }));
}

async function waitForSessionEvent(id, type) {
  const controller = new AbortController();
  try {
    const response = await fetch(base + '/api/sessions/' + id + '/events', {
      headers: { cookie: employee },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/event-stream\b/);
    let pending = '';
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      pending += chunk;
      const frames = pending.split('\n\n');
      pending = frames.pop();
      for (const frame of frames) {
        const data = frame.split('\n').find((line) => line.startsWith('data: '));
        if (data && JSON.parse(data.slice('data: '.length)).type === type) return;
      }
    }
    throw new Error('Поток завершился без события ' + type);
  } finally {
    controller.abort();
  }
}

async function openRequest(names, changes = {}) {
  const originals = await Promise.all(names.map((name) => readFile(new URL('../test/fixtures/' + name, import.meta.url))));
  const form = new FormData();
  for (const [index, bytes] of originals.entries()) {
    form.append('receipts', new Blob([bytes], { type: 'image/png' }), names[index]);
  }
  const { data } = await call('/api/sessions', { cookie: employee, body: form, status: 201 });
  const id = data.sessionId;
  const fields = {
    type: 'dinner', date: today, time: null, attendees: 2, purpose: 'Reviewed milestones and equipment installation for the university laboratory with the external project partner.',
    funding: 'sponsored', paidByClaimant: 'yes',
    ...changes,
  };
  for (const [field, value] of Object.entries(fields)) {
    await call('/api/sessions/' + id + '/messages', { cookie: employee, body: { field, value }, status: 202 });
  }
  return { id, originals };
}

async function mailState(id, draft) {
  const messages = (await mailpit.list(draft.to)).filter((message) =>
    String(message.MessageID).replace(/^<|>$/g, '') === draft.messageId);
  assert.ok(messages.length <= 1, 'Повторное письмо ' + id);
  return messages;
}

async function submit(id, draft) {
  const path = '/api/sessions/' + id + '/confirm-send';
  await call(path, { cookie: employee, body: { revision: draft.revision - 1 }, status: 409 });
  assert.equal((await mailState(id, draft)).length, 0);
  await Promise.all([
    call(path, { cookie: employee, body: { revision: draft.revision } }),
    call(path, { cookie: employee, body: { revision: draft.revision } }),
  ]);
  const current = await waitFor(id, ({ status }) => status === 'submitted_for_review');
  assert.equal((await mailState(id, draft)).length, 1);
  return current;
}

async function importAndCheck(id, revision) {
  const first = await call('/api/approvals', { cookie: reviewer });
  const again = await call('/api/approvals', { cookie: reviewer });
  for (const list of [first, again]) {
    assert.equal(list.data.requests.filter((request) => request.id === id).length, 1);
  }
  const { data: detail } = await call('/api/approvals/' + id, { cookie: reviewer });
  await call('/api/approvals/' + id, { cookie: authority, status: 404 });
  const { data: check } = await call('/api/approvals/' + id + '/check', {
    cookie: reviewer, body: { revision },
  });
  return { detail, check };
}

const greenStarted = performance.now();
const { id: green, originals } = await openRequest(['receipt-green-one.png', 'receipt-green-two.png']);
const paused = await waitFor(green, (state) => state.questions?.some(({ field }) => field === 'amount'));
assert.equal(paused.status, 'waiting_for_input');
const question = paused.questions.find(({ field }) => field === 'amount');
const originalHash = paused.receipts.find(({ id }) => id === question.receiptId).sha256;
assert.equal((await mailpit.list('accounting@example.test')).filter((m) => m.MessageID?.includes(green)).length, 0);
await Promise.all([
  waitForSessionEvent(green, 'draft_created'),
  call('/api/sessions/' + green + '/messages', {
    cookie: employee, body: { receiptId: question.receiptId, lineId: question.lineId, field: 'amount', value: 6500 },
  }),
]);
const greenDraft = await waitFor(green, (state) => state.status === 'waiting_for_send_confirmation' && state.draft);
assert.equal(greenDraft.calculation.requestedCents, 14500);
assert.equal(greenDraft.calculation.excludedCents, 2400);
await submit(green, greenDraft.draft);

const reviewStarted = performance.now();
const greenResult = await importAndCheck(green, greenDraft.revision);
assert.equal(greenResult.check.verdict, 'green', JSON.stringify(greenResult.check.findings));
assert.equal(greenResult.detail.attachments.length, 2);
assert.ok(greenResult.check.attachments.some(({ sha256 }) => sha256 === originalHash));
for (const [index, attachment] of greenResult.check.attachments.entries()) {
  assert.equal(attachment.sha256, checksum(originals[index]));
}
const approve = '/api/approvals/' + green + '/approve';
const approvalBody = { revision: greenDraft.revision, checkId: greenResult.check.id };
await call(approve, { cookie: employee, body: approvalBody, status: 403 });
await call(approve, { cookie: authority, body: approvalBody, status: 403 });
await call(approve, { cookie: reviewer, body: { ...approvalBody, revision: greenDraft.revision - 1 }, status: 409 });
const { data: approval } = await call(approve, { cookie: reviewer, body: approvalBody });
const { data: duplicate } = await call(approve, { cookie: reviewer, body: approvalBody });
assert.equal(approval.approverId, 'reviewer');
assert.deepEqual(approval, duplicate);
const { data: audit } = await call('/api/audit/sessions/' + green, { cookie: reviewer });
assert.equal(audit.session.status, 'approved');
for (const [type, actorId] of [['receipt_corrected', 'employee'], ['send_confirmed', 'employee'],
  ['mail_imported', 'reviewer'], ['review_completed', 'reviewer'], ['expense_approved', 'reviewer']]) {
  assert.equal(audit.events.filter((event) => event.type === type && event.actorId === actorId).length, 1);
}
console.log('PASS green: original attachments, human correction, one send, explicit approval, audit');
const spend = audit.events.flatMap(({ type, data }) => {
  if (type === 'receipt_extracted') return [{ provider: 'Qwen', usage: data.usage ?? {} }];
  if (type === 'policy_check_completed' && data.model) return [{ provider: 'Jev', usage: data.usage ?? {} }];
  if (type === 'review_completed') return [
    ...(data.models?.qwen ?? []).map(({ usage }) => ({ provider: 'Qwen', usage: usage ?? {} })),
    { provider: 'Jev', usage: data.models?.jevTokens ?? {} },
  ];
  return [];
});
const tokenSum = {};
for (const { provider, usage } of spend) {
  tokenSum[provider] ??= { input: 0, output: 0, observedCost: 0 };
  tokenSum[provider].input += usage.input_tokens ?? usage.prompt_tokens ?? 0;
  tokenSum[provider].output += usage.output_tokens ?? usage.completion_tokens ?? 0;
  tokenSum[provider].observedCost += usage.cost ?? 0;
}
console.log('GREEN_RUN ' + JSON.stringify({ sessionId: green,
  submissionSeconds: Number(((reviewStarted - greenStarted) / 1000).toFixed(2)),
  reviewSeconds: Number(((performance.now() - reviewStarted) / 1000).toFixed(2)),
  modelUsage: tokenSum }));

const { id: red } = await openRequest(['receipt-red.png'], {
  excessReason: 'Extra meals were required due to the schedule of the lab installation.',
});
const redDraft = await waitFor(red, (state) => state.status === 'waiting_for_send_confirmation' && state.draft);
assert.equal(redDraft.calculation.standardCents, 16000);
assert.equal(redDraft.calculation.excessCents, 2000);
await submit(red, redDraft.draft);
const { check: redCheck } = await importAndCheck(red, redDraft.revision);
assert.equal(redCheck.verdict, 'red');
assert.ok(redCheck.findings.some(({ code }) => code === 'MEAL_LIMIT_EXCEEDED'));
await call('/api/approvals/' + red + '/approve', {
  cookie: reviewer, body: { revision: redDraft.revision, checkId: redCheck.id }, status: 409,
});
await call('/api/sessions/' + red + '/reopen', { cookie: employee, body: {}, status: 204 });
await call('/api/sessions/' + red + '/messages', {
  cookie: employee, body: { field: 'purpose', value: 'Reviewed the campus lab installation schedule and contingency with the external partner.' },
});
const revised = await waitFor(red, (state) => state.status === 'waiting_for_send_confirmation'
  && state.revision > redDraft.revision);
await call('/api/approvals/' + red + '/approve', {
  cookie: reviewer, body: { revision: redDraft.revision, checkId: redCheck.id }, status: 409,
});
assert.equal((await mailState(red, revised.draft)).length, 0);
console.log('PASS red: separate $20 overage and stale-version rejection');

const restricted = await openRequest(['receipt-red.png'], { date: '2026-07-02', type: 'other',
  excessReason: 'Recorded for a manual policy review.' });
const restrictedDraft = await waitFor(restricted.id, (state) => state.status === 'waiting_for_send_confirmation' && state.draft);
await submit(restricted.id, restrictedDraft.draft);
const { check: restrictedCheck } = await importAndCheck(restricted.id, restrictedDraft.revision);
assert.equal(restrictedCheck.verdict, 'red');
assert.ok(restrictedCheck.findings.some(({ code }) => code === 'EVENT_TYPE_REVIEW_REQUIRED'));
const days = (Date.parse(today) - Date.parse('2026-07-02')) / 86400000;
if (days > 60) assert.ok(restrictedCheck.findings.some(({ code }) => code === 'SUBMISSION_OR_APPROVAL_AFTER_60_DAYS'));
console.log('PASS restricted: unsupported event and date policy');
const tampered = await openRequest(['receipt-red.png'], {
  attendees: 3, excessReason: 'Fixture for validating attachment integrity.',
});
const tamperedDraft = await waitFor(tampered.id, (state) => state.status === 'waiting_for_send_confirmation' && state.draft);
await submit(tampered.id, tamperedDraft.draft);
const [ownTestMessage] = await mailState(tampered.id, tamperedDraft.draft);
const original = await mailpit.message(ownTestMessage.ID);
assert.ok(ownTestMessage.MessageID.includes(tampered.id));
const deleted = await fetch((process.env.MAILPIT_BASE_URL ?? 'http://mailpit:8025') + '/api/v1/messages', {
  method: 'DELETE', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ IDs: [ownTestMessage.ID] }), signal: AbortSignal.timeout(10000),
});
assert.ok(deleted.ok);
const smtp = nodemailer.createTransport({ host: process.env.SMTP_HOST ?? 'mailpit',
  port: Number(process.env.SMTP_PORT ?? 1025), connectionTimeout: 5000, socketTimeout: 10000 });
await smtp.sendMail({
  from: tamperedDraft.draft.from, to: tamperedDraft.draft.to, subject: tamperedDraft.draft.subject,
  text: original.Text, messageId: '<' + tamperedDraft.draft.messageId + '>',
  headers: { 'X-Expense-Session': tampered.id, 'X-Expense-Revision': String(tamperedDraft.revision) },
  attachments: [{ filename: 'receipt-red.png', contentType: 'image/png',
    content: Buffer.concat([tampered.originals[0], Buffer.from('synthetic mutation')]) }],
});
const { check: tamperedCheck } = await importAndCheck(tampered.id, tamperedDraft.revision);
assert.equal(tamperedCheck.verdict, 'red');
assert.ok(tamperedCheck.findings.some(({ code }) => code === 'ATTACHMENT_HASH_MISMATCH'),
  JSON.stringify(tamperedCheck.findings));
console.log('PASS modified attachment: changed bytes in an actual Mailpit message');
console.log('PASS verification in ' + ((performance.now() - start) / 1000).toFixed(1) + ' s');
