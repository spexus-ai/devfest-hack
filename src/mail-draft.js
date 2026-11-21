import { extractionKey } from './workflow.js';

export const accountingAddress = 'accounting@example.test';
const payloadStart = 'BEGIN EXPENSE DATA';
const payloadEnd = 'END EXPENSE DATA';

export function readExpensePayload(text) {
  const match = typeof text === 'string' && text.match(/(?:^|\r?\n)BEGIN EXPENSE DATA\r?\n([^\r\n]+)\r?\nEND EXPENSE DATA(?:\r?\n|$)/);
  if (!match) throw new Error('The email is missing the structured request data.');
  return JSON.parse(match[1]);
}

const amount = (value, currency = 'USD') => (value / 100).toFixed(2) + ' ' + currency;

export function prepareMailDraft(store, session) {
  return store.atomic(() => {
    const attachments = store.listReceipts(session.id).map(({ id, filename, sha256, path, mime }) => ({
      id, filename, sha256, path, mime,
    }));
    const { calculation } = session;
    const conversionDetails = calculation.conversions?.length ? { conversions: calculation.conversions } : {};
    const receiptContext = Object.fromEntries(['date', 'time'].filter((field) => session.contextSources?.[field]?.source === 'receipt')
      .map((field) => [field, session.contextSources[field].evidence]));
    const contextEvidence = Object.keys(receiptContext).length ? { receiptContext } : {};
    const receiptTaxes = (session.reviewReceipts ?? []).filter((receipt) => receipt.tax?.cents != null)
      .map(({ receiptId, currency, tax }) => ({ receiptId, currency: currency.value, ...tax }));
    const taxDetails = receiptTaxes.length ? { receiptTaxes } : {};
    const amounts = {
      receiptTotalCents: calculation.receiptTotalCents, standardCents: calculation.standardCents,
      excessCents: calculation.excessCents, excludedCents: calculation.excludedCents,
      requestedCents: calculation.requestedCents,
    };
    const fingerprint = extractionKey({
      context: session.context, ...contextEvidence, amounts, ...taxDetails, ...conversionDetails, findings: session.findings, policy: session.policy.sha256,
      attachments: attachments.map(({ sha256 }) => sha256), corrections: session.corrections ?? [],
    });
    const latest = session.revision ? store.getDraft(session.id, session.revision) : null;
    if (latest?.status === 'draft' && latest.fingerprint === fingerprint) return latest;

    const revision = (session.revision || 0) + 1;
    const subject = 'Expense reimbursement request · ' + session.context.date + ' · v' + revision;
    const payload = {
      sessionId: session.id, revision, claimantId: session.claimantId, claimantName: session.claimantName,
      claimantEmail: session.claimantEmail, policyId: session.policy.id, policyHash: session.policy.sha256,
      context: session.context, ...contextEvidence, amounts, ...taxDetails, ...conversionDetails, findings: session.findings.map(({ code }) => code),
      attachments: attachments.map(({ id, filename, sha256 }) => ({ id, filename, sha256 })),
      corrections: session.corrections ?? [],
    };
    const preview = [
      'Please review the attached expense reimbursement request.',
      'Employee: ' + session.claimantName,
      'Event: ' + [session.context.date, session.context.time, session.context.type, session.context.attendees + ' attendees'].filter(Boolean).join(' / '),
      'Purpose: ' + session.context.purpose,
      'Funding: ' + session.context.funding,
      'Paid by applicant: ' + session.context.paidByClaimant,
      'Prior reimbursement: ' + amount(session.context.priorReimbursementCents ?? 0),
      'Receipts total: ' + amount(amounts.receiptTotalCents),
      'Within limit: ' + amount(amounts.standardCents),
      'Requires exception approval: ' + amount(amounts.excessCents),
      'Excluded: ' + amount(amounts.excludedCents),
      'Requested: ' + amount(amounts.requestedCents),
      ...receiptTaxes.map(({ receiptId, cents, currency, treatment }) => {
        const filename = attachments.find(({ id }) => id === receiptId)?.filename;
        const note = { included: 'included in item prices', added: 'added to item prices' }[treatment];
        return `Tax (${filename ?? receiptId}): ${amount(cents, currency)}${note ? ' (' + note + ')' : ''}`;
      }),
      ...(calculation.conversions ?? []).map(({ receiptId, currency, sourceCents, usdCents, rate }) => {
        const filename = attachments.find(({ id }) => id === receiptId)?.filename;
        return `Currency conversion (${filename ?? receiptId}): ${amount(sourceCents, currency)} → ${amount(usdCents)} (1 ${currency} = ${rate.numerator / rate.denominator} USD)`;
      }),
      ...(session.context.excessReason ? ['Exception justification: ' + session.context.excessReason] : []),
      '',
      ...calculation.items.map((item) =>
        (item.excluded ? 'Excluded: ' : 'Item: ') + item.description + ' — ' + amount(item.cents)
        + (item.sourceCurrency ? ' (' + amount(item.sourceCents, item.sourceCurrency) + ')' : '')
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
        ...taxDetails, ...conversionDetails, attachments: payload.attachments } });
    return draft;
  });
}

export function visibleDraft(draft) {
  if (!draft) return null;
  const { revision, from, to, subject, preview, status, messageId, attachments } = draft;
  return { revision, from, to, subject, preview, status, messageId,
    attachments: attachments.map(({ id, filename, sha256 }) => ({ id, filename, sha256 })) };
}
