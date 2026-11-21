import { extractionKey } from './workflow.js';

export const accountingAddress = 'accounting@example.test';
const payloadStart = 'BEGIN EXPENSE DATA';
const payloadEnd = 'END EXPENSE DATA';

export function readExpensePayload(text) {
  const match = typeof text === 'string' && text.match(/(?:^|\r?\n)BEGIN EXPENSE DATA\r?\n([^\r\n]+)\r?\nEND EXPENSE DATA(?:\r?\n|$)/);
  if (!match) throw new Error('В письме отсутствуют структурированные данные заявки.');
  return JSON.parse(match[1]);
}

const usd = (value) => (value / 100).toFixed(2) + ' USD';

export function prepareMailDraft(store, session) {
  return store.atomic(() => {
    const attachments = store.listReceipts(session.id).map(({ id, filename, sha256, path, mime }) => ({
      id, filename, sha256, path, mime,
    }));
    const { calculation } = session;
    const amounts = {
      receiptTotalCents: calculation.receiptTotalCents, standardCents: calculation.standardCents,
      excessCents: calculation.excessCents, excludedCents: calculation.excludedCents,
      requestedCents: calculation.requestedCents,
    };
    const fingerprint = extractionKey({
      context: session.context, amounts, findings: session.findings, policy: session.policy.sha256,
      attachments: attachments.map(({ sha256 }) => sha256), corrections: session.corrections ?? [],
    });
    const latest = session.revision ? store.getDraft(session.id, session.revision) : null;
    if (latest?.status === 'draft' && latest.fingerprint === fingerprint) return latest;

    const revision = (session.revision || 0) + 1;
    const subject = 'Expense reimbursement request · ' + session.context.date + ' · v' + revision;
    const payload = {
      sessionId: session.id, revision, claimantId: session.claimantId, claimantName: session.claimantName,
      claimantEmail: session.claimantEmail, policyId: session.policy.id, policyHash: session.policy.sha256,
      context: session.context, amounts, findings: session.findings.map(({ code }) => code),
      attachments: attachments.map(({ id, filename, sha256 }) => ({ id, filename, sha256 })),
      corrections: session.corrections ?? [],
    };
    const preview = [
      'Please review the attached expense reimbursement request.',
      'Employee: ' + session.claimantName,
      'Event: ' + session.context.date + ' / ' + session.context.type + ' / ' + session.context.attendees + ' attendees',
      'Purpose: ' + session.context.purpose,
      'Funding: ' + session.context.funding,
      'Paid by applicant: ' + session.context.paidByClaimant,
      'Prior reimbursement: ' + usd(session.context.priorReimbursementCents),
      'Receipts total: ' + usd(amounts.receiptTotalCents),
      'Within limit: ' + usd(amounts.standardCents),
      'Requires exception approval: ' + usd(amounts.excessCents),
      'Excluded: ' + usd(amounts.excludedCents),
      'Requested: ' + usd(amounts.requestedCents),
      ...(session.context.excessReason ? ['Exception justification: ' + session.context.excessReason] : []),
      '',
      ...calculation.items.map((item) =>
        (item.excluded ? 'Excluded: ' : 'Item: ') + item.description + ' — ' + usd(item.cents)
        + (item.reason ? ' (' + item.reason + ')' : '')),
      ...session.findings.map(({ code, message }) => code + ': ' + message),
    ].join('\n');
    const messageId = session.id + '.' + revision + '@expense-autopilot.example.test';
    const draft = store.addDraft({
      sessionId: session.id, revision, fingerprint, status: 'draft', from: session.claimantEmail,
      to: accountingAddress, subject, preview, payload, attachments, messageId,
      text: [preview, '', payloadStart, JSON.stringify(payload), payloadEnd].join('\n'),
    });
    store.updateSession(session.id, () => ({ revision }),
      { type: 'draft_created', data: { revision, messageId, amounts, policyHash: payload.policyHash,
        attachments: payload.attachments } });
    return draft;
  });
}

export function visibleDraft(draft) {
  if (!draft) return null;
  const { revision, from, to, subject, preview, status, messageId, attachments } = draft;
  return { revision, from, to, subject, preview, status, messageId,
    attachments: attachments.map(({ id, filename, sha256 }) => ({ id, filename, sha256 })) };
}
